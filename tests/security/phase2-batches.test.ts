import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'

/**
 * Phase 2: CommodityBatch and its event log.
 *
 * The two guarantees worth proving are the ones the directive calls
 * non-negotiable: quantity cannot move without a recorded event, and status
 * cannot move arbitrarily. Everything else is detail.
 */

let A: TestUser   // farmer, owns the chain
let B: TestUser   // unrelated member
let farmId: string
let cycleId: string
let harvestId: string
let batchId: string

const HARVEST_QTY = 100

beforeAll(async () => {
  A = await makeUser('farmer', 'Farmer')
  B = await makeUser('trader', 'Trader')

  const { data: farm } = await A.client.from('farms').insert({
    owner_id: A.uid, farm_name: 'Phase2 Farm', state: 'Benue', lga: 'Makurdi',
    size_hectares: 20, primary_crops: ['Maize'], ownership_type: 'owned',
  }).select('id').single()
  farmId = farm!.id

  const { data: cycle } = await A.client.from('crop_records').insert({
    farm_id: farmId, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single()
  cycleId = cycle!.id

  const { data: harvest } = await A.client.from('harvests').insert({
    production_cycle_id: cycleId, farm_id: farmId, commodity: 'Maize',
    harvest_date: '2026-09-05', quantity: HARVEST_QTY, unit: 'tonne',
    location_state: 'Benue', location_lga: 'Makurdi',
  }).select('id').single()
  harvestId = harvest!.id

  const { data: id, error } = await A.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvestId, p_quantity: 60, p_grade: 'Grade A',
  })
  if (error) throw new Error('batch create: ' + error.message)
  batchId = id as string
}, 180_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('creating a batch from a harvest', () => {
  it('gives the batch a BATCH ref and traces it to its origin', async () => {
    const { data } = await A.client
      .from('commodity_batches')
      .select('ref, commodity, quantity, available_quantity, farm_id, harvest_id, origin_traced, status')
      .eq('id', batchId).single()

    expect(data!.ref).toMatch(/^BATCH-\d{6}$/)
    expect(data!.commodity).toBe('Maize')
    expect(Number(data!.quantity)).toBe(60)
    expect(Number(data!.available_quantity)).toBe(60)
    expect(data!.farm_id).toBe(farmId)
    expect(data!.harvest_id).toBe(harvestId)
    expect(data!.origin_traced).toBe(true)
    expect(data!.status).toBe('created')
  })

  it('writes a created event with the opening balance', async () => {
    const { data } = await A.client
      .from('batch_events')
      .select('event_type, new_status, quantity_delta, quantity_after, actor_id')
      .eq('batch_id', batchId).eq('event_type', 'created').single()

    expect(data!.new_status).toBe('created')
    expect(Number(data!.quantity_after)).toBe(60)
    expect(data!.actor_id).toBe(A.uid)
  })

  it('marks the harvest as batched', async () => {
    const { data } = await A.client.from('harvests').select('status').eq('id', harvestId).single()
    expect(data!.status).toBe('batched')
  })

  it('refuses to mint more than the harvest yielded', async () => {
    // 60 already allocated of 100, so 50 more must fail.
    const { error } = await A.client.rpc('loamy_create_batch_from_harvest', {
      p_harvest_id: harvestId, p_quantity: 50,
    })
    expect(error, 'a farmer created more traceable stock than they harvested').toBeTruthy()
  })

  it('allows the genuine remainder', async () => {
    const { data, error } = await A.client.rpc('loamy_create_batch_from_harvest', {
      p_harvest_id: harvestId, p_quantity: 40,
    })
    expect(error).toBeFalsy()
    expect(data).toBeTruthy()
  })

  it('refuses a batch from a harvest the caller does not own', async () => {
    const { error } = await B.client.rpc('loamy_create_batch_from_harvest', {
      p_harvest_id: harvestId, p_quantity: 1,
    })
    expect(error).toBeTruthy()
  })
})

describe('quantity cannot move without an event', () => {
  it('has no client UPDATE path on the batch at all', async () => {
    await A.client.from('commodity_batches')
      .update({ available_quantity: 5000, quantity: 5000 }).eq('id', batchId)

    const { data } = await A.client
      .from('commodity_batches').select('quantity, available_quantity').eq('id', batchId).single()
    expect(Number(data!.quantity), 'batch quantity was directly writable').toBe(60)
    expect(Number(data!.available_quantity)).toBe(60)
  })

  it('has no client INSERT path — a batch cannot be conjured', async () => {
    const { error } = await A.client.from('commodity_batches').insert({
      commodity: 'Maize', origin_owner_id: A.uid, owner_id: A.uid,
      quantity: 999, available_quantity: 999, unit: 'tonne',
    })
    expect(error, 'a member created an untraceable batch directly').toBeTruthy()
  })

  it('refuses to take more than is available', async () => {
    const { error } = await A.client.rpc('loamy_batch_transition', {
      p_batch_id: batchId, p_event_type: 'quantity_adjusted', p_quantity_delta: -500,
    })
    expect(error, 'a batch went negative').toBeTruthy()
  })

  it('refuses to exceed the original quantity', async () => {
    const { error } = await A.client.rpc('loamy_batch_transition', {
      p_batch_id: batchId, p_event_type: 'quantity_adjusted', p_quantity_delta: 500,
    })
    expect(error).toBeTruthy()
  })

  it('records a legitimate adjustment with delta and resulting balance', async () => {
    const { error } = await A.client.rpc('loamy_batch_transition', {
      p_batch_id: batchId, p_event_type: 'quantity_adjusted',
      p_quantity_delta: -10, p_note: 'spoilage',
    })
    expect(error, error?.message).toBeFalsy()

    const { data: b } = await A.client
      .from('commodity_batches').select('available_quantity').eq('id', batchId).single()
    expect(Number(b!.available_quantity)).toBe(50)

    const { data: ev } = await A.client
      .from('batch_events').select('quantity_delta, quantity_after')
      .eq('batch_id', batchId).eq('event_type', 'quantity_adjusted').single()
    expect(Number(ev!.quantity_delta)).toBe(-10)
    expect(Number(ev!.quantity_after)).toBe(50)
  })
})

describe('status cannot move arbitrarily', () => {
  it('refuses an unknown event type', async () => {
    const { error } = await A.client.rpc('loamy_batch_transition', {
      p_batch_id: batchId, p_event_type: 'teleported',
    })
    expect(error).toBeTruthy()
  })

  it('refuses a transition from a status that does not allow it', async () => {
    // A 'created' batch has not been sold, so it cannot be loaded.
    const { error } = await A.client.rpc('loamy_batch_transition', {
      p_batch_id: batchId, p_event_type: 'loaded',
    })
    expect(error, 'a batch skipped straight to loaded').toBeTruthy()
  })

  it('will not let the holder mark their own batch verified', async () => {
    // The whole point of the verification engine: evidence is collected by the
    // field, approval is the platform's.
    const { error } = await A.client.rpc('loamy_batch_transition', {
      p_batch_id: batchId, p_event_type: 'verified',
    })
    expect(error, 'a seller self-verified their own stock').toBeTruthy()

    const { data } = await A.client
      .from('commodity_batches').select('verification_status').eq('id', batchId).single()
    expect(data!.verification_status).toBe('unverified')
  })

  it('will not let a member drive a system transition directly', async () => {
    const { error } = await A.client.rpc('loamy_batch_transition', {
      p_batch_id: batchId, p_event_type: 'sold',
    })
    expect(error, 'a member marked their own batch sold').toBeTruthy()
  })

  it('allows a legitimate holder transition and records it', async () => {
    const { error } = await A.client.rpc('loamy_batch_transition', {
      p_batch_id: batchId, p_event_type: 'listed', p_note: 'listed for sale',
    })
    expect(error, error?.message).toBeFalsy()

    const { data } = await A.client
      .from('commodity_batches').select('status').eq('id', batchId).single()
    expect(data!.status).toBe('listed')
  })

  it('refuses a stranger transitioning someone else’s batch', async () => {
    const { error } = await B.client.rpc('loamy_batch_transition', {
      p_batch_id: batchId, p_event_type: 'unlisted',
    })
    expect(error).toBeTruthy()
  })
})

describe('the event log is evidence, so it is append-only and private', () => {
  it('cannot be inserted into by a client', async () => {
    const { error } = await A.client.from('batch_events').insert({
      batch_id: batchId, event_type: 'delivered', new_status: 'delivered',
    })
    expect(error, 'a member forged a batch event').toBeTruthy()
  })

  it('cannot be edited or deleted by a client', async () => {
    const { data: before } = await A.client
      .from('batch_events').select('id, note').eq('batch_id', batchId).limit(1).single()

    await A.client.from('batch_events').update({ note: 'tampered' }).eq('id', before!.id)
    await A.client.from('batch_events').delete().eq('id', before!.id)

    const { data: after } = await A.client
      .from('batch_events').select('note').eq('id', before!.id).maybeSingle()
    expect(after, 'a batch event was deleted').toBeTruthy()
    expect(after!.note).not.toBe('tampered')
  })

  it('is invisible to unrelated members and to anon', async () => {
    const other = await B.client.from('batch_events').select('*').eq('batch_id', batchId)
    expect(other.data ?? []).toHaveLength(0)

    const a = anonClient()
    const pubB = await a.from('commodity_batches').select('*').limit(1)
    const pubE = await a.from('batch_events').select('*').limit(1)
    expect(pubB.error || (pubB.data ?? []).length === 0).toBeTruthy()
    expect(pubE.error || (pubE.data ?? []).length === 0).toBeTruthy()
  })

  it('preserves an ordered history that can be replayed', async () => {
    const { data } = await A.client
      .from('batch_events')
      .select('event_type, quantity_after, occurred_at')
      .eq('batch_id', batchId)
      .order('occurred_at', { ascending: true })

    const types = (data ?? []).map((e) => e.event_type)
    expect(types[0]).toBe('created')
    expect(types).toContain('quantity_adjusted')
    expect(types).toContain('listed')

    // The final recorded balance matches the batch itself.
    const withQty = (data ?? []).filter((e) => e.quantity_after !== null)
    const { data: b } = await A.client
      .from('commodity_batches').select('available_quantity').eq('id', batchId).single()
    expect(Number(withQty[withQty.length - 1].quantity_after))
      .toBe(Number(b!.available_quantity))
  })
})
