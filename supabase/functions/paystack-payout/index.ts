// Supabase Edge Function (Deno) — paystack-payout
// RETIRED 2026-09-22. Refuses every call.
//
// WHAT IT DID
//   Settled a released `orders` row into the seller's Loamy WALLET. It wrote
//   the wallet_entries row Wave 1 QA found, and it is the last live caller of
//   the deprecated orders path.
//
// WHY IT IS RETIRED RATHER THAN REPOINTED
//   Two reasons, either of which is sufficient.
//
//   1. It presumes a custodial balance. Loamy holds no member funds; the
//      wallet was closed and wallet_entries now refuses new rows.
//   2. It settles an ORDER. Phase 4 slice 1 made `transactions` the
//      authoritative spine and deprecated `orders`; checkout has not created
//      an order since. Repointing this at the ledger would keep the
//      deprecated model alive at the exact moment it should end.
//
//   A released order that predates the change is settled by the institution
//   off-platform and recorded through loamy_record_supplier_settlement, like
//   every other settlement.
//
// It refuses rather than being deleted so that a stale client calling it gets
// a clear answer instead of a 404 it might retry.
//
// Deploy: supabase functions deploy paystack-payout
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  return json({
    error: 'Order settlement through the Loamy wallet has been retired.',
    detail:
      'Loamy holds no member funds. The deprecated orders path is closed; ' +
      'purchases settle through the transaction spine, and an institution ' +
      'records its own settlement via loamy_record_supplier_settlement.',
    retired: '2026-09-22',
  }, 410)
})
