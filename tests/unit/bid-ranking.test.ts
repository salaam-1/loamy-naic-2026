import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS, rankBids, type RankFactor, type RfqBid } from '@/lib/bids'

/**
 * Bid ranking decides which supplier a buyer awards, so it has commercial
 * consequences. It is rule-based and must stay deterministic and explainable —
 * these tests exist to stop it quietly becoming something else.
 */

let n = 0
const bid = (over: Partial<RfqBid> = {}): RfqBid => ({
  id: `bid-${n++}`,
  rfq_id: 'rfq-1',
  supplier_id: `sup-${n}`,
  price_per_unit: 100,
  unit: 'tonne',
  available_quantity: 10,
  delivery_date: '2026-10-01',
  farm_origin: null,
  photos: [],
  documents: [],
  note: null,
  status: 'submitted',
  submitted_at: '2026-09-01T00:00:00Z',
  supplier_name: 'Supplier',
  supplier_state: 'Kano',
  supplier_verified: false,
  completed_transactions: 0,
  on_time_rate: null,
  ...over,
})

const RFQ = { delivery_state: 'Kano', delivery_deadline: '2026-10-15' }

describe('rankBids', () => {
  it('returns every bid, never silently dropping one', () => {
    const bids = [bid(), bid(), bid()]
    expect(rankBids(bids, RFQ).length).toBe(3)
  })

  it('is deterministic — identical input gives identical output', () => {
    const bids = [bid({ price_per_unit: 90 }), bid({ price_per_unit: 120 })]
    const a = rankBids(bids, RFQ)
    const b = rankBids(bids, RFQ)
    expect(a.map((r) => [r.bid.id, r.score])).toEqual(b.map((r) => [r.bid.id, r.score]))
  })

  it('ranks the cheaper bid first when nothing else differs', () => {
    const cheap = bid({ price_per_unit: 80 })
    const dear = bid({ price_per_unit: 200 })
    const out = rankBids([dear, cheap], RFQ)
    expect(out[0].bid.id).toBe(cheap.id)
  })

  it('prefers a verified supplier when price and dates are equal', () => {
    const plain = bid({ supplier_verified: false })
    const verified = bid({ supplier_verified: true })
    const out = rankBids([plain, verified], RFQ)
    expect(out[0].bid.id).toBe(verified.id)
  })

  it('prefers a supplier in the delivery state, all else equal', () => {
    const far = bid({ supplier_state: 'Lagos' })
    const near = bid({ supplier_state: 'Kano' })
    const out = rankBids([far, near], RFQ)
    expect(out[0].bid.id).toBe(near.id)
  })

  it('keeps every factor inside 0..1 and every score inside 0..100', () => {
    const bids = [
      bid({ price_per_unit: 1, supplier_verified: true, completed_transactions: 99 }),
      bid({ price_per_unit: 10_000, supplier_state: null, delivery_date: null }),
      bid({ price_per_unit: 500, completed_transactions: 3 }),
    ]
    for (const r of rankBids(bids, RFQ)) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
      for (const [k, v] of Object.entries(r.factors)) {
        expect(Number.isFinite(v), `${k} is not finite`).toBe(true)
        expect(v, `${k} below 0`).toBeGreaterThanOrEqual(0)
        expect(v, `${k} above 1`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('survives a single bid without dividing by a zero range', () => {
    const out = rankBids([bid()], RFQ)
    expect(out.length).toBe(1)
    expect(Number.isFinite(out[0].score)).toBe(true)
  })

  it('survives missing dates, null states and an RFQ with no deadline', () => {
    const bids = [bid({ delivery_date: null, supplier_state: null }), bid()]
    const out = rankBids(bids, { delivery_state: null, delivery_deadline: null })
    for (const r of out) expect(Number.isFinite(r.score)).toBe(true)
  })

  it('honours reweighting — zeroing every factor but price makes price decisive', () => {
    const onlyPrice = { price: 1, delivery: 0, distance: 0, verification: 0, track_record: 0 } as Record<RankFactor, number>
    const cheapUnverified = bid({ price_per_unit: 50, supplier_verified: false, supplier_state: 'Lagos' })
    const dearVerified = bid({ price_per_unit: 400, supplier_verified: true, supplier_state: 'Kano' })
    const out = rankBids([dearVerified, cheapUnverified], RFQ, onlyPrice)
    expect(out[0].bid.id).toBe(cheapUnverified.id)
  })

  it('does not mutate the bids it is given', () => {
    const bids = [bid({ price_per_unit: 90 }), bid({ price_per_unit: 120 })]
    const snapshot = JSON.stringify(bids)
    rankBids(bids, RFQ)
    expect(JSON.stringify(bids)).toBe(snapshot)
  })

  it('uses weights that sum to 1 by default, so scores stay comparable', () => {
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 6)
  })
})
