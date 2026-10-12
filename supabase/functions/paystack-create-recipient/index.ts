// Supabase Edge Function (Deno) — paystack-create-recipient
// Validates a seller's bank account with Paystack, creates a transfer recipient,
// and saves it (recipient_code) so future payouts can transfer to them. Uses the
// secret + service-role keys, so it runs server-side.
//
// Deploy: supabase functions deploy paystack-create-recipient
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

  const SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')
  if (!SECRET) return json({ error: 'Payments are not configured yet.' }, 503)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return json({ error: 'Not signed in.' }, 401)
  const caller = userData.user.id

  let body: { bank_code?: string; account_number?: string; bank_name?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  const bank_code = String(body.bank_code ?? '').trim()
  const account_number = String(body.account_number ?? '').trim()
  if (!bank_code || !/^\d{10}$/.test(account_number)) {
    return json({ error: 'Enter a valid 10-digit account number and select a bank.' }, 400)
  }

  const ps = (path: string, init?: RequestInit) =>
    fetch(`https://api.paystack.co${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    }).then((r) => r.json())

  // 1) Resolve the account name.
  const resolve = await ps(`/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`)
  if (!resolve.status) return json({ error: resolve.message ?? 'Could not verify that account.' }, 422)
  const account_name = resolve.data.account_name as string

  // 2) Create (or re-create) the transfer recipient.
  const recip = await ps('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({ type: 'nuban', name: account_name, account_number, bank_code, currency: 'NGN' }),
  })
  if (!recip.status) return json({ error: recip.message ?? 'Could not save that account.' }, 502)
  const recipient_code = recip.data.recipient_code as string

  // 3) Persist it (one payout account per seller).
  const nowIso = new Date().toISOString()
  const { error: upErr } = await admin.from('seller_payout_accounts').upsert({
    user_id: caller,
    bank_code,
    bank_name: body.bank_name ?? null,
    account_number,
    account_name,
    recipient_code,
    updated_at: nowIso,
  })
  if (upErr) return json({ error: upErr.message }, 500)

  return json({ account_name, recipient_code })
})
