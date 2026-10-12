import { describe, expect, it } from 'vitest'
import {
  CLASSIFICATION_META,
  canShowBand, classificationBadge, evidenceLine, freshness, isOverclaim,
  priceCaption, strongestEvidence, supplyRows, unavailableMessage,
  type Classification, type DemandSignal, type SupplySignal,
} from '../../src/lib/intelligence'

describe('an inference is never dressed as an observation', () => {
  it('labels each classification distinctly', () => {
    expect(classificationBadge('observed')!.label).toBe('Observed')
    expect(classificationBadge('user_generated')!.label).toBe('Reported')
    expect(classificationBadge('model_inference')!.label).toBe('Calculated')
  })

  it('never calls a calculation an observation', () => {
    const m = CLASSIFICATION_META.model_inference
    expect(m.label).not.toBe('Observed')
    expect(m.help).toMatch(/not itself an observation/i)
    expect(m.help).toMatch(/not a forecast/i)
  })

  it('is honest that a reported figure is unverified', () => {
    expect(CLASSIFICATION_META.user_generated.help).toMatch(/not independently verified/i)
  })

  it('returns null for a missing classification rather than guessing', () => {
    expect(classificationBadge(undefined)).toBeNull()
    expect(classificationBadge('fact')).toBeNull()
  })

  it('gives every classification a help string', () => {
    for (const c of ['observed', 'user_generated', 'model_inference'] as Classification[]) {
      expect(CLASSIFICATION_META[c].help.length, c).toBeGreaterThan(20)
    }
  })
})

describe('a withheld result is withheld, not rounded', () => {
  it('says insufficient data, with no number attached', () => {
    const msg = unavailableMessage({ available: false, reason: 'insufficient_data' })
    expect(msg).toMatch(/not enough activity/i)
    // The precise failure: "approximately 0–5" still narrows the field.
    expect(msg).not.toMatch(/\d/)
    expect(msg).not.toMatch(/approximately|around|about|roughly/i)
  })

  it('explains each refusal in words a person can act on', () => {
    expect(unavailableMessage({ available: false, reason: 'no_commodity' }))
      .toMatch(/choose a commodity/i)
    expect(unavailableMessage({ available: false, reason: 'no_market_specified' }))
      .toMatch(/no national price series/i)
    expect(unavailableMessage({ available: false, reason: 'insufficient_history' }))
      .toMatch(/not enough recorded observations/i)
  })

  it('prefers the server message when there is one', () => {
    expect(unavailableMessage({
      available: false, reason: 'insufficient_data',
      message: 'Too few participants in this period.',
    })).toBe('Too few participants in this period.')
  })

  it('shows no band when the signal is unavailable', () => {
    expect(canShowBand({ available: false, reason: 'insufficient_data' })).toBe(false)
    expect(canShowBand(null)).toBe(false)
  })

  it('shows a band only when there is one', () => {
    expect(canShowBand({ available: true, band: 'medium' })).toBe(true)
    expect(canShowBand({ available: true })).toBe(false)
  })
})

describe('every figure carries its evidence', () => {
  const signal = (over: Partial<DemandSignal> = {}): DemandSignal => ({
    available: true, classification: 'observed', band: 'medium',
    commodity: 'Maize', state: 'Lagos', period_days: 30,
    population: { participants: 42, events: 86, completed_transactions: 17 },
    breakdown: [
      { signal: 'search', events: 60, weight: 1, contribution: 60 },
      { signal: 'complete_transaction', events: 17, weight: 100, contribution: 1700 },
      { signal: 'view_listing', events: 9, weight: 2, contribution: 18 },
    ],
    ...over,
  })

  it('uses the server evidence note when present', () => {
    expect(evidenceLine(signal({ evidence_note: 'Based on 86 searches and 17 deals.' })))
      .toBe('Based on 86 searches and 17 deals.')
  })

  it('builds one from population, place and period otherwise', () => {
    const l = evidenceLine(signal())!
    expect(l).toContain('42 participants')
    expect(l).toContain('17 completed transactions')
    expect(l).toContain('Lagos')
    expect(l).toContain('30 days')
  })

  it('returns null rather than inventing evidence', () => {
    expect(evidenceLine({ available: true })).toBeNull()
    expect(evidenceLine({ available: false, reason: 'insufficient_data' })).toBeNull()
  })

  it('orders by CONTRIBUTION, so a deal outranks everything', () => {
    const top = strongestEvidence(signal(), 3)
    expect(top[0].signal).toBe('complete_transaction')
    // Descending contribution throughout. Sixty searches legitimately
    // outweigh nine views -- volume counts, it is just weighted far lower.
    for (let i = 1; i < top.length; i++) {
      expect(Number(top[i].contribution)).toBeLessThanOrEqual(Number(top[i - 1].contribution))
    }
  })

  it('still ranks one deal above one search', () => {
    const top = strongestEvidence({
      available: true,
      breakdown: [
        { signal: 'search', events: 1, weight: 1, contribution: 1 },
        { signal: 'complete_transaction', events: 1, weight: 100, contribution: 100 },
      ],
    })
    expect(top[0].signal).toBe('complete_transaction')
  })

  it('survives a signal with no breakdown', () => {
    expect(strongestEvidence({ available: true })).toEqual([])
  })
})

describe('supply stays three numbers', () => {
  const supply = (): SupplySignal => ({
    available: true, classification: 'observed',
    listed: { listings: 12, quantity_kg: 500_000, means: 'Claimed by sellers. Not inspected.' },
    verified: { batches: 3, quantity_kg: 60_000, means: 'Physically inspected by a Loamy agent.' },
    transacted: { transactions: 5, quantity_kg: 90_000, means: 'Stock that actually moved.' },
  })

  it('returns three rows and never a total', () => {
    const rows = supplyRows(supply())
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.key)).toEqual(['verified', 'transacted', 'listed'])
    // The sum is deliberately not offered anywhere.
    expect(rows.some((r) => r.key === 'total')).toBe(false)
  })

  it('puts VERIFIED first, because it is the strongest', () => {
    expect(supplyRows(supply())[0].key).toBe('verified')
  })

  it('carries the caveat with each row', () => {
    for (const r of supplyRows(supply())) {
      expect(r.means.length, r.key).toBeGreaterThan(10)
    }
    expect(supplyRows(supply()).find((r) => r.key === 'listed')!.means)
      .toMatch(/not inspected/i)
  })

  it('shows nothing when the signal is unavailable', () => {
    expect(supplyRows({ available: false, reason: 'insufficient_data' })).toEqual([])
  })
})

describe('stale data is dated, never called current', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

  it('marks a fresh observation current', () => {
    expect(freshness(daysAgo(1)).state).toBe('current')
  })

  it('marks a month-old one recent', () => {
    expect(freshness(daysAgo(20)).state).toBe('recent')
  })

  it('marks an old one STALE and says how old', () => {
    const f = freshness(daysAgo(120))
    expect(f.state).toBe('stale')
    expect(f.label).toMatch(/120 days old/)
  })

  it('never captions a stale price as current', () => {
    const c = priceCaption(daysAgo(120), 'Kano')
    expect(c).toContain('Kano reference')
    expect(c).toMatch(/may be out of date/i)
    expect(c.toLowerCase()).not.toContain('current')
  })

  it('handles a missing date honestly', () => {
    expect(freshness(null).state).toBe('unknown')
    expect(priceCaption(null, 'Kano')).toMatch(/date not recorded/i)
  })

  it('handles a broken date without crashing', () => {
    expect(freshness('not a date').state).toBe('unknown')
  })
})

describe('the language guard', () => {
  it('catches AI theatre', () => {
    expect(isOverclaim('AI has discovered rising demand')).toBe(true)
    expect(isOverclaim('AI predicts a shortage')).toBe(true)
  })

  it('catches certainty about the future', () => {
    expect(isOverclaim('Prices will definitely rise next month')).toBe(true)
    expect(isOverclaim('Guaranteed returns')).toBe(true)
  })

  it('catches undefined superlatives', () => {
    for (const s of ['Best price on Loamy', 'Best seller this week',
                     'The hottest commodity right now']) {
      expect(isOverclaim(s), s).toBe(true)
    }
  })

  it('leaves honest statistical copy alone', () => {
    for (const s of [
      'Based on 86 searches and 17 completed transactions across Lagos',
      'Observed historical pattern for maize in Kano',
      '4.9% below Kano reference, recorded 18 Sep',
      'Lowest observed price among 23 matching listings',
      'Demand signal: medium',
    ]) {
      expect(isOverclaim(s), s).toBe(false)
    }
  })

  it('passes every string this module can produce', () => {
    const strings = [
      ...Object.values(CLASSIFICATION_META).flatMap((m) => [m.label, m.help]),
      unavailableMessage({ available: false, reason: 'insufficient_data' }),
      unavailableMessage({ available: false, reason: 'no_market_specified' }),
      priceCaption(new Date().toISOString(), 'Kano'),
      priceCaption(new Date(Date.now() - 1e10).toISOString(), 'Kano'),
    ]
    for (const s of strings) {
      expect(isOverclaim(s), s).toBe(false)
    }
  })
})
