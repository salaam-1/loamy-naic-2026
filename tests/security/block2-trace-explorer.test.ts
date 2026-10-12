import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * BLOCK 2 — the Trace Explorer.
 *
 * Two things are being asserted, and the second matters more than the first:
 *
 *   1. A chain can be entered from ANY reference a person might be holding.
 *   2. Redaction is honest. A node that is absent and a node that is withheld
 *      are reported differently, and a refusal never reveals that the record
 *      exists.
 */

let FARMER: TestUser
let BUYER: TestUser
let OUTSIDER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
const FARMER_HANDLE = `f_${RUN}`

let batchId = ''
let batchRef = ''
let listingId = ''
let txnId = ''
let txnRef = ''

beforeAll(async () => {
  FARMER = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('trader', 'Trader')
  OUTSIDER = await makeUser('trader', 'Trader')
  admin = await adminClient()

  await FARMER.client.rpc('loamy_set_username', { p_username: FARMER_HANDLE })

  const { data: farm } = await FARMER.client.from('farms').insert({
    owner_id: FARMER.uid, farm_name: 'Trace Farm', state: 'Benue', lga: 'Makurdi',
    size_hectares: 6, primary_crops: ['Maize'], ownership_type: 'owned',
    latitude: 7.73, longitude: 8.53,
  }).select('id').single()

  const { data: cycle } = await FARMER.client.from('crop_records').insert({
    farm_id: farm!.id, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single()

  const { data: harvest } = await FARMER.client.from('harvests').insert({
    production_cycle_id: cycle!.id, farm_id: farm!.id, commodity: 'Maize',
    harvest_date: '2026-09-06', quantity: 20, unit: 'tonne',
  }).select('id').single()

  const { data: batch } = await FARMER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvest!.id, p_quantity: 20,
  })
  batchId = batch as string

  const { data: b } = await FARMER.client
    .from('commodity_batches').select('ref').eq('id', batchId).single()
  batchRef = b!.ref

  const { data: listing } = await FARMER.client.rpc('loamy_list_batch', {
    p_batch_id: batchId, p_quantity: 20, p_price_per_unit: 95_000,
  })
  listingId = listing as string

  const { data: txn } = await BUYER.client.rpc('loamy_propose_transaction', {
    p_listing_id: listingId, p_quantity: 20,
  })
  txnId = txn as string
  const { data: t } = await BUYER.client.from('transactions').select('ref').eq('id', txnId).single()
  txnRef = t!.ref
}, 300_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('entry from any reference', () => {
  it('traces a batch ref', async () => {
    const { data } = await FARMER.client.rpc('loamy_trace', { p_ref: batchRef })
    const t = data as Record<string, any>
    expect(t.found).toBe(true)
    expect(t.batch.ref).toBe(batchRef)
    expect(t.scope).toBe('origin')
  })

  it('traces the SAME chain from a transaction ref', async () => {
    const { data } = await BUYER.client.rpc('loamy_trace', { p_ref: txnRef })
    const t = data as Record<string, any>
    expect(t.found).toBe(true)
    expect(t.batch.ref).toBe(batchRef)
    expect(t.entered_via.entity_type).toBe('transaction')
    expect(t.entered_via.ref).toBe(txnRef)
  })

  it('traces from a listing ref', async () => {
    const { data: l } = await FARMER.client
      .from('listings').select('ref').eq('id', listingId).single()
    const { data } = await FARMER.client.rpc('loamy_trace', { p_ref: l!.ref })
    expect((data as Record<string, any>).batch.ref).toBe(batchRef)
  })

  it('accepts a lowercase ref, because people retype what is on paper', async () => {
    const { data } = await FARMER.client.rpc('loamy_trace', { p_ref: batchRef.toLowerCase() })
    expect((data as Record<string, any>).found).toBe(true)
  })

  it('says so plainly when a real ref is not part of a commodity chain', async () => {
    const { data: acc } = await (admin ?? FARMER.client)
      .from('loamy_entity_refs').select('ref').eq('entity_type', 'ledger_account').limit(1).maybeSingle()
    expect(acc, 'no trace access record was created in setup').toBeTruthy()
    const { data } = await FARMER.client.rpc('loamy_trace', { p_ref: acc.ref })
    const t = data as Record<string, any>
    expect(t.found).toBe(false)
    expect(t.reason).toBe('not_traceable')
  })

  it('refuses an unknown ref without confirming anything', async () => {
    const { data } = await FARMER.client.rpc('loamy_trace', { p_ref: 'BATCH-999999' })
    expect((data as Record<string, any>).reason).toBe('no_such_reference')
  })

  it('refuses a signed-out caller outright', async () => {
    const { data, error } = await anonClient().rpc('loamy_trace', { p_ref: batchRef })
    expect(error || (data as Record<string, any>)?.found === false).toBeTruthy()
  })
})

describe('redaction is honest', () => {
  it('gives the origin farmer the full chain', async () => {
    const { data } = await FARMER.client.rpc('loamy_trace', { p_ref: batchRef })
    const t = data as Record<string, any>
    expect(t.scope).toBe('origin')
    expect(t.farm.available).toBe(true)
    expect(t.farm.farm_name).toBe('Trace Farm')
    expect(Number(t.batch.quantity)).toBe(20)
  })

  it('gives a counterparty the party view, without the origin farm identity', async () => {
    const { data } = await BUYER.client.rpc('loamy_trace', { p_ref: batchRef })
    const t = data as Record<string, any>
    expect(t.scope).toBe('party')
    expect(t.farm.available).toBe(true)
    expect(t.farm.state, 'the origin state should be visible').toBeTruthy()
    expect(t.farm.farm_name, 'a buyer learned the farm name').toBeNull()
    expect(t.farm.owner_name, 'a buyer learned the farmer name').toBeNull()
  })

  it('gives a browsing member the public view only', async () => {
    const { data } = await OUTSIDER.client.rpc('loamy_trace', { p_ref: batchRef })
    const t = data as Record<string, any>
    expect(t.scope).toBe('public')
    expect(t.batch.quantity, 'quantity leaked to a browsing member').toBeNull()
    expect(t.transactions.available).toBe(false)
    expect(t.transactions.reason).toBe('not_permitted')
  })

  it('distinguishes NEVER HAPPENED from NOT PERMITTED', async () => {
    const origin = (await FARMER.client.rpc('loamy_trace', { p_ref: batchRef }))
      .data as Record<string, any>
    const browsing = (await OUTSIDER.client.rpc('loamy_trace', { p_ref: batchRef }))
      .data as Record<string, any>

    // The farmer is entitled to see logistics and there genuinely are none.
    expect(origin.logistics.available).toBe(false)
    expect(origin.logistics.reason).toBe('no_transport_recorded')

    // The browsing member is NOT entitled. Same node, different reason —
    // never the same word.
    expect(browsing.logistics.reason).toBe('not_permitted')
    expect(browsing.logistics.reason).not.toBe(origin.logistics.reason)
  })

  it('never reports a withheld node as an absent one', async () => {
    const browsing = (await OUTSIDER.client.rpc('loamy_trace', { p_ref: batchRef }))
      .data as Record<string, any>
    for (const node of ['transactions', 'logistics', 'warehouse', 'financing']) {
      expect(browsing[node].reason, `${node} was disguised as absent`).toBe('not_permitted')
    }
  })
})

describe('the financing node', () => {
  it('is withheld from a member with only the public scope', async () => {
    const { data } = await OUTSIDER.client.rpc('loamy_trace_financing', { p_batch_id: batchId })
    expect((data as Record<string, any>).reason).toBe('not_permitted')
  })

  it('says no financing was used, rather than going silent', async () => {
    const { data } = await FARMER.client.rpc('loamy_trace_financing', { p_batch_id: batchId })
    const f = data as Record<string, any>
    expect(f.available).toBe(false)
    expect(f.reason).toBe('never_financed')
  })

  it('appears in the assembled chain', async () => {
    const { data } = await FARMER.client.rpc('loamy_trace', { p_ref: batchRef })
    expect((data as Record<string, any>).financing).toBeTruthy()
  })
})

describe('the reverse direction is narrow on purpose', () => {
  it('lets a farmer walk down their own production', async () => {
    const { data } = await FARMER.client.rpc('loamy_trace_identity', {
      p_username: FARMER_HANDLE,
    })
    const t = data as Record<string, any>
    expect(t.found).toBe(true)
    expect(t.access_reason).toBe('self')

    const farm = t.farms[0]
    expect(farm.farm_name).toBe('Trace Farm')
    const harvest = farm.cycles[0].harvests[0]
    expect(harvest.batches.map((b: any) => b.ref)).toContain(batchRef)
  })

  it('refuses a BUYER who bought from that farmer', async () => {
    // The buyer may trace the batch they bought. They may not enumerate
    // everything else the farmer has ever produced.
    const { data } = await BUYER.client.rpc('loamy_trace_identity', {
      p_username: FARMER_HANDLE,
    })
    expect((data as Record<string, any>).found,
      'a buyer enumerated a farmer\'s entire production').toBe(false)
  })

  it('refuses a stranger, in the same words as an unknown handle', async () => {
    const refused = await OUTSIDER.client.rpc('loamy_trace_identity', { p_username: FARMER_HANDLE })
    const unknown = await OUTSIDER.client.rpc('loamy_trace_identity', { p_username: `ghost_${RUN}` })
    expect(refused.data).toEqual(unknown.data)
    expect((refused.data as Record<string, any>).reason).toBe('no_such_reference')
  })

  it('lets an administrator walk down', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_trace_identity', { p_username: FARMER_HANDLE })
    expect((data as Record<string, any>).access_reason).toBe('admin')
  })

  it('refuses a signed-out caller', async () => {
    const { data, error } = await anonClient().rpc('loamy_trace_identity', {
      p_username: FARMER_HANDLE,
    })
    expect(error || (data as Record<string, any>)?.found === false).toBeTruthy()
  })
})
