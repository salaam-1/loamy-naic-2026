import { describe, expect, it } from 'vitest'
import { guardStructured } from '@/lib/loam/guard'
import { anchorsIn, cropsIn, fold, monthsIn, statesIn, unitsIn } from '@/lib/loam/anchors'
import type { EvidenceItem } from '@/lib/loam/types'

/**
 * Multilingual provenance, with language-mismatched evidence.
 *
 * Loam's evidence is canonical English. A correct Hausa, Igbo or Yoruba
 * restatement of it shares almost no words with it, so lexical grounding cannot
 * run -- which in Phase 1.5 meant those languages were checked only for
 * structure, numbers and months. A statement naming the WRONG CROP, the wrong
 * state or the wrong unit passed unchallenged.
 *
 * Phase 1.6 adds ANCHORS: tokens whose identity survives translation. Every
 * test below pairs ENGLISH evidence with a non-English statement, which is the
 * real configuration and the one that was previously unverified.
 *
 * THIS IS NOT SEMANTIC VERIFICATION. A statement in these languages carrying no
 * anchors and no polarity markers is still unverified beyond holding a
 * citation. The final describe block asserts that limit honestly rather than
 * leaving it implied.
 */

const PLANTING: EvidenceItem = {
  level: 2, source: 'Loam knowledge pack v0 - PENDING AGRONOMIST REVIEW',
  claim: 'In the Northern Guinea Savanna, rain-fed maize is sown at the onset of the rains, '
    + 'typically from late May into mid-June. The sowing date follows the actual onset of '
    + 'rainfall for that season rather than a fixed calendar date, and sowing before the '
    + 'rains are established risks seedling loss.',
  periods: ['late May', 'May', 'June', 'mid-June'],
}
const PRICE: EvidenceItem = {
  level: 1, source: 'Loamy market price records',
  claim: 'Observed retail price for Maize: the most recent recorded figure is 420 naira per kg '
    + 'on 2026-09-30.',
  numbers: [420],
}

const Q = {
  ha: 'Yaushe zan shuka masara a jihar Kaduna?',
  ig: 'Kedu mgbe m kwesiri iku oka na Kaduna?',
  yo: 'Nigba wo ni mo le gbin agbado ni ipinle Kaduna?',
  en: 'When should I plant maize in Kaduna?',
}

describe('anchors are extracted from all four languages', () => {
  it('resolves crop names to one canonical form', () => {
    expect([...cropsIn('maize')]).toEqual(['Maize'])
    expect([...cropsIn('masara')], 'Hausa').toEqual(['Maize'])
    expect([...cropsIn('ọka')], 'Igbo').toEqual(['Maize'])
    expect([...cropsIn('àgbàdo')], 'Yoruba').toEqual(['Maize'])
  })

  it('resolves month names to one index', () => {
    expect([...monthsIn('late May')]).toEqual([5])
    expect([...monthsIn('watan Mayu')], 'Hausa').toEqual([5])
    expect([...monthsIn('ọnwa Mee')], 'Igbo').toEqual([5])
    expect([...monthsIn('Èbibi')], 'Yoruba').toEqual([5])
  })

  it('resolves units to one canonical form', () => {
    expect([...unitsIn('per kg')]).toEqual(['kg'])
    expect([...unitsIn('kowane buhu')], 'Hausa bag').toEqual(['bag'])
    expect([...unitsIn('akpa')], 'Igbo bag').toEqual(['bag'])
    expect([...unitsIn('àpò')], 'Yoruba bag').toEqual(['bag'])
  })

  it('reads state names, which are the same string in every language', () => {
    for (const q of Object.values(Q)) {
      expect([...statesIn(q)]).toEqual(['Kaduna'])
    }
  })

  it('folds diacritics, because the model writes both forms', () => {
    // A live Hausa reply used "karshen" where the dictionary form is "ǃarshen".
    expect(fold('ƙarshen')).toBe('karshen')
    expect(fold('ọka')).toBe('oka')
    expect(fold('àgbàdo')).toBe('agbado')
    expect(fold('ìparí')).toBe('ipari')
  })
})

describe('a correct statement survives in every language, with English evidence', () => {
  const CORRECT: Record<string, string> = {
    ha: 'Ka shuka masara daga karshen Mayu zuwa tsakiyar Yuni.',
    ig: 'Kụọ ọka site na njedebe Mee ruo etiti Juun.',
    yo: 'Gbin àgbàdo láti ìparí Èbibi sí áárín Òkudu.',
  }
  for (const [lang, text] of Object.entries(CORRECT)) {
    it(`${lang}: "${text.slice(0, 44)}..."`, () => {
      const out = guardStructured({
        raw: `[1] ${text}`,
        answer: '', question: Q[lang as 'ha'], evidence: [PLANTING],
        language: lang as 'ha' | 'ig' | 'yo',
      })
      expect(out.body, 'a correct restatement must not be rejected').toEqual([text])
      expect(out.report.fellBack).toBe(false)
    })
  }
})

describe('an invented anchor is caught in every language', () => {
  const WRONG_CROP: Record<string, string> = {
    ha: 'Ka shuka shinkafa daga karshen Mayu zuwa tsakiyar Yuni.',
    ig: 'Kụọ osikapa site na njedebe Mee ruo etiti Juun.',
    yo: 'Gbin ìrẹsì láti ìparí Èbibi.',
  }
  for (const [lang, text] of Object.entries(WRONG_CROP)) {
    it(`${lang}: names Rice when the evidence is about Maize`, () => {
      const out = guardStructured({
        raw: `[1] ${text}`,
        answer: '', question: Q[lang as 'ha'], evidence: [PLANTING],
        language: lang as 'ha' | 'ig' | 'yo',
      })
      expect(out.body).toEqual([])
      expect(out.dropped[0].reason).toContain('crop "Rice"')
    })
  }

  it('ha: names a month the evidence never mentions', () => {
    const out = guardStructured({
      raw: '[1] Ka shuka masara a watan Satumba.',
      answer: '', question: Q.ha, evidence: [PLANTING], language: 'ha',
    })
    expect(out.body).toEqual([])
    expect(out.dropped[0].reason).toContain('september')
  })

  it('ha: names a state nobody asked about', () => {
    const out = guardStructured({
      raw: '[1] Ka shuka masara a jihar Kano daga karshen Mayu.',
      answer: '', question: Q.ha, evidence: [PLANTING], language: 'ha',
    })
    expect(out.body).toEqual([])
    expect(out.dropped[0].reason).toContain('state "Kano"')
  })

  it('ha: reverses the unit, which changes the figure by the weight of a bag', () => {
    const out = guardStructured({
      raw: '[1] Farashin masara shine naira 420 kowane buhu.',
      answer: '', question: 'Nawa ne farashin masara?', evidence: [PRICE], language: 'ha',
    })
    expect(out.body, 'the record says per kg, not per bag').toEqual([])
    expect(out.dropped[0].reason).toContain('unit "bag"')
  })

  it('ha: invents a figure', () => {
    const out = guardStructured({
      raw: '[1] Farashin masara shine naira 950 kowane kg.',
      answer: '', question: 'Nawa ne farashin masara?', evidence: [PRICE], language: 'ha',
    })
    expect(out.body).toEqual([])
    expect(out.dropped[0].reason).toContain('950')
  })

  it('an anchor the MEMBER supplied in their own question is allowed', () => {
    const out = guardStructured({
      raw: '[1] Ka shuka masara a jihar Kaduna daga karshen Mayu zuwa tsakiyar Yuni.',
      answer: '', question: Q.ha, evidence: [PLANTING], language: 'ha',
    })
    expect(out.body.length, 'Kaduna came from the question').toBe(1)
  })
})

describe('the structural guarantee still holds regardless of language', () => {
  it('an uncited Hausa statement cannot enter the factual body', () => {
    const out = guardStructured({
      raw: '[1] Ka shuka masara daga karshen Mayu zuwa tsakiyar Yuni.\n'
        + '[?] Wannan hanya tana kyautata lafiyar kasa sosai.',
      answer: '', question: Q.ha, evidence: [PLANTING], language: 'ha',
    })
    expect(out.body.length).toBe(1)
    expect(out.reasoning).toEqual(['Wannan hanya tana kyautata lafiyar kasa sosai.'])
    expect(out.answer).not.toContain('kyautata')
  })

  it('unstructured Hausa prose is discarded wholesale', () => {
    const out = guardStructured({
      raw: 'Ka shuka masara daga karshen Mayu. Wannan shine mafi kyau.',
      answer: '', question: Q.ha, evidence: [PLANTING], language: 'ha',
    })
    expect(out.unstructured).toBe(true)
    expect(out.report.fellBack).toBe(true)
  })
})

describe('the honest limit of multilingual checking', () => {
  it('a Hausa statement with no anchors and no polarity markers is NOT verified', () => {
    /**
     * This test documents a GAP, not a feature. The sentence below is Hausa for
     * "this is a very important matter for farmers" -- unsupported by the
     * evidence, carrying no crop, month, figure, unit, state or polarity marker,
     * and so invisible to every language-independent check Loam has.
     *
     * It is admitted into the factual body. The only thing standing behind it is
     * that the model chose to cite evidence for it. If this assertion ever
     * starts failing, something real has been added and the limitation note in
     * docs/loam-architecture.md should be revised.
     */
    const out = guardStructured({
      raw: '[1] Wannan babban abu ne mai muhimmanci ga manoma.',
      answer: '', question: Q.ha, evidence: [PLANTING], language: 'ha',
    })
    expect(out.body.length, 'KNOWN GAP: unanchored non-English prose is admitted').toBe(1)
    expect(out.report.fellBack).toBe(false)
  })

  it('the same unanchored sentence IS caught in English, by lexical overlap', () => {
    // The asymmetry is the point: English has a check the other languages do not.
    const out = guardStructured({
      raw: '[1] This is a very important matter for farmers everywhere.',
      answer: '', question: Q.en, evidence: [PLANTING], language: 'en',
    })
    expect(out.body).toEqual([])
    expect(out.dropped[0].reason).toContain('content words')
  })
})
