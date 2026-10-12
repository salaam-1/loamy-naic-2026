import { describe, expect, it } from 'vitest'
import { en } from '../../src/lib/i18n/packs/en'
import { PACKS, REVIEW_STATUS } from '../../src/lib/i18n/packs'
import { clearMissingKeys, missingKeys, translate } from '../../src/lib/i18n'
import { LOCALES } from '../../src/lib/i18n/types'
import { isReferenceKey, packEntries } from '../../scripts/lib/i18n-contract.mjs'

/**
 * Invariants every translation pack must hold.
 *
 * These are the structural claims the localization layer rests on, as opposed
 * to how much of it is translated. Coverage is not what this file measures:
 * Hausa, Igbo and Yoruba are deliberately partial and are expected to stay
 * that way until a native reviewer has been through them. What is asserted is
 * that whatever IS there is well formed, reachable, and not pretending.
 */

const WORDS = en as Record<string, string>
const CANONICAL = new Set(Object.keys(WORDS))

describe('the canonical pack is the key space', () => {
  it('English defines every key any pack may use', () => {
    const stray: string[] = []
    for (const loc of LOCALES) {
      if (loc === 'en') continue
      for (const key of Object.keys(PACKS[loc])) {
        if (!CANONICAL.has(key)) stray.push(`${loc}: ${key}`)
      }
    }
    /**
     * A key in a locale pack with no English counterpart is dead weight at
     * best and a misspelling at worst. `Partial<Record<TranslationKey, ...>>`
     * makes it a compile error, and this is the belt to that braces: a pack
     * written as a plain object literal, or widened anywhere, would slip past
     * the type and still never be asked for.
     */
    expect(stray, `keys not present in English:\n${stray.join('\n')}`).toEqual([])
  })

  it('no pack declares the same key twice', () => {
    /**
     * A duplicate is legal TypeScript in an object literal: the last wins
     * silently. Two were found in A.3 (`auth.ifAccountExists` and one in
     * `transaction.ts`), and in one of them the two values DIFFERED, so the
     * screen rendered whichever happened to be last in the file.
     */
    const offenders: string[] = []
    for (const loc of LOCALES) {
      const seen = new Map<string, string>()
      for (const e of packEntries(loc)) {
        const prior = seen.get(e.key)
        if (prior) {
          offenders.push(`${loc}: ${e.key} declared again at ${e.file}:${e.line} (first at ${prior})`)
        } else {
          seen.set(e.key, `${e.file}:${e.line}`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('no translation is an empty string', () => {
    /**
     * An empty value is worse than a missing one. A missing key falls back to
     * English and the member reads something; an empty string satisfies the
     * lookup and renders nothing at all, so a button loses its label and the
     * fallback counter never records a gap.
     */
    const offenders: string[] = []
    for (const loc of LOCALES) {
      for (const [key, value] of Object.entries(PACKS[loc] as Record<string, string>)) {
        if (typeof value !== 'string' || value.trim() === '') offenders.push(`${loc}: ${key}`)
      }
    }
    expect(offenders, `empty translations:\n${offenders.join('\n')}`).toEqual([])
  })

  it('every canonical value is a non-empty string', () => {
    for (const [key, value] of Object.entries(WORDS)) {
      expect(typeof value, `${key} is not a string`).toBe('string')
      expect(value.trim().length, `${key} is empty in English`).toBeGreaterThan(0)
    }
  })
})

/**
 * A value identical to the English is either a correct cognate or a faked
 * translation, and the two are indistinguishable without a reason. So the
 * reason has to be written down.
 *
 * A value passes if a RULE explains it (nothing translatable outside the
 * placeholders) or if it is listed here with a category. Anything else fails,
 * which is the conservative direction: a new English string copied into a pack
 * is caught, and the cost of a genuine cognate is one line and a category.
 */
const APPROVED_IDENTICAL: Record<string, { why: string; locales?: string[] }> = {
  // Brands and product names. Translating these would be the error.
  Loamy: { why: 'brand' },
  Loam: { why: 'brand: the assistant' },
  'Loamy Digital ID': { why: 'brand: product name' },
  // Acronyms and technical identifiers. The glossary keeps identifiers as-is
  // so a reference means the same thing in every language.
  'PAR 30+': { why: 'acronym: portfolio at risk, industry standard' },
  'PAR 30+ / principal': { why: 'acronym plus a French cognate', locales: ['fr'] },
  TIN: { why: 'acronym: tax identification number' },
  Latitude: { why: 'technical: GPS axis' },
  Longitude: { why: 'technical: GPS axis' },
  // Units. A unit symbol is not language.
  kg: { why: 'unit symbol' },
  litre: { why: 'unit, identical in French', locales: ['fr'] },
  // `ha` here is HECTARES, not the Hausa locale code. The placeholder-only
  // rule does not exempt it because stripping `{size}` leaves two letters,
  // which is exactly the shape of a word -- so it is listed instead.
  '{size} ha': { why: 'unit symbol: hectares' },
  // Terms the glossary deliberately retains untranslated.
  batch: { why: 'glossary: retained in ig and yo, see glossary.md', locales: ['ig', 'yo'] },
  // Borrowings. These ARE the word used in Nigerian Hausa and Igbo for the
  // thing; recorded as borrowings rather than left to look like an oversight.
  Dashboard: { why: 'borrowing used in ha and ig', locales: ['ha', 'ig'] },
  Menu: { why: 'borrowing in ig; identical in French', locales: ['fr', 'ig'] },
  // French cognates. Each is the correct French word, spelt the same.
  Date: { why: 'fr cognate', locales: ['fr'] },
  Type: { why: 'fr cognate', locales: ['fr'] },
  Action: { why: 'fr cognate', locales: ['fr'] },
  Actions: { why: 'fr cognate', locales: ['fr'] },
  Description: { why: 'fr cognate', locales: ['fr'] },
  Principal: { why: 'fr cognate', locales: ['fr'] },
  Note: { why: 'fr cognate', locales: ['fr'] },
  Notes: { why: 'fr cognate', locales: ['fr'] },
  Conditions: { why: 'fr cognate', locales: ['fr'] },
  active: { why: 'fr cognate', locales: ['fr'] },
  Messages: { why: 'fr cognate', locales: ['fr'] },
  Message: { why: 'fr cognate', locales: ['fr'] },
  Transactions: { why: 'fr cognate', locales: ['fr'] },
  Transaction: { why: 'fr cognate', locales: ['fr'] },
  transaction: { why: 'fr cognate', locales: ['fr'] },
  transactions: { why: 'fr cognate', locales: ['fr'] },
  Inspection: { why: 'fr cognate', locales: ['fr'] },
  Inspections: { why: 'fr cognate', locales: ['fr'] },
  Contact: { why: 'fr cognate', locales: ['fr'] },
  Notifications: { why: 'fr cognate', locales: ['fr'] },
  Total: { why: 'fr cognate', locales: ['fr'] },
  Structure: { why: 'fr cognate', locales: ['fr'] },
  Simulation: { why: 'fr cognate', locales: ['fr'] },
  Sources: { why: 'fr cognate', locales: ['fr'] },
  Stock: { why: 'fr cognate', locales: ['fr'] },
  Performance: { why: 'fr cognate', locales: ['fr'] },
  Transport: { why: 'fr cognate', locales: ['fr'] },
  Document: { why: 'fr cognate', locales: ['fr'] },
  Distance: { why: 'fr cognate', locales: ['fr'] },
  'score {score}': { why: 'fr cognate with a placeholder', locales: ['fr'] },
  'Documents · {count}': { why: 'fr cognate with a placeholder', locales: ['fr'] },
  'Inspections · {count}': { why: 'fr cognate with a placeholder', locales: ['fr'] },
  'Inspection · {status}': { why: 'fr cognate with a placeholder', locales: ['fr'] },
  'Version {version} · {reference}': { why: 'fr cognate with placeholders', locales: ['fr'] },
  'Commission {amount} · {status}': { why: 'fr cognate with placeholders', locales: ['fr'] },
}

/**
 * True when the value has nothing to translate: it is placeholders, digits,
 * separators and punctuation. `{quantity} {unit} · {price}/{unit}` is the same
 * string in every language because every word in it is a variable.
 */
function nothingToTranslate(value: string): boolean {
  const withoutVars = value.replace(/\{\w+\}/g, '')
  return !/[A-Za-z]{2,}/.test(withoutVars)
}

describe('no pack passes English off as a translation', () => {
  for (const loc of LOCALES) {
    if (loc === 'en') continue
    it(`${loc}: every English-identical value is explained`, () => {
      const unexplained: string[] = []
      for (const [key, value] of Object.entries(PACKS[loc] as Record<string, string>)) {
        if (WORDS[key] !== value) continue
        if (nothingToTranslate(value)) continue
        const approved = APPROVED_IDENTICAL[value]
        if (approved && (!approved.locales || approved.locales.includes(loc))) continue
        unexplained.push(`${loc}: ${key} = ${JSON.stringify(value)}`)
      }
      expect(
        unexplained,
        'English copied into a pack counts as translated unless a reason is\n'
        + 'recorded in APPROVED_IDENTICAL. Add the value with a category, or\n'
        + `translate it:\n${unexplained.join('\n')}`,
      ).toEqual([])
    })
  }

  it('the approved list carries no entry that is no longer needed', () => {
    // An allowlist nobody prunes becomes a place to hide things. If a value is
    // no longer identical anywhere, its exemption should go.
    const stillIdentical = new Set<string>()
    for (const loc of LOCALES) {
      if (loc === 'en') continue
      for (const [key, value] of Object.entries(PACKS[loc] as Record<string, string>)) {
        if (WORDS[key] === value) stillIdentical.add(value)
      }
    }
    const stale = Object.keys(APPROVED_IDENTICAL).filter((v) => !stillIdentical.has(v))
    expect(stale, `exemptions no longer needed:\n${stale.join('\n')}`).toEqual([])
  })
})

describe('REVIEW_STATUS stays authoritative', () => {
  it('records a status for every shipped locale', () => {
    for (const loc of LOCALES) {
      expect(REVIEW_STATUS[loc], `no review status for ${loc}`).toBeTruthy()
    }
  })

  it('only English is canonical, and nothing claims native review', () => {
    /**
     * The honest-labelling invariant. No wave may promote a language without a
     * reviewer having actually read it, and 'reviewed' is deliberately not a
     * value this type admits: adding it is the change that should require a
     * conversation.
     */
    expect(REVIEW_STATUS.en).toBe('canonical')
    for (const loc of LOCALES) {
      if (loc === 'en') continue
      expect(['unreviewed', 'partial'], `${loc} claims ${REVIEW_STATUS[loc]}`)
        .toContain(REVIEW_STATUS[loc])
    }
  })

  it('a locale marked partial actually has gaps, and one marked unreviewed is complete', () => {
    // The status is a claim about the pack and has to match it, or it is just
    // a comment. `term.*` is reference vocabulary and excluded.
    const renderable = [...CANONICAL].filter((k) => !isReferenceKey(k))
    for (const loc of LOCALES) {
      if (loc === 'en') continue
      const have = renderable.filter(
        (k) => (PACKS[loc] as Record<string, string | undefined>)[k] !== undefined).length
      const gaps = renderable.length - have
      if (REVIEW_STATUS[loc] === 'partial') {
        expect(gaps, `${loc} is marked partial but has no gaps`).toBeGreaterThan(0)
      }
      if (REVIEW_STATUS[loc] === 'unreviewed') {
        // 'unreviewed' means translated-but-unchecked, so it should be
        // substantially complete. A hard 0 would make this brittle against a
        // deliberate single-key deferral, so the bar is proportional.
        expect(gaps / renderable.length, `${loc} is marked unreviewed but is ${gaps} keys short`)
          .toBeLessThan(0.05)
      }
    }
  })
})

describe('fallback stays observable', () => {
  it('a missing key falls back to English and is recorded as a gap', () => {
    /**
     * The gap counter is how coverage is measured honestly. If a fallback ever
     * stopped being recorded, a pack could look complete while rendering
     * English, which is precisely the claim this project must not make.
     */
    clearMissingKeys()
    // A key English has and Hausa does not, chosen from the real gap set so
    // this cannot drift into testing a key that later gets translated.
    const gap = [...CANONICAL].find(
      (k) => (PACKS.ha as Record<string, string | undefined>)[k] === undefined
        && !isReferenceKey(k))
    expect(gap, 'no Hausa gap found; this test needs a genuinely missing key').toBeTruthy()
    const rendered = translate('ha', gap!)
    expect(rendered, 'fallback did not render the English').toBe(WORDS[gap!])
    // `missingKeys()` reports Record<locale, key[]>, not a flat list.
    expect(missingKeys().ha ?? [], 'the fallback was not recorded').toContain(gap)
  })

  it('English itself records nothing, having nothing to fall back to', () => {
    clearMissingKeys()
    translate('en', [...CANONICAL][0])
    expect(missingKeys()).toEqual({})
  })
})
