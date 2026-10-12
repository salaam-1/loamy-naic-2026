// Supabase Edge Function (Deno) — paystack-webhook
// Paystack calls this server-to-server when a charge succeeds. It verifies the
// signature with the SECRET key, then moves the order into escrow. Paystack does
// not send a Supabase JWT, so deploy with --no-verify-jwt.
//
// Deploy:  supabase functions deploy paystack-webhook --no-verify-jwt
// Webhook: set this function's URL in Paystack Dashboard → Settings → API/Webhooks.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.2'
import { createHmac } from 'node:crypto'

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')
  if (!SECRET) return new Response('Not configured', { status: 503 })

  // Verify the payload signature over the RAW body.
  const raw = await req.text()
  // NOTE: named expectedSignature, not `expected`. A second `const expected`
  // further down (the expected kobo amount) collided with it in the same
  // scope, which is a SyntaxError -- the module never instantiated and every
  // Paystack delivery returned BOOT_ERROR. Keep these names distinct.
  const expectedSignature = createHmac('sha512', SECRET).update(raw).digest('hex')
  const signature = req.headers.get('x-paystack-signature') ?? ''
  if (signature !== expectedSignature) return new Response('Invalid signature', { status: 401 })

  let event: {
    event?: string
    data?: {
      reference?: string
      status?: string
      transfer_code?: string
      reason?: string
      metadata?: { order_id?: string; escrow?: boolean; award_id?: string }
    }
  }
  try { event = JSON.parse(raw) } catch { return new Response('Bad JSON', { status: 400 }) }

  const admin0 = createClient(SUPABASE_URL, SERVICE_ROLE)

  // ---- Wallet withdrawal outcomes: RETIRED 2026-09-22 ---------------------
  // Withdrawals are closed. Loamy holds no member balance, wallet-withdraw
  // refuses every call, and wallet_entries/wallet_withdrawals refuse new rows
  // at the database -- so a transfer.* event can only be for a withdrawal
  // that predates the change, or a replay.
  //
  // It is ACKNOWLEDGED rather than acted on: writing the reversal credit
  // would now raise, and Paystack would retry a webhook that can never
  // succeed. Nothing is silently discarded -- the event is recorded so a
  // straggler is visible to whoever has to reconcile it.
  if (event.event?.startsWith('transfer.')) {
    const ref = event.data?.reference
    if (ref?.startsWith('loamy-wd-')) {
      await admin0.from('audit_events').insert({
        event_type: 'retired_withdrawal_webhook',
        subject_type: 'wallet_withdrawal',
        detail: {
          provider_event: event.event,
          reference: ref,
          reason: event.data?.reason ?? null,
          note: 'Withdrawals were retired on 2026-09-22. No balance was changed.',
        },
      })
    }
    return new Response('ok', { status: 200 })
  }

  // Respond 200 to anything we don't act on so Paystack stops retrying.
  if (event.event !== 'charge.success') return new Response('ignored', { status: 200 })

  const reference = event.data?.reference
  const orderId = event.data?.metadata?.order_id
  const isEscrow = event.data?.metadata?.escrow === true || !!event.data?.metadata?.award_id
  if (!reference) return new Response('ok', { status: 200 })

  const admin = admin0

  // Double-check with Paystack (never trust the payload alone).
  const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  })
  const verify = await verifyRes.json()
  if (!verifyRes.ok || verify?.data?.status !== 'success') return new Response('unverified', { status: 200 })

  // ---- Processor escrow funding -------------------------------------------
  // A charge that funds an award's escrow. Amount is cross-checked against the
  // server-computed escrow amount; the funded transition is idempotent.
  if (isEscrow) {
    const nowIso = new Date().toISOString()
    const paidKobo = Number(verify.data?.amount)
    const { data: esc } = await admin
      .from('escrow_transactions')
      .select('id, company_id, supplier_id, amount, status')
      .eq('provider_reference', reference)
      .maybeSingle()
    if (!esc) return new Response('ok', { status: 200 })

    // Idempotency: a replay after funding must never re-fund.
    if (['funded', 'released', 'partially_released'].includes(esc.status)) return new Response('ok', { status: 200 })

    const expectedKobo = Math.round(Number(esc.amount) * 100)
    if (paidKobo !== expectedKobo) {
      await admin.from('escrow_events').insert({
        escrow_transaction_id: esc.id, event_type: 'amount_mismatch',
        payload: { reference, paid: paidKobo, expected: expectedKobo },
      })
      return new Response('amount mismatch', { status: 200 })
    }

    await admin.from('escrow_transactions')
      .update({ status: 'funded', funded_at: nowIso, updated_at: nowIso })
      .eq('id', esc.id)
    await admin.from('escrow_events').insert({
      escrow_transaction_id: esc.id, event_type: 'funded', payload: { reference, amount: esc.amount },
    })
    await admin.from('notifications').insert([
      { user_id: esc.supplier_id, title: 'Escrow funded', body: 'The buyer funded escrow for your award — the funds are held by our payment partner until release.', type: 'escrow' },
    ])
    return new Response('ok', { status: 200 })
  }

  const resolvedOrderId = orderId ?? verify.data?.metadata?.order_id
  const nowIso = new Date().toISOString()
  const paidAmount = Number(verify.data?.amount)

  // Load the order so we can cross-check the amount before trusting the charge.
  const { data: order } = resolvedOrderId
    ? await admin
        .from('orders')
        .select('id, buyer_id, seller_id, status, subtotal')
        .eq('id', resolvedOrderId)
        .maybeSingle()
    : { data: null }

  // The paid amount MUST equal the server-set order total (in kobo). A mismatch
  // is anomalous — record it as failed and never move funds into escrow.
  const expectedKobo = order ? Math.round(Number(order.subtotal) * 100) : null
  if (expectedKobo !== null && paidAmount !== expectedKobo) {
    await admin
      .from('order_payments')
      .update({ status: 'failed', meta: { ...verify.data, amount_mismatch: true, expected: expectedKobo }, updated_at: nowIso })
      .eq('reference', reference)
    return new Response('amount mismatch', { status: 200 })
  }

  await admin
    .from('order_payments')
    .update({ status: 'paid', paid_at: nowIso, meta: verify.data, updated_at: nowIso })
    .eq('reference', reference)

  if (order && ['awaiting_payment', 'confirmed'].includes(order.status)) {
    await admin.from('orders').update({ status: 'in_escrow', updated_at: nowIso }).eq('id', order.id)
    await admin.from('notifications').insert([
      { user_id: order.buyer_id, title: 'Payment secured', body: 'Your payment is held safely in escrow until you confirm receipt.', type: 'marketplace' },
      { user_id: order.seller_id, title: 'Order paid', body: 'The buyer has paid — funds are in escrow. You can prepare to fulfil the order.', type: 'marketplace' },
    ])
  }

  return new Response('ok', { status: 200 })
})
