import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider, useT, translate } from '../../src/lib/i18n'
import { en } from '../../src/lib/i18n/packs/en'
import { PACKS } from '../../src/lib/i18n/packs'
import { LOCALES, type Locale } from '../../src/lib/i18n/types'

/**
 * The acceptance journey, asserted on rendered text.
 *
 * Each block stands for a screen a member actually walks through: the public
 * landing before any account exists, the sign-in page, the dashboard, the
 * marketplace, the cart and Settings. The assertion is always the same shape —
 * mount, read the DOM, compare the words — because the failure this is written
 * to catch is "the selector changed and the page did not".
 *
 * Where a language has no entry, the test asserts the ENGLISH appears. That is
 * the designed fallback and it is as important to prove as a translation: it is
 * the difference between a component that is wired and merely untranslated, and
 * a component that bypassed i18n altogether.
 */

function Screen({ keys }: { keys: string[] }) {
  const { t } = useT()
  return (
    <ul>
      {keys.map((k) => (
        <li key={k} data-testid={k}>{t(k)}</li>
      ))}
    </ul>
  )
}

function renderIn(locale: Locale, keys: string[]) {
  return render(
    <LanguageProvider explicitLocale={locale}><Screen keys={keys} /></LanguageProvider>,
  )
}

const read = (k: string) => screen.getByTestId(k).textContent ?? ''

afterEach(() => {
  cleanup()
  try { localStorage.clear() } catch { /* ignore */ }
})

/** Screens, and the keys that carry their visible chrome. */
const SCREENS: Record<string, string[]> = {
  'public landing': ['public.heroTitle', 'public.howItWorks', 'public.whoItsFor', 'public.getStarted', 'public.disclaimer'],
  'public shell': ['public.signIn', 'public.deliverTo', 'public.allCategories', 'common.search'],
  'login': ['auth.signIn', 'auth.email', 'auth.password', 'auth.forgotPassword'],
  'dashboard': ['nav.overview', 'dashboard.marketToday', 'dashboard.farms', 'common.signOut'],
  'marketplace': ['marketplace.title', 'marketplace.allCategories', 'marketplace.addToCart', 'marketplace.category'],
  'cart': ['cart.yourCart', 'cart.isEmpty', 'cart.proceedToCheckout', 'cart.continueShopping'],
  'settings': ['settings.title', 'settings.language', 'settings.yourRoles', 'settings.username'],
  'financing': ['financing.title', 'financing.notALender', 'financing.status.approved'],
  'transaction': ['transaction.title', 'transaction.amount', 'financial.custodyNote'],
  'verification': ['verification.title', 'verification.verified', 'verification.declared'],
  'logistics': ['logistics.title', 'logistics.status.in_transit', 'logistics.confirmDelivery'],
  'warehouse': ['warehouse.title', 'warehouse.reservations', 'warehouse.capacity'],
  'notifications': ['notifications.title', 'notifications.empty'],

  // Phase 7 additions. The acceptance list names fifteen surfaces, and these
  // are the ones the journey did not reach: the two institutional portals and
  // a role-specific operational screen.
  //
  // These are held to the SAME bar as the rest -- never blank, never a key
  // name, and an untranslated key must render the English rather than
  // nothing. They are NOT held to "must differ from English", because the
  // bank portal is deliberately left in English for Igbo and Yoruba (its
  // users are institutional staff working in English or French) and asserting
  // otherwise would be asserting a translation that was declined on purpose.
  'bank portal': ['financing.bank.requestedFacility', 'financing.bank.recordedDecision', 'financing.bank.decisionTrail'],
  'admin': ['nav.overview', 'common.search', 'common.filter', 'common.save'],
  'field operations': ['verification.fieldOps.myWork', 'verification.fieldOps.claim', 'verification.taskState.approved'],
  'checkout': ['checkout.title', 'checkout.placeOrder', 'checkout.paymentPartnerNote', 'checkout.totalToPay'],
  'auth - reset': ['auth.setNewPassword', 'auth.newPassword', 'auth.updatePassword'],
  'footer': ['footer.language', 'footer.privacy', 'footer.imageCredits'],
  'payout': ['payout.title', 'payout.bankName', 'payout.accountNumber'],

  /* Wave A.1. The browse -> listing -> save -> cart -> checkout path, which is
     the journey a buyer actually walks. Unlike the institutional surfaces
     above, these ARE held to "must differ from English" by the dedicated
     suite in marketplace-checkout-i18n.test.tsx: this wave translated them in
     all five languages, so a fallback here is a regression, not a decision. */
  'marketplace browse': ['marketplace.sort.recommended', 'marketplace.loadMore', 'marketplace.searchListings', 'marketplace.noListingsMatchShort'],
  'marketplace card': ['marketplace.add', 'marketplace.addToCartAria', 'marketplace.saveForLater', 'marketplace.inCart'],
  'listing detail': ['marketplace.backToMarketplace', 'marketplace.quantityAvailableLabel', 'marketplace.expressInterest', 'marketplace.contactAfterAccept'],
  'saved items': ['marketplace.savedItems', 'marketplace.noSavedListings', 'marketplace.remove'],
  'checkout page': ['checkout.title', 'checkout.deliverToState', 'checkout.totalToPay', 'checkout.placeOrder', 'checkout.backToCart'],
  'checkout errors': ['checkout.couldNotComplete', 'checkout.couldNotStartFinancing', 'checkout.emptyCart'],
}

describe('every journey screen renders through i18n, in every language', () => {
  for (const [screenName, keys] of Object.entries(SCREENS)) {
    it(`${screenName}: never blank, never a key name, in all five languages`, () => {
      for (const loc of LOCALES) {
        renderIn(loc, keys)
        for (const k of keys) {
          const text = read(k)
          expect(text.trim().length, `${loc}:${screenName}:${k}`).toBeGreaterThan(0)
          // A key name on screen means the lookup broke.
          expect(text, `${loc}:${screenName}:${k}`).not.toBe(k)
        }
        cleanup()
      }
    })

    it(`${screenName}: an absent translation falls back to English, not to nothing`, () => {
      for (const loc of LOCALES) {
        for (const k of keys) {
          const inPack = (PACKS[loc] as Record<string, string | undefined>)[k]
          if (inPack === undefined) {
            // Wired but untranslated: it must render the canonical English.
            expect(translate(loc, k), `${loc}:${k}`).toBe(en[k as keyof typeof en])
          }
        }
      }
    })
  }
})

describe('the public surface actually changes language', () => {
  const keys = SCREENS['public landing']

  it('renders English as the canonical baseline', () => {
    renderIn('en', keys)
    expect(read('public.heroTitle')).toBe('The Operating System for Agriculture')
    expect(read('public.howItWorks')).toBe('How it works')
  })

  it('renders Hausa before any account exists', () => {
    renderIn('ha', keys)
    expect(read('public.heroTitle')).toBe('Tsarin Aiki na Noma')
    expect(read('public.howItWorks')).toBe('Yadda yake aiki')
    expect(read('public.getStarted')).toBe('Fara')
  })

  it('renders French', () => {
    renderIn('fr', keys)
    expect(read('public.heroTitle')).toContain("système d'exploitation")
    expect(read('public.howItWorks')).toBe('Comment ça marche')
  })

  it('renders Igbo', () => {
    renderIn('ig', keys)
    expect(read('public.heroTitle')).toContain('Ọrụ Ugbo')
    expect(read('public.howItWorks')).toBe('Otu ọ si arụ ọrụ')
  })

  it('renders Yoruba, with diacritics intact', () => {
    renderIn('yo', keys)
    expect(read('public.heroTitle')).toContain('Àgbẹ̀')
    expect(read('public.howItWorks')).toBe('Bí ó ṣe ń ṣiṣẹ́')
  })

  it('keeps the lender disclaimer complete in every language that translates it', () => {
    for (const loc of LOCALES) {
      renderIn(loc, keys)
      const text = read('public.disclaimer')
      expect(text.length, loc).toBeGreaterThan(40)
      if (text !== en['public.disclaimer']) {
        // A translated disclaimer must still say Loamy does not lend.
        // Each language's own word for lending. Igbo "agbazinye ego" and
        // Yoruba "yá owó" both say it; neither matched the pattern this
        // started as, so a correct translation read as a dropped clause.
        expect(text, `${loc} dropped the lender claim`)
          .toMatch(/pr[êe]teur|rance|lender|agbazinye|y[áa] ow[óo]/i)
      }
      cleanup()
    }
  })
})

describe('business data is never translated by the interface', () => {
  function WithData() {
    const { t, money } = useT()
    return (
      <div>
        <p data-testid="seller">{t('marketplace.listingBy', { seller: 'Sahel Grains Ltd' })}</p>
        <p data-testid="ref">TXN-000190</p>
        <p data-testid="commodity">Maize</p>
        <p data-testid="money">{money(95000)}</p>
      </div>
    )
  }

  it('passes names, references, commodity data and money through untouched', () => {
    for (const loc of LOCALES) {
      render(<LanguageProvider explicitLocale={loc}><WithData /></LanguageProvider>)
      expect(screen.getByTestId('seller').textContent, loc).toContain('Sahel Grains Ltd')
      expect(screen.getByTestId('ref').textContent, loc).toBe('TXN-000190')
      expect(screen.getByTestId('commodity').textContent, loc).toBe('Maize')
      expect(screen.getByTestId('money').textContent, loc).toContain('95,000')
      cleanup()
    }
  })
})
