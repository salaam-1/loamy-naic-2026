import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Phases 8-12: logistics, warehouse, traceability, intelligence, institutions.
 *
 * This suite walks the directive's GOLDEN PATH (Part 33) end to end and then
 * traces it back, because the point of these phases is that the links connect.
 * A phase that passes in isolation but does not join to the next one has not
 * really been built.
 */

let FARMER: TestUser
let BUYER: TestUser
let HAULIER: TestUser
let WAREHOUSE: TestUser
let OUTSIDER: TestUser
let admin: SupabaseClient | null

let batchId = ''
let batchRef = ''
let txnId = ''
let jobId = ''
let facilityId = ''

beforeAll(async () => {
  FARMER = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('trader', 'Trader')
  HAULIER = await makeUser('logistics_provider', 'Logistics Provider')
  WAREHOUSE = await makeUser('warehouse_owner', 'Warehouse Owner')
  OUTSIDER = await makeUser('trader', 'Trader')
  admin = await adminClient()

  // --- farm -> cycle -> harvest -> batch ---
  const { data: farm } = await FARMER.client.from('farms').insert({
    owner_id: FARMER.uid, farm_name: 'Golden Path Farm', state: 'Benue', lga: 'Makurdi',
    size_hectares: 15, primary_crops: ['Maize'], ownership_type: 'owned',
    latitude: 7.7322, longitude: 8.5391,
  }).select('id').single()

  const { data: cycle } = await FARMER.client.from('crop_records').insert({
    farm_id: farm!.id, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single()

  const { data: harvest } = await FARMER.client.from('harvests').insert({
    production_cycle_id: cycle!.id, farm_id: farm!.id, commodity: 'Maize',
    harvest_date: '2026-09-05', quantity: 40, unit: 'tonne',
    location_state: 'Benue', location_lga: 'Makurdi',
  }).select('id').single()

  const { data: b } = await FARMER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvest!.id, p_quantity: 40, p_grade: 'Grade A',
  })
  batchId = b as string
  const { data: br } = await FARMER.client
    .from('commodity_batches').select('ref').eq('id', batchId).single()
  batchRef = br!.ref

  // --- list -> propose -> accept ---
  const { data: listing } = await FARMER.client.rpc('loamy_list_batch', {
    p_batch_id: batchId, p_quantity: 20, p_price_per_unit: 300_000,
  })
  const { data: t } = await BUYER.client.rpc('loamy_propose_transaction', {
    p_listing_id: listing as string, p_quantity: 20,
    p_delivery_state: 'Lagos', p_delivery_lga: 'Ikeja',
  })
  txnId = t as string
  await FARMER.client.rpc('loamy_transaction_transition', {
    p_transaction_id: txnId, p_event_type: 'accept', p_machine: 'status',
  })

  // --- warehouse facility at the destination ---
  const { data: fac } = await WAREHOUSE.client.from('service_directory').insert({
    owner_id: WAREHOUSE.uid, service_type: 'warehouse', business_name: 'Ikeja AgriStore',
    state: 'Lagos', lga: 'Ikeja', capacity_tonnes: 500,
  }).select('id').single()
  facilityId = fac!.id
}, 300_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

// ---------------------------------------------------------------------------
describe('Phase 8 — logistics', () => {
  it('lets a party request transport once the deal is accepted', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_request_transport', {
      p_transaction_id: txnId, p_mode: 'loamy',
      p_pickup_state: 'Benue', p_pickup_lga: 'Makurdi',
      p_dropoff_state: 'Lagos', p_dropoff_lga: 'Ikeja',
    })
    expect(error, error?.message).toBeFalsy()
    jobId = data as string

    const { data: j } = await BUYER.client
      .from('transport_jobs').select('ref, status, mode, transaction_id, batch_id')
      .eq('id', jobId).single()
    expect(j!.ref).toMatch(/^LOG-\d{6}$/)
    expect(j!.status).toBe('requested')
    expect(j!.transaction_id).toBe(txnId)
    expect(j!.batch_id).toBe(batchId)
  })

  it('refuses a stranger requesting transport on someone else’s transaction', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_request_transport', {
      p_transaction_id: txnId, p_mode: 'loamy',
    })
    expect(error).toBeTruthy()
  })

  it('refuses a second job for the same transaction', async () => {
    const { error } = await BUYER.client.rpc('loamy_request_transport', {
      p_transaction_id: txnId, p_mode: 'loamy',
    })
    expect(error).toBeTruthy()
  })

  it('still allows EXTERNAL haulage — Loamy logistics is not forced', async () => {
    const { data: t2 } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: (await FARMER.client.from('listings').select('id')
        .eq('batch_id', batchId).eq('status', 'active').limit(1).single()).data!.id,
      p_quantity: 5,
    })
    await FARMER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: t2 as string, p_event_type: 'accept', p_machine: 'status',
    })
    const { data, error } = await BUYER.client.rpc('loamy_request_transport', {
      p_transaction_id: t2 as string, p_mode: 'external',
      p_external_provider_name: 'Arewa Haulage',
    })
    expect(error, error?.message).toBeFalsy()

    const { data: j } = await BUYER.client
      .from('transport_jobs').select('mode, status').eq('id', data as string).single()
    expect(j!.mode).toBe('external')
    expect(j!.status).toBe('booked')
  }, 90_000)

  it('refuses a transition from the wrong role', async () => {
    // 'loaded' is the provider's to record, and nobody is assigned yet.
    const { error } = await BUYER.client.rpc('loamy_logistics_transition', {
      p_job_id: jobId, p_event_type: 'loaded',
    })
    expect(error).toBeTruthy()
  })

  it('drives the transaction and batch forward when the provider reports movement', async () => {
    // Select a transporter through the real path (Part 21).
    const assign = await BUYER.client.rpc('loamy_assign_transport', {
      p_job_id: jobId, p_provider_id: HAULIER.uid, p_agreed_price: 450_000,
    })
    expect(assign.error, assign.error?.message).toBeFalsy()

    for (const ev of ['loaded', 'departed']) {
      const { error } = await HAULIER.client.rpc('loamy_logistics_transition', {
        p_job_id: jobId, p_event_type: ev,
        p_latitude: 7.73, p_longitude: 8.53,
      })
      expect(error, `${ev}: ${error?.message}`).toBeFalsy()
    }

    // Fulfilment moved; status and payment did NOT.
    const { data: t } = await BUYER.client
      .from('transactions').select('status, payment_state, fulfilment_state').eq('id', txnId).single()
    expect(t!.fulfilment_state).toBe('in_transit')
    expect(t!.status).toBe('accepted')
    expect(t!.payment_state).toBe('not_started')

    const { data: bt } = await FARMER.client
      .from('commodity_batches').select('status').eq('id', batchId).single()
    expect(bt!.status).toBe('in_transit')
  }, 90_000)

  it('keeps live truck position away from strangers and anon', async () => {
    const stranger = await OUTSIDER.client.from('shipment_events').select('*').eq('job_id', jobId)
    expect(stranger.data ?? [], 'a stranger read live shipment positions').toHaveLength(0)

    const pub = await anonClient().from('shipment_events').select('*').limit(1)
    expect(pub.error || (pub.data ?? []).length === 0).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('Phase 9 — warehouse', () => {
  let reservationId = ''

  it('gives the facility a WH reference', async () => {
    const { data } = await WAREHOUSE.client
      .from('service_directory').select('ref').eq('id', facilityId).single()
    expect(data!.ref).toMatch(/^WH-\d{6}$/)
  })

  it('will not let the owner self-verify their facility', async () => {
    await WAREHOUSE.client.from('service_directory')
      .update({ verification_status: 'verified' }).eq('id', facilityId)
    const { data } = await WAREHOUSE.client
      .from('service_directory').select('verification_status').eq('id', facilityId).single()
    expect(data!.verification_status, 'a warehouse self-verified').toBe('unverified')
  })

  it('requests storage without silently booking it', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_request_storage', {
      p_transaction_id: txnId, p_facility_id: facilityId, p_quantity: 20,
    })
    expect(error, error?.message).toBeFalsy()
    reservationId = data as string

    const { data: r } = await BUYER.client
      .from('warehouse_reservations').select('ref, status').eq('id', reservationId).single()
    expect(r!.ref).toMatch(/^WHR-\d{6}$/)
    // Part 25 of the master directive: a recommendation must never auto-book.
    expect(r!.status).toBe('requested')
  })

  it('only the facility owner may answer', async () => {
    const bad = await BUYER.client.rpc('loamy_respond_storage', {
      p_reservation_id: reservationId, p_accept: true,
    })
    expect(bad.error).toBeTruthy()

    const good = await WAREHOUSE.client.rpc('loamy_respond_storage', {
      p_reservation_id: reservationId, p_accept: true,
    })
    expect(good.error, good.error?.message).toBeFalsy()
  })

  it('records an ARRIVAL as a receipt AND a batch event, not a location edit', async () => {
    const { data, error } = await WAREHOUSE.client.rpc('loamy_record_warehouse_receipt', {
      p_facility_id: facilityId, p_batch_id: batchId, p_movement: 'arrival',
      p_quantity: 20, p_condition: 'Dry, good order',
      p_reservation_id: reservationId, p_transaction_id: txnId,
    })
    expect(error, error?.message).toBeFalsy()

    const { data: r } = await WAREHOUSE.client
      .from('warehouse_receipts').select('ref, movement, quantity, condition, received_by')
      .eq('id', data as string).single()
    expect(r!.ref).toMatch(/^WRC-\d{6}$/)
    expect(r!.received_by).toBe(WAREHOUSE.uid)

    // The traceable event Part 22 demands.
    const { data: ev } = await FARMER.client
      .from('batch_events').select('event_type, new_status')
      .eq('batch_id', batchId).eq('event_type', 'warehouse_received').maybeSingle()
    expect(ev, 'arrival did not create a batch event').toBeTruthy()
    expect(ev!.new_status).toBe('warehouse_received')
  })

  it('refuses a seller signing for goods at a warehouse they do not run', async () => {
    const { error } = await FARMER.client.rpc('loamy_record_warehouse_receipt', {
      p_facility_id: facilityId, p_batch_id: batchId, p_movement: 'arrival', p_quantity: 1,
    })
    expect(error, 'a seller declared their own stock received').toBeTruthy()
  })

  it('keeps receipts off the public surface', async () => {
    const pub = await anonClient().from('warehouse_receipts').select('*').limit(1)
    expect(pub.error || (pub.data ?? []).length === 0).toBeTruthy()
    const stranger = await OUTSIDER.client.from('warehouse_receipts').select('*').eq('batch_id', batchId)
    expect(stranger.data ?? []).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('Phase 10 — traceability', () => {
  it('reconstructs the whole chain for the origin farmer', async () => {
    const { data, error } = await FARMER.client.rpc('loamy_trace_batch', { p_ref: batchRef })
    expect(error, error?.message).toBeFalsy()
    const tr = data as Record<string, any>

    expect(tr.found).toBe(true)
    expect(tr.scope).toBe('origin')
    expect(tr.batch.ref).toBe(batchRef)
    expect(tr.farm.available).toBe(true)
    expect(tr.farm.farm_name).toBe('Golden Path Farm')
    expect(tr.production_cycle.available).toBe(true)
    expect(tr.harvest.available).toBe(true)
    expect(tr.listings.available).toBe(true)
    expect(tr.transactions.available).toBe(true)
    expect(tr.logistics.available).toBe(true)
    expect(tr.warehouse.available).toBe(true)
    // The spine: created -> listed -> reserved -> in_transit -> warehouse_received
    const events = (tr.events as { event: string }[]).map((e) => e.event)
    expect(events[0]).toBe('created')
    expect(events).toContain('warehouse_received')
  })

  it('accepts a raw uuid as well as the printed reference', async () => {
    const { data } = await FARMER.client.rpc('loamy_trace_batch', { p_ref: batchId })
    expect((data as Record<string, any>).found).toBe(true)
  })

  it('gives the buyer the party view — chain yes, farm identity no', async () => {
    const { data } = await BUYER.client.rpc('loamy_trace_batch', { p_ref: batchRef })
    const tr = data as Record<string, any>
    expect(tr.scope).toBe('party')
    expect(tr.farm.available).toBe(true)
    expect(tr.farm.state).toBe('Benue')
    // Identity and precise location withheld.
    expect(tr.farm.farm_name).toBeNull()
    expect(tr.farm.owner_name).toBeNull()
    expect(tr.farm.lga).toBeNull()
    expect(tr.transactions.available).toBe(true)
  })

  it('never fabricates a missing link', async () => {
    // A declared batch with no harvest behind it.
    const { data: bare } = await FARMER.client.from('farms').insert({
      owner_id: FARMER.uid, farm_name: 'Bare', state: 'Benue', lga: 'Gboko',
      size_hectares: 1, primary_crops: ['Rice'], ownership_type: 'owned',
    }).select('id').single()
    const { data: c2 } = await FARMER.client.from('crop_records').insert({
      farm_id: bare!.id, crop: 'Rice', season_year: 2026,
    }).select('id').single()
    const { data: h2 } = await FARMER.client.from('harvests').insert({
      production_cycle_id: c2!.id, farm_id: bare!.id, commodity: 'Rice',
      harvest_date: '2026-09-01', quantity: 5, unit: 'tonne',
    }).select('id').single()
    const { data: b2 } = await FARMER.client.rpc('loamy_create_batch_from_harvest', {
      p_harvest_id: h2!.id, p_quantity: 5,
    })
    const { data } = await FARMER.client.rpc('loamy_trace_batch', { p_ref: b2 as string })
    const tr = data as Record<string, any>

    // Explicitly unavailable, with a reason — not an empty success.
    expect(tr.listings.available).toBe(false)
    expect(tr.listings.reason).toBe('never_listed')
    expect(tr.transactions.available).toBe(false)
    expect(tr.transactions.reason).toBe('never_sold')
    expect(tr.warehouse.reason).toBe('never_warehoused')
    expect(tr.verifications.reason).toBe('never_verified')
  }, 90_000)

  it('gives an uninvolved member the PUBLIC scope of an actively-listed batch', async () => {
    // Intended: stock on sale is traceable to a browsing buyer, at state
    // granularity and with no identities or quantities.
    const { data } = await OUTSIDER.client.rpc('loamy_trace_batch', { p_ref: batchRef })
    const tr = data as Record<string, any>
    expect(tr.found).toBe(true)
    expect(tr.scope).toBe('public')
    expect(tr.batch.origin_state).toBe('Benue')
    expect(tr.batch.quantity).toBeNull()
    expect(tr.farm.farm_name).toBeNull()
    expect(tr.transactions.available).toBe(false)
    expect(tr.transactions.reason).toBe('not_permitted')
  })

  it('will not confirm a batch that is not listed and not theirs', async () => {
    // The unlisted 'Bare' batch from the previous test: an uninvolved member
    // gets the same answer as for a nonexistent ref, so this is not an oracle.
    const { data: bare } = await FARMER.client
      .from('commodity_batches').select('ref').eq('commodity', 'Rice').limit(1).maybeSingle()
    if (!bare) return
    const { data } = await OUTSIDER.client.rpc('loamy_trace_batch', { p_ref: bare.ref })
    const tr = data as Record<string, any>
    expect(tr.found).toBe(false)
    expect(tr.reason).toBe('no_such_reference')
  })

  it('returns the same shape for a genuinely unknown reference', async () => {
    const { data } = await BUYER.client.rpc('loamy_trace_batch', { p_ref: 'BATCH-999999' })
    expect((data as Record<string, any>).found).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('Phase 11 — weather and market intelligence', () => {
  it('records weather against a farm, with provider metadata', async () => {
    const { data: farm } = await FARMER.client
      .from('farms').select('id').eq('farm_name', 'Golden Path Farm').single()
    const { data, error } = await FARMER.client.rpc('loamy_record_weather', {
      p_subject_type: 'farm', p_subject_id: farm!.id, p_kind: 'forecast',
      p_observed_for: '2026-09-25', p_provider: 'open-meteo',
      p_temp_min_c: 22, p_temp_max_c: 31, p_precip_mm: 4.2,
    })
    expect(error, error?.message).toBeFalsy()

    const { data: w } = await FARMER.client
      .from('weather_observations').select('ref, provider, kind, interpretation')
      .eq('id', data as string).single()
    expect(w!.ref).toMatch(/^WX-\d{6}$/)
    expect(w!.provider).toBe('open-meteo')
    // Raw provider data and Loamy interpretation are separate columns.
    expect(w!.interpretation).toBeNull()
  })

  it('refuses a weather reading with no provider named', async () => {
    const { error } = await FARMER.client.rpc('loamy_record_weather', {
      p_subject_type: 'region', p_subject_id: null, p_kind: 'forecast',
      p_observed_for: '2026-09-25', p_provider: '  ',
    })
    expect(error).toBeTruthy()
  })

  it('refuses weather about another member’s farm', async () => {
    const { data: farm } = await FARMER.client
      .from('farms').select('id').eq('farm_name', 'Golden Path Farm').single()
    const { error } = await OUTSIDER.client.rpc('loamy_record_weather', {
      p_subject_type: 'farm', p_subject_id: farm!.id, p_kind: 'forecast',
      p_observed_for: '2026-09-26', p_provider: 'open-meteo',
    })
    expect(error).toBeTruthy()
  })

  it('keeps a farm’s weather private to its owner', async () => {
    const { data } = await OUTSIDER.client
      .from('weather_observations').select('*').eq('subject_type', 'farm')
    expect(data ?? []).toHaveLength(0)
  })

  it('labels market data by kind, and keeps model output out of aggregates', async () => {
    const { data, error } = await anonClient()
      .from('loamy_validated_prices').select('data_class').limit(1)
    expect(error).toBeFalsy()
    if ((data ?? []).length) expect(data![0].data_class).toBe('observed')

    const { error: aggErr } = await anonClient()
      .from('loamy_market_intelligence').select('commodity, days_since_latest').limit(1)
    expect(aggErr, 'market intelligence view unreadable').toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
describe('Phase 12 — institutional access', () => {
  it('refuses every aggregate to an account with no scope', async () => {
    // Denial is DATA, not an exception -- otherwise the refusal audit row is
    // rolled back with the raise and the probe leaves no trace.
    for (const fn of ['loamy_institutional_production',
                      'loamy_institutional_trade',
                      'loamy_institutional_storage']) {
      const { data, error } = await OUTSIDER.client.rpc(fn)
      expect(error, `${fn}: ${error?.message}`).toBeFalsy()
      const r = data as Record<string, any>
      expect(r.allowed, `${fn} answered an unscoped caller`).toBe(false)
      expect(r.reason).toBe('scope_not_held')
      expect(r.rows).toBeUndefined()
    }
  })

  it('refuses trace lookup without the scope', async () => {
    const { data } = await OUTSIDER.client.rpc('loamy_institutional_trace', { p_ref: batchRef })
    const r = data as Record<string, any>
    expect(r.allowed).toBe(false)
    expect(r.batch).toBeUndefined()
  })

  it('will not let a member grant themselves a scope', async () => {
    const { error } = await OUTSIDER.client.from('institutional_access').insert({
      user_id: OUTSIDER.uid, organisation: 'Self Ltd', scope: 'trace_lookup',
      lawful_basis: 'because I said so', granted_by: OUTSIDER.uid,
    })
    expect(error, 'a member granted themselves institutional access').toBeTruthy()
  })

  it('answers once an admin grants the scope, and audits the query', async () => {
    if (!admin) return expect(admin).toBeNull()

    const grant = await admin.from('institutional_access').insert({
      user_id: OUTSIDER.uid, organisation: 'Test Ministry of Agriculture',
      scope: 'trace_lookup', lawful_basis: 'Phase 12 verification',
      granted_by: (await admin.auth.getUser()).data.user!.id,
    })
    expect(grant.error, grant.error?.message).toBeFalsy()

    const { data, error } = await OUTSIDER.client
      .rpc('loamy_institutional_trace', { p_ref: batchRef })
    expect(error, error?.message).toBeFalsy()

    const tr = data as Record<string, any>
    expect(tr.allowed).toBe(true)
    expect(tr.found).toBe(true)
    expect(tr.scope).toBe('institutional')
    expect(tr.batch.commodity).toBe('Maize')
    expect(tr.batch.origin_state).toBe('Benue')
    // An institution is never a party: no counterparties, quantities or prices.
    expect(tr.transactions).toBeUndefined()
    expect(tr.batch.quantity).toBeUndefined()
    expect(tr.farm).toBeUndefined()

    const { data: audit } = await admin
      .from('audit_events').select('event_type, detail')
      .eq('event_type', 'institutional_query')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    expect(audit, 'an institutional query was not audited').toBeTruthy()
    expect((audit!.detail as Record<string, unknown>).allowed).toBe(true)
  }, 90_000)

  it('audits a REFUSED query too — the probe must leave a trace', async () => {
    if (!admin) return
    const { data: denied } = await OUTSIDER.client.rpc('loamy_institutional_production')
    expect((denied as Record<string, any>).allowed).toBe(false)

    const { data } = await admin
      .from('audit_events').select('detail')
      .eq('event_type', 'institutional_query').eq('subject_type', 'aggregate_production')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    expect(data, 'a refused institutional query left no trace').toBeTruthy()
    expect((data!.detail as Record<string, unknown>).allowed).toBe(false)
  })

  it('stops answering once the grant expires', async () => {
    if (!admin) return
    await admin.from('institutional_access')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('user_id', OUTSIDER.uid).eq('scope', 'trace_lookup')

    const { data } = await OUTSIDER.client
      .rpc('loamy_institutional_trace', { p_ref: batchRef })
    expect((data as Record<string, any>).allowed, 'an expired grant still answered').toBe(false)
  })
})
