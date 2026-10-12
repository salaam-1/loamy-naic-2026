// Supabase Edge Function (Deno) — escrow-initialize
// Starts a Paystack charge to FUND ESCROW for an awarded bid. Funds are held by
// the payment partner (Paystack), never by Loamy. Uses the Paystack SECRET key
// and the Supabase SERVICE ROLE key — neither may ever reach the browser.
//
// Deploy:  supabase functions deploy escrow-initialize
// Secrets: PAYSTACK_SECRET_KEY, APP_URL (reused from the marketplace setup)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')
  const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173'
  if (!SECRET) return json({ error: 'Payments are not configured yet.' }, 503)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return json({ error: 'Not signed in.' }, 401)
  const caller = userData.user.id

  let award_id: string | undefined
  try { award_id = (await req.json())?.award_id } catch { /* ignore */ }
  if (!award_id) return json({ error: 'award_id is required.' }, 400)

  // Load the award + its RFQ (for company + supplier + server-side amount).
  const { data: award } = await admin
    .from('rfq_awards')
    .select('id, rfq_id, supplier_id, awarded_quantity, awarded_price, status')
    .eq('id', award_id).maybeSingle()
  if (!award) return json({ error: 'Award not found.' }, 404)
  const { data: rfqRow } = await admin.from('rfqs').select('id, company_id').eq('id', award.rfq_id).maybeSingle()
  if (!rfqRow) return json({ error: 'Buy request not found.' }, 404)

  // Authorise: caller must be an owner / Procurement Director / Finance Officer.
  const { data: member } = await admin
    .from('company_members').select('company_role, is_owner')
    .eq('company_id', rfqRow.company_id).eq('user_id', caller).maybeSingle()
  const canSettle = !!member && (member.is_owner || ['Procurement Director', 'Finance Officer'].includes(member.company_role))
  if (!canSettle) return json({ error: 'Only a Finance Officer or Procurement Director can fund escrow.' }, 403)

  // Server-computed amount — never trust the client.
  const amount = Number(award.awarded_quantity) * Number(award.awarded_price)
  const amountKobo = Math.round(amount * 100)
  if (amountKobo <= 0) return json({ error: 'Award value must be greater than zero.' }, 400)

  // Idempotency: don't re-fund an already funded/released escrow.
  const { data: existing } = await admin
    .from('escrow_transactions').select('id, status, authorization_url').eq('award_id', award_id).maybeSingle()
  if (existing && ['funded', 'released', 'partially_released'].includes(existing.status)) {
    return json({ error: 'This award’s escrow is already funded.' }, 409)
  }

  const { data: buyer } = await admin.auth.admin.getUserById(caller)
  const email = buyer.user?.email
  if (!email) return json({ error: 'No email on file to receipt the payment.' }, 400)

  const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, amount: amountKobo, currency: 'NGN',
      metadata: { escrow: true, award_id: award.id, company_id: rfqRow.company_id, supplier_id: award.supplier_id },
      callback_url: `${APP_URL}/dashboard/processor/rfqs?funded=${award.id}`,
    }),
  })
  const ps = await psRes.json()
  if (!psRes.ok || !ps.status) return json({ error: ps.message ?? 'Paystack initialise failed.' }, 502)

  const reference = ps.data.reference as string
  const authorization_url = ps.data.authorization_url as string

  const { data: txn } = await admin.from('escrow_transactions').upsert(
    {
      award_id: award.id, rfq_id: award.rfq_id, company_id: rfqRow.company_id, supplier_id: award.supplier_id,
      provider: 'paystack', provider_reference: reference, authorization_url,
      amount, currency: 'NGN', status: 'initiated', updated_at: new Date().toISOString(),
    },
    { onConflict: 'award_id' },
  ).select('id').single()

  if (txn) {
    await admin.from('escrow_events').insert({
      escrow_transaction_id: txn.id, event_type: 'initiated', actor_id: caller,
      payload: { reference, amount },
    })
  }

  return json({ authorization_url, reference })
})
