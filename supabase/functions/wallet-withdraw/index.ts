// Supabase Edge Function (Deno) — wallet-withdraw
// RETIRED 2026-09-22. Refuses every call.
//
// A withdrawal presumes a custodial balance to withdraw FROM. Loamy holds no
// member funds: the wallet UI was removed in the completion sprint, and
// wallet_entries and wallet_withdrawals now refuse new rows at the database.
//
// This function moved real money out of Loamy's Paystack balance, so leaving
// it live while the rest of the model says "not a custodian" was the single
// most dangerous inconsistency left in the system. It refuses rather than
// being deleted so a stale caller gets a clear answer rather than a 404.
//
// Sellers are settled by the institution, directly, and Loamy records the
// reference -- see loamy_record_supplier_settlement.
//
// Deploy: supabase functions deploy wallet-withdraw
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  return json({
    error: 'Withdrawals have been retired.',
    detail:
      'Loamy is not a custodian and holds no member balance, so there is ' +
      'nothing to withdraw. Sellers are settled directly by the institution.',
    retired: '2026-09-22',
  }, 410)
})
