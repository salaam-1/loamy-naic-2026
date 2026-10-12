import { beforeAll, describe, expect, it } from 'vitest'
import { adminClient, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * PARTIAL SALE — a batch is only `sold` when there is nothing left of it.
 *
 * `loamy_transaction_transition` fired the batch event 'sold' on every
 * completed transaction, so completing a 12-tonne purchase against a
 * 100-tonne batch marked the WHOLE batch sold with 88 tonnes still available.
 * The seller's remaining stock silently became unsellable, and the trace said
 * the batch was gone when it was not.
 *
 * `partially_sold` had existed since Phase 2 and the transition rules were
 * widened for it in 20260919220001. Every piece was in place; nothing ever
 * fired the event.
 *
 * The model these tests hold:
 *   quantity            as harvested. NEVER mutates.
 *   available_quantity  what is left. Moved only through the batch machine.
 *   committed           quantity - available_quantity (derived)
 *   status              sold ONLY at zero; partially_sold otherwise
 */

let SELLER: TestUser
let BUYER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
const TOTAL = 100
const FIRST = 12
const SECOND = 20

let batchId = ''
let listingId = ''
let txn1 = ''
let txn2 = ''

/** Every step asserted: a silent setup failure makes every later test a lie. */
function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error || r.data === null) {
    throw new Error(`setup ${label}: ${r.error?.message ?? 'no row returned'}`)
  }
  return r.data
}

const batch = async () => {
  const { data } = await SELLER.client.from('commodity_batches')
    .select('quantity, available_quantity, status').eq('id', batchId).single()
  return data as { quantity: number; available_quantity: number; status: string }
}

/** Walk a transaction to completed. Acceptance is what commits the stock. */
async function completeSale(txn: string) {
  const accept = await SELLER.client.rpc('loamy_transaction_transition', {
    p_transaction_id: txn, p_event_type: 'accept', p_machine: 'status',
  })
  expect(accept.error, `accept: ${accept.error?.message}`).toBeFalsy()

  const done = await admin!.rpc('loamy_transaction_transition', {
    p_transaction_id: txn, p_event_type: 'complete', p_machine: 'status',
  })
  expect(done.error, `complete: ${done.error?.message}`).toBeFalsy()
}

beforeAll(async () => {
  admin = await adminClient()
  SELLER = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('trader', 'Trader')

  const farm = must('farm', await SELLER.client.from('farms').insert({
    owner_id: SELLER.uid, farm_name: `Partial Farm ${RUN}`,
    state: 'Benue', lga: 'Makurdi', size_hectares: 10,
    primary_crops: ['Maize'], ownership_type: 'owned',
    latitude: 7.7322, longitude: 8.5391,
  }).select('id').single())

  const cycle = must('cycle', await SELLER.client.from('crop_records').insert({
    farm_id: farm.id, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single())

  const harvest = must('harvest', await SELLER.client.from('harvests').insert({
    production_cycle_id: cycle.id, farm_id: farm.id, commodity: 'Maize',
    harvest_date: '2026-09-10', quantity: TOTAL, unit: 'tonne',
  }).select('id').single())

  const b = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvest.id, p_quantity: TOTAL,
  })
  if (b.error || !b.data) throw new Error(`setup batch: ${b.error?.message}`)
  batchId = b.data as string

  const l = await SELLER.client.rpc('loamy_list_batch', {
    p_batch_id: batchId, p_quantity: TOTAL, p_price_per_unit: 90_000,
    p_state: 'Benue', p_lga: 'Makurdi',
  })
  if (l.error || !l.data) throw new Error(`setup listing: ${l.error?.message}`)
  listingId = l.data as string
}, 300_000)

describe('0 — the fixtures this file depends on exist', () => {
  it('has a 100 tonne batch, listed', async () => {
    expect(batchId, 'no batch was created').toBeTruthy()
    expect(listingId, 'no listing was created').toBeTruthy()
    const b = await batch()
    expect(Number(b.quantity)).toBe(TOTAL)
    expect(Number(b.available_quantity)).toBe(TOTAL)
    expect(b.status).toBe('listed')
  })
})

describe('1 — a 12t sale from a 100t batch', () => {
  it('commits the stock on acceptance, not on proposal', async () => {
    const t = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: FIRST,
    })
    expect(t.error, t.error?.message).toBeFalsy()
    txn1 = t.data as string

    // Proposing must not lock a seller's inventory: otherwise a buyer could
    // grief them for free.
    const b = await batch()
    expect(Number(b.available_quantity), 'proposing committed stock').toBe(TOTAL)
  })

  it('leaves 88 available and marks the batch PARTIALLY sold', async () => {
    if (!admin) return
    await completeSale(txn1)

    const b = await batch()
    expect(Number(b.available_quantity)).toBe(TOTAL - FIRST)
    expect(b.status, 'a 12t sale marked the whole batch sold').toBe('partially_sold')
  })

  it('never mutates the original quantity', async () => {
    const b = await batch()
    // The batch as harvested is a historical fact; only availability moves.
    expect(Number(b.quantity)).toBe(TOTAL)
  })

  it('records the committed quantity as the difference, not a stored field', async () => {
    const b = await batch()
    expect(Number(b.quantity) - Number(b.available_quantity)).toBe(FIRST)
  })
})

describe('2 — the remainder is still sellable', () => {
  it('accepts a second 20t sale from the same batch', async () => {
    if (!admin) return
    const t = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: SECOND,
    })
    expect(t.error, t.error?.message).toBeFalsy()
    txn2 = t.data as string

    await completeSale(txn2)

    const b = await batch()
    expect(Number(b.available_quantity)).toBe(TOTAL - FIRST - SECOND)
    expect(b.status).toBe('partially_sold')
  })

  it('keeps both transactions attached to the SAME batch', async () => {
    const { data } = await BUYER.client.from('transactions')
      .select('id, batch_id, quantity').in('id', [txn1, txn2])
    expect(data ?? []).toHaveLength(2)
    for (const t of data ?? []) {
      // No duplicate batch model: one batch, many sales.
      expect(t.batch_id, 'a sale was attached to a different batch').toBe(batchId)
    }
  })
})

describe('3 — over-selling is refused', () => {
  /**
   * The refusal lands at ACCEPTANCE, not at proposal.
   *
   * `loamy_propose_transaction` validates against the LISTING, not against
   * what other open proposals have already committed -- a documented Phase 4
   * slice 1 limitation. Committing is what acceptance does, and the batch
   * machine enforces `available_quantity` there.
   *
   * That is a real design choice rather than a gap: refusing at proposal
   * would mean the first buyer to click holds an option over stock they have
   * not paid for. The seller decides who gets it, and only then is stock
   * taken. What must never happen is the COMMITMENT succeeding, and this
   * asserts exactly that.
   */
  it('refuses to COMMIT more stock than remains', async () => {
    const b = await batch()
    const over = Number(b.available_quantity) + 1

    const t = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: over,
    })
    expect(t.error, t.error?.message).toBeFalsy()

    const { error } = await SELLER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: t.data as string, p_event_type: 'accept', p_machine: 'status',
    })
    expect(error, 'more stock was committed than exists').toBeTruthy()
    expect(error!.message).toMatch(/remain/i)

    // And the over-sized proposal is cleaned up so it cannot be accepted later.
    await BUYER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: t.data as string, p_event_type: 'cancel', p_machine: 'status',
    })
  })

  it('leaves the balance untouched after a refusal', async () => {
    const b = await batch()
    expect(Number(b.available_quantity)).toBe(TOTAL - FIRST - SECOND)
  })
})

describe('4 — exhausting the batch marks it sold', () => {
  it('becomes SOLD only when nothing is left', async () => {
    if (!admin) return
    const before = await batch()
    const rest = Number(before.available_quantity)

    const t = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: rest,
    })
    expect(t.error, t.error?.message).toBeFalsy()
    await completeSale(t.data as string)

    const after = await batch()
    expect(Number(after.available_quantity)).toBe(0)
    expect(after.status, 'an exhausted batch was not marked sold').toBe('sold')
    // And still the original quantity.
    expect(Number(after.quantity)).toBe(TOTAL)
  })
})

describe('5 — a warehouse can sign in a partially sold batch', () => {
  it('allows warehouse_received from the batch state a sale leaves behind', async () => {
    if (!admin) return
    // Wave 1 found a receipt refused because the batch was still `listed` --
    // the transaction had never been accepted, so nothing was committed. With
    // the sale completed the batch reaches a state the receipt rules accept:
    // reserved, partially_sold and sold are all permitted.
    const { data: rules } = await admin.from('batch_transition_rules')
      .select('allowed_from').eq('event_type', 'warehouse_received').single()
    const allowed = (rules!.allowed_from as string[])
    const b = await batch()
    expect(allowed, `a ${b.status} batch cannot be received into a warehouse`)
      .toContain(b.status)
  })
})

describe('6 — traceability keeps the original batch', () => {
  it('traces the batch and finds it', async () => {
    const { data: b } = await SELLER.client.from('commodity_batches')
      .select('ref').eq('id', batchId).single()
    const { data, error } = await SELLER.client.rpc('loamy_trace', { p_ref: b!.ref })
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, any>).found).toBe(true)
  })

  it('kept an event for every sale rather than overwriting the batch', async () => {
    const { data } = await SELLER.client.from('batch_events')
      .select('event_type').eq('batch_id', batchId)
    const types = (data ?? []).map((e) => e.event_type)
    // Three sales: two partial, one that exhausted it.
    expect(types.filter((t) => t === 'partially_sold').length).toBeGreaterThanOrEqual(2)
    expect(types).toContain('sold')
  })
})
