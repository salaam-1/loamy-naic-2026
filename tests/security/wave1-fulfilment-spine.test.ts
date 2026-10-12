import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * WAVE 1 — the fulfilment spine, end to end, and the boundaries around it.
 *
 * The Wave 1 migration WIDENED three views so that transaction-linked work is
 * visible to the people who must act on it. Widening a view is widening
 * access, so most of this file is the negative case: a carrier who is not on
 * the job, a warehouse that was not asked, a stranger, a signed-out visitor.
 *
 * It also walks the spine: loading -> transport -> offer -> award -> in
 * transit -> storage -> receipt -> delivered. That ordering is the server's,
 * not the test's, and each step only works because the one before it did.
 */

let SELLER: TestUser
let BUYER: TestUser
let CARRIER: TestUser
let OTHER_CARRIER: TestUser
let WAREHOUSE: TestUser
let OUTSIDER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
const QTY = 12
const PRICE = 90_000

let listingId = ''
let txnId = ''
let batchId = ''
let jobId = ''
let offerId = ''
let facilityId = ''
let reservationId = ''

beforeAll(async () => {
  admin = await adminClient()
  SELLER = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('trader', 'Trader')
  CARRIER = await makeUser('logistics_provider', 'Logistics Provider')
  OTHER_CARRIER = await makeUser('logistics_provider', 'Logistics Provider')
  WAREHOUSE = await makeUser('warehouse_owner', 'Warehouse Owner')
  OUTSIDER = await makeUser('trader', 'Trader')

  // A real chain of stock, so origin can be resolved through it.
  const must = <T,>(label: string, r: { data: T | null; error: { message: string } | null }): T => {
    if (r.error || !r.data) throw new Error(`setup ${label}: ${r.error?.message ?? 'no row returned'}`)
    return r.data
  }

  const { data: farm } = await SELLER.client.from('farms').insert({
    owner_id: SELLER.uid, farm_name: `Wave1 Farm ${RUN}`,
    state: 'Benue', lga: 'Makurdi', size_hectares: 10,
    primary_crops: ['Maize'], ownership_type: 'owned',
    latitude: 7.7322, longitude: 8.5391,
  }).select('id').single()

  const { data: cycle } = await SELLER.client.from('crop_records').insert({
    farm_id: farm!.id, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single()

  const { data: harvest } = await SELLER.client.from('harvests').insert({
    production_cycle_id: cycle!.id, farm_id: farm!.id, commodity: 'Maize',
    harvest_date: '2026-09-10', quantity: 100, unit: 'tonne',
  }).select('id').single()

  const { data: b } = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvest!.id, p_quantity: 100,
  })
  batchId = b as string

  // A batch-backed listing is created through loamy_list_batch, not by
  // insert -- the table refuses the direct path, which is why this listing is
  // traceable at all.
  const listed = await SELLER.client.rpc('loamy_list_batch', {
    p_batch_id: batchId, p_quantity: 100, p_price_per_unit: PRICE,
    p_state: 'Benue', p_lga: 'Makurdi',
  })
  if (listed.error) throw new Error(`setup listing: ${listed.error.message}`)
  listingId = listed.data as string

  const { data: t } = await BUYER.client.rpc('loamy_propose_transaction', {
    p_listing_id: listingId, p_quantity: QTY,
  })
  txnId = t as string

  // A delivery destination, so storage suggestions have somewhere to search.
  await BUYER.client.from('transactions')
    .update({ delivery_state: 'Benue', delivery_lga: 'Makurdi' }).eq('id', txnId)

  // A warehouse in the same state, listed by its owner.
  const fRes = await WAREHOUSE.client.from('service_directory').insert({
    owner_id: WAREHOUSE.uid, service_type: 'warehouse',
    business_name: `Wave1 Store ${RUN}`, state: 'Benue', lga: 'Makurdi',
    capacity_tonnes: 500, capacity_note: 'Dry storage',
  }).select('id').single()
  facilityId = must('facility', fRes).id
}, 300_000)

afterAll(async () => {
  if (facilityId) await WAREHOUSE.client.from('service_directory').delete().eq('id', facilityId)
})

describe('1 — origin resolves through the traceability chain', () => {
  it('finds the origin state without transactions.origin_state', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_transaction_origin_state', {
      p_transaction_id: txnId,
    })
    expect(error, error?.message).toBeFalsy()
    // Resolved via transaction -> batch -> farm. The column this replaced
    // never existed and raised 42703 on every call.
    expect(data).toBe('Benue')
  })

  it('suggests warehouses, which it never could before', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_suggest_warehouses', {
      p_transaction_id: txnId,
    })
    expect(error, error?.message).toBeFalsy()
    const s = data as Record<string, any>
    expect(s.available).toBe(true)
    expect(s.searched_state).toBe('Benue')
    expect((s.items as unknown[]).length).toBeGreaterThan(0)
  })

  it('tells a stranger nothing about the transaction', async () => {
    const { data } = await OUTSIDER.client.rpc('loamy_suggest_warehouses', {
      p_transaction_id: txnId,
    })
    const s = data as Record<string, any>
    expect(s.available).toBe(false)
    // Same answer as a genuinely missing transaction: distinguishing them
    // would confirm a stranger's purchase exists.
    expect(s.reason).toBe('no_such_transaction')
  })
})

describe('2 — the fulfilment read is party-scoped', () => {
  it('gives the buyer their own purchase, and says which side they are on', async () => {
    const { data } = await BUYER.client.rpc('loamy_transaction_fulfilment', {
      p_transaction_id: txnId,
    })
    const f = data as Record<string, any>
    expect(f.available).toBe(true)
    expect(f.transaction.viewer_role).toBe('buyer')
  })

  it('gives the seller the same purchase, from their side', async () => {
    const { data } = await SELLER.client.rpc('loamy_transaction_fulfilment', {
      p_transaction_id: txnId,
    })
    expect((data as Record<string, any>).transaction.viewer_role).toBe('seller')
  })

  it('refuses a stranger', async () => {
    const { data } = await OUTSIDER.client.rpc('loamy_transaction_fulfilment', {
      p_transaction_id: txnId,
    })
    const f = data as Record<string, any>
    expect(f.available).toBe(false)
    expect(f.transaction).toBeUndefined()
  })

  it('refuses a signed-out visitor', async () => {
    const { error } = await anonClient().rpc('loamy_transaction_fulfilment', {
      p_transaction_id: txnId,
    })
    expect(error).toBeTruthy()
  })
})

describe('3 — loading, and what it unlocks', () => {
  it('refuses transport while loading has not started', async () => {
    const { data } = await BUYER.client.rpc('loamy_request_transport_for_transaction', {
      p_transaction_id: txnId, p_mode: 'loamy',
    })
    const r = data as Record<string, any>
    expect(r.created).toBe(false)
    expect(r.reason).toBe('too_early')
  })

  it('refuses a stranger recording loading', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_record_loading', {
      p_transaction_id: txnId, p_stage: 'scheduled',
    })
    expect(error, 'a stranger recorded loading on someone else’s purchase').toBeTruthy()
  })

  it('lets the seller schedule loading', async () => {
    const { data, error } = await SELLER.client.rpc('loamy_record_loading', {
      p_transaction_id: txnId, p_stage: 'scheduled', p_note: `Wave1 ${RUN}`,
    })
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, any>).recorded).toBe(true)
  })

  it('FLAGS a completed loading with no evidence rather than refusing it', async () => {
    const { data, error } = await SELLER.client.rpc('loamy_record_loading', {
      p_transaction_id: txnId, p_stage: 'completed', p_quantity: QTY,
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.recorded).toBe(true)
    // Refusing would push people to record nothing at all.
    expect(r.flags).toEqual(expect.arrayContaining(['no_loading_photo', 'no_waybill', 'no_gps']))
  })

  it('shows the flags to the BUYER, not just the seller', async () => {
    const { data } = await BUYER.client.rpc('loamy_transaction_fulfilment', {
      p_transaction_id: txnId,
    })
    const loading = (data as Record<string, any>).loading as Record<string, any>[]
    const completed = loading.find((l) => l.stage === 'completed')
    expect(completed, 'the buyer cannot see the loading record').toBeTruthy()
    expect(completed!.flags).toContain('no_loading_photo')
  })
})

describe('4 — transport: request, quote, award', () => {
  it('lets the buyer request transport once loading has moved', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_request_transport_for_transaction', {
      p_transaction_id: txnId, p_mode: 'loamy', p_dropoff: 'Makurdi depot',
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.created).toBe(true)
    jobId = r.job_id
  })

  it('refuses the SELLER arranging the buyer’s delivery', async () => {
    const { error } = await SELLER.client.rpc('loamy_request_transport_for_transaction', {
      p_transaction_id: txnId, p_mode: 'loamy',
    })
    expect(error).toBeTruthy()
  })

  it('SHOWS the job to a carrier — the defect this wave fixed', async () => {
    // loamy_open_transport_jobs filtered on company_id, NULL for a purchase,
    // so `NULL in (...)` hid every marketplace job from every carrier.
    const { data } = await CARRIER.client.from('loamy_open_transport_jobs').select('*').eq('id', jobId)
    expect(data ?? [], 'a carrier still cannot see marketplace freight').toHaveLength(1)
    expect(data![0].job_kind).toBe('purchase')
  })

  it('does NOT show the job to the buyer as quotable work', async () => {
    const { data } = await BUYER.client.from('loamy_open_transport_jobs').select('id').eq('id', jobId)
    expect(data ?? [], 'the buyer was offered their own freight to quote on').toHaveLength(0)
  })

  it('refuses an offer from a party to the transaction', async () => {
    const { error } = await BUYER.client.rpc('loamy_submit_transport_offer', {
      p_job_id: jobId, p_price: 1,
    })
    expect(error).toBeTruthy()
  })

  it('refuses an offer from someone who is not a logistics provider', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_submit_transport_offer', {
      p_job_id: jobId, p_price: 50_000,
    })
    expect(error, 'a non-carrier quoted on freight').toBeTruthy()
  })

  it('accepts offers from two carriers', async () => {
    const a = await CARRIER.client.rpc('loamy_submit_transport_offer', {
      p_job_id: jobId, p_price: 120_000, p_note: 'Flatbed available',
    })
    expect(a.error, a.error?.message).toBeFalsy()
    offerId = a.data as string

    const b = await OTHER_CARRIER.client.rpc('loamy_submit_transport_offer', {
      p_job_id: jobId, p_price: 150_000,
    })
    expect(b.error, b.error?.message).toBeFalsy()
  })

  it('SHOWS both offers to the buyer — the mirror defect', async () => {
    const { data } = await BUYER.client.rpc('loamy_transaction_fulfilment', {
      p_transaction_id: txnId,
    })
    const offers = ((data as Record<string, any>).transport?.offers ?? []) as unknown[]
    expect(offers, 'the buyer cannot see offers on their own job').toHaveLength(2)
  })

  it('does not show one carrier another carrier’s price', async () => {
    const { data } = await OTHER_CARRIER.client
      .from('loamy_transport_offers_v').select('id, price').eq('transport_job_id', jobId)
    const ids = (data ?? []).map((o) => o.id)
    expect(ids, 'a carrier saw a rival’s quote').not.toContain(offerId)
  })

  it('refuses a stranger awarding the job', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_select_transport_offer', {
      p_offer_id: offerId,
    })
    expect(error).toBeTruthy()
  })

  it('awards exclusively: one selected, the rest declined', async () => {
    const { error } = await BUYER.client.rpc('loamy_select_transport_offer', { p_offer_id: offerId })
    expect(error, error?.message).toBeFalsy()

    const { data } = await BUYER.client.rpc('loamy_transaction_fulfilment', {
      p_transaction_id: txnId,
    })
    const t = (data as Record<string, any>).transport
    expect(t.status).toBe('assigned')
    expect(Number(t.agreed_price)).toBe(120_000)
    // The declined offer is filtered out of the party-facing read.
    expect(t.offers).toHaveLength(1)
  })

  it('refuses a second award on the same job', async () => {
    const { error } = await BUYER.client.rpc('loamy_select_transport_offer', { p_offer_id: offerId })
    expect(error, 'a job was awarded twice').toBeTruthy()
  })
})

describe('5 — the carrier moves the goods', () => {
  it('refuses a transition from a carrier who did not win', async () => {
    const { error } = await OTHER_CARRIER.client.rpc('loamy_logistics_transition', {
      p_job_id: jobId, p_event_type: 'departed',
    })
    expect(error, 'a losing carrier moved the job').toBeTruthy()
  })

  it('walks loaded -> departed -> arrived -> delivered', async () => {
    for (const ev of ['loaded', 'departed', 'arrived', 'delivered']) {
      const { error } = await CARRIER.client.rpc('loamy_logistics_transition', {
        p_job_id: jobId, p_event_type: ev,
      })
      expect(error, `${ev}: ${error?.message}`).toBeFalsy()
    }
  })

  it('shows the buyer every step the carrier recorded', async () => {
    const { data } = await BUYER.client.rpc('loamy_transaction_fulfilment', {
      p_transaction_id: txnId,
    })
    const t = (data as Record<string, any>).transport
    expect(t.status).toBe('delivered')
    const types = (t.events as Record<string, any>[]).map((e) => e.event_type)
    expect(types).toEqual(expect.arrayContaining(['loaded', 'departed', 'arrived', 'delivered']))
  })
})

describe('6 — storage is requested and accepted, never silently booked', () => {
  it('lets the buyer ask a facility for space', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_request_storage', {
      p_transaction_id: txnId, p_facility_id: facilityId, p_quantity: QTY,
      p_note: `Wave1 ${RUN}`,
    })
    expect(error, error?.message).toBeFalsy()
    reservationId = data as string
  })

  it('refuses a stranger requesting storage on this purchase', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_request_storage', {
      p_transaction_id: txnId, p_facility_id: facilityId, p_quantity: 1,
    })
    expect(error).toBeTruthy()
  })

  it('is NOT booked merely because it was requested', async () => {
    const { data } = await BUYER.client.rpc('loamy_transaction_fulfilment', {
      p_transaction_id: txnId,
    })
    const s = ((data as Record<string, any>).storage ?? []) as Record<string, any>[]
    expect(s[0].status).toBe('requested')
  })

  it('SHOWS the request to the facility — the third hidden-row defect', async () => {
    const { data } = await WAREHOUSE.client
      .from('loamy_warehouse_reservations_v').select('*').eq('id', reservationId)
    expect(data ?? [], 'the facility cannot see the storage request').toHaveLength(1)
    expect(data![0].reservation_kind).toBe('purchase')
  })

  it('hides it from an unrelated member', async () => {
    const { data } = await OUTSIDER.client
      .from('loamy_warehouse_reservations_v').select('id').eq('id', reservationId)
    expect(data ?? []).toHaveLength(0)
  })

  it('refuses anyone but the facility answering', async () => {
    const { error } = await BUYER.client.rpc('loamy_respond_storage', {
      p_reservation_id: reservationId, p_accept: true,
    })
    expect(error, 'the requester accepted their own storage request').toBeTruthy()
  })

  it('lets the facility accept', async () => {
    const { error } = await WAREHOUSE.client.rpc('loamy_respond_storage', {
      p_reservation_id: reservationId, p_accept: true,
    })
    expect(error, error?.message).toBeFalsy()
  })

  it('refuses a receipt from anyone but the facility', async () => {
    const { error } = await BUYER.client.rpc('loamy_record_warehouse_receipt', {
      p_facility_id: facilityId, p_batch_id: batchId,
      p_movement: 'arrival', p_quantity: QTY,
    })
    expect(error, 'a buyer signed goods in at someone else’s warehouse').toBeTruthy()
  })

  /**
   * A KNOWN LIMITATION, asserted rather than worked around.
   *
   * The batch here is 100 tonnes and only 12 were bought, so the batch stays
   * `listed` through the whole journey — a partial sale does not move the
   * seller's remaining stock, which is correct. But
   * `loamy_record_warehouse_receipt` writes a batch transition to
   * `warehouse_received`, which is only allowed from in_transit, loaded,
   * reserved, sold or partially_sold.
   *
   * So a warehouse cannot sign in goods from a PARTIALLY sold batch. The
   * guard is the batch state machine protecting itself and must not be
   * loosened from here; what is missing is that a partial sale never marks
   * the batch `partially_sold`. That is a batch-lifecycle question, not a
   * fulfilment one, and it is carried to Wave 2 rather than patched.
   */
  it('refuses a receipt while the batch itself has not moved', async () => {
    const { error } = await WAREHOUSE.client.rpc('loamy_record_warehouse_receipt', {
      p_facility_id: facilityId, p_batch_id: batchId,
      p_movement: 'arrival', p_quantity: QTY, p_condition: 'Dry',
      p_reservation_id: reservationId, p_transaction_id: txnId,
    })
    expect(error, 'the batch state machine was bypassed').toBeTruthy()
    expect(error!.message).toMatch(/cannot go to warehouse_received/i)
  })

  it('refuses a receipt from anyone but the facility, whatever the batch state', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_record_warehouse_receipt', {
      p_facility_id: facilityId, p_batch_id: batchId,
      p_movement: 'arrival', p_quantity: QTY,
    })
    expect(error).toBeTruthy()
  })
})

describe('7 — nothing duplicated, and the trace can find it', () => {
  it('leaves exactly one transaction', async () => {
    const { data } = await BUYER.client.from('transactions')
      .select('id').eq('listing_id', listingId).eq('quantity', QTY)
    expect(data ?? [], 'the fulfilment spine created a duplicate transaction').toHaveLength(1)
  })

  it('leaves exactly one live transport job', async () => {
    const { data } = await BUYER.client.from('transport_jobs')
      .select('id').eq('transaction_id', txnId).not('status', 'in', '(cancelled,failed)')
    expect(data ?? []).toHaveLength(1)
  })

  it('traces the purchase by its business reference', async () => {
    const { data: t } = await BUYER.client.from('transactions')
      .select('ref').eq('id', txnId).single()
    const { data, error } = await BUYER.client.rpc('loamy_trace', { p_ref: t!.ref })
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, any>).found).toBe(true)
  })

  it('does not leak the purchase to a stranger through trace', async () => {
    const { data: t } = await BUYER.client.from('transactions')
      .select('ref').eq('id', txnId).single()
    const { data } = await OUTSIDER.client.rpc('loamy_trace', { p_ref: t!.ref })
    const r = data as Record<string, any>
    // "Exists but not visible to you" must not read as "does not exist", and
    // neither may disclose the purchase itself.
    expect(JSON.stringify(r)).not.toContain(BUYER.uid)
  })
})
