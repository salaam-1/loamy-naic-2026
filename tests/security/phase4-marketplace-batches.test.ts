import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'

/**
 * Phase 4: the marketplace sells real batches.
 *
 * Two things matter here. A seller must not be able to over-list stock they do
 * not have, and a seller must not be able to dress a declaration up as verified
 * traceable stock. Both are claims a remote buyer would rely on.
 */

let SELLER: TestUser
let BUYER: TestUser
let batchId: string
let listingId: string

const BATCH_QTY = 60

beforeAll(async () => {
  SELLER = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('trader', 'Trader')

  const { data: farm } = await SELLER.client.from('farms').insert({
    owner_id: SELLER.uid, farm_name: 'Phase4 Farm', state: 'Benue', lga: 'Makurdi',
    size_hectares: 12, primary_crops: ['Maize'], ownership_type: 'owned',
  }).select('id').single()

  const { data: cycle } = await SELLER.client.from('crop_records').insert({
    farm_id: farm!.id, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single()

  const { data: harvest } = await SELLER.client.from('harvests').insert({
    production_cycle_id: cycle!.id, farm_id: farm!.id, commodity: 'Maize',
    harvest_date: '2026-09-05', quantity: BATCH_QTY, unit: 'tonne',
    location_state: 'Benue', location_lga: 'Makurdi',
  }).select('id').single()

  const { data: b, error } = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvest!.id, p_quantity: BATCH_QTY, p_grade: 'Grade A',
  })
  if (error) throw new Error('batch: ' + error.message)
  batchId = b as string
}, 240_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('listing a batch', () => {
  it('creates a batch-backed listing and moves the batch to listed', async () => {
    const { data, error } = await SELLER.client.rpc('loamy_list_batch', {
      p_batch_id: batchId, p_quantity: 40, p_price_per_unit: 250_000,
      p_description: 'Dry maize, Grade A',
    })
    expect(error, error?.message).toBeFalsy()
    listingId = data as string

    const { data: l } = await SELLER.client
      .from('listings').select('ref, claim_basis, batch_id, commodity, unit, quality_grade')
      .eq('id', listingId).single()
    expect(l!.ref).toMatch(/^LIST-\d{6}$/)
    expect(l!.claim_basis).toBe('batch_backed')
    expect(l!.batch_id).toBe(batchId)
    // Commodity, unit and grade come from the batch, not from free text.
    expect(l!.commodity).toBe('Maize')
    expect(l!.unit).toBe('tonne')
    expect(l!.quality_grade).toBe('Grade A')

    const { data: b } = await SELLER.client
      .from('commodity_batches').select('status').eq('id', batchId).single()
    expect(b!.status).toBe('listed')
  })

  it('refuses to list more of a batch than remains', async () => {
    // 40 of 60 already listed, so 30 more must fail.
    const { error } = await SELLER.client.rpc('loamy_list_batch', {
      p_batch_id: batchId, p_quantity: 30, p_price_per_unit: 250_000,
    })
    expect(error, 'a batch was advertised beyond its quantity').toBeTruthy()
  })

  it('allows the genuine remainder', async () => {
    const { error } = await SELLER.client.rpc('loamy_list_batch', {
      p_batch_id: batchId, p_quantity: 20, p_price_per_unit: 255_000,
    })
    expect(error, error?.message).toBeFalsy()
  })

  it('refuses to list a batch the caller does not hold', async () => {
    const { error } = await BUYER.client.rpc('loamy_list_batch', {
      p_batch_id: batchId, p_quantity: 1, p_price_per_unit: 100,
    })
    expect(error).toBeTruthy()
  })

  it('refuses a zero or negative price', async () => {
    for (const price of [0, -5]) {
      const { error } = await SELLER.client.rpc('loamy_list_batch', {
        p_batch_id: batchId, p_quantity: 1, p_price_per_unit: price,
      })
      expect(error).toBeTruthy()
    }
  })
})

describe('a seller cannot fake a backed claim', () => {
  it('refuses a direct insert carrying a batch_id', async () => {
    const { error } = await SELLER.client.from('listings').insert({
      seller_id: SELLER.uid, listing_type: 'commodity', commodity: 'Maize',
      quantity_kg: 5, unit: 'kg', price_per_unit: 100, state: 'Benue',
      batch_id: batchId,
    })
    expect(error, 'a listing was pointed at a batch directly').toBeTruthy()
  })

  it('refuses a direct insert claiming batch_backed with no batch', async () => {
    const { error } = await SELLER.client.from('listings').insert({
      seller_id: SELLER.uid, listing_type: 'commodity', commodity: 'Maize',
      quantity_kg: 5, unit: 'kg', price_per_unit: 100, state: 'Benue',
      claim_basis: 'batch_backed',
    })
    expect(error, 'a declared listing claimed to be batch-backed').toBeTruthy()
  })

  it('refuses to upgrade an existing declared listing by update', async () => {
    const { data: plain } = await SELLER.client.from('listings').insert({
      seller_id: SELLER.uid, listing_type: 'commodity', commodity: 'Rice',
      quantity_kg: 100, unit: 'kg', price_per_unit: 900, state: 'Benue',
    }).select('id, claim_basis').single()
    expect(plain!.claim_basis).toBe('seller_declared')

    await SELLER.client.from('listings')
      .update({ claim_basis: 'batch_backed', batch_id: batchId }).eq('id', plain!.id)

    const { data: after } = await SELLER.client
      .from('listings').select('claim_basis, batch_id').eq('id', plain!.id).single()
    expect(after!.claim_basis).toBe('seller_declared')
    expect(after!.batch_id).toBeNull()
  })

  it('refuses to change the quantity of a backed listing by update', async () => {
    await SELLER.client.from('listings').update({ quantity_kg: 5000 }).eq('id', listingId)
    const { data } = await SELLER.client
      .from('listings').select('quantity_kg').eq('id', listingId).single()
    expect(Number(data!.quantity_kg)).toBe(40)
  })

  it('still allows ordinary declared listings — this is not a lockout', async () => {
    const { error } = await SELLER.client.from('listings').insert({
      seller_id: SELLER.uid, listing_type: 'commodity', commodity: 'Sorghum',
      quantity_kg: 50, unit: 'kg', price_per_unit: 700, state: 'Benue',
    })
    expect(error, error?.message).toBeFalsy()
  })
})

describe('the public surface tells a buyer what is actually backed', () => {
  it('exposes claim basis and verification status to anon', async () => {
    const { data, error } = await anonClient()
      .from('loamy_public_listings')
      .select('id, claim_basis, verification_status, origin_traced, batch_ref, origin_state')
      .eq('id', listingId).maybeSingle()

    expect(error).toBeFalsy()
    expect(data!.claim_basis).toBe('batch_backed')
    // Nobody has inspected it yet, so it is traceable but NOT verified.
    expect(data!.verification_status).toBe('unverified')
    expect(data!.origin_traced).toBe(true)
    expect(data!.batch_ref).toMatch(/^BATCH-\d{6}$/)
    expect(data!.origin_state).toBe('Benue')
  })

  it('reports a declared listing honestly', async () => {
    const { data } = await anonClient()
      .from('loamy_public_listings')
      .select('claim_basis, verification_status, origin_traced, batch_ref')
      .eq('commodity', 'Sorghum').eq('state', 'Benue').limit(1).maybeSingle()

    expect(data!.claim_basis).toBe('seller_declared')
    expect(data!.verification_status).toBe('unverified')
    expect(data!.origin_traced).toBe(false)
    expect(data!.batch_ref).toBeNull()
  })

  it('never exposes the farm, coordinates or current location', async () => {
    const { data } = await anonClient()
      .from('loamy_public_listings').select('*').eq('id', listingId).maybeSingle()
    const keys = Object.keys(data ?? {})
    for (const leak of ['farm_id', 'latitude', 'longitude', 'current_location',
                        'owner_id', 'origin_owner_id', 'seller_id', 'origin_lga']) {
      expect(keys, `public listings expose ${leak}`).not.toContain(leak)
    }
  })

  it('keeps the batch itself invisible to anon and to other members', async () => {
    const a = await anonClient().from('commodity_batches').select('*').limit(1)
    expect(a.error || (a.data ?? []).length === 0).toBeTruthy()

    const b = await BUYER.client.from('commodity_batches').select('*').eq('id', batchId)
    expect(b.data ?? [], 'a buyer can read the seller’s batch row').toHaveLength(0)
  })
})

describe('buyer-requested verification (remote sourcing)', () => {
  let requestedCaseId = ''

  it('lets a buyer ask for the stock behind a listing to be inspected', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_request_listing_verification', {
      p_listing_id: listingId, p_note: 'Sourcing from Lagos, want eyes on it.',
    })
    expect(error, error?.message).toBeFalsy()
    expect(data).toBeTruthy()
    requestedCaseId = data as string
  })

  it('is idempotent — asking twice does not open a second case', async () => {
    const { data: again } = await BUYER.client.rpc('loamy_request_listing_verification', {
      p_listing_id: listingId,
    })
    expect(again).toBe(requestedCaseId)

    // Counted through the requester's own sanctioned view. §7 hardening took
    // the raw table read away from them, so the count has to come from the
    // path that masks the agent.
    const { data: cases } = await BUYER.client.rpc('loamy_my_verification_cases')
    const mine = (cases as Record<string, any>[]).filter((c) => c.subject_id === batchId)
    expect(mine, 'asking twice opened a second case').toHaveLength(1)
    expect(mine[0].case_id).toBe(requestedCaseId)
  })

  it('does not disclose the agent to the requester', async () => {
    const raw = await BUYER.client
      .from('verification_tasks').select('assigned_to').eq('id', requestedCaseId)
    expect(raw.data ?? [], 'the requester can still read the raw task row').toHaveLength(0)

    const { data: cases } = await BUYER.client.rpc('loamy_my_verification_cases')
    const mine = (cases as Record<string, any>[]).find((c) => c.case_id === requestedCaseId)
    expect(mine!.agent_display).toMatch(/^(Not yet assigned|Loamy Verification Agent)$/)
    expect(mine!.assigned_to).toBeUndefined()
  })

  it('refuses a seller verifying their own listing', async () => {
    const { error } = await SELLER.client.rpc('loamy_request_listing_verification', {
      p_listing_id: listingId,
    })
    expect(error, 'a seller ordered verification of their own stock').toBeTruthy()
  })

  it('refuses on a declared listing, and says why', async () => {
    // `.is('batch_id', null)` is the point of the test, and it was missing.
    // Selecting "any Sorghum listing" picks a BATCH-BACKED one half the time,
    // and on those the RPC is right not to refuse -- so this assertion passed
    // or failed by luck of the draw rather than by behaviour.
    const { data: plain } = await SELLER.client
      .from('listings').select('id').eq('commodity', 'Sorghum')
      .is('batch_id', null).order('created_at').limit(1).single()
    const { error } = await BUYER.client.rpc('loamy_request_listing_verification', {
      p_listing_id: plain!.id,
    })
    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/declared/i)
  })

  it('does not leak the batch location to the requesting buyer', async () => {
    // The buyer can see their case, but the case must not hand them the farm.
    const { data } = await BUYER.client
      .from('loamy_verification_cases')
      .select('*').eq('subject_id', batchId).maybeSingle()
    const keys = Object.keys(data ?? {})
    for (const leak of ['expected_lat', 'expected_lng', 'latitude', 'longitude']) {
      expect(keys, `verification case view exposes ${leak}`).not.toContain(leak)
    }
  })
})

describe('unlisting', () => {
  it('pauses the listing and returns the batch when nothing is left listed', async () => {
    const { data: mine } = await SELLER.client
      .from('listings').select('id').eq('batch_id', batchId).eq('status', 'active')
    for (const l of mine ?? []) {
      const { error } = await SELLER.client.rpc('loamy_unlist_batch', { p_listing_id: l.id })
      expect(error, error?.message).toBeFalsy()
    }

    const { data: b } = await SELLER.client
      .from('commodity_batches').select('status, verification_status').eq('id', batchId).single()
    // Nobody inspected this batch, so unlisting must NOT leave it claiming to
    // be verified. It returns to 'created'.
    expect(b!.verification_status).toBe('unverified')
    expect(b!.status).toBe('created')
  }, 60_000)

  it('refuses to unlist someone else’s listing', async () => {
    const { error } = await BUYER.client.rpc('loamy_unlist_batch', { p_listing_id: listingId })
    expect(error).toBeTruthy()
  })
})
