import { describe, expect, it } from 'vitest'
import { evidenceOnlyAnswer, guardAnswer, monthsIn, numbersIn } from '@/lib/loam/guard'
import type { EvidenceItem } from '@/lib/loam/types'

/**
 * The guard, tested against the actual Phase 0 failure.
 *
 * On 2026-10-07, asked "when should I plant maize in Kaduna?", N-ATLaS
 * Q4_K_M answered:
 *
 *   "In Kaduna State, Nigeria, the ideal time to plant maize is towards the end
 *    of the rainy season, specifically in September and October. This allows
 *    maize to mature before the onset of the dry season."
 *
 * That sentence is the reason this module exists, so it is the first test. Note
 * that it contains NO NUMBERS: a numeric provenance check passes it without
 * complaint. The months are what give it away.
 */

const KADUNA_EVIDENCE: EvidenceItem[] = [
  {
    level: 2,
    claim: 'In the Northern Guinea Savanna, rain-fed maize is sown at the onset of the rains, '
      + 'typically from late May into mid-June.',
    source: 'Loam knowledge pack v0 — PENDING AGRONOMIST REVIEW',
    periods: ['late May', 'May', 'June', 'mid-June'],
  },
]

const PHASE0_WRONG_ANSWER =
  'In Kaduna State, Nigeria, the ideal time to plant maize is towards the end of the rainy '
  + 'season, specifically in September and October. This allows maize to mature before the '
  + 'onset of the dry season.'

describe('the guard rejects the exact answer that motivated it', () => {
  it('catches "September and October" against May/June evidence', () => {
    const out = guardAnswer({
      answer: PHASE0_WRONG_ANSWER,
      question: 'When should I plant maize in Kaduna?',
      evidence: KADUNA_EVIDENCE,
      language: 'en',
    })
    expect(out.report.fellBack, 'the Phase 0 answer must not reach a user').toBe(true)
    expect(out.report.unsupportedPeriods).toContain('september')
    expect(out.report.unsupportedPeriods).toContain('october')
    // The replacement says what the records actually support.
    expect(out.answer).toContain('late May into mid-June')
    expect(out.answer).not.toContain('September')
  })

  it('a numeric check alone would NOT have caught it', () => {
    // Stated explicitly so nobody later "simplifies" the guard down to numbers.
    expect(numbersIn(PHASE0_WRONG_ANSWER).size).toBe(0)
  })

  it('accepts the same answer shape when it matches the evidence', () => {
    const out = guardAnswer({
      answer: 'Plant maize when the rains are established, usually from late May into mid-June. '
        + 'Sowing before the rains settle risks losing seedlings.',
      question: 'When should I plant maize in Kaduna?',
      evidence: KADUNA_EVIDENCE,
      language: 'en',
    })
    expect(out.report.fellBack).toBe(false)
    expect(out.answer).toContain('late May')
  })
})

describe('periods are compared across languages', () => {
  it('reads English, abbreviated and Hausa month names as the same months', () => {
    expect([...monthsIn('planting in May')]).toEqual([5])
    expect([...monthsIn('a watan Mayu')]).toEqual([5])
    expect([...monthsIn('Sep')]).toEqual([9])
    expect([...monthsIn('Satumba')]).toEqual([9])
  })

  it('accepts a correct Hausa answer built from English evidence', () => {
    // Evidence is canonical English; N-ATLaS answers in Hausa. A correct Hausa
    // answer must not be rejected merely for being in Hausa.
    const out = guardAnswer({
      answer: 'Ka shuka masara daga ƙarshen Mayu zuwa tsakiyar Yuni, lokacin da ruwan sama ya tabbata.',
      question: 'Yaushe zan shuka masara a Kaduna?',
      evidence: KADUNA_EVIDENCE,
      language: 'ha',
    })
    expect(out.report.fellBack).toBe(false)
  })

  it('still catches a WRONG Hausa answer', () => {
    const out = guardAnswer({
      answer: 'Ka shuka masara a watan Satumba da Oktoba.',
      question: 'Yaushe zan shuka masara a Kaduna?',
      evidence: KADUNA_EVIDENCE,
      language: 'ha',
    })
    expect(out.report.fellBack).toBe(true)
    expect(out.report.unsupportedPeriods).toContain('september')
  })

  it('an ISO date in the evidence authorises its month', () => {
    const out = guardAnswer({
      answer: 'Your maize was planted in June.',
      question: 'When did I plant?',
      evidence: [{ level: 1, claim: 'Crop record: Maize, planted 2026-06-02.', source: 'Loamy crop records' }],
      language: 'en',
    })
    expect(out.report.fellBack).toBe(false)
  })
})

describe('numeric provenance', () => {
  const priceEvidence: EvidenceItem[] = [{
    level: 1,
    claim: 'Observed retail price for Maize: the most recent recorded figure is ₦420 per kg on 2026-09-30.',
    source: 'Loamy market price records',
    numbers: [420],
  }]

  it('allows a figure the evidence states', () => {
    const out = guardAnswer({
      answer: 'The most recent recorded price is ₦420 per kg.',
      question: 'What is the maize price?', evidence: priceEvidence, language: 'en',
    })
    expect(out.report.fellBack).toBe(false)
  })

  it('rejects a figure the evidence never stated', () => {
    const out = guardAnswer({
      answer: 'Maize is around ₦650 per kg at the moment.',
      question: 'What is the maize price?', evidence: priceEvidence, language: 'en',
    })
    expect(out.report.fellBack).toBe(true)
    expect(out.report.unsupportedNumbers).toContain('650')
  })

  it('allows a figure the MEMBER supplied in the question', () => {
    // "Is ₦33,000 a bag fair?" — repeating their own number back is not invention.
    const out = guardAnswer({
      answer: 'You mentioned ₦33,000 a bag. The most recent recorded figure is ₦420 per kg.',
      question: 'Is ₦33,000 per bag a good price for maize?',
      evidence: priceEvidence, language: 'en',
    })
    expect(out.report.fellBack).toBe(false)
  })

  it('tolerates rounding but not invention', () => {
    const ev: EvidenceItem[] = [{ level: 1, claim: 'Average was 419.6 naira per kg.', source: 's', numbers: [419.6] }]
    expect(guardAnswer({ answer: 'About 420 naira per kg.', question: 'q', evidence: ev, language: 'en' }).report.fellBack).toBe(false)
    expect(guardAnswer({ answer: 'About 480 naira per kg.', question: 'q', evidence: ev, language: 'en' }).report.fellBack).toBe(true)
  })

  it('ignores small integers, which are counts rather than claims', () => {
    const out = guardAnswer({
      answer: 'There are 3 things to watch, and 2 of them matter most.',
      question: 'q', evidence: priceEvidence, language: 'en',
    })
    expect(out.report.fellBack).toBe(false)
  })
})

describe('forecast language is refused even when the numbers check out', () => {
  it('rejects a prediction built from authorised figures', () => {
    const ev: EvidenceItem[] = [{ level: 1, claim: 'Recorded price ₦420 per kg.', source: 's', numbers: [420] }]
    const out = guardAnswer({
      answer: 'Maize will cost ₦420 per kg next season.',
      question: 'What will maize cost?', evidence: ev, language: 'en',
    })
    expect(out.report.fellBack).toBe(true)
    expect(out.report.reason).toContain('forecast language')
  })
})

describe('the deterministic fallback', () => {
  it('is built only from Level 1 and Level 2 claims', () => {
    const text = evidenceOnlyAnswer(
      [
        ...KADUNA_EVIDENCE,
        { level: 3, claim: 'Model speculation that must not appear.', source: 'model' },
      ],
      'en',
    )
    expect(text).toContain('late May into mid-June')
    expect(text, 'Level 3 must never be presented as a record').not.toContain('speculation')
  })

  it('does NOT put the internal attribution in the answer text', () => {
    /**
     * It used to, as "(${e.source})". A live Hausa run put
     * "PENDING AGRONOMIST REVIEW" on screen inside a Hausa answer -- engineer
     * phrasing, in the wrong language, in the prose a farmer reads.
     *
     * Provenance is not lost: it travels in the structured `evidence` field and
     * the interface renders it through describeSource() in the member's own
     * language. This asserts the split, so a future change cannot quietly put
     * the raw string back into the sentence.
     */
    const text = evidenceOnlyAnswer(KADUNA_EVIDENCE, 'en')
    expect(text).toContain('late May into mid-June')
    expect(text).not.toContain('PENDING AGRONOMIST REVIEW')
    expect(text).not.toContain('Loam knowledge pack')
  })

  it('declines rather than inventing when there is nothing to show', () => {
    const text = evidenceOnlyAnswer([], 'en')
    expect(text).toContain('I will not guess')
  })
})
