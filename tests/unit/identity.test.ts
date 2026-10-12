import { describe, expect, it } from 'vitest'
import {
  handle, memberSince, normaliseUsername, profilePath,
  ratingBars, ratingDisplay, reviewRefusal, validateUsername,
} from '../../src/lib/identity'
import {
  gapKind, gapMessage, looksLikeRef, normaliseRef, traceRefusal, TRACE_ORDER, TRACE_LABELS,
} from '../../src/lib/trace'

describe('usernames', () => {
  it('normalises what a person actually pastes', () => {
    expect(normaliseUsername('  @Kano_Maize ')).toBe('kano_maize')
    expect(normaliseUsername('@@musa')).toBe('musa')
    expect(normaliseUsername('MUSA')).toBe('musa')
  })

  it('accepts ordinary handles', () => {
    for (const n of ['kano_maize', 'musa1', 'a1b', 'x'.repeat(30)]) {
      expect(validateUsername(n), n).toEqual({ ok: true })
    }
  })

  it('refuses the shapes the database also refuses', () => {
    const bad = ['', 'ab', 'x'.repeat(31), 'has space', 'has-dash', 'Ümlaut', '123', '___']
    for (const n of bad) {
      expect(validateUsername(n).ok, `${n} should be refused`).toBe(false)
    }
  })

  it('accepts typed capitals, because the handle is normalised not rejected', () => {
    // The database stores lowercase only. Rejecting "Kano_Maize" outright
    // would be punishing someone for their keyboard; it is lowercased.
    expect(validateUsername('Kano_Maize')).toEqual({ ok: true })
    expect(normaliseUsername('Kano_Maize')).toBe('kano_maize')
  })

  it('requires a letter, so a handle cannot mimic a reference number', () => {
    // BATCH-000982 style refs are all digits after the prefix; a purely
    // numeric handle invites confusion between people and records.
    expect(validateUsername('000982').ok).toBe(false)
    expect(validateUsername('b000982').ok).toBe(true)
  })

  it('builds display and link forms', () => {
    expect(handle('musa')).toBe('@musa')
    expect(handle(null)).toBe('')
    expect(profilePath('@Musa')).toBe('/u/musa')
  })
})

describe('rating display', () => {
  const summary = (over: Partial<Parameters<typeof ratingDisplay>[0]> = {}) => ({
    count: 10, has_enough: true, minimum_for_average: 3, average: 4.4,
    distribution: { '5': 6, '4': 3, '3': 1 }, ...over,
  })

  it('shows nothing at all when there are no reviews', () => {
    const d = ratingDisplay(summary({ count: 0, has_enough: false, average: null, distribution: {} }))
    expect(d.value).toBe('-')
    expect(d.showStars).toBe(false)
    expect(d.caption).toBe('No reviews yet')
  })

  it('WITHHOLDS an average below the threshold, and says how many more are needed', () => {
    // The dangerous case: two five-star reviews from a seller's own network
    // must not render as "5.0".
    const d = ratingDisplay(summary({ count: 2, has_enough: false, average: null }))
    expect(d.value).toBe('-')
    expect(d.showStars).toBe(false)
    expect(d.caption).toContain('1 more')
  })

  it('never invents an average from the distribution', () => {
    // has_enough=false but a stray average present: the UI still withholds,
    // because the server's threshold decision is the authority.
    const d = ratingDisplay(summary({ count: 2, has_enough: false, average: 5 }))
    expect(d.showStars).toBe(false)
  })

  it('shows one decimal once there is enough', () => {
    const d = ratingDisplay(summary())
    expect(d.value).toBe('4.4')
    expect(d.showStars).toBe(true)
    expect(d.caption).toBe('10 reviews')
  })

  it('singularises one review', () => {
    expect(ratingDisplay(summary({ count: 1, has_enough: false, average: null })).caption)
      .toContain('1 review ·')
  })

  it('builds 5..1 bars that total 100% when there is data', () => {
    const bars = ratingBars(summary())
    expect(bars.map((b) => b.star)).toEqual([5, 4, 3, 2, 1])
    expect(bars.reduce((n, b) => n + b.percent, 0)).toBe(100)
    expect(bars.find((b) => b.star === 5)!.count).toBe(6)
  })

  it('does not divide by zero on an empty distribution', () => {
    const bars = ratingBars(null)
    expect(bars.every((b) => b.percent === 0 && b.count === 0)).toBe(true)
  })
})

describe('review refusals', () => {
  it('has copy for every reason the server returns', () => {
    for (const r of ['already_reviewed', 'not_concluded', 'in_dispute',
                     'no_such_transaction', 'not_signed_in']) {
      expect(reviewRefusal(r).length).toBeGreaterThan(10)
    }
  })

  it('falls back rather than rendering a raw code', () => {
    expect(reviewRefusal('something_new')).not.toContain('_')
  })
})

describe('member since', () => {
  it('gives month and year, not a false-precision date', () => {
    expect(memberSince('2026-07-11T09:33:00Z')).toMatch(/July 2026/)
  })
  it('survives a missing or broken timestamp', () => {
    expect(memberSince(null)).toBe('')
    expect(memberSince('not a date')).toBe('')
  })
})

describe('trace refs', () => {
  it('recognises the ref shapes the registry issues', () => {
    for (const r of ['BATCH-000982', 'TXN-000244', 'WH-000032', 'batch-000982']) {
      expect(looksLikeRef(r), r).toBe(true)
    }
    expect(looksLikeRef('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('rejects what is obviously not a ref, before bothering the server', () => {
    for (const r of ['', 'maize', 'BATCH', '000982', 'BATCH-12']) {
      expect(looksLikeRef(r), r).toBe(false)
    }
  })

  it('normalises case and stray whitespace', () => {
    expect(normaliseRef('  batch-000982 ')).toBe('BATCH-000982')
    expect(normaliseRef('BATCH -000982')).toBe('BATCH-000982')
  })
})

describe('trace gaps — the distinction that matters', () => {
  it('separates "did not happen" from "you may not see it"', () => {
    expect(gapKind('never_verified')).toBe('absent')
    expect(gapKind('never_financed')).toBe('absent')
    expect(gapKind('not_permitted')).toBe('withheld')
  })

  it('never describes a withheld node as an absent one', () => {
    // This is the whole point. "Never verified" on a batch you simply lack
    // scope for would be a lie told to a buyer.
    expect(gapMessage('not_permitted')).toMatch(/access level/i)
    expect(gapMessage('not_permitted')).not.toMatch(/never|not recorded/i)
  })

  it('has plain copy for each absence reason the server returns', () => {
    for (const r of ['not_recorded', 'record_missing', 'never_verified', 'never_listed',
                     'never_sold', 'never_financed', 'never_warehoused', 'no_transport_recorded']) {
      expect(gapMessage(r), r).not.toMatch(/_/)
    }
  })

  it('falls back to "Not recorded" rather than showing a raw reason code', () => {
    expect(gapMessage('brand_new_reason')).toBe('Not recorded')
    expect(gapMessage(undefined)).toBe('Not recorded')
  })

  it('labels every node in the chain', () => {
    for (const k of TRACE_ORDER) {
      expect(TRACE_LABELS[k], k).toBeTruthy()
    }
  })

  it('orders the chain the way a person reads it', () => {
    const i = (k: string) => TRACE_ORDER.indexOf(k as never)
    expect(i('farm')).toBeLessThan(i('harvest'))
    expect(i('harvest')).toBeLessThan(i('batch'))
    expect(i('batch')).toBeLessThan(i('listings'))
    expect(i('listings')).toBeLessThan(i('transactions'))
    expect(i('transactions')).toBeLessThan(i('logistics'))
  })

  it('explains a failed trace without leaking whether the ref exists', () => {
    expect(traceRefusal('no_such_reference')).toMatch(/or you do not have access/i)
  })
})
