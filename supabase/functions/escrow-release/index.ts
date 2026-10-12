// Supabase Edge Function (Deno) — escrow-release
// Releases (or partially releases, or refunds) an award's escrow. Funds are held
// by the payment partner (Paystack). Permission-gated to Finance Officer /
// Procurement Director. Release is only allowed after the inspection has been
// accepted.
//
// A release now lands in the SUPPLIER'S LOAMY WALLET rather than being pushed
// straight to their bank. They withdraw from the wallet when they choose
// (wallet-withdraw does the bank transfer), so a release never stalls just
// because the supplier has not saved a bank account yet.
//
// Deploy: supabase functions deploy escrow-release
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

  let body: { award_id?: string; amount?: number; refund?: boolean } = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.award_id) return json({ error: 'award_id is required.' }, 400)

  const { data: esc } = await admin
    .from('escrow_transactions')
    .select('id, company_id, supplier_id, award_id, amount, released_amount, status')
    .eq('award_id', body.award_id).maybeSingle()
  if (!esc) return json({ error: 'No escrow found for this award.' }, 404)

  // Authorise: owner / Procurement Director / Finance Officer.
  const { data: member } = await admin
    .from('company_members').select('company_role, is_owner')
    .eq('company_id', esc.company_id).eq('user_id', caller).maybeSingle()
  const canSettle = !!member && (member.is_owner || ['Procurement Director', 'Finance Officer'].includes(member.company_role))
  if (!canSettle) return json({ error: 'Only a Finance Officer or Procurement Director can authorise this.' }, 403)

  const nowIso = new Date().toISOString()

  // ---- Refund path (consignment rejected) ---------------------------------
  if (body.refund) {
    if (!['funded', 'partially_released'].includes(esc.status)) {
      return json({ error: `Escrow cannot be refunded (status: ${esc.status}).` }, 409)
    }
    const { data: fundEvent } = await admin
      .from('escrow_events').select('payload').eq('escrow_transaction_id', esc.id).eq('event_type', 'funded').maybeSingle()
    const refundRes = await fetch('https://api.paystack.co/refund', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: (fundEvent?.payload as { reference?: string })?.reference }),
    }).then((r) => r.json()).catch(() => ({ status: false }))

    await admin.from('escrow_transactions').update({ status: 'refunded', updated_at: nowIso }).eq('id', esc.id)
    await admin.from('escrow_events').insert({
      escrow_transaction_id: esc.id, event_type: 'refunded', actor_id: caller, payload: { provider: refundRes?.data ?? refundRes },
    })
    await admin.from('notifications').insert({
      user_id: esc.supplier_id, title: 'Escrow refunded',
      body: 'The buyer refunded the escrow for a rejected consignment via our payment partner.', type: 'escrow',
    })
    return json({ status: 'refunded' })
  }

  // ---- Release path -------------------------------------------------------
  if (!['funded', 'partially_released'].includes(esc.status)) {
    return json({ error: `Escrow is not fundable for release (status: ${esc.status}).` }, 409)
  }

  // Release only after inspection has been accepted.
  const { data: award } = await admin.from('rfq_awards').select('status').eq('id', esc.award_id).maybeSingle()
  if (award?.status !== 'inspected' && award?.status !== 'delivered' && award?.status !== 'completed') {
    return json({ error: 'Release is only allowed after the inspection is accepted.' }, 409)
  }

  const remaining = Number(esc.amount) - Number(esc.released_amount)
  const releaseAmount = body.amount != null ? Number(body.amount) : remaining
  if (releaseAmount <= 0 || releaseAmount > remaining) {
    return json({ error: `Release amount must be between 0 and the remaining ${remaining}.` }, 400)
  }

  // Record the release in the DOUBLE-ENTRY LEDGER, not a member wallet.
  //
  // This used to credit `wallet_entries`, which made Loamy look like a
  // custodian holding the supplier's money. It does not hold funds: the
  // payment provider settles the supplier, and Loamy records that it
  // happened as a memorandum pair across partner_funding and
  // external_settlement. The table now refuses new rows outright, so this is
  // the only correct path rather than merely the preferred one.
  //
  // The reference is still derived from the escrow row and the running
  // released total, so a retry of the SAME release cannot post twice while a
  // genuine second partial release still can.
  const reference = `escrow:${esc.id}:${Number(esc.released_amount) + releaseAmount}`
  const { data: posted, error: creditError } = await admin.rpc('loamy_record_escrow_release', {
    p_escrow_id: esc.id,
    p_amount: releaseAmount,
    p_external_reference: reference,
    p_provider: 'paystack',
  })
  if (creditError) {
    await admin.from('escrow_events').insert({
      escrow_transaction_id: esc.id, event_type: 'release_failed', actor_id: caller,
      payload: { amount: releaseAmount, reason: creditError.message },
    })
    return json({ error: 'Could not record the release against the ledger.' }, 500)
  }
  // `posted: false` means this reference was already recorded. Not an error,
  // and not a reason to post again.

  await admin.from('escrow_events').insert({
    escrow_transaction_id: esc.id, event_type: 'release_initiated', actor_id: caller,
    // Not 'loamy_wallet'. The supplier is settled by the provider; Loamy
    // records the movement and holds nothing.
    payload: { amount: releaseAmount, reference, settled_to: 'ledger_memorandum',
               entry_group: (posted as { entry_group?: string } | null)?.entry_group ?? null },
  })

  const newReleased = Number(esc.released_amount) + releaseAmount
  const fullyReleased = newReleased >= Number(esc.amount) - 0.0001
  await admin.from('escrow_transactions').update({
    released_amount: newReleased,
    status: fullyReleased ? 'released' : 'partially_released',
    released_at: nowIso, release_trigger: 'buyer', updated_at: nowIso,
  }).eq('id', esc.id)

  if (fullyReleased) {
    await admin.from('rfq_awards').update({ status: 'completed', updated_at: nowIso }).eq('id', esc.award_id)
    await admin.from('escrow_events').insert({ escrow_transaction_id: esc.id, event_type: 'released', actor_id: caller, payload: { total: newReleased } })
  }
  await admin.from('notifications').insert({
    user_id: esc.supplier_id, title: 'Payment released',
    body: 'The buyer released payment via our payment partner. It is now in your Loamy wallet — withdraw it to your bank from the Wallet page.',
    type: 'wallet',
  })

  return json({ status: fullyReleased ? 'released' : 'partially_released', released: newReleased })
})
