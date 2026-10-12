import { describe, expect, it } from 'vitest'
import { PACKS } from '../../src/lib/i18n/packs'
import { LOCALES } from '../../src/lib/i18n/types'
import { pluralBases } from '../../scripts/lib/i18n-contract.mjs'

/**
 * Counted strings: the parts of the plural contract that are about the WORDS
 * rather than about the keys.
 *
 * WHAT IS HERE AND WHAT IS NOT
 *   Key existence, suffix convention and per-locale resolution moved into
 *   `tests/unit/i18n-source-contract.test.ts` in Wave A.5, where they are
 *   asserted through the real `pluralKey` for every locale and several counts.
 *   This file keeps the assertion that has nothing to do with keys: that each
 *   form actually says the number.
 *
 *   It also no longer carries its own source scanner. It had one, and so did
 *   three other test files, and each was wrong differently -- one of them read
 *   only the remainder of a call's own line. The extraction now lives once, in
 *   `scripts/lib/i18n-contract.mjs`, and both the guards and the reporting
 *   scripts read it.
 *
 * WHY THIS FILE EXISTED IN THE FIRST PLACE
 *   Three key families shipped written as `base_one` / `base_other`, which is
 *   i18next's convention and not this engine's. Every one of those lookups
 *   missed, and a member on the orders screen read the literal text
 *   "transaction.orderPlaced_plural" -- in English as well as in the other
 *   four languages.
 */

const BASES = [...pluralBases()].filter((b: string) => b.includes('.'))

describe('counted strings say the number', () => {
  it('finds the counted strings in the source at all', () => {
    // A zero here would make every assertion below vacuous.
    expect(BASES.length, 'no counted strings found in src').toBeGreaterThan(5)
  })

  it('every plural form carries {count}, in every language that has one', () => {
    /**
     * The singular may legitimately omit it: "Your order was placed" reads
     * better than "1 order was placed". The PLURAL form may not. "orders were
     * placed" without the number is a sentence that lost its subject, and it
     * is the kind of thing that reads fine in review and is useless on screen.
     */
    const bad: string[] = []
    for (const base of BASES) {
      for (const locale of LOCALES) {
        const key = `${base}_plural`
        const value = (PACKS[locale] as Record<string, string | undefined>)[key]
        if (value && !value.includes('{count}')) bad.push(`${locale}: ${key} = "${value}"`)
      }
    }
    expect(bad, `a plural form with no count:\n${bad.join('\n')}`).toEqual([])
  })

  it('no plural form is identical to its singular in a language that splits at one', () => {
    /**
     * English and French only.
     *
     * In those two, a pack where both forms carry the same words has either
     * not been translated for number or was filled in mechanically, and that
     * is worth catching.
     *
     * IGBO AND YORUBA are excluded because they have a single plural category:
     * one form serving both counts is correct there, and flagging it would be
     * flagging the right answer.
     *
     * HAUSA is excluded for a different and less certain reason. CLDR gives it
     * `one` and `other`, so `pluralKey` does ask for two forms. But a Hausa
     * noun following a numeral commonly does not inflect -- the number is
     * already carried by the numeral -- so three keys in the processor pack
     * read identically in both forms:
     *
     *     processor.analytics.supplierRow
     *     processor.awardLogistics.offersReceived
     *     processor.bid.completedTransactions
     *
     * Whether that is good Hausa or laziness is a question for a speaker, not
     * for this test. It is recorded in glossary.md under the reviewer queue
     * rather than asserted either way here, because a guard that enforces a
     * guess about grammar is worse than no guard.
     */
    const SPLITS_AT_ONE = ['en', 'fr'] as const
    const suspect: string[] = []
    for (const base of BASES) {
      for (const locale of SPLITS_AT_ONE) {
        const pack = PACKS[locale] as Record<string, string | undefined>
        const one = pack[base]
        const many = pack[`${base}_plural`]
        if (one && many && one === many) suspect.push(`${locale}: ${base} = "${one}"`)
      }
    }
    expect(
      suspect,
      'identical singular and plural in a language that distinguishes them:\n'
      + `${suspect.join('\n')}`,
    ).toEqual([])
  })
})
