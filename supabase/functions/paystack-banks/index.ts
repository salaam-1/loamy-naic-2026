// Supabase Edge Function (Deno) — paystack-banks
// Returns the Paystack NUBAN bank list for the payout-account picker. Uses the
// secret key, so it runs server-side. Any signed-in user may call it.
//
// Deploy: supabase functions deploy paystack-banks
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')
  if (!SECRET) return json({ error: 'Payments are not configured yet.' }, 503)

  // Require a signed-in caller.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return json({ error: 'Not signed in.' }, 401)

  const res = await fetch('https://api.paystack.co/bank?currency=NGN&perPage=100', {
    headers: { Authorization: `Bearer ${SECRET}` },
  })
  const data = await res.json()
  if (!res.ok || !data.status) return json({ error: data.message ?? 'Could not load banks.' }, 502)

  const banks = (data.data as { name: string; code: string }[]).map((b) => ({ name: b.name, code: b.code }))
  return json({ banks })
})
