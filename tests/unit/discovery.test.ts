import { describe, expect, it } from 'vitest'
import {
  comparisonLabel, comparisonQualifier, comparisonRefusal,
  isRecommended, landedCost, safeMetadata, sellerFacts,
  superlativeLabel, topReasons, VIEWS,
  type DiscoveryItem, type LogisticsEstimate, type PriceComparison, type SellerSignals,
} from '../../src/lib/discovery'

const comparison = (over: Partial<PriceComparison> = {}): PriceComparison => ({
  comparable: true, market: 'Kano', recorded_date: '2026-09-18', stale: false,
  difference_percent: -4.94, direction: 'below',
  label: '4.9% below Kano reference', price_per_kg: 500, reference_per_kg: 526,
  ...over,
})

describe('price comparison — the market is never dropped', () => {
  it('names the market in the label', () => {
    expect(comparisonLabel(comparison())).toBe('4.9% below Kano reference')
  })

  it('NEVER produces a label without a market, even if the server omits one', () => {
    // The failure this guards: "4.9% below reference", which a reader
    // completes as "…in Nigeria". Loamy has no national benchmark.
    expect(comparisonLabel(comparison({ market: undefined, label: '4.9% below reference' })))
      .toBeNull()
  })

  it('builds the label itself when the server sends only the numbers', () => {
    const l = comparisonLabel(comparison({ label: undefined }))
    expect(l).toBe('4.9% below Kano reference')
    expect(l).toContain('Kano')
  })

  it('handles a price above the reference without calling it a discount', () => {
    const l = comparisonLabel(comparison({
      difference_percent: 3.2, direction: 'above', label: undefined,
    }))
    expect(l).toBe('3.2% above Kano reference')
  })

  it('says level rather than 0% below', () => {
    expect(comparisonLabel(comparison({
      difference_percent: 0, direction: 'level', label: undefined,
    }))).toBe('level with Kano reference')
  })

  it('shows nothing at all when the comparison is not possible', () => {
    expect(comparisonLabel({ comparable: false, reason: 'no_reference_data' })).toBeNull()
    expect(comparisonLabel(null)).toBeNull()
  })

  it('always offers a date qualifier, and flags a stale one', () => {
    expect(comparisonQualifier(comparison())).toMatch(/recorded 18 Sep/)
    expect(comparisonQualifier(comparison({ stale: true })))
      .toMatch(/may be out of date/)
  })

  it('explains WHY there is no comparison instead of going blank', () => {
    expect(comparisonRefusal({ comparable: false, reason: 'no_market_specified' }))
      .toMatch(/choose a reference market/i)
    expect(comparisonRefusal({ comparable: false, reason: 'unit_not_convertible',
      message: 'A price per litres cannot be compared with a 100kg reference.' }))
      .toMatch(/cannot be compared/)
  })
})

describe('superlatives carry their population', () => {
  const item = (lo: DiscoveryItem['lowest_observed']) => ({ lowest_observed: lo })

  it('states the comparison population', () => {
    expect(superlativeLabel(item({
      among: 23, as_of: '2026-09-20T10:00:00Z',
      label: 'Lowest observed price among 23 matching listing(s)',
    }))).toContain('23')
  })

  it('refuses to call a listing lowest when it is the only one', () => {
    // "Lowest of 1" is true and meaningless, which is the worst combination.
    expect(superlativeLabel(item({
      among: 1, as_of: '2026-09-20T10:00:00Z', label: 'Lowest observed price among 1 matching listing(s)',
    }))).toBeNull()
  })

  it('shows nothing when the listing is not the lowest', () => {
    expect(superlativeLabel(item(null))).toBeNull()
  })

  it('never yields the words "best price"', () => {
    const l = superlativeLabel(item({
      among: 9, as_of: '2026-09-20T10:00:00Z', label: 'Lowest observed price among 9 matching listing(s)',
    })) ?? ''
    expect(l.toLowerCase()).not.toContain('best')
    expect(l.toLowerCase()).toContain('observed')
  })
})

describe('landed cost — only when freight is observed', () => {
  const observed: LogisticsEstimate = {
    available: true, rate_per_kg: 42, observations: 7,
    from_state: 'Benue', to_state: 'Lagos', label: 'Estimated from 7 past Benue→Lagos load(s)',
  }

  it('adds commodity and observed freight', () => {
    const l = landedCost({ price_per_kg: 500 }, observed)
    expect(l.shown).toBe(true)
    expect(l.landed_per_kg).toBe(542)
    expect(l.observations).toBe(7)
  })

  it('SHOWS NOTHING when freight has not been observed', () => {
    // The dangerous case: a plausible landed cost the buyer plans around,
    // built on a freight number nobody measured.
    const l = landedCost({ price_per_kg: 500 }, {
      available: false, reason: 'insufficient_corridor_data', observations: 1, minimum_required: 3,
      message: 'Loamy has not carried enough Benue to Lagos loads to estimate freight.',
    })
    expect(l.shown).toBe(false)
    expect(l.landed_per_kg).toBeUndefined()
    expect(l.note).toMatch(/has not carried enough/)
  })

  it('shows nothing when there is no logistics answer at all', () => {
    const l = landedCost({ price_per_kg: 500 }, null)
    expect(l.shown).toBe(false)
    expect(l.reason).toBe('no_logistics_data')
    // The commodity price is still carried, so the card can show that alone.
    expect(l.commodity_per_kg).toBe(500)
  })

  it('refuses when the commodity price is not per-kg comparable', () => {
    const l = landedCost({ price_per_kg: null }, observed)
    expect(l.shown).toBe(false)
    expect(l.reason).toBe('unit_not_convertible')
  })

  it('never silently treats a missing freight rate as zero', () => {
    const l = landedCost({ price_per_kg: 500 }, { available: true, observations: 9 })
    expect(l.shown, 'available=true with no rate was treated as free freight').toBe(false)
  })
})

describe('a recommendation must have a reason', () => {
  const reasons = (codes: string[]) => ({ reasons: codes.map((c) => ({ code: c, label: c })) })

  it('is not a recommendation when nothing can be said about it', () => {
    expect(isRecommended({ reasons: [] })).toBe(false)
  })

  it('is a recommendation once there is evidence', () => {
    expect(isRecommended(reasons(['seller_verified']))).toBe(true)
  })

  it('puts the commercially useful reasons first', () => {
    const top = topReasons(reasons([
      'commodity_match', 'established_seller', 'below_reference', 'quantity_covers_request',
    ]), 3)
    expect(top.map((r) => r.code)).toEqual([
      'quantity_covers_request', 'below_reference', 'established_seller',
    ])
  })

  it('does not repeat a reason', () => {
    const top = topReasons(reasons(['seller_verified', 'seller_verified', 'below_reference']))
    expect(top.filter((r) => r.code === 'seller_verified')).toHaveLength(1)
  })

  it('keeps unknown reason codes rather than dropping them', () => {
    // A future server-side reason must still reach the buyer, just last.
    const top = topReasons(reasons(['brand_new_signal']), 3)
    expect(top.map((r) => r.code)).toContain('brand_new_signal')
  })
})

describe('seller signals stay individual facts', () => {
  const signals = (over: Partial<SellerSignals> = {}): SellerSignals => ({
    verified: true, member_since: '2026-01-04T00:00:00Z',
    completed_transactions: 17, active_listings: 3,
    rating: { count: 12, has_enough: true, average: 4.7, minimum_for_average: 3 },
    fulfilment: { available: true, rate_percent: 94, sample: 16 },
    ...over,
  })

  it('lists the facts the directive asks for', () => {
    const facts = sellerFacts(signals()).join(' | ')
    expect(facts).toContain('Verified')
    expect(facts).toContain('17 completed transactions')
    expect(facts).toContain('94% fulfilment over 16 deliveries')
    expect(facts).toContain('4.7 from 12 reviews')
    expect(facts).toContain('3 active listings')
  })

  it('never emits a single combined score', () => {
    const facts = sellerFacts(signals())
    for (const f of facts) {
      expect(f.toLowerCase()).not.toMatch(/\bscore\b|\brank\b|\brating of\b/)
    }
  })

  it('KEEPS the 3-review rule from Block 1', () => {
    const facts = sellerFacts(signals({
      rating: { count: 2, has_enough: false, average: null, minimum_for_average: 3 },
    })).join(' | ')
    expect(facts).toContain('2 reviews')
    expect(facts, 'an average was shown below three reviews').not.toMatch(/\d\.\d from/)
  })

  it('withholds a fulfilment rate computed from too few deliveries', () => {
    const facts = sellerFacts(signals({
      fulfilment: { available: false, reason: 'too_few_deliveries', sample: 2, minimum: 5 },
    })).join(' | ')
    expect(facts, '100% over two deliveries is not a fulfilment rate').not.toContain('fulfilment')
  })

  it('says nothing at all about an unknown seller', () => {
    expect(sellerFacts(null)).toEqual([])
  })
})

describe('behavioural telemetry collects only what it needs', () => {
  it('strips the keys that must never be logged', () => {
    const clean = safeMetadata({
      email: 'a@b.com', phone: '08012345678', bvn: '22222222222',
      token: 'x', ip: '1.2.3.4', address: 'somewhere',
      commodity: 'Maize', results: 12,
    })
    expect(Object.keys(clean).sort()).toEqual(['commodity', 'results'])
  })

  it('is case-insensitive about it', () => {
    expect(safeMetadata({ Email: 'a@b.com', BVN: '1' })).toEqual({})
  })

  it('drops nulls rather than storing empty keys', () => {
    expect(safeMetadata({ a: null, b: undefined, c: 0 })).toEqual({ c: 0 })
  })

  it('survives being handed nothing', () => {
    expect(safeMetadata(undefined as never)).toEqual({})
  })
})

describe('the three views', () => {
  it('offers buy, source and opportunity, each as a question', () => {
    expect(VIEWS.map((v) => v.key)).toEqual(['buy', 'source', 'opportunity'])
    for (const v of VIEWS) expect(v.question).toMatch(/\?$/)
  })
})
