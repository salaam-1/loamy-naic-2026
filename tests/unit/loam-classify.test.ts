import { describe, expect, it } from 'vitest'
import { classify } from '@/lib/loam/classify'

/**
 * The gate's first decision. Getting this wrong in the lenient direction
 * reproduces the Phase 0 failure, so the tests below check the STRICT side
 * hardest: an unrecognised question must land on `specific`, not `general`.
 */

describe('forecast questions are identified before anything else', () => {
  for (const q of [
    'What will maize cost in March?',
    'How much will rice cost next month?',
    'Can you predict the price of sorghum?',
    'What is your forecast for cowpea prices?',
  ]) {
    it(`"${q}"`, () => {
      expect(classify(q).demand).toBe('forecast')
    })
  }

  it('does not mistake an observed-price question for a forecast', () => {
    expect(classify('What is the maize price in Kano?').demand).toBe('specific')
    expect(classify('What was the price of maize last season?').demand).not.toBe('forecast')
  })
})

describe('personal questions require the member\'s own records', () => {
  for (const q of ["What's on my farm?", 'Do I have any listings?', 'What is my financing status?']) {
    it(`"${q}"`, () => {
      expect(classify(q).demand).toBe('personal')
    })
  }

  it('recognises a Hausa personal question', () => {
    const c = classify('Me ke gonata?')
    expect(c.demand).toBe('personal')
  })
})

describe('specificity rises with place, date and figure', () => {
  it('a named state makes a question specific', () => {
    const c = classify('Tell me about maize in Kaduna')
    expect(c.demand).toBe('specific')
    expect(c.state).toBe('Kaduna')
    expect(c.because).toContain('names a place')
  })

  it('"when" makes a question specific even without a place', () => {
    expect(classify('When should I plant maize?').demand).toBe('specific')
  })

  it('an unrecognised question is treated as specific, not general', () => {
    const c = classify('Fusarium on the lower leaves after the second weeding')
    expect(c.demand, 'unknown shapes must need evidence').toBe('specific')
    expect(c.because).toContain('unrecognised')
  })
})

describe('general questions are a narrow, explicit set', () => {
  for (const q of [
    'Why does crop rotation matter?',
    'What is intercropping?',
    'Explain the benefits of rotation',
    'How to manage a common crop pest',
    'How to prepare soil before planting',
  ]) {
    it(`"${q}"`, () => {
      expect(classify(q).demand).toBe('general')
    })
  }

  it('a general topic plus a place becomes specific', () => {
    // "why" alone is general; "why ... in Kano" is a claim about a place.
    expect(classify('Why does crop rotation matter in Kano?').demand).toBe('specific')
  })
})

describe('entities are reused from the existing Co-pilot extractors', () => {
  it('resolves Hausa commodity names', () => {
    expect(classify('Farashin masara a Kano').commodity).toBe('Maize')
  })

  it('detects Hausa and overrides the app language for the turn', () => {
    expect(classify('Yaushe zan shuka masara?', 'en').language).toBe('ha')
  })

  it('carries the last commodity into a follow-up', () => {
    expect(classify('and in Kano?', 'en', 'Sorghum').commodity).toBe('Sorghum')
  })
})
