import { describe, expect, it } from 'vitest'
import { en } from '../../src/lib/i18n/packs/en'
import { PACKS } from '../../src/lib/i18n/packs'
import { translate } from '../../src/lib/i18n'
import { pluralKey } from '../../src/lib/i18n/format'
import { LOCALES } from '../../src/lib/i18n/types'
import {
  FOREIGN_PLURAL_SUFFIXES, interpolatedPrefixes, isReferenceKey, literalCalls, placeholders,
  pluralBases,
} from '../../scripts/lib/i18n-contract.mjs'

/**
 * THE LOCALIZATION CONTRACT
 *
 *     APPLICATION SOURCE -> LOOKUP ENGINE -> CANONICAL KEY -> LOCALE PACK
 *
 * All four layers must agree. This file asserts that they do, in that
 * direction, using the ENGINE the application actually calls.
 *
 * WHY THE DIRECTION IS THE WHOLE POINT
 *   Wave A.3 found three key families written as `base_one` / `base_other`,
 *   which is i18next's convention and not this engine's: `pluralKey()` returns
 *   the bare base for the `one` category and `base_plural` for `other`. Every
 *   one of those lookups missed, and a member on the orders screen read the
 *   literal text "transaction.orderPlaced_plural" -- in English as much as in
 *   the other four languages.
 *
 *   Five parity tests were green at the time. ALL of them compared pack to
 *   pack. The packs agreed with each other perfectly and all of them disagreed
 *   with the code, so pack parity could not see it by construction, and no
 *   amount of further parity testing would have.
 *
 *   So this starts from the source, takes the key the application passes, and
 *   requires the engine to resolve it. The pack is data here, not the
 *   authority.
 *
 * WHY THE EXTRACTION IS SHARED
 *   `scripts/lib/i18n-contract.mjs`. Waves A.1 to A.4 each grew their own
 *   scanner inside the test that needed it, so each was wrong in its own way
 *   and fixing one fixed one. The reporting scripts read the same module, so a
 *   scanner bug is now a bug in one file.
 */

const WORDS = en as Record<string, string>
const CANONICAL = new Set(Object.keys(WORDS))
const CALLS = literalCalls()
const PREFIXES = interpolatedPrefixes()
const PLURAL_BASES = [...pluralBases()].filter((b) => b.includes('.'))

describe('the contract is being measured at all', () => {
  it('finds the call sites, the prefixes and the counted keys', () => {
    // A collapse here after a refactor would leave every assertion below
    // passing while proving nothing.
    expect(CALLS.length, 'no translator calls found in src').toBeGreaterThan(1000)
    expect(PREFIXES.length, 'no runtime-built keys found').toBeGreaterThan(10)
    expect(PLURAL_BASES.length, 'no counted keys found').toBeGreaterThan(5)
  })

  it('the canonical pack and the runtime registry are the same object', () => {
    // `TranslationKey` is derived from `en`, and `PACKS.en` is what the engine
    // reads. If those ever diverge, a key can typecheck and not resolve.
    expect(Object.keys(PACKS.en).length).toBe(CANONICAL.size)
    for (const k of CANONICAL) {
      expect((PACKS.en as Record<string, string>)[k], `${k} missing from the registry`)
        .toBeDefined()
    }
  })
})

describe('layer 1 to 3: source -> engine -> canonical key', () => {
  it('every literal key the application passes exists in canonical English', () => {
    // Catches a typo, a key never added, and a key left behind by a rename.
    const offenders = [...new Set(CALLS
      .filter((c) => c.fn !== 'tPlural' && !CANONICAL.has(c.key))
      .map((c) => `${c.file}:${c.line} ${c.fn}('${c.key}')`))]
    expect(
      offenders,
      `${offenders.length} call site(s) ask for a key that does not exist:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('every literal key RESOLVES through the engine, not merely exists', () => {
    // Membership of the pack object and resolution through `translate()` are
    // two different claims. This asserts the second, in English, where a
    // fallback cannot hide a miss.
    const offenders = [...new Set(CALLS
      .filter((c) => c.fn !== 'tPlural')
      .filter((c) => {
        const out = translate('en', c.key)
        return out === c.key || out.trim() === ''
      })
      .map((c) => `${c.file}:${c.line} ${c.fn}('${c.key}') rendered its own key`))]
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('every runtime-built key prefix matches a real namespace', () => {
    // The namespace typo: `financing.banks.` where the pack says
    // `financing.bank.`. The prefix is never itself a key, so the only
    // checkable claim is that something lives under it.
    const offenders = [...new Set(PREFIXES
      .filter((p) => ![...CANONICAL].some((k) => k.startsWith(p.prefix)))
      .map((p) => `${p.file}:${p.line} builds keys under '${p.prefix}' and nothing exists there`))]
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

describe('layer 2: the plural convention the engine actually implements', () => {
  it('no canonical key uses a suffix the engine cannot produce', () => {
    const unreachable = [...CANONICAL].filter(
      (k) => FOREIGN_PLURAL_SUFFIXES.some((s: string) => k.endsWith(s)))
    expect(
      unreachable,
      `these keys can never be reached by pluralKey():\n${unreachable.join('\n')}`,
    ).toEqual([])
  })

  it('every counted key resolves for every count in every locale', () => {
    /**
     * Run through the REAL `pluralKey`, not a copy of its rule. Hausa and
     * French split at one like English; Igbo and Yoruba have a single
     * category, so for them even a count of one resolves to `_plural`. That
     * is why the `_plural` form has to read naturally for one as well as many.
     */
    const PROBE = [0, 1, 2, 5, 11, 21, 100]
    const missing = new Set<string>()
    for (const base of PLURAL_BASES) {
      for (const loc of LOCALES) {
        for (const n of PROBE) {
          const key = pluralKey(base, n, loc)
          if (!CANONICAL.has(key)) missing.add(`${key} (from ${base}, ${loc}, count ${n})`)
        }
      }
    }
    expect([...missing], [...missing].join('\n')).toEqual([])
  })

  it('no pack carries an orphan plural form', () => {
    // A `_plural` key whose base is not a counted key is either a rename that
    // was half-finished or a translator inventing a form. Either way nothing
    // will ever ask for it, and it inflates the coverage number.
    const counted = new Set(PLURAL_BASES)
    const orphans: string[] = []
    for (const loc of LOCALES) {
      for (const key of Object.keys(PACKS[loc])) {
        if (!key.endsWith('_plural')) continue
        const base = key.slice(0, -'_plural'.length)
        // Reference vocabulary is unreferenced on purpose. See
        // REFERENCE_NAMESPACES: `term.*` is terminology that appears INSIDE
        // other strings, and nothing calls t('term.commodity') directly.
        if (isReferenceKey(base)) continue
        if (!counted.has(base)) orphans.push(`${loc}: ${key}`)
      }
    }
    expect(orphans, `orphan plural forms:\n${orphans.join('\n')}`).toEqual([])
  })
})

describe('layer 3 to 4: the interpolation contract', () => {
  /**
   * A dropped placeholder is the one translation failure that silently removes
   * information rather than garbling it: `Release {amount}` losing `{amount}`
   * leaves a button that no longer says how much money it moves.
   */
  it('every call site supplies the variables its English declares', () => {
    const offenders: string[] = []
    let checked = 0
    let unjudgeable = 0

    for (const c of CALLS) {
      const english = WORDS[c.key]
      if (!english) continue
      const implicit = c.fn === 'tPlural' ? ['count'] : []
      const needed = placeholders(english).filter((w: string) => !implicit.includes(w))
      if (!needed.length) continue
      if (!c.judgeable) { unjudgeable++; continue }
      checked++
      const supplied: string[] = c.vars ?? []
      const missing = needed.filter((w: string) => !supplied.includes(w))
      if (missing.length) {
        offenders.push(`${c.file}:${c.line} ${c.fn}('${c.key}') is missing {${missing.join('} {')}}`)
      }
    }

    // Guard the guard. If parsing degrades to where almost nothing is checked,
    // this test is decoration that reads as coverage.
    expect(checked, 'too few interpolated call sites were parseable to be meaningful')
      .toBeGreaterThan(40)
    expect(unjudgeable).toBeLessThan(checked)
    expect([...new Set(offenders)], offenders.join('\n')).toEqual([])
  })

  it('no call site supplies a variable the English does not declare', () => {
    /**
     * The other direction, and a weaker signal: a surplus variable renders
     * nothing and breaks nothing. It is still reported, because it means the
     * call site and the copy have drifted -- usually a placeholder removed
     * from the English and left at the call site, which is one edit away from
     * the reverse mistake.
     */
    const offenders: string[] = []
    for (const c of CALLS) {
      const english = WORDS[c.key]
      if (!english || !c.judgeable || !c.vars?.length) continue
      const declared = new Set([...placeholders(english), ...(c.fn === 'tPlural' ? ['count'] : [])])
      const surplus = c.vars.filter((v: string) => !declared.has(v))
      if (surplus.length) {
        offenders.push(
          `${c.file}:${c.line} ${c.fn}('${c.key}') passes {${surplus.join('} {')}}, which the English does not use`)
      }
    }
    expect([...new Set(offenders)], offenders.join('\n')).toEqual([])
  })

  it('no translation requires a variable the source cannot supply', () => {
    /**
     * The failure this catches is a translator's, not a developer's: a French
     * string that introduces `{montant}` where the English says `{amount}`
     * renders the literal text "{montant}" to a member, because nothing at the
     * call site supplies it. Compared as an interpolation CONTRACT, never as
     * prose.
     */
    const offenders: string[] = []
    for (const key of CANONICAL) {
      const declared = new Set(placeholders(WORDS[key]))
      for (const loc of LOCALES) {
        if (loc === 'en') continue
        const value = (PACKS[loc] as Record<string, string | undefined>)[key]
        if (value === undefined) continue // deliberate English fallback
        for (const v of placeholders(value)) {
          if (!declared.has(v)) {
            offenders.push(`${loc}:${key} uses {${v}}, which the English never declares`)
          }
        }
      }
    }
    expect([...new Set(offenders)], offenders.join('\n')).toEqual([])
  })

  it('no translation drops a variable the English declares', () => {
    const offenders: string[] = []
    for (const key of CANONICAL) {
      const declared = placeholders(WORDS[key])
      if (!declared.length) continue
      for (const loc of LOCALES) {
        if (loc === 'en') continue
        const value = (PACKS[loc] as Record<string, string | undefined>)[key]
        if (value === undefined) continue
        const got = new Set(placeholders(value))
        const lost = declared.filter((v: string) => !got.has(v))
        if (lost.length) offenders.push(`${loc}:${key} dropped {${lost.join('} {')}}`)
      }
    }
    expect([...new Set(offenders)], offenders.join('\n')).toEqual([])
  })
})
