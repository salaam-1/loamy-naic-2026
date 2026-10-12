import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider, useT } from '../../src/lib/i18n'
import { LOCALE_META, type Locale } from '../../src/lib/i18n/types'
import { PACKS, REVIEW_STATUS } from '../../src/lib/i18n/packs'

/**
 * Does the INTERFACE actually render in each language?
 *
 * A pack that loads is not a language that works. Every assertion here reads
 * text out of the DOM after rendering, and the expected strings are the exact
 * ones a member would see. If a pack were emptied, these fail; if a pack were
 * merely present but unwired, these fail too.
 *
 * Where a language has no entry for a key, the test asserts the ENGLISH appears
 * — that is the designed fallback and it is as important to prove as the
 * translation itself.
 */

/** A surface that touches every area the release claims to localize. */
function Surface() {
  const { t, locale, money, num, dateShort, dir } = useT()
  return (
    <div>
      <nav aria-label={t('a11y.mainNavigation')}>
        <span data-testid="nav-marketplace">{t('nav.marketplace')}</span>
        <span data-testid="nav-settings">{t('nav.settings')}</span>
      </nav>
      <h1 data-testid="settings-language">{t('settings.language')}</h1>
      <button data-testid="save">{t('common.save')}</button>
      <button data-testid="signout">{t('common.signOut')}</button>
      <p data-testid="add-to-cart">{t('marketplace.addToCart')}</p>
      <p data-testid="amount">{t('transaction.amount')}</p>
      <p data-testid="verified">{t('verification.verified')}</p>
      <p data-testid="error">{t('error.generic')}</p>
      <p data-testid="validation">{t('validation.required')}</p>
      <p data-testid="not-a-lender">{t('financing.notALender')}</p>
      <p data-testid="custody">{t('financial.custodyNote')}</p>
      <p data-testid="seller">{t('marketplace.listingBy', { seller: 'Sahel Grains Ltd' })}</p>
      <p data-testid="money">{money(250000)}</p>
      <p data-testid="num">{num(1234)}</p>
      <p data-testid="date">{dateShort('2026-10-03T00:00:00Z')}</p>
      <p data-testid="locale">{locale}</p>
      <p data-testid="dir">{dir}</p>
    </div>
  )
}

function renderIn(locale: Locale) {
  return render(<LanguageProvider explicitLocale={locale}><Surface /></LanguageProvider>)
}

const text = (id: string) => screen.getByTestId(id).textContent ?? ''

afterEach(() => {
  cleanup()
  try { localStorage.clear() } catch { /* ignore */ }
})

// ---------------------------------------------------------------------------
// Per-language rendered assertions
// ---------------------------------------------------------------------------

describe('English renders English', () => {
  it('renders the canonical strings', () => {
    renderIn('en')
    expect(text('save')).toBe('Save')
    expect(text('nav-marketplace')).toBe('Marketplace')
    expect(text('settings-language')).toBe('Language')
    expect(text('amount')).toBe('Amount')
  })
})

describe('French renders French', () => {
  it('translates navigation, settings and actions', () => {
    renderIn('fr')
    expect(text('nav-marketplace')).toBe('Place de marché')
    expect(text('nav-settings')).toBe('Paramètres')
    expect(text('settings-language')).toBe('Langue')
    expect(text('save')).toBe('Enregistrer')
    expect(text('signout')).toBe('Se déconnecter')
  })

  it('translates marketplace, transaction and verification vocabulary', () => {
    renderIn('fr')
    expect(text('add-to-cart')).toBe('Ajouter au panier')
    expect(text('amount')).toBe('Montant')
    expect(text('verified')).toBe('Vérifié')
  })

  it('translates error and validation states', () => {
    renderIn('fr')
    expect(text('error')).toContain('Une erreur est survenue')
    expect(text('validation')).toContain('obligatoire')
  })

  it('carries the lender and custody assurances in full', () => {
    renderIn('fr')
    // Loamy is not a lender, and never says "prêt" for financing.
    expect(text('not-a-lender')).toContain("n'est pas un prêteur")
    expect(text('not-a-lender')).toContain('banques partenaires')
    expect(text('custody')).toContain('ne détient pas vos fonds')
  })
})

describe('Hausa renders Hausa', () => {
  it('translates navigation, settings and actions', () => {
    renderIn('ha')
    expect(text('nav-marketplace')).toBe('Kasuwa')
    expect(text('nav-settings')).toBe('Saiti')
    expect(text('settings-language')).toBe('Harshe')
    expect(text('save')).toBe('Ajiye')
    expect(text('signout')).toBe('Fita')
  })

  it('translates marketplace, transaction and verification vocabulary', () => {
    renderIn('ha')
    expect(text('add-to-cart')).toBe('Saka a kwando')
    expect(text('amount')).toBe('Adadi')
    expect(text('verified')).toBe('An tabbatar')
  })

  it('keeps the hooked letters rather than flattening them', () => {
    renderIn('ha')
    // ɓ ɗ ƙ are letters, not decoration. Flattening them changes the word.
    expect(text('add-to-cart')).toContain('kwando')
    expect(text('custody')).toContain('kuɗinka')
  })

  it('says financing, never loan, and carries the custody sentence', () => {
    renderIn('ha')
    expect(text('not-a-lender')).toContain('Loamy ba ya ba da rance')
    expect(text('not-a-lender')).toContain('Bankunan haɗin gwiwa')
    expect(text('custody')).toContain('Loamy ba ya riƙe kuɗinka')
  })
})

describe('Igbo renders Igbo', () => {
  it('translates navigation, settings and actions', () => {
    renderIn('ig')
    expect(text('nav-marketplace')).toBe('Ahịa')
    expect(text('nav-settings')).toBe('Ntọala')
    expect(text('settings-language')).toBe('Asụsụ')
    expect(text('save')).toBe('Chekwaa')
    expect(text('signout')).toBe('Pụọ')
  })

  it('translates marketplace, transaction and verification vocabulary', () => {
    renderIn('ig')
    expect(text('add-to-cart')).toBe('Tinye na nkata')
    expect(text('amount')).toBe('Ego')
    expect(text('verified')).toBe('Akwadoro')
  })

  it('keeps the sub-dot vowels', () => {
    renderIn('ig')
    expect(text('nav-marketplace')).toBe('Ahịa')   // not "Ahia"
    expect(text('settings-language')).toBe('Asụsụ') // not "Asusu"
  })

  it('falls back to English for financing, which is NOT translated', () => {
    renderIn('ig')
    // Honest state: the Igbo pack deliberately omits financing wording rather
    // than guessing on a screen about money.
    expect(text('not-a-lender')).toBe('Loamy is not a lender. Financing decisions are made by partner banks.')
    expect(text('custody')).toContain('Loamy does not hold your funds')
  })
})

describe('Yoruba renders Yoruba', () => {
  it('translates navigation, settings and actions', () => {
    renderIn('yo')
    expect(text('nav-marketplace')).toBe('Ọjà')
    expect(text('nav-settings')).toBe('Ètò')
    expect(text('settings-language')).toBe('Èdè')
    expect(text('save')).toBe('Fipamọ́')
    expect(text('signout')).toBe('Jáde')
  })

  it('translates marketplace, transaction and verification vocabulary', () => {
    renderIn('yo')
    expect(text('add-to-cart')).toBe('Fi sínú agbọ̀n')
    expect(text('amount')).toBe('Iye owó')
    expect(text('verified')).toBe('Ti jẹ́rìísí')
  })

  it('keeps tone marks and sub-dot vowels', () => {
    renderIn('yo')
    expect(text('nav-marketplace')).toBe('Ọjà')  // not "Oja"
    expect(text('save')).toBe('Fipamọ́')          // not "Fipamo"
    expect(text('settings-language')).toBe('Èdè') // not "Ede"
  })

  it('falls back to English for financing, which is NOT translated', () => {
    renderIn('yo')
    expect(text('not-a-lender')).toBe('Loamy is not a lender. Financing decisions are made by partner banks.')
  })
})

// ---------------------------------------------------------------------------
// Invariants that must survive every language
// ---------------------------------------------------------------------------

describe('invariants across all five languages', () => {
  const all: Locale[] = ['en', 'ha', 'ig', 'yo', 'fr']

  it('never renders blank for any asserted string', () => {
    for (const loc of all) {
      renderIn(loc)
      for (const id of ['save', 'nav-marketplace', 'settings-language', 'error', 'validation', 'not-a-lender', 'custody']) {
        expect(text(id).trim().length, `${loc}:${id}`).toBeGreaterThan(0)
      }
      cleanup()
    }
  })

  it('never renders a key name', () => {
    for (const loc of all) {
      renderIn(loc)
      for (const id of ['save', 'nav-marketplace', 'amount', 'verified', 'custody']) {
        expect(text(id), `${loc}:${id}`).not.toMatch(/^[a-z]+\.[a-zA-Z]/)
      }
      cleanup()
    }
  })

  it('keeps Naira identical in every language', () => {
    const seen = new Set<string>()
    for (const loc of all) {
      renderIn(loc)
      seen.add(text('money'))
      cleanup()
    }
    expect(seen.size, `money differed by language: ${[...seen].join(' | ')}`).toBe(1)
    expect([...seen][0]).toContain('250,000')
  })

  it('does not translate an interpolated business name', () => {
    for (const loc of all) {
      renderIn(loc)
      expect(text('seller'), loc).toContain('Sahel Grains Ltd')
      cleanup()
    }
  })

  it('keeps every language left-to-right for now', () => {
    for (const loc of all) {
      renderIn(loc)
      expect(text('dir'), loc).toBe('ltr')
      cleanup()
    }
  })

  it('updates document.lang so assistive technology follows', () => {
    for (const loc of all) {
      renderIn(loc)
      expect(document.documentElement.lang, loc).toBe(LOCALE_META[loc].code)
      cleanup()
    }
  })

  it('formats counts and dates per locale without throwing', () => {
    for (const loc of all) {
      renderIn(loc)
      expect(text('num').length, loc).toBeGreaterThan(0)
      expect(text('date').length, loc).toBeGreaterThan(0)
      expect(text('date'), loc).not.toBe('-')
      cleanup()
    }
  })
})

describe('switching language is a repaint, not a reload', () => {
  function Switcher() {
    const { t, setLocale, locale } = useT()
    return (
      <div>
        <p data-testid="save">{t('common.save')}</p>
        <p data-testid="locale">{locale}</p>
        <button onClick={() => setLocale('ha')}>ha</button>
        <button onClick={() => setLocale('fr')}>fr</button>
      </div>
    )
  }

  it('changes rendered text in place, with no remount and no sign-out', () => {
    render(<LanguageProvider><Switcher /></LanguageProvider>)
    expect(text('save')).toBe('Save')

    act(() => { screen.getByText('ha').click() })
    expect(text('save')).toBe('Ajiye')

    act(() => { screen.getByText('fr').click() })
    expect(text('save')).toBe('Enregistrer')
    expect(text('locale')).toBe('fr')
  })
})

describe('the product cannot overclaim', () => {
  it('records an honest review status for every pack', () => {
    expect(REVIEW_STATUS.en).toBe('canonical')
    // Nothing is 'canonical' but English, and nothing claims to be reviewed,
    // because no native-speaker review has happened.
    for (const loc of ['ha', 'ig', 'yo', 'fr'] as Locale[]) {
      expect(['unreviewed', 'partial'], loc).toContain(REVIEW_STATUS[loc])
    }
  })

  it('reports real key counts, which the coverage script must match', () => {
    expect(Object.keys(PACKS.fr).length).toBeGreaterThan(500)
    expect(Object.keys(PACKS.ha).length).toBeGreaterThan(300)
    // ig and yo are deliberately a core only. Asserting the shape stops a
    // future change from quietly claiming more than was translated.
    expect(Object.keys(PACKS.ig).length).toBeGreaterThan(100)
    expect(Object.keys(PACKS.yo).length).toBeGreaterThan(100)

    // Igbo and Yoruba are still PARTIAL, and the point of this assertion is
    // that the product cannot quietly claim otherwise. It used to be a magic
    // upper bound (548), which simply went stale the moment more was honestly
    // translated. The real invariant is the relationship: these two packs
    // carry less than the canonical English, so some keys still fall back.
    //
    // If one of them ever genuinely reaches parity, this fails and someone has
    // to say so on purpose rather than drift into the claim.
    const canonical = Object.keys(PACKS.en).length
    expect(Object.keys(PACKS.ig).length, 'ig now claims full coverage').toBeLessThan(canonical)
    expect(Object.keys(PACKS.yo).length, 'yo now claims full coverage').toBeLessThan(canonical)
  })
})
