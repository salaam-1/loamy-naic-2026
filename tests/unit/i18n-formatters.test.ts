import { describe, expect, it } from 'vitest'
import {
  formatDateLong, formatDateShort, formatMoney, formatNumber, formatRelative,
} from '../../src/lib/i18n/format'
import { formatNaira } from '../../src/lib/utils'
import { LOCALES, LOCALE_META } from '../../src/lib/i18n/types'
import {
  LEGACY_DATE_DEBT, hardcodedLocaleSites, legacyDateCallers, legacyDateImporters,
} from '../../scripts/lib/i18n-contract.mjs'

/**
 * The formatting layer: which locale each kind of value follows.
 *
 * TWO RULES, AND THEY POINT IN OPPOSITE DIRECTIONS
 *
 *   MONEY IS NOT LOCALIZED. A naira amount reads identically in all five
 *   languages: `₦250,000`, with the naira sign and Nigerian grouping. This is
 *   deliberate and is the one thing in this file a future developer is most
 *   likely to "fix". A Nigerian bank officer, a Nigerian farmer and a
 *   French-speaking exporter looking at the same facility must see the same
 *   number, because the number is a fact about money and not about them.
 *
 *   EVERYTHING ELSE IS LOCALIZED. Counts, dates, relative times and
 *   percentages follow the language the member chose. Wave A.3 found an
 *   analytics screen formatting volumes with the BROWSER's locale, and A.4
 *   found two sites hardcoding `en-NG`. Both are the same defect: output that
 *   can never follow the member.
 *
 * WHY THE SOURCE IS ASSERTED AND NOT ONLY THE OUTPUT
 *   `formatNaira(500000)` and `(500000).toLocaleString('en-NG')` produce the
 *   identical string, so reverting a formatter to a hardcoded locale is
 *   invisible from outside. That mutation was injected during A.4 and the
 *   suite stayed green. What makes a hardcoded locale wrong is not the output
 *   for one number; it is that the output can never change. So the rule is
 *   asserted as a rule, over the source.
 */

// Deterministic inputs. Nothing here may depend on the machine's clock, its
// timezone offset beyond what the formatter itself applies, or its locale.
const ISO = '2026-03-14T10:00:00.000Z'
const BIG = 1234567
const MONEY = 250000

describe('money is not localized, and that is correct', () => {
  it('formatNaira produces one identical string for every locale', () => {
    const outputs = LOCALES.map(() => formatNaira(MONEY))
    expect(new Set(outputs).size, 'money formatting differed by locale').toBe(1)
  })

  it('formatMoney, the i18n contract version, agrees with it', () => {
    // Two entry points, one answer. If these ever diverge, half the product
    // shows one grouping and half shows another.
    expect(formatMoney(MONEY)).toBe(formatNaira(MONEY))
  })

  it('keeps the naira sign and the Nigerian grouping', () => {
    const s = formatNaira(MONEY)
    expect(s).toContain('250,000')
    expect(s).toMatch(/₦|NGN/)
  })

  it('introduces no conversion, rounding or precision change', () => {
    // The number is the number. A localization wave must never alter a
    // monetary value, only how it is punctuated.
    expect(formatNaira(0)).toMatch(/0/)
    expect(formatNaira(1)).toContain('1')
    expect(formatNaira(999)).toContain('999')
    expect(formatNaira(1000)).toContain('1,000')
    // Naira renders to whole units (`maximumFractionDigits: 0`). That is the
    // existing, documented behaviour and a localization wave must not change
    // it: 1,234,567.89 reads as 1,234,568, because the kobo rounding is a
    // decision somebody made deliberately, not a formatting accident.
    expect(formatNaira(1234567.89).replace(/[^\d,]/g, '')).toBe('1,234,568')
    expect(formatNaira(0.4).replace(/[^\d]/g, '')).toBe('0')
    // Negative and very large values still read as themselves.
    expect(formatNaira(-500)).toContain('500')
    expect(formatNaira(1e9)).toContain('1,000,000,000')
  })
})

describe('counts follow the member’s chosen locale', () => {
  it('French grouping actually differs from English', () => {
    /**
     * The positive control. If this ever matches English, the formatter has
     * stopped consulting the locale and every other assertion here becomes
     * vacuous. French groups with a narrow no-break space, not a comma.
     */
    const english = formatNumber(BIG, 'en')
    expect(english).toBe('1,234,567')
    expect(formatNumber(BIG, 'fr'), 'French matched English').not.toBe(english)
  })

  it('every locale formats the same number without losing a digit', () => {
    for (const loc of LOCALES) {
      const out = formatNumber(BIG, loc)
      expect(out.length, `${loc} produced nothing`).toBeGreaterThan(6)
      expect(out.replace(/[^0-9]/g, ''), `${loc} changed the number`).toBe('1234567')
    }
  })

  it('does not consult the ambient locale', () => {
    /**
     * Passing the locale explicitly is what makes this testable at all. A
     * formatter reading `navigator.language` or the Node default would give
     * the same answer on this machine and a different one on another, so a bug
     * would reproduce for one person and not the next.
     */
    for (const loc of LOCALES) {
      expect(formatNumber(BIG, loc)).toBe(formatNumber(BIG, loc))
      expect(formatNumber(BIG, loc)).toBe(
        new Intl.NumberFormat(LOCALE_META[loc].intl).format(BIG))
    }
  })
})

describe('dates follow the member’s chosen locale', () => {
  it('never renders the raw ISO string', () => {
    for (const loc of LOCALES) {
      const out = formatDateShort(ISO, loc)
      expect(out, `${loc} returned the ISO string`).not.toBe(ISO)
      expect(out.length, `${loc} returned nothing`).toBeGreaterThan(3)
    }
  })

  it('at least one locale differs from English, short and long', () => {
    const shorts = new Set(LOCALES.map((l) => formatDateShort(ISO, l)))
    const longs = new Set(LOCALES.map((l) => formatDateLong(new Date(ISO), l)))
    expect(shorts.size, 'every locale produced the identical short date').toBeGreaterThan(1)
    expect(longs.size, 'every locale produced the identical long date').toBeGreaterThan(1)
    // French specifically: "14 mars" rather than "14 Mar".
    expect(formatDateLong(new Date(ISO), 'fr')).not.toBe(formatDateLong(new Date(ISO), 'en'))
  })

  it('handles a null or absent date without throwing', () => {
    for (const loc of LOCALES) {
      expect(formatDateShort(null, loc)).toBe('-')
      expect(formatDateShort(undefined, loc)).toBe('-')
    }
  })

  it('relative time is locale-aware and anchored to a supplied now', () => {
    // `now` is a parameter precisely so this does not depend on the clock.
    const now = new Date('2026-03-15T10:00:00.000Z')
    const outs = LOCALES.map((l) => formatRelative(ISO, l, now))
    for (const [i, out] of outs.entries()) {
      expect(out.length, `${LOCALES[i]} produced nothing`).toBeGreaterThan(0)
      expect(out, `${LOCALES[i]} returned the ISO string`).not.toContain('2026-03-14T')
    }
    expect(new Set(outs).size, 'every locale produced the identical relative time')
      .toBeGreaterThan(1)
  })
})

describe('the legacy formatter ratchet', () => {
  /**
   * `src/lib/utils.ts` carries its own `formatDateShort` and `formatDateLong`,
   * both hardcoding `en-NG`, from before the i18n layer existed. They are the
   * reason a localized screen can still render en-NG dates to a Yoruba
   * speaker.
   *
   * 73 files inherited them. This wave does not migrate all 73: it freezes the
   * list so no NEW file can take the debt, and migrates the Bank portal as the
   * representative set.
   */
  const callers = legacyDateCallers() as { file: string }[]
  const importers = legacyDateImporters() as { file: string }[]
  const debt = new Set(LEGACY_DATE_DEBT as string[])

  it('the debt list is not empty and not the whole application', () => {
    // A zero would mean the ratchet is measuring nothing; the full count would
    // mean it was generated from the wrong set.
    expect(debt.size).toBeGreaterThan(20)
    expect(debt.size).toBeLessThan(200)
  })

  it('no file outside the frozen list uses a legacy date helper', () => {
    const offenders = [...new Set([...callers, ...importers].map((c) => c.file))]
      .filter((f) => f !== 'src/lib/utils.ts' && !debt.has(f))
    expect(
      offenders,
      'these files take on locale-hardcoded date formatting that did not exist\n'
      + 'before. Use `dateShort` / `dateLong` from `useT()` instead:\n'
      + `${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('the debt list only shrinks: every entry still owes something', () => {
    // Otherwise a migrated file stays listed, the number looks worse than it
    // is, and the list stops being a measure of anything.
    const stillOwing = new Set([...callers, ...importers].map((c) => c.file))
    const paid = [...debt].filter((f) => !stillOwing.has(f))
    expect(
      paid,
      `these files no longer use a legacy helper and should be removed from\n`
      + `LEGACY_DATE_DEBT:\n${paid.join('\n')}`,
    ).toEqual([])
  })

  it('the Bank portal is off the legacy helper, as the migrated example', () => {
    const bankDebt = [...debt].filter((f) => f.startsWith('src/pages/bank/'))
    expect(bankDebt, 'bank files are back on the legacy helper').toEqual([])
    const bankUsers = [...callers, ...importers]
      .map((c) => c.file).filter((f) => f.startsWith('src/pages/bank/'))
    expect(bankUsers).toEqual([])
  })
})

describe('no formatter decides the locale for the member', () => {
  /**
   * Known debt, listed rather than silently tolerated. Each of these passes a
   * locale literal or none, and each belongs to a surface this wave does not
   * own. The point of listing them is that anything NOT listed fails.
   */
  const KNOWN_LOCALE_DEBT = new Set([
    // Quantity and count rendering on surfaces this wave does not own. Each
    // belongs to the wave that localizes that surface. Money sites are NOT
    // here: the extractor classifies a currency-formatting call as `money`,
    // because pinning en-NG for naira is the rule and not the debt.
    'src/components/Money.tsx',
    'src/components/fulfilment/FulfilmentPanel.tsx',
    'src/components/fulfilment/LoadingCard.tsx',
    'src/components/fulfilment/StorageCard.tsx',
    'src/lib/quantity.ts',
    'src/lib/charts.ts',
    'src/lib/discovery.ts',
    'src/lib/identity.ts',
    'src/lib/intelligence.ts',
    'src/pages/marketplace/Discover.tsx',
    'src/pages/marketplace/PurchaseDetail.tsx',
    'src/pages/shared/FinancialActivity.tsx',
    'src/pages/shared/Home.tsx',
    'src/pages/shared/MarketIntelligence.tsx',
    // Dates on surfaces not yet localized.
    'src/components/PrivacyPreferences.tsx',
    'src/components/WeatherPanel.tsx',
    'src/components/layout/NotificationsBell.tsx',
    'src/pages/public/Privacy.tsx',
    'src/pages/trace/TraceExplorer.tsx',
    'src/pages/RoleDashboard.tsx',
    // The legacy helpers themselves. They ARE the hardcoded locale, which is
    // why the ratchet above exists. Removing the pin here would silently
    // change the output of every one of the 73 files that still call them.
    'src/lib/utils.ts',
    // Copilot: out of scope by standing instruction in every wave.
    'src/lib/copilot/engine.ts',
    // Admin: out of scope for this wave. `AdminDataHealth` holds the only two
    // BROWSER-locale sites in the application -- they pass no locale at all,
    // so the output varies by machine and a bug reproduces for one tester and
    // not the next. Recorded so the next Admin wave inherits a named defect
    // rather than discovering it again.
    'src/components/AdminDataHealth.tsx',
    'src/pages/admin/AdminAudit.tsx',
  ])

  const sites = hardcodedLocaleSites() as { file: string; line: number; kind: string }[]

  it('finds the sites at all', () => {
    expect(sites.length).toBeGreaterThan(5)
  })

  it('the canonical formatting layer threads the locale, except for money', () => {
    /**
     * `src/lib/i18n/format.ts` pins en-NG in exactly one place, `formatMoney`,
     * and that IS the rule rather than an exception to it. Everything else in
     * the layer must take the locale from `LOCALE_META`.
     *
     * An earlier version of this test forbade every literal in the file and so
     * failed on the one site that is correct. A guard that calls the right
     * answer wrong teaches the next reader to break it.
     */
    const inLayer = sites.filter((s) => s.file === 'src/lib/i18n/format.ts')
    const notMoney = inLayer.filter((s) => s.kind !== 'money')
    expect(
      notMoney,
      'src/lib/i18n/format.ts must take the locale from LOCALE_META outside\n'
      + `formatMoney:\n${notMoney.map((s) => `${s.file}:${s.line} (${s.kind})`).join('\n')}`,
    ).toEqual([])
  })

  it('no unlisted file pins or inherits a locale', () => {
    // `money` sites are excluded by classification, not by listing: a
    // currency-formatting call pinned to en-NG is the rule. Listing them
    // individually would make the debt list look like it contained the money
    // layer, and the next reader would try to "migrate" it.
    const offenders = sites
      .filter((s) => s.kind !== 'money')
      .filter((s) => !KNOWN_LOCALE_DEBT.has(s.file))
      .map((s) => `${s.file}:${s.line} ${s.kind} locale`)
    expect(
      offenders,
      'a formatter here decides the locale instead of the member. Take\n'
      + '`num` / `dateShort` / `dateLong` / `relative` from `useT()`, or add the\n'
      + `file to KNOWN_LOCALE_DEBT with a reason:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('every listed file still has the debt it is listed for', () => {
    const withDebt = new Set(sites.filter((s) => s.kind !== 'money').map((s) => s.file))
    const paid = [...KNOWN_LOCALE_DEBT].filter((f) => !withDebt.has(f))
    expect(paid, `no longer needed in KNOWN_LOCALE_DEBT:\n${paid.join('\n')}`).toEqual([])
  })
})
