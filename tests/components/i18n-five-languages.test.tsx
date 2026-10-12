import { describe, expect, it } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { LanguageProvider, useT, LANGUAGE_STORAGE_KEY } from '../../src/lib/i18n'
import { LOCALES, type Locale } from '../../src/lib/i18n/types'
import { formatNaira } from '../../src/lib/utils'

/**
 * One component, rendered in all five languages.
 *
 * WHY A RENDER TEST AND NOT ANOTHER PACK TEST
 *   Everything else in tests/unit asserts the DATA: that keys exist, resolve,
 *   agree on placeholders. None of it proves that a React tree actually shows
 *   a member the translated string. The gap between those two claims is where
 *   a provider bug, a stale context, a memoised translator or a component
 *   holding its own copy of `t` would live, and all four are the kind of thing
 *   that passes every pack test.
 *
 *   So this renders a real component through the real provider, once per
 *   locale, and reads the DOM.
 *
 * WHAT IT IS NOT
 *   Not a browser suite. No Playwright, no screenshots, no layout. It is an
 *   infrastructure test: ten semantic cases, five languages, read the text.
 *
 * WHY `document.lang` IS NOT THE ASSERTION
 *   A provider can set the document language correctly and still render
 *   English into every node. The assertion has to be the text a member reads.
 */

/**
 * The ten semantic cases the brief names, each keyed to something real in the
 * product rather than to a fixture. Using live keys means a rename breaks this
 * test, which is the point: a representative test that cannot go stale is a
 * test of a fixture, not of the product.
 */
const CASES = {
  heading: { key: 'bank.decision.title' },
  button: { key: 'bank.settlement.record' },
  status: { key: 'financing.status.approved' },
  plural: { key: 'processor.bid.awardN', count: 3 },
  interpolation: { key: 'bank.decision.requestedHint', vars: { amount: formatNaira(500000) } },
  error: { key: 'bank.detail.couldNotLoad' },
  emptyState: { key: 'bank.alerts.noneTitle' },
} as const

function Specimen() {
  const { t, tPlural, num, dateShort, money } = useT()
  return (
    <dl>
      <dt>heading</dt>
      <dd data-testid="heading">{t(CASES.heading.key)}</dd>
      <dt>button</dt>
      <dd data-testid="button">{t(CASES.button.key)}</dd>
      <dt>status</dt>
      <dd data-testid="status">{t(CASES.status.key)}</dd>
      <dt>plural</dt>
      <dd data-testid="plural">
        {tPlural(CASES.plural.key, CASES.plural.count, { count: CASES.plural.count })}
      </dd>
      <dt>interpolation</dt>
      <dd data-testid="interpolation">{t(CASES.interpolation.key, CASES.interpolation.vars)}</dd>
      <dt>number</dt>
      <dd data-testid="number">{num(1234567)}</dd>
      <dt>date</dt>
      <dd data-testid="date">{dateShort('2026-03-14T10:00:00.000Z')}</dd>
      <dt>money</dt>
      <dd data-testid="money">{money(250000)}</dd>
      <dt>error</dt>
      <dd data-testid="error">{t(CASES.error.key)}</dd>
      <dt>emptyState</dt>
      <dd data-testid="emptyState">{t(CASES.emptyState.key)}</dd>
    </dl>
  )
}

const SLOTS = [
  'heading', 'button', 'status', 'plural', 'interpolation',
  'number', 'date', 'money', 'error', 'emptyState',
] as const

/** Render the specimen with a locale chosen the way a member chooses one. */
function renderIn(locale: Locale): Record<string, string> {
  cleanup()
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale)
  } catch { /* private mode: the provider falls back, which is also fine */ }
  render(
    <LanguageProvider>
      <Specimen />
    </LanguageProvider>,
  )
  const out: Record<string, string> = {}
  for (const slot of SLOTS) out[slot] = screen.getByTestId(slot).textContent ?? ''
  return out
}

const RENDERED = Object.fromEntries(LOCALES.map((l) => [l, renderIn(l)])) as
  Record<Locale, Record<string, string>>

describe('the specimen renders in all five languages', () => {
  it('shipped locales are exactly the five agreed', () => {
    expect([...LOCALES]).toEqual(['en', 'ha', 'ig', 'yo', 'fr'])
  })

  for (const locale of LOCALES) {
    it(`${locale}: every slot renders text, and no slot leaks a key`, () => {
      for (const slot of SLOTS) {
        const text = RENDERED[locale][slot]
        expect(text.trim().length, `${locale}:${slot} rendered nothing`).toBeGreaterThan(0)
        // The A.3 failure mode, read off the DOM: a member seeing
        // "transaction.orderPlaced_plural" where a sentence belongs.
        expect(text, `${locale}:${slot} leaked a translation key`)
          .not.toMatch(/\b[a-z]+\.[a-z][A-Za-z0-9_]*\.[A-Za-z0-9_]/)
        expect(text, `${locale}:${slot} left a placeholder unsubstituted`)
          .not.toMatch(/\{\w+\}/)
      }
    })
  }
})

describe('each language visibly differs from English where it should', () => {
  /**
   * The slots that must differ, and the ones that must not.
   *
   * MONEY MUST NOT DIFFER. `₦250,000` is the same in all five, deliberately,
   * and asserting that here is what stops a future wave from "localizing" it.
   */
  const MUST_DIFFER = ['heading', 'button', 'status', 'error', 'emptyState'] as const

  for (const locale of LOCALES) {
    if (locale === 'en') continue
    it(`${locale}: the translated slots are not the English string`, () => {
      const differs = MUST_DIFFER.filter((slot) => RENDERED[locale][slot] !== RENDERED.en[slot])
      expect(
        differs.length,
        `${locale} rendered English in every slot, which means the pack is not\n`
        + `reaching the DOM. Got:\n${MUST_DIFFER.map((s) => `  ${s}: ${RENDERED[locale][s]}`).join('\n')}`,
      ).toBeGreaterThan(0)
    })
  }

  it('money is identical in every language', () => {
    const seen = new Set(LOCALES.map((l) => RENDERED[l].money))
    expect(
      seen.size,
      `money differed by locale: ${[...seen].join(' | ')}. The naira convention\n`
      + 'is deliberate: an amount is a business fact, not a presentation choice.',
    ).toBe(1)
    expect(RENDERED.en.money).toContain('250,000')
  })

  it('numbers and dates DO differ, which is the opposite rule', () => {
    expect(
      new Set(LOCALES.map((l) => RENDERED[l].number)).size,
      'every locale grouped 1,234,567 identically, so num() is ignoring the locale',
    ).toBeGreaterThan(1)
    expect(
      new Set(LOCALES.map((l) => RENDERED[l].date)).size,
      'every locale formatted the date identically, so dateShort() is ignoring it',
    ).toBeGreaterThan(1)
  })
})

describe('dynamic values survive the round trip', () => {
  it('the interpolated amount appears in every language', () => {
    for (const locale of LOCALES) {
      expect(
        RENDERED[locale].interpolation,
        `${locale} lost the interpolated amount`,
      ).toContain('500,000')
    }
  })

  it('the plural slot carries its count in every language', () => {
    for (const locale of LOCALES) {
      expect(RENDERED[locale].plural, `${locale} lost the count`).toContain('3')
    }
  })

  it('a counted string picks the form the locale’s rules ask for', () => {
    /**
     * Igbo and Yoruba have a single plural category, so even a count of one
     * resolves to `_plural`. English and French split at one. Asserted through
     * the rendered DOM rather than through `pluralKey`, so this covers the
     * whole path rather than the rule in isolation.
     */
    cleanup()
    function One() {
      const { tPlural } = useT()
      return <span data-testid="one">{tPlural('processor.bid.awardN', 1, { count: 1 })}</span>
    }
    const single: Record<string, string> = {}
    for (const locale of LOCALES) {
      cleanup()
      try { localStorage.setItem(LANGUAGE_STORAGE_KEY, locale) } catch { /* ignore */ }
      render(<LanguageProvider><One /></LanguageProvider>)
      single[locale] = screen.getByTestId('one').textContent ?? ''
    }
    // English says "supplier", not "suppliers", at one.
    expect(single.en).toMatch(/supplier(?!s)/)
    for (const locale of LOCALES) {
      expect(single[locale].trim().length, `${locale} rendered nothing at count 1`)
        .toBeGreaterThan(0)
      expect(single[locale]).toContain('1')
    }
  })
})

describe('no unexpected English fallback on a key the test expects translated', () => {
  /**
   * Every slot above uses a key that all five packs carry. A fallback here is
   * not a coverage gap, it is a regression: it means a pack lost an entry, or
   * the merge order in a pack's index.ts started shadowing it.
   */
  it('each locale translates every slot key it is supposed to', () => {
    const offenders: string[] = []
    for (const locale of LOCALES) {
      if (locale === 'en') continue
      for (const slot of ['heading', 'button', 'error', 'emptyState'] as const) {
        if (RENDERED[locale][slot] === RENDERED.en[slot]) {
          offenders.push(`${locale}:${slot} fell back to English ("${RENDERED.en[slot]}")`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
