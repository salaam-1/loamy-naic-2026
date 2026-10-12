/**
 * Harvest → batch → listing → trace: live verification.
 * Run with: node scripts/verify-stock-spine.mjs
 *
 * The forensic audit found that nothing under src/ touched `harvests` or
 * `commodity_batches`, so the batch spine was unreachable from the product no
 * matter how complete the backend was. The UI now reaches it. This script
 * proves the whole path actually works against the LIVE project, because a
 * screen existing is not evidence that a feature does.
 *
 * Two throwaway accounts, publishable key only — everything runs under RLS,
 * exactly as a real member's browser would.
 *
 * What it asserts, in order:
 *   1. a farmer can record a harvest against their own production cycle
 *   2. a batch cut from it gets a BATCH- ref and origin_traced = true
 *   3. the harvest's remaining quantity is enforced server-side
 *   4. listing from a batch produces a `batch_backed` listing
 *   5. a seller CANNOT forge batch_id / claim_basis on a plain listing
 *   6. the batch is traceable by its ref
 *   7. another member cannot see the batch at all
 *   8. a seller cannot commission verification of their own stock
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-stock-spine.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const PASSWORD = 'LoamyStock-Test!' + Math.random().toString(36).slice(2, 8)
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function signup(email, name) {
  const client = createClient(TEST_ENV.url, TEST_ENV.key, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: {
      data: {
        full_name: name,
        phone: '08000000000',
        category: 'Farmer',
        platform_role: 'farmer',
        state: 'Kaduna',
      },
    },
  })
  if (error) throw new Error(`signup ${email}: ${error.message}`)
  return { client, uid: data.user.id, email }
}

const ts = Date.now()
const A = await signup(`usmanyakubu541+loamystock-a-${ts}@gmail.com`, 'Stock Spine Farmer A')
const B = await signup(`usmanyakubu541+loamystock-b-${ts}@gmail.com`, 'Stock Spine Farmer B')

// ---------------------------------------------------------------------------
// Set-up: a farm and a production cycle.
// ---------------------------------------------------------------------------
const { data: farm, error: farmErr } = await A.client
  .from('farms')
  .insert({
    owner_id: A.uid, farm_name: 'Spine Test Farm', state: 'Kaduna', lga: 'Zaria',
    size_hectares: 4, primary_crops: ['Maize'], ownership_type: 'owned',
  })
  .select('*').maybeSingle()
ok('Farm created', !!farm && !farmErr, farmErr?.message)

const { data: cycle, error: cycleErr } = await A.client
  .from('crop_records')
  .insert({ farm_id: farm.id, crop: 'Maize', season_year: 2026 })
  .select('*').maybeSingle()
ok('Production cycle created', !!cycle && !cycleErr, cycleErr?.message)

// ---------------------------------------------------------------------------
// 1. Harvest
// ---------------------------------------------------------------------------
const { data: harvest, error: hErr } = await A.client
  .from('harvests')
  .insert({
    farm_id: farm.id,
    production_cycle_id: cycle.id,
    commodity: 'Maize',
    harvest_date: '2026-09-15',
    quantity: 1000,
    unit: 'kg',
    quality_grade: 'Grade A',
    location_state: 'Kaduna',
    location_lga: 'Zaria',
  })
  .select('*').maybeSingle()
ok('Harvest recorded by the farm owner', !!harvest && !hErr, hErr?.message)
ok('Harvest got a HARV- business ref', !!harvest?.ref?.startsWith('HARV-'), harvest?.ref)

// A harvest against someone else's farm must be refused outright.
const { error: foreignHarvestErr } = await B.client.from('harvests').insert({
  farm_id: farm.id, production_cycle_id: cycle.id, commodity: 'Maize',
  harvest_date: '2026-09-15', quantity: 10, unit: 'kg',
})
ok("Cannot record a harvest on another member's farm", !!foreignHarvestErr,
  foreignHarvestErr?.message?.slice(0, 60))

// ---------------------------------------------------------------------------
// 2 & 3. Batch
// ---------------------------------------------------------------------------
const { data: batchId, error: bErr } = await A.client.rpc('loamy_create_batch_from_harvest', {
  p_harvest_id: harvest.id, p_quantity: 400, p_grade: 'Grade A', p_packaging: '50kg sacks',
})
ok('Batch created from harvest', !!batchId && !bErr, bErr?.message)

const { data: batch } = await A.client
  .from('commodity_batches').select('*').eq('id', batchId).maybeSingle()
ok('Batch got a BATCH- business ref', !!batch?.ref?.startsWith('BATCH-'), batch?.ref)
ok('Origin is TRACED, not merely declared', batch?.origin_traced === true)
ok('Batch carries the harvest, cycle and farm', batch?.harvest_id === harvest.id
  && batch?.production_cycle_id === cycle.id && batch?.farm_id === farm.id)
ok('Batch quantity is what was asked for', Number(batch?.quantity) === 400)
ok('Batch starts unverified', batch?.verification_status === 'unverified',
  batch?.verification_status)

// A batch event must exist beside it -- quantity never moves silently.
const { data: events } = await A.client
  .from('batch_events').select('*').eq('batch_id', batchId)
ok('A batch event was recorded with the batch', (events?.length ?? 0) >= 1,
  `${events?.length ?? 0} event(s)`)

// The remaining 600 kg, and no more.
const { error: overBatchErr } = await A.client.rpc('loamy_create_batch_from_harvest', {
  p_harvest_id: harvest.id, p_quantity: 900,
})
ok('Cannot batch more than the harvest holds', !!overBatchErr,
  overBatchErr?.message?.slice(0, 60))

const { data: batch2Id, error: b2Err } = await A.client.rpc('loamy_create_batch_from_harvest', {
  p_harvest_id: harvest.id, p_quantity: 600,
})
ok('Can batch exactly the remainder', !!batch2Id && !b2Err, b2Err?.message)

// A second member cannot batch someone else's harvest.
const { error: foreignBatchErr } = await B.client.rpc('loamy_create_batch_from_harvest', {
  p_harvest_id: harvest.id, p_quantity: 1,
})
ok("Cannot batch another member's harvest", !!foreignBatchErr,
  foreignBatchErr?.message?.slice(0, 60))

// ---------------------------------------------------------------------------
// 4 & 5. Listing
// ---------------------------------------------------------------------------
const { data: listingId, error: lErr } = await A.client.rpc('loamy_list_batch', {
  p_batch_id: batchId, p_quantity: 250, p_price_per_unit: 850,
  p_state: 'Kaduna', p_lga: 'Zaria', p_description: 'Spine test stock',
})
ok('Batch listed on the marketplace', !!listingId && !lErr, lErr?.message)

const { data: listing } = await A.client
  .from('listings').select('*').eq('id', listingId).maybeSingle()
ok('Listing is BATCH_BACKED, not seller-declared', listing?.claim_basis === 'batch_backed',
  listing?.claim_basis)
ok('Listing points at the batch', listing?.batch_id === batchId)
ok('Listing inherited the batch commodity and grade',
  listing?.commodity === 'Maize' && listing?.quality_grade === 'Grade A')

const { data: batchAfterList } = await A.client
  .from('commodity_batches').select('status').eq('id', batchId).maybeSingle()
ok("Batch moved to 'listed' through its own transition", batchAfterList?.status === 'listed',
  batchAfterList?.status)

// Over-listing the same stock twice.
const { error: overListErr } = await A.client.rpc('loamy_list_batch', {
  p_batch_id: batchId, p_quantity: 300, p_price_per_unit: 850,
})
ok('Cannot list more of a batch than is free', !!overListErr,
  overListErr?.message?.slice(0, 60))

// The forgery that would make provenance worthless.
const { error: forgeErr } = await A.client.from('listings').insert({
  seller_id: A.uid, listing_type: 'commodity', commodity: 'Maize',
  quantity_kg: 100, unit: 'kg', price_per_unit: 900, state: 'Kaduna',
  batch_id: batchId, claim_basis: 'batch_backed',
})
ok('Seller CANNOT forge batch_id / claim_basis on a listing', !!forgeErr,
  forgeErr?.message?.slice(0, 70))

const { error: forgeClaimErr } = await A.client.from('listings').insert({
  seller_id: A.uid, listing_type: 'commodity', commodity: 'Maize',
  quantity_kg: 100, unit: 'kg', price_per_unit: 900, state: 'Kaduna',
  claim_basis: 'batch_backed',
})
ok('Seller CANNOT claim batch_backed with no batch at all', !!forgeClaimErr,
  forgeClaimErr?.message?.slice(0, 70))

// A plain listing is still allowed, and is honestly labelled.
const { data: plain } = await A.client.from('listings').insert({
  seller_id: A.uid, listing_type: 'commodity', commodity: 'Maize',
  quantity_kg: 50, unit: 'kg', price_per_unit: 900, state: 'Kaduna',
}).select('claim_basis').maybeSingle()
ok('An ordinary listing is labelled seller_declared', plain?.claim_basis === 'seller_declared',
  plain?.claim_basis)

// ---------------------------------------------------------------------------
// 6. Trace
// ---------------------------------------------------------------------------
const { data: trace, error: tErr } = await A.client.rpc('loamy_trace_batch_for_ref', {
  p_ref: batch.ref,
})
ok('Batch is traceable by its ref', !!trace && !tErr, tErr?.message)
ok('Trace resolves to this batch', JSON.stringify(trace ?? {}).includes(batch.ref))

// ---------------------------------------------------------------------------
// 7. RLS
// ---------------------------------------------------------------------------
const { data: bSeesBatch } = await B.client
  .from('commodity_batches').select('id').eq('id', batchId).maybeSingle()
ok("Another member cannot see the batch row", !bSeesBatch)

const { data: bSeesHarvest } = await B.client
  .from('harvests').select('id').eq('id', harvest.id).maybeSingle()
ok('Another member cannot see the harvest row', !bSeesHarvest)

// ---------------------------------------------------------------------------
// 8. Verification is demand-side
// ---------------------------------------------------------------------------
const { error: selfVerifyErr } = await A.client.rpc('loamy_request_listing_verification', {
  p_listing_id: listingId,
})
ok('Seller cannot commission verification of their own listing', !!selfVerifyErr,
  selfVerifyErr?.message?.slice(0, 70))

const { data: buyerCase, error: buyerVerifyErr } = await B.client.rpc(
  'loamy_request_listing_verification', { p_listing_id: listingId })
ok('A different member CAN request verification of it', !!buyerCase && !buyerVerifyErr,
  buyerVerifyErr?.message?.slice(0, 70))

const { data: batchPending } = await A.client
  .from('commodity_batches').select('verification_status').eq('id', batchId).maybeSingle()
ok('Requesting does NOT mark the batch verified',
  batchPending?.verification_status !== 'verified', batchPending?.verification_status)

// ---------------------------------------------------------------------------
// Tidy up what can be tidied: take the test stock off the market. Batches and
// harvests have no delete path by design (every write is an event), so the
// rows remain under the throwaway accounts.
// ---------------------------------------------------------------------------
const { error: unlistErr } = await A.client.rpc('loamy_unlist_batch', { p_listing_id: listingId })
ok('Listing can be withdrawn', !unlistErr, unlistErr?.message)
await A.client.from('listings').update({ status: 'withdrawn' }).eq('seller_id', A.uid).eq('status', 'active')

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.log('FAILED:', failed.map((f) => f.name).join(' | '))
  process.exit(1)
}
