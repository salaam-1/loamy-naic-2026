import { describe, expect, it } from 'vitest'
import { guardStructured } from '@/lib/loam/guard'
import {
  GROUNDING_THRESHOLD, contentWords, groundStatement, parseStatements,
} from '@/lib/loam/structure'
import type { EvidenceItem } from '@/lib/loam/types'

/**
 * Qualitative hallucination: the failures that carry no numbers, no dates and
 * nothing measurable, and so are invisible to a provenance check.
 *
 * Phase 1's guard passed every statement in the ADVERSARIAL list below. They
 * are fluent, plausible, agriculturally consequential, and unsupported. Some
 * were produced by N-ATLaS in live runs; the rest are the same shape, written
 * to cover the categories the brief named.
 *
 * The mechanism under test is STRUCTURAL, not lexical: a statement either cites
 * evidence it demonstrably restates, or it is routed to a labelled reasoning
 * section where it cannot be read as a record, or it is dropped. No list of
 * banned words is involved.
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
const ZONE_EVIDENCE: EvidenceItem = {
  level: 2, source: 'Loam knowledge pack v0 - PENDING AGRONOMIST REVIEW',
  claim: "Kaduna lies in Nigeria's Northern Guinea Savanna agro-ecological zone.",
  contextOnly: true,
}
const Q_PLANT = 'When should I plant maize in Kaduna?'
const Q_ROTATE = 'Why does crop rotation matter?'

/** Statements taken verbatim from live N-ATLaS runs, plus same-shape additions. */
const ADVERSARIAL: { category: string; text: string; evidence: EvidenceItem; question: string; live?: true }[] = [
  {
    category: 'unsupported causal explanation',
    text: 'This is because the region experiences a dry season during the colder months of the year.',
    evidence: PLANTING, question: Q_PLANT, live: true,
  },
  {
    category: 'unsupported sustainability claim',
    text: 'This approach ensures a more sustainable and resilient farming system.',
    evidence: ROTATION, question: Q_ROTATE, live: true,
  },
  {
    category: 'source name leaked as authority',
    text: 'This approach is supported by Loam knowledge pack v0, which emphasizes the importance '
      + 'of rotation principles for optimal agricultural outcomes.',
    evidence: ROTATION, question: Q_ROTATE, live: true,
  },
  {
    category: 'unsupported crop-suitability claim',
    text: 'Maize is particularly well suited to this zone because of its deep root system.',
    evidence: PLANTING, question: Q_PLANT,
  },
  {
    category: 'unsupported crop-suitability claim',
    text: 'Sorghum would be a better choice for a farmer in this area.',
    evidence: PLANTING, question: Q_PLANT,
  },
  {
    category: 'unsupported pest/disease behaviour',
    text: 'Fall armyworm pressure is typically highest just after the first rains.',
    evidence: PLANTING, question: Q_PLANT,
  },
  {
    category: 'unsupported pest/disease behaviour',
    text: 'Striga infestation can be reduced by delaying sowing until the soil has warmed.',
    evidence: PLANTING, question: Q_PLANT,
  },
  {
    category: 'plausible explanatory filler, nothing measurable',
    text: 'Legume rotation also improves household nutrition and market resilience.',
    evidence: ROTATION, question: Q_ROTATE,
  },
  {
    category: 'plausible explanatory filler, nothing measurable',
    text: 'Following this practice will give you a healthier harvest and a better income.',
    evidence: ROTATION, question: Q_ROTATE,
  },
  {
    category: 'unsupported agronomic instruction',
    text: 'Apply fertiliser at the same time to get the best establishment.',
    evidence: PLANTING, question: Q_PLANT,
  },
]

/** Statements that genuinely restate their evidence. Must survive. */
const GROUNDED: { text: string; evidence: EvidenceItem; question: string }[] = [
  {
    text: "In Kaduna, which lies in Nigeria's Northern Guinea Savanna agro-ecological zone, "
      + 'rain-fed maize is sown at the onset of the rains, typically from late May into mid-June.',
    evidence: PLANTING, question: Q_PLANT,
  },
  {
    text: 'Sowing before the rains are established risks seedling loss.',
    evidence: PLANTING, question: Q_PLANT,
  },
  {
    text: 'The sowing date follows the actual onset of rainfall rather than a fixed calendar date.',
    evidence: PLANTING, question: Q_PLANT,
  },
  {
    text: 'Crop rotation matters because it helps maintain soil nitrogen, interrupts pest and '
      + 'disease cycles, and spreads risk across multiple crops.',
    evidence: ROTATION, question: Q_ROTATE,
  },
  {
    text: 'Rotating cereals with legumes like cowpea or groundnut helps maintain soil nitrogen.',
    evidence: ROTATION, question: Q_ROTATE,
  },
]

describe('a cited statement must actually restate the evidence it cites', () => {
  for (const a of ADVERSARIAL) {
    it(`drops a ${a.category}${a.live ? ' [observed live]' : ''}: "${a.text.slice(0, 48)}..."`, () => {
      const out = guardStructured({
        raw: `[1] ${a.text}`,
        answer: '', question: a.question, evidence: [a.evidence], language: 'en',
      })
      expect(out.body, 'an ungrounded claim must not enter the factual body').toEqual([])
      expect(out.dropped.length).toBeGreaterThan(0)
      expect(out.report.fellBack, 'nothing survived, so the evidence is shown instead').toBe(true)
      expect(out.answer).not.toContain(a.text)
    })
  }

  for (const g of GROUNDED) {
    it(`keeps a grounded statement: "${g.text.slice(0, 48)}..."`, () => {
      const out = guardStructured({
        raw: `[1] ${g.text}`,
        answer: '', question: g.question, evidence: [g.evidence], language: 'en',
      })
      expect(out.body, g.text).toEqual([g.text])
      expect(out.report.fellBack).toBe(false)
      expect(out.dropped).toEqual([])
    })
  }
})

describe('the grounding threshold sits in an empty band', () => {
  it('separates the two populations with no overlap', () => {
    const score = (text: string, ev: EvidenceItem, q: string) =>
      groundStatement({ kind: 'cited', citation: 1, text }, [ev], q, 'en').overlap

    const grounded = GROUNDED.map((g) => score(g.text, g.evidence, g.question))
    const bad = ADVERSARIAL.map((a) => score(a.text, a.evidence, a.question))

    const worstGrounded = Math.min(...grounded)
    const bestBad = Math.max(...bad)

    // The claim the threshold comment makes, asserted rather than asserted-in-prose.
    expect(bestBad, `an adversarial statement scored ${bestBad}`).toBeLessThan(GROUNDING_THRESHOLD)
    expect(worstGrounded, `a grounded statement scored ${worstGrounded}`).toBeGreaterThan(GROUNDING_THRESHOLD)
    // And the band is wide, not a hair's breadth.
    expect(worstGrounded - bestBad).toBeGreaterThan(0.2)
  })

  it('the stopword list contains no agricultural vocabulary', () => {
    // The moment this list learns subject matter, the mechanism has become the
    // keyword matching the brief ruled out.
    const words = contentWords(
      'maize sorghum rice rotation legume nitrogen pest disease sustainable '
      + 'suitable yield harvest planting rainfall soil fertiliser',
    )
    expect(words.size, 'every domain word must survive as a content word').toBeGreaterThanOrEqual(15)
  })
})

describe('reasoning is separated, not suppressed', () => {
  it('an honestly-marked inference is kept, but never in the body', () => {
    const out = guardStructured({
      raw: '[1] Sowing before the rains are established risks seedling loss.\n'
        + '[?] Many farmers in the area wait for two good rains before sowing.',
      answer: '', question: Q_PLANT, evidence: [PLANTING], language: 'en',
    })
    expect(out.body).toEqual(['Sowing before the rains are established risks seedling loss.'])
    expect(out.reasoning).toEqual(['Many farmers in the area wait for two good rains before sowing.'])
    expect(out.answer, 'the answer field carries only grounded fact')
      .not.toContain('Many farmers')
    expect(out.report.fellBack).toBe(false)
  })

  it('the same sentence is harmless as [?] and rejected as [1]', () => {
    const sentence = 'This approach ensures a more sustainable and resilient farming system.'
    const asReasoning = guardStructured({
      raw: `[1] Rotating cereals with legumes helps maintain soil nitrogen.\n[?] ${sentence}`,
      answer: '', question: Q_ROTATE, evidence: [ROTATION], language: 'en',
    })
    expect(asReasoning.reasoning).toEqual([sentence])
    expect(asReasoning.body).not.toContain(sentence)

    const asFact = guardStructured({
      raw: `[1] ${sentence}`,
      answer: '', question: Q_ROTATE, evidence: [ROTATION], language: 'en',
    })
    expect(asFact.body).toEqual([])
    expect(asFact.dropped[0].text).toBe(sentence)
  })

  it('an inference may not smuggle in a figure or a month either', () => {
    const out = guardStructured({
      raw: '[1] Sowing before the rains are established risks seedling loss.\n'
        + '[?] Most farmers here sow in September and get 900 kg per hectare.',
      answer: '', question: Q_PLANT, evidence: [PLANTING], language: 'en',
    })
    expect(out.body.length).toBe(1)
    expect(out.reasoning, 'reasoning is still provenance-checked').toEqual([])
    expect(out.dropped.some((d) => d.reason.startsWith('reasoning:'))).toBe(true)
  })
})

describe('the structure fails closed', () => {
  it('unstructured prose is discarded wholesale', () => {
    // Exactly what Phase 1 accepted: three fluent sentences, one invented.
    const out = guardStructured({
      raw: 'In Kaduna, maize is sown from late May into mid-June. Sowing early risks '
        + 'seedling loss. This is because the region experiences a dry season during the '
        + 'colder months of the year.',
      answer: '', question: Q_PLANT, evidence: [PLANTING], language: 'en',
    })
    expect(out.unstructured).toBe(true)
    expect(out.report.fellBack).toBe(true)
    expect(out.body).toEqual([])
    expect(out.answer, 'the evidence is shown instead').toContain('late May into mid-June')
    expect(out.answer).not.toContain('colder months')
  })

  it('a reply that is only reasoning falls back to the evidence', () => {
    const out = guardStructured({
      raw: '[?] I think you should wait until the rains look settled.',
      answer: '', question: Q_PLANT, evidence: [PLANTING], language: 'en',
    })
    expect(out.report.fellBack).toBe(true)
    expect(out.report.reason).toContain('only its own reasoning')
    expect(out.answer).not.toContain('I think')
  })

  it('an out-of-range citation is judged on grounding, not on the index', () => {
    // A live run produced a correct, fully-grounded sentence labelled [2] when
    // only one evidence item existed. Dropping it lost true content over an
    // index the model guessed, so an out-of-range citation now gets the same
    // treatment as a wrong one: check the whole set.
    const out = guardStructured({
      raw: '[7] Maize is sown from late May into mid-June.',
      answer: '', question: Q_PLANT, evidence: [PLANTING], language: 'en',
    })
    expect(out.body.length).toBe(1)
    expect(out.report.fellBack).toBe(false)
  })

  it('an out-of-range citation on an UNGROUNDED statement is still dropped', () => {
    const out = guardStructured({
      raw: '[7] This approach ensures a more sustainable and resilient farming system.',
      answer: '', question: Q_PLANT, evidence: [PLANTING], language: 'en',
    })
    expect(out.body).toEqual([])
    expect(out.dropped.length).toBe(1)
  })

  it('an empty reply falls back rather than returning nothing', () => {
    const out = guardStructured({
      raw: '   \n  \n', answer: '', question: Q_PLANT, evidence: [PLANTING], language: 'en',
    })
    expect(out.unstructured).toBe(true)
    expect(out.answer.length).toBeGreaterThan(20)
  })
})

describe('the parser tolerates what a small model actually produces', () => {
  it('accepts bullets, parentheses and wrapped lines', () => {
    const stmts = parseStatements(
      '- [1] First statement\n'
      + '* (2) Second statement that wraps\n'
      + '  onto another line\n'
      + '[?] A reasoning line\n',
    )
    expect(stmts.map((s) => s.kind)).toEqual(['cited', 'cited', 'inference'])
    expect(stmts[1].text).toBe('Second statement that wraps onto another line')
    expect(stmts[1].citation).toBe(2)
  })

  it('strips a markdown fence', () => {
    expect(parseStatements('```\n[1] Inside a fence\n```').length).toBe(1)
  })

  it('returns nothing for prose, which the guard treats as failure', () => {
    expect(parseStatements('Just a paragraph with no markers at all.')).toEqual([])
  })
})

describe('the Phase 0 regression stays pinned', () => {
  // 2026-10-07, N-ATLaS Q4_K_M, verbatim. The sentence this whole subsystem
  // exists for. It must fail as a cited statement, and its months must fail
  // provenance even if it ever arrives grounded.
  const PHASE0 = 'In Kaduna State, Nigeria, the ideal time to plant maize is towards the end of '
    + 'the rainy season, specifically in September and October. This allows maize to mature '
    + 'before the onset of the dry season.'

  it('is rejected as a cited statement', () => {
    const out = guardStructured({
      raw: `[1] ${PHASE0}`,
      answer: '', question: Q_PLANT, evidence: [PLANTING], language: 'en',
    })
    expect(out.body).toEqual([])
    expect(out.answer).not.toContain('September')
    expect(out.answer).toContain('late May into mid-June')
  })

  it('is rejected as unstructured prose', () => {
    const out = guardStructured({
      raw: PHASE0, answer: '', question: Q_PLANT, evidence: [PLANTING], language: 'en',
    })
    expect(out.unstructured).toBe(true)
    expect(out.answer).not.toContain('September')
  })

  it('is rejected even when marked as reasoning, because of its months', () => {
    const out = guardStructured({
      raw: `[1] Sowing before the rains are established risks seedling loss.\n[?] ${PHASE0}`,
      answer: '', question: Q_PLANT, evidence: [PLANTING], language: 'en',
    })
    expect(out.reasoning).toEqual([])
    expect(out.answer).not.toContain('September')
  })
})

describe('Hausa: structural protection holds, lexical grounding does not apply', () => {
  it('keeps a correct Hausa statement that cites evidence', () => {
    const out = guardStructured({
      raw: '[1] Ka shuka masara daga karshen Mayu zuwa tsakiyar Yuni.',
      answer: '', question: 'Yaushe zan shuka masara a Kaduna?',
      evidence: [PLANTING], language: 'ha',
    })
    expect(out.body.length).toBe(1)
    expect(out.report.fellBack).toBe(false)
  })

  it('still routes an uncited Hausa statement to reasoning, never the body', () => {
    const out = guardStructured({
      raw: '[1] Ka shuka masara daga karshen Mayu zuwa tsakiyar Yuni.\n'
        + '[?] Wannan hanya tana kyautata lafiyar kasa.',
      answer: '', question: 'Yaushe zan shuka masara a Kaduna?',
      evidence: [PLANTING], language: 'ha',
    })
    expect(out.body.length).toBe(1)
    expect(out.reasoning).toEqual(['Wannan hanya tana kyautata lafiyar kasa.'])
    expect(out.answer).not.toContain('lafiyar kasa')
  })

  it('still catches a wrong Hausa month, because months are language-independent', () => {
    const out = guardStructured({
      raw: '[1] Ka shuka masara a watan Satumba da Oktoba.',
      answer: '', question: 'Yaushe zan shuka masara a Kaduna?',
      evidence: [PLANTING], language: 'ha',
    })
    // Phase 1.6 catches this at GROUNDING rather than at the provenance stage:
    // the anchor check now runs for every language before lexical overlap is
    // considered, so the statement is dropped with the offending month named
    // instead of surviving to be caught later.
    expect(out.report.fellBack).toBe(true)
    expect(out.body).toEqual([])
    expect(out.dropped.length).toBe(1)
    expect(out.dropped[0].reason).toContain('september')
    expect(out.answer).not.toContain('Satumba')
  })
})

describe('the citation is a hint, the evidence set is the test', () => {
  // Both items present, as in the live run that exposed this.
  const BOTH = [ZONE_EVIDENCE, PLANTING]

  it('keeps a correct statement that cites the WRONG evidence item', () => {
    // Verbatim from a live run: N-ATLaS labelled four sowing statements [1],
    // which is the zone entry. Scored against item 1 alone they all failed and
    // a correct answer collapsed to one sentence about which savanna Kaduna is
    // in. Bookkeeping must not be mistaken for invention.
    const out = guardStructured({
      raw: '[1] In this zone, rain-fed maize is sown at the onset of the rains.\n'
        + '[1] The sowing date typically starts from late May into mid-June.\n'
        + '[1] It follows the actual onset of rainfall rather than a fixed calendar date.\n'
        + '[1] Sowing before the rains risks seedling loss.',
      answer: '', question: Q_PLANT, evidence: BOTH, language: 'en',
    })
    expect(out.body.length, 'all four are supported by evidence 2').toBe(4)
    expect(out.dropped).toEqual([])
    expect(out.report.fellBack).toBe(false)
  })

  it('records which item actually grounded a mis-cited statement', () => {
    const r = groundStatement(
      { kind: 'cited', citation: 1, text: 'Sowing before the rains risks seedling loss.' },
      BOTH, Q_PLANT, 'en',
    )
    expect(r.grounded).toBe(true)
    expect(r.groundedBy, 'the planting entry, not the cited zone entry').toBe(2)
    expect(r.reason).toContain('not the cited 1')
  })

  it('EVERY adversarial statement still fails against the WHOLE set', () => {
    // The claim the relaxation rests on. If checking the full set rescued even
    // one hallucination, the relaxation would be a hole rather than a fix.
    const all = [ZONE_EVIDENCE, PLANTING, ROTATION]
    for (const a of ADVERSARIAL) {
      const r = groundStatement({ kind: 'cited', citation: 1, text: a.text }, all, a.question, 'en')
      expect(r.grounded, `${a.category}: "${a.text.slice(0, 50)}" scored ${r.overlap.toFixed(2)}`).toBe(false)
    }
  })

  it('the Phase 0 sentence still fails against the whole set', () => {
    const out = guardStructured({
      raw: '[2] In Kaduna State, Nigeria, the ideal time to plant maize is towards the end of '
        + 'the rainy season, specifically in September and October.',
      answer: '', question: Q_PLANT, evidence: BOTH, language: 'en',
    })
    expect(out.answer).not.toContain('September')
  })
})
