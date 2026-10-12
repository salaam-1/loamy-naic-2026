import { describe, expect, it } from 'vitest'
import {
  BATCH_STATUS_META, BATCH_VERIFICATION_META,
  canBatch, listableQuantity, listingBlocker, unbatchedQuantity,
  type BatchStatus, type CommodityBatch, type Harvest,
} from '../../src/lib/stock'

function harvest(over: Partial<Harvest> = {}): Harvest {
  return {
    id: 'h1',
    ref: 'HARV-000001',
    production_cycle_id: 'c1',
    farm_id: 'f1',
    commodity: 'Maize',
    harvest_date: '2026-09-01',
    quantity: 1000,
    unit: 'kg',
    quality_grade: null,
    condition: null,
    location_state: 'Kano',
    location_lga: 'Dawakin Kudu',
    location_note: null,
    status: 'recorded',
    created_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function batch(over: Partial<CommodityBatch> = {}): CommodityBatch {
  return {
    id: 'b1',
    ref: 'BATCH-000001',
    commodity: 'Maize',
    farm_id: 'f1',
    harvest_id: 'h1',
    origin_traced: true,
    origin_owner_id: 'u1',
    owner_id: 'u1',
    quantity: 400,
    available_quantity: 400,
    unit: 'kg',
    quality_grade: null,
    packaging: null,
    condition: null,
    origin_state: 'Kano',
    origin_lga: 'Dawakin Kudu',
    current_location: null,
    current_state: 'Kano',
    status: 'created',
    verification_status: 'unverified',
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    ...over,
  }
}

describe('how much of a harvest is left to batch', () => {
  it('is the whole harvest before anything is batched', () => {
    expect(unbatchedQuantity(harvest(), [])).toBe(1000)
  })

  it('subtracts every batch cut from that harvest', () => {
    const left = unbatchedQuantity(harvest(), [
      batch({ id: 'b1', quantity: 400 }),
      batch({ id: 'b2', quantity: 250 }),
    ])
    expect(left).toBe(350)
  })

  it('ignores batches from OTHER harvests', () => {
    const left = unbatchedQuantity(harvest(), [batch({ id: 'b9', harvest_id: 'other', quantity: 900 })])
    expect(left).toBe(1000)
  })

  it('frees the quantity back up when a batch is cancelled', () => {
    // Mirrors loamy_create_batch_from_harvest, which excludes cancelled
    // batches from the allocated total. Getting this wrong would strand a
    // farmer's stock after a mistaken batch.
    const left = unbatchedQuantity(harvest(), [batch({ quantity: 400, status: 'cancelled' })])
    expect(left).toBe(1000)
  })

  it('never goes negative', () => {
    expect(unbatchedQuantity(harvest({ quantity: 100 }), [batch({ quantity: 500 })])).toBe(0)
  })
})

describe('whether a harvest can still become a batch', () => {
  it('can when some remains', () => {
    expect(canBatch(harvest(), [batch({ quantity: 400 })])).toBe(true)
  })

  it('cannot once fully batched', () => {
    expect(canBatch(harvest(), [batch({ quantity: 1000 })])).toBe(false)
  })

  it('cannot while cancelled or disputed', () => {
    expect(canBatch(harvest({ status: 'cancelled' }), [])).toBe(false)
    expect(canBatch(harvest({ status: 'disputed' }), [])).toBe(false)
  })

  it('still can once merely marked batched, if quantity remains', () => {
    // `batched` is set as soon as the FIRST batch is cut, so treating it as
    // terminal would strand the rest of the harvest.
    expect(canBatch(harvest({ status: 'batched' }), [batch({ quantity: 400 })])).toBe(true)
  })
})

describe('how much of a batch may go on the market', () => {
  it('is the uncommitted quantity when nothing is listed', () => {
    expect(listableQuantity(batch({ available_quantity: 400 }), 0)).toBe(400)
  })

  it('subtracts what is already on the market', () => {
    // Both must be subtracted or the same tonne gets sold twice.
    expect(listableQuantity(batch({ available_quantity: 400 }), 150)).toBe(250)
  })

  it('never goes negative', () => {
    expect(listableQuantity(batch({ available_quantity: 100 }), 500)).toBe(0)
  })
})

describe('the listing button explains itself before the server refuses', () => {
  it('permits an ordinary in-store batch', () => {
    expect(listingBlocker(batch(), 0)).toBeNull()
  })

  it('permits a partly sold batch with stock left', () => {
    expect(listingBlocker(batch({ status: 'partially_sold', available_quantity: 100 }), 0)).toBeNull()
  })

  const refused: BatchStatus[] = ['sold', 'cancelled', 'disputed', 'delivered', 'released']
  it.each(refused)('refuses a batch that is %s, matching loamy_list_batch', (status) => {
    const blocker = listingBlocker(batch({ status }), 0)
    expect(blocker).not.toBeNull()
    expect(blocker).toContain('cannot be listed')
  })

  it('explains when everything is already spoken for', () => {
    expect(listingBlocker(batch({ available_quantity: 400 }), 400)).toMatch(/already listed or committed/)
  })
})

describe('status is presented as two independent axes', () => {
  it('labels every commercial status', () => {
    const all = Object.keys(BATCH_STATUS_META) as BatchStatus[]
    expect(all).toHaveLength(13)
    for (const s of all) expect(BATCH_STATUS_META[s].label.length).toBeGreaterThan(0)
  })

  it('never calls an unverified batch verified', () => {
    // A batch can be `listed` commercially and `unverified` for provenance.
    // Collapsing the two would have to misrepresent one of them.
    expect(BATCH_VERIFICATION_META.unverified.label).toMatch(/not verified/i)
    expect(BATCH_STATUS_META.listed.label).not.toMatch(/verified/i)
  })
})
