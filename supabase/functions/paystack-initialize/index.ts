// Supabase Edge Function (Deno) — paystack-initialize
// Starts a Paystack charge for a CONFIRMED order. Runs server-side because it
// uses the Paystack SECRET key and the Supabase SERVICE ROLE key, neither of
// which may ever reach the browser.
//
// Deploy:  supabase functions deploy paystack-initialize
// Secrets: supabase secrets set PAYSTACK_SECRET_KEY=sk_test_... APP_URL=http://localhost:5173
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
  const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY')
  const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173'
  if (!PAYSTACK_SECRET_KEY) return json({ error: 'Payments are not configured yet.' }, 503)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Identify the caller from their JWT.
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return json({ error: 'Not signed in.' }, 401)
  const caller = userData.user.id

  let order_id: string | undefined
  try { order_id = (await req.json())?.order_id } catch { /* ignore */ }
  if (!order_id) return json({ error: 'order_id is required.' }, 400)

  // Load + authorise the order.
  const { data: order } = await admin
    .from('orders')
    .select('id, buyer_id, seller_id, status, subtotal, currency')
    .eq('id', order_id)
    .maybeSingle()
  if (!order) return json({ error: 'Order not found.' }, 404)
  if (order.buyer_id !== caller) return json({ error: 'Only the buyer can pay for this order.' }, 403)
  if (!['confirmed', 'awaiting_payment'].includes(order.status))
    return json({ error: `This order cannot be paid (status: ${order.status}).` }, 409)

  // Buyer email for the Paystack receipt.
  const { data: buyer } = await admin.auth.admin.getUserById(order.buyer_id)
  const email = buyer.user?.email
  if (!email) return json({ error: 'No email on file for the buyer.' }, 400)

  const amountKobo = Math.round(Number(order.subtotal) * 100)
  if (amountKobo <= 0) return json({ error: 'Order total must be greater than zero.' }, 400)

  // Initialise the Paystack transaction.
  const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      amount: amountKobo,
      currency: order.currency ?? 'NGN',
      metadata: { order_id: order.id, buyer_id: order.buyer_id, seller_id: order.seller_id },
      callback_url: `${APP_URL}/orders?paid=${order.id}`,
    }),
  })
  const ps = await psRes.json()
  if (!psRes.ok || !ps.status) return json({ error: ps.message ?? 'Paystack initialise failed.' }, 502)

  const reference = ps.data.reference as string
  const authorization_url = ps.data.authorization_url as string

  // Record the attempt and move the order to awaiting_payment.
  await admin.from('order_payments').upsert(
    {
      order_id: order.id,
      provider: 'paystack',
      reference,
      amount: Number(order.subtotal),
      currency: order.currency ?? 'NGN',
      status: 'initialized',
      authorization_url,
    },
    { onConflict: 'reference' },
  )
  await admin.from('orders').update({ status: 'awaiting_payment', updated_at: new Date().toISOString() }).eq('id', order.id)

  return json({ authorization_url, reference })
})
