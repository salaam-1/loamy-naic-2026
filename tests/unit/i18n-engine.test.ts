import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  clearMissingKeys, missingKeys, resolveLocale, translate, LANGUAGE_STORAGE_KEY,
} from '../../src/lib/i18n'
import { en } from '../../src/lib/i18n/packs/en'
import { PACKS } from '../../src/lib/i18n/packs'
import { formatMoney, formatNumber, formatDateShort, pluralKey } from '../../src/lib/i18n/format'
import { LOCALES, LOCALE_META, isLocale, matchBrowserLocale } from '../../src/lib/i18n/types'
import { pluralBases } from '../../scripts/lib/i18n-contract.mjs'

/**
 * The localization ENGINE, tested as behaviour rather than as a file listing.
 *
 * These are the invariants the whole feature rests on: a missing translation
 * renders English rather than nothing, money does not move when the language
 * does, and a browser preference never overrides a choice the member made.
 * Rendered-DOM coverage for each language lives in the component tests.
 */

const ROOT = join(__dirname, '..', '..')

beforeEach(() => {
  clearMissingKeys()
  try { localStorage.clear() } catch { /* node env */ }
})

describe('locale model', () => {
  it('ships exactly the five agreed languages', () => {
    expect([...LOCALES]).toEqual(['en', 'ha', 'ig', 'yo', 'fr'])
  })

  it('carries direction for every locale, so RTL later is data not surgery', () => {
    for (const l of LOCALES) expect(LOCALE_META[l].dir).toBe('ltr')
  })

  it('names each language in its own words, never a translation of the name', () => {
    expect(LOCALE_META.fr.endonym).toBe('Français')
    expect(LOCALE_META.yo.endonym).toBe('Yorùbá')
  })

  it('rejects anything that is not a shipped locale', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('de')).toBe(false)
    expect(isLocale('')).toBe(false)
    expect(isLocale(null)).toBe(false)
  })
})

describe('browser language mapping', () => {
  it('maps a regional tag onto the base language', () => {
    expect(matchBrowserLocale(['fr-CA'])).toBe('fr')
    expect(matchBrowserLocale(['ha-NG'])).toBe('ha')
  })

  it('returns null for a language Loamy does not ship, rather than guessing', () => {
    expect(matchBrowserLocale(['de-DE', 'pt-BR'])).toBeNull()
  })

  it('takes the first supported entry from an ordered preference list', () => {
    expect(matchBrowserLocale(['de-DE', 'yo-NG', 'fr-FR'])).toBe('yo')
  })
})

describe('preference resolution order', () => {
  it('prefers the explicit saved preference above everything', () => {
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr') } catch { /* node */ }
    expect(resolveLocale('ig')).toBe('ig')
  })

  it('does NOT let a browser language displace an explicit choice', () => {
    // Someone who chose English on a Hausa phone meant English.
    expect(resolveLocale('en')).toBe('en')
  })

  it('falls back to English when there is no preference anywhere', () => {
    expect(resolveLocale(null)).toBe('en')
  })

  it('ignores a stored value that is not a shipped locale', () => {
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de') } catch { /* node */ }
    expect(resolveLocale(null)).toBe('en')
  })
})

describe('translation and fallback', () => {
  it('returns the English string for the canonical locale', () => {
    expect(translate('en', 'common.save')).toBe('Save')
  })

  it('falls back to English for a key the pack does not carry', () => {
    // Written against a key that is GENUINELY absent, found at run time. An
    // earlier version asserted this with 'common.save', which silently stopped
    // testing fallback the moment Hausa translated it.
    const absent = Object.keys(en).find((k) => !(k in PACKS.ha))
    expect(absent, 'Hausa now covers every key; point this at another pack').toBeTruthy()
    expect(translate('ha', absent!)).toBe(en[absent as keyof typeof en])
  })

  it('does NOT fall back for a key the pack does carry', () => {
    // The other half of the same promise: a translation that exists is used.
    expect(translate('ha', 'common.save')).toBe('Ajiye')
    expect(translate('fr', 'common.cancel')).toBe('Annuler')
  })

  it('never returns an empty string for a known key', () => {
    for (const key of Object.keys(en)) {
      for (const loc of LOCALES) {
        expect(translate(loc, key).length, `${loc}:${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('records the fallback so the gap is measurable', () => {
    const absent = Object.keys(en).find((k) => !(k in PACKS.ha))!
    translate('ha', absent)
    expect(missingKeys().ha ?? []).toContain(absent)
  })

  it('records nothing for English, which cannot fall back to itself', () => {
    translate('en', 'common.save')
    expect(missingKeys().en ?? []).toHaveLength(0)
  })

  it('returns the key, not blank, for a runtime-built key nobody defined', () => {
    expect(translate('en', 'status.somethingTheServerInvented')).toBe('status.somethingTheServerInvented')
  })
})

describe('interpolation', () => {
  it('substitutes named variables', () => {
    expect(translate('en', 'auth.welcomeBackNamed', { name: 'Amina' })).toBe('Welcome back, Amina')
  })

  it('leaves an unknown placeholder visible rather than printing undefined', () => {
    expect(translate('en', 'auth.welcomeBackNamed')).toContain('{name}')
  })

  it('does not translate the value it interpolates', () => {
    // A business name is data. It passes through exactly.
    const out = translate('en', 'marketplace.listingBy', { seller: 'Sahel Grains Ltd' })
    expect(out).toContain('Sahel Grains Ltd')
  })
})

describe('money does not move when the language does', () => {
  it('formats Naira identically in every locale', () => {
    const outputs = LOCALES.map(() => formatMoney(250000))
    expect(new Set(outputs).size, 'money formatting differed by locale').toBe(1)
  })

  it('keeps the Naira sign and the Nigerian grouping', () => {
    const s = formatMoney(250000)
    expect(s).toContain('250,000')
    expect(s).toMatch(/₦|NGN/)
  })

  it('introduces no conversion: the number is the number', () => {
    expect(formatMoney(250000)).toContain('250,000')
    expect(formatMoney(0)).toMatch(/0/)
  })
})

describe('locale-aware formatting that SHOULD vary', () => {
  it('formats plain counts per locale', () => {
    expect(formatNumber(1234, 'en')).toMatch(/1[,.\s]?234/)
    expect(formatNumber(1234, 'fr')).toMatch(/1[\s .]?234/)
  })

  it('formats dates without throwing for any shipped locale', () => {
    for (const l of LOCALES) {
      expect(formatDateShort('2026-10-03T00:00:00Z', l).length).toBeGreaterThan(0)
    }
  })

  it('returns a dash, not a crash, for a missing or invalid date', () => {
    expect(formatDateShort(null, 'en')).toBe('-')
    expect(formatDateShort('not-a-date', 'en')).toBe('-')
  })
})

describe('pluralisation uses locale rules, not n === 1', () => {
  /**
   * The rule, exercised on an arbitrary base: `pluralKey` is pure and does not
   * care whether the key exists.
   */
  it('selects the singular key for one', () => {
    expect(pluralKey('example.thing', 1, 'en')).toBe('example.thing')
  })

  it('selects a plural key for other counts', () => {
    expect(pluralKey('example.thing', 5, 'en')).toBe('example.thing_plural')
    expect(pluralKey('example.thing', 0, 'en')).toBe('example.thing_plural')
  })

  /**
   * Both forms exist for every counted string the application ACTUALLY uses,
   * derived from the source rather than named here.
   *
   * This assertion previously used `cart.items` as its example, which was
   * superseded by `a11y.addedToCartAnnouncement` in Phase 2 and deleted as
   * dead in A.5 -- at which point the test failed for a reason that had
   * nothing to do with pluralisation. An example that can rot is a test of the
   * example. The full per-locale, per-count version of this lives in
   * tests/unit/i18n-source-contract.test.ts.
   */
  it('both forms exist in the canonical pack for every counted string in use', () => {
    const bases = [...pluralBases()].filter((b: string) => b.includes('.'))
    expect(bases.length, 'no counted strings found in src').toBeGreaterThan(5)
    for (const base of bases) {
      expect(en[base as keyof typeof en], `${base} has no singular form`).toBeTruthy()
      expect(en[`${base}_plural` as keyof typeof en], `${base} has no plural form`).toBeTruthy()
    }
  })
})

describe('the canonical pack is well formed', () => {
  it('has no duplicate or empty values', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(typeof v, k).toBe('string')
      expect(v.length, k).toBeGreaterThan(0)
    }
  })

  it('covers the twenty glossary terms the product is built on', () => {
    for (const term of [
      'commodity', 'batch', 'harvest', 'farm', 'listing', 'transaction', 'financing',
      'verification', 'growthPartner', 'logistics', 'warehouse', 'exporter', 'processor',
      'buyer', 'trader', 'supplier', 'traceability', 'loading', 'delivery', 'settlement',
    ]) {
      expect(en[`term.${term}` as keyof typeof en], term).toBeTruthy()
    }
  })

  it('keeps the custody and lender assurances intact and complete', () => {
    expect(en['financial.custodyNote']).toContain('Loamy does not hold your funds')
    expect(en['financing.notALender']).toContain('not a lender')
    expect(en['financing.sandboxWarning']).toContain('not a credit decision')
  })
})

// ---------------------------------------------------------------------------
// Keys built at runtime must never reach the screen as themselves
// ---------------------------------------------------------------------------
describe('a key built from server data always has a fallback', () => {
  function tsxFiles(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`
      if (statSync(join(ROOT, rel)).isDirectory()) out.push(...tsxFiles(rel))
      else if (name.endsWith('.tsx')) out.push(rel)
    }
    return out
  }

  /**
   * The failure this exists for.
   *
   * Status vocabularies are looked up with the database's own value spliced
   * into the key: t(`financing.status.${app.status}`). That is correct right
   * up until the database holds a value this build has not heard of -- a new
   * lifecycle state, a legacy row -- and then `t` returns the key, and the
   * member reads "financing.status.some_new_state" on a screen about their
   * own money.
   *
   * `tOr(key, english)` is the fix: it falls back to the lib map's own
   * English, which is what the surface rendered before it was translated.
   * This asserts that every interpolated key goes through it.
   *
   * `tPlural` is exempt here: it derives its own suffix from a literal base,
   * so the base is still written out in the source. Whether that suffix
   * matches the pack is asserted in tests/unit/plural-keys.test.ts, because
   * for three key families it did not.
   *
   * SCOPED TO THE VOCABULARIES THE DATABASE FEEDS
   *   Not every interpolated key is a risk. `t(`public.pillar.${p.key}.title`)`
   *   on the landing page splices in a value from a constant array three lines
   *   above it, and every possible key is therefore present in the pack by
   *   construction. Flagging those would be noise, and noise is how a guard
   *   stops being read.
   *
   *   What IS a risk is a key built from a value the SERVER chose: a status, a
   *   state, an event type, a flag. Those are the namespaces listed below, and
   *   they are precisely the ones mirrored from the lib maps in glossary.md.
   */
  /**
   * Keys whose interpolated value comes from a constant in the same file, so
   * every key they can produce exists in the pack by construction.
   *
   * An ALLOWLIST rather than a pattern for the risky ones. The first version
   * of this guard tried to describe the dangerous namespaces with a regex and
   * matched none of them -- including the real offender it was written for --
   * so it passed while proving nothing. Listing what is safe fails closed: a
   * new interpolated key is flagged until somebody says why it is fine.
   */
  const LOCALLY_KEYED = [
    'public.pillar.',   // Landing: PILLARS, a const array in the file
    'public.step.',     // Landing: STEPS
    'role.',            // Landing: ROLES
    'public.role.',     // Landing: ROLES
  ]

  it('no component interpolates a server-chosen value into plain t()', () => {
    const offenders: string[] = []
    for (const file of tsxFiles('src')) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      // t(`...${...}...`) -- a template literal key with a substitution.
      for (const m of src.matchAll(/(?<![\w.])t\(`([^`]*\$\{[^`]*)`/g)) {
        if (LOCALLY_KEYED.some((prefix) => m[1].startsWith(prefix))) continue
        offenders.push(`${file}: ${m[0].slice(0, 64)}`)
      }
    }
    expect(
      offenders,
      'Use tOr(key, english) so an unrecognised value renders the English, '
        + `not the key:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
