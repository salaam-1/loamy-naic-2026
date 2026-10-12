import { describe, expect, it } from 'vitest'
import { LGAS_BY_STATE, lgasFor } from '@/lib/lgas'
import { COMMODITIES, COMMODITY_GROUPS, NIGERIA_STATES } from '@/lib/nigeria'
import { perUnitLabel } from '@/lib/ambassador'

/**
 * Reference data underpins farm location, directory addresses and the
 * geospatial work in Phase 1. A silent drift here (a renamed state, a missing
 * LGA) would surface as an unselectable form, not an error.
 */
describe('Nigeria LGA data', () => {
  it('covers all 36 states plus the FCT', () => {
    expect(Object.keys(LGAS_BY_STATE).length).toBe(37)
  })

  it('has exactly 774 LGAs, the official count', () => {
    const total = Object.values(LGAS_BY_STATE).reduce((n, l) => n + l.length, 0)
    expect(total).toBe(774)
  })

  it('keys match NIGERIA_STATES exactly, so a chosen state always resolves', () => {
    expect(Object.keys(LGAS_BY_STATE).sort()).toEqual([...NIGERIA_STATES].sort())
  })

  it('never returns undefined for a valid state, or throws for an invalid one', () => {
    for (const s of NIGERIA_STATES) expect(lgasFor(s).length).toBeGreaterThan(0)
    expect(lgasFor(null)).toEqual([])
    expect(lgasFor('Atlantis')).toEqual([])
  })

  it('has no blank or duplicated LGA names within a state', () => {
    for (const [state, lgas] of Object.entries(LGAS_BY_STATE)) {
      expect(new Set(lgas).size, `${state} has duplicates`).toBe(lgas.length)
      for (const l of lgas) expect(l.trim(), `${state} has a blank LGA`).not.toBe('')
    }
  })
})

describe('commodity taxonomy', () => {
  it('contains no livestock or animal products', () => {
    // Hard product constraint, enforced in the DB too (listings_commodity_taxonomy).
    const banned = /cattle|goat|sheep|poultry|chicken|fish|meat|egg|milk|livestock|dairy/i
    for (const c of COMMODITIES) expect(banned.test(c), `${c} looks like livestock`).toBe(false)
  })

  it('groups every commodity exactly once', () => {
    const grouped = COMMODITY_GROUPS.flatMap((g) => g.commodities)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual([...COMMODITIES].sort())
  })
})

describe('perUnitLabel', () => {
  // Regression: a missing quantity rendered as "per NaN x bag" on the live
  // home page, because Number(undefined) is NaN and NaN === 1 is false.
  it('falls back to a single unit for missing or unparseable quantities', () => {
    expect(perUnitLabel(undefined, 'bag')).toBe('bag')
    expect(perUnitLabel(null, 'bag')).toBe('bag')
    expect(perUnitLabel('', 'bag')).toBe('bag')
    expect(perUnitLabel('not-a-number', 'bag')).toBe('bag')
    expect(perUnitLabel(NaN, 'bag')).toBe('bag')
  })

  it('treats one, zero and negative quantities as a single unit', () => {
    expect(perUnitLabel(1, 'tonne')).toBe('tonne')
    expect(perUnitLabel('1', 'tonne')).toBe('tonne')
    expect(perUnitLabel(0, 'tonne')).toBe('tonne')
    expect(perUnitLabel(-3, 'tonne')).toBe('tonne')
  })

  it('shows the multiple for a real lot', () => {
    expect(perUnitLabel(2, 'tonne')).toBe('2 × tonne')
    expect(perUnitLabel('2.5', 'bag')).toBe('2.5 × bag')
  })
})
