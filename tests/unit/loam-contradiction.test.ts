import { describe, expect, it } from 'vitest'
import { guardStructured } from '@/lib/loam/guard'
import { polarityConflicts } from '@/lib/loam/polarity'
import { contentWords } from '@/lib/loam/structure'
import type { EvidenceItem } from '@/lib/loam/types'

/**
 * Contradiction and negation.
 *
 * THE FAILURE THIS SUITE EXISTS FOR
 *   Evidence:  "sowing before the rains are established risks seedling loss"
 *   Statement: "sowing before established rains is safe"
 *
 *   Grounding by content-word overlap scores that near 1.0 -- nearly every word
 *   is shared. The anchors agree, the numbers agree, the months agree. Only the
 *   meaning is inverted, and the inverted version costs a crop.
 *
 * WHAT IS BEING TESTED
 *   Polarity comparison across a few opposition classes, with negation flipping
 *   evaluative ones. Not semantics: the mechanism does not understand the
 *   sentences, it checks whether both sides said opposite things about the same
 *   axis. The last block tests the false positives it accepts, on the brief's
 *   own instruction to prefer dropping a statement over guessing at meaning.
 */

const PLANTING: EvidenceItem = {
  level: 2, source: 'Loam knowledge pack v0 - PENDING AGRONOMIST REVIEW',
  claim: 'In the Northern Guinea Savanna, rain-fed maize is sown at the onset of the rains, '
    + 'typically from late May into mid-June. The sowing date follows the actual onset of '
    + 'rainfall for that season rather than a fixed calendar date, and sowing before the '
    + 'rains are established risks seedling loss.',
  periods: ['late May', 'May', 'June', 'mid-June'],
}
const ROTATION: EvidenceItem = {
  level: 2, source: 'Loam knowledge pack v0 - PENDING AGRONOMIST REVIEW',
  claim: 'Rotating cereals with legumes such as cowpea, groundnut or soybean helps maintain '
    + 'soil nitrogen, interrupts the life cycle of crop-specific pests and diseases, and '
    + "spreads a household's risk across more than one crop.",
}
const STORAGE: EvidenceItem = {
  level: 2, source: 'Loam knowledge pack v0 - PENDING AGRONOMIST REVIEW',
  claim: 'Grain should be dried before storage, because storing grain that is still moist '
    + 'invites mould and insect damage.',
}

const Q = 'When should I plant maize in Kaduna?'

function reject(raw: string, evidence: EvidenceItem[], language: 'en' | 'ha' = 'en') {
  return guardStructured({ raw, answer: '', question: Q, evidence, language })
}

describe('the flagship reversal', () => {
  it('"risks seedling loss" vs "is safe" is caught despite near-total overlap', () => {
    const out = reject('[1] Sowing before established rains is safe.', [PLANTING])
    expect(out.body, 'the reversed statement must not reach a user').toEqual([])
    expect(out.dropped[0].reason).toContain('contradicts the evidence')
    expect(out.dropped[0].reason).toContain('risky')
    expect(out.answer).toContain('risks seedling loss')
  })

  it('overlap alone would have passed it', () => {
    // Stated so nobody later removes the polarity layer believing grounding
    // already covers this.
    const stmt = contentWords('Sowing before established rains is safe.')
    const ev = contentWords(PLANTING.claim)
    const matched = [...stmt].filter((w) => ev.has(w)).length
    expect(matched / stmt.size, 'high overlap, inverted meaning').toBeGreaterThan(0.45)
  })

  it('the correct version survives', () => {
    const out = reject('[1] Sowing before the rains are established risks seedling loss.', [PLANTING])
    expect(out.body.length).toBe(1)
    expect(out.report.fellBack).toBe(false)
  })
})

describe('explicit negation', () => {
  it('"is not risky" inverts the risk pole and is caught', () => {
    const out = reject('[1] Sowing before the rains are established is not risky.', [PLANTING])
    expect(out.body).toEqual([])
    expect(out.dropped[0].reason).toContain('contradicts')
  })

  it("\"isn't\" is caught too, contraction and all", () => {
    const out = reject("[1] Sowing before the rains isn't dangerous.", [PLANTING])
    expect(out.body).toEqual([])
  })

  it('"no risk" is caught', () => {
    const out = reject('[1] There is no risk in sowing before the rains are established.', [PLANTING])
    expect(out.body).toEqual([])
  })

  it('a negation that does NOT invert the evidence survives', () => {
    // "Do not sow before the rains" says the same thing as the evidence. An
    // earlier design flipped before/after on negation and rejected exactly this.
    const out = reject('[1] Do not sow before the rains are established, or you risk seedling loss.', [PLANTING])
    expect(out.body.length, 'correct advice must not be rejected').toBe(1)
  })
})

describe('increases vs decreases', () => {
  const YIELD: EvidenceItem = {
    level: 2, source: 'pack', claim: 'Rotating with legumes improves soil nitrogen over time.',
  }
  it('"reduces" against "improves" is caught', () => {
    const out = reject('[1] Rotating with legumes reduces soil nitrogen over time.', [YIELD])
    expect(out.body).toEqual([])
    expect(out.dropped[0].reason).toContain('increases')
  })
  it('"improves" against "improves" survives', () => {
    const out = reject('[1] Rotating with legumes improves soil nitrogen.', [YIELD])
    expect(out.body.length).toBe(1)
  })
  it('"does not improve" is caught by the negation flip', () => {
    const out = reject('[1] Rotating with legumes does not improve soil nitrogen.', [YIELD])
    expect(out.body).toEqual([])
  })
})

describe('recommended vs not recommended', () => {
  const ADVICE: EvidenceItem = {
    level: 2, source: 'pack',
    claim: 'Drying grain before storage is recommended for every cereal crop.',
  }
  it('"should be avoided" against "is recommended" is caught', () => {
    const out = reject('[1] Drying grain before storage should be avoided.', [ADVICE])
    expect(out.body).toEqual([])
  })
  it('"is recommended" survives', () => {
    const out = reject('[1] Drying grain before storage is recommended.', [ADVICE])
    expect(out.body.length).toBe(1)
  })
})

describe('high vs low', () => {
  const SEASON: EvidenceItem = {
    level: 1, source: 'Loamy market price records',
    claim: 'Recorded maize prices have been lowest in November.',
    periods: ['November'],
  }
  it('"highest in November" against "lowest in November" is caught', () => {
    const out = guardStructured({
      raw: '[1] Recorded maize prices have been highest in November.',
      answer: '', question: 'When is maize cheapest?', evidence: [SEASON], language: 'en',
    })
    expect(out.body).toEqual([])
    expect(out.dropped[0].reason).toContain('low')
  })
})

describe('before vs after, where materially relevant', () => {
  const MATURITY: EvidenceItem = {
    level: 2, source: 'pack',
    claim: 'Maize reaches maturity roughly 90 to 120 days after sowing.',
    numbers: [90, 120],
  }
  it('"before sowing" against "after sowing" is caught', () => {
    const out = guardStructured({
      raw: '[1] Maize reaches maturity roughly 90 to 120 days before sowing.',
      answer: '', question: 'How long does maize take?', evidence: [MATURITY], language: 'en',
    })
    expect(out.body).toEqual([])
    expect(out.dropped[0].reason).toContain('before')
  })

  it('the correct direction survives', () => {
    const out = guardStructured({
      raw: '[1] Maize reaches maturity roughly 90 to 120 days after sowing.',
      answer: '', question: 'How long does maize take?', evidence: [MATURITY], language: 'en',
    })
    expect(out.body.length).toBe(1)
  })

  it('the SAFE COMPLEMENT is not mistaken for a contradiction', () => {
    /**
     * Evidence warns about sowing BEFORE the rains. A statement advising to sow
     * AFTER them is the same advice from the other side, and a plain
     * before/after comparison rejects it. Suppressed when the evidence carries a
     * risk warning and the statement carries no risk pole of its own.
     */
    const out = reject('[1] Sow after the rains are established.', [PLANTING])
    expect(out.body.length, 'the safe complement is correct advice').toBe(1)
  })

  it('but the DROPPED WARNING is caught', () => {
    // The mirror image: same cautioned action, caution silently removed. Time
    // order agrees, so nothing else would flag it.
    const out = reject('[1] Sow before the rains are established.', [PLANTING])
    expect(out.body, 'repeating a cautioned action without the caution inverts it').toEqual([])
    expect(out.dropped[0].reason).toContain('drops the evidence')
  })
})

describe('contradiction is detected across languages', () => {
  it('a Hausa "it is safe" contradicts English "risks seedling loss"', () => {
    // Polarity markers are defined per language and mapped to a shared pole, so
    // neither sentence has to be translated.
    const out = reject('[1] Shuka kafin ruwan sama yana da lafiya.', [PLANTING], 'ha')
    expect(out.body).toEqual([])
    expect(out.dropped[0].reason).toContain('contradicts')
  })

  it('a correct Hausa statement about the risk survives', () => {
    const out = reject('[1] Shuka kafin ruwan sama yana haifar da asarar iri.', [PLANTING], 'ha')
    expect(out.body.length).toBe(1)
  })
})

describe('the check stays quiet when it has nothing to compare', () => {
  it('no conflict when the statement says nothing about any axis', () => {
    expect(polarityConflicts('Maize is sown at the onset of the rains.', PLANTING.claim)).toEqual([])
  })

  it('no conflict when the evidence says nothing about the axis', () => {
    expect(polarityConflicts('This is the safest option.', 'Maize is a cereal crop.')).toEqual([])
  })

  it('no conflict when a side genuinely carries both poles', () => {
    // Evidence that mentions both risk and safety is ambiguous on that axis,
    // not contradictory, so it is skipped rather than guessed at.
    expect(polarityConflicts(
      'Drying grain is safe.',
      'Drying grain is safe, but storing it moist risks mould damage.',
    )).toEqual([])
  })

  it('"Northern" does not read as the negation "nor"', () => {
    // It did. hasNegation matched substrings, so "Northern Guinea Savanna" made
    // the evidence appear negated, flipped its risk pole to "safe", and a
    // correct warning was reported as a contradiction. Word boundaries now.
    const out = reject('[1] Sowing before the rains are established risks seedling loss.', [PLANTING])
    expect(out.body.length, 'three letters inside an unrelated word inverted the whole check').toBe(1)
  })
})

describe('the false positives this design accepts', () => {
  it('a rejected statement always leaves the evidence in its place', () => {
    // The brief's instruction: prefer dropping a statement over guessing at
    // meaning. The cost of a false positive is therefore a worse answer, never
    // a wrong one -- the underlying evidence is still shown.
    const out = reject('[1] Sowing before established rains is safe.', [PLANTING])
    expect(out.report.fellBack).toBe(true)
    expect(out.answer).toContain('late May into mid-June')
    expect(out.answer).toContain('risks seedling loss')
  })

  it('a statement contradicting ONE item is dropped even if another allows it', () => {
    // Known conservatism: polarity is checked against the cited item, and for
    // non-English against every item. Coherent evidence makes this a non-issue;
    // incoherent evidence would make Loam silent rather than wrong.
    const out = guardStructured({
      raw: '[1] Storing moist grain is safe.',
      answer: '', question: 'How should I store grain?',
      evidence: [STORAGE, ROTATION], language: 'en',
    })
    expect(out.body).toEqual([])
  })
})
