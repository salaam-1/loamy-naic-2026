import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PublicListing } from '../../src/lib/marketplace'
import { LOCALES, type Locale } from '../../src/lib/i18n/types'

/**
 * The homepage storefront preview: bounded, and still a marketplace.
 *
 * WHY A RENDER TEST AS WELL AS THE SOURCE GUARD
 *   `tests/unit/homepage-bounded.test.ts` asserts the READ is bounded, which
 *   is the part that matters for page weight and is the part a careless change
 *   would widen. It cannot tell you what the page looks like when the read
 *   returns nothing, or five rows, or more rows than the cap.
 *
 *   This renders the real component and counts cards. The two together are the
 *   claim: twelve rows cross the wire, and at most twelve reach the screen.
 *
 * WHAT IS MOCKED AND WHY
 *   Supabase and the cart/auth contexts. The point of the test is the
 *   component's own behaviour at each data boundary, and a real client would
 *   make it a test of staging's row count.
 */

// jsdom ships no matchMedia, and StorefrontHero asks it whether motion is
// reduced. Same stub the ux-polish suite uses.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
})

// --- a listing that looks like the view's output ----------------------------
function listing(n: number): PublicListing {
  return {
    id: `l${n}`,
    listing_ref: `LST-${n}`,
    commodity: ['Maize', 'Sorghum', 'Cowpea', 'Rice'][n % 4],
    listing_type: 'commodity',
    quantity: 100 + n,
    unit: 'tonne',
    price_per_unit: 90000 + n,
    currency: 'NGN',
    state: ['Kano', 'Kaduna', 'Oyo'][n % 3],
    lga: null,
    photos: [],
    created_at: `2026-03-${String((n % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
    seller_display_name: `Seller ${n}`,
    seller_category: null,
    seller_verified: n % 2 === 0,
    seller_username: null,
    quality_grade: null,
    claim_basis: n % 3 === 0 ? 'batch_backed' : 'seller_declared',
    batch_ref: null,
    verification_status: n % 3 === 0 ? 'verified' : 'unverified',
    origin_traced: n % 3 === 0,
    origin_state: n % 3 === 0 ? 'Kano' : null,
  }
}

/** What the mocked listings read returns next. */
let listingRows: PublicListing[] = []
/** Every limit the component asked the database for, in order. */
let requestedLimits: number[] = []
/** Every column list it asked for. */
let requestedSelects: string[] = []

vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['select', 'in', 'eq', 'or', 'order']) {
      chain[m] = (arg: unknown) => {
        if (m === 'select' && typeof arg === 'string') requestedSelects.push(arg)
        return self()
      }
    }
    chain.limit = (n: number) => {
      requestedLimits.push(n)
      // The database never returns more than it was asked for. Honouring the
      // limit here is what makes "fewer than the cap" and "more than the cap"
      // distinguishable cases rather than the same one.
      const rows = table === 'loamy_public_listings' && requestedSelects.at(-1) === 'commodity'
        ? listingRows.map((l) => ({ commodity: l.commodity }))
        : listingRows.slice(0, n)
      return Promise.resolve({ data: rows, error: null })
    }
    return chain
  }
  return { supabase: { from: (table: string) => builder(table) } }
})

const addToCart = vi.fn()
const toggleWishlist = vi.fn()
// The shared card renders both AddToCartButton and WishlistHeart, so the cart
// context has to answer for the wishlist too: omitting `isWishlisted` threw
// inside the card and the grid rendered nothing at all.
vi.mock('@/context/CartContext', () => ({
  useCart: () => ({
    inCart: () => false,
    addToCart,
    isWishlisted: () => false,
    toggleWishlist,
    cartCount: 0,
    cartBump: 0,
  }),
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile: { id: 'u1' }, loading: false }),
}))
vi.mock('@/components/DailyPricesPanel', () => ({ DailyPricesPanel: () => null }))

const { default: PublicMarketplace } = await import('../../src/pages/public/PublicMarketplace')
const { LanguageProvider } = await import('../../src/lib/i18n')
const { HOMEPAGE_MARKETPLACE_LIMIT } = await import('../../src/lib/marketplace')
const { LANGUAGE_STORAGE_KEY } = await import('../../src/lib/i18n')

function renderPreview(locale: Locale = 'en', preview = true) {
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, locale) } catch { /* private mode */ }
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <PublicMarketplace preview={preview} />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

/**
 * Cards link to `/marketplace/:id`, so counting them needs a prefix match that
 * excludes the CTA's own `/marketplace`. Getting that wrong counts the CTA as a
 * thirteenth card, which is exactly the number this file exists to police.
 */
function cardLinks(): HTMLElement[] {
  return screen.queryAllByRole('link').filter((a) => {
    const href = a.getAttribute('href') ?? ''
    return href.startsWith('/marketplace/') && href.length > '/marketplace/'.length
  })
}

function cardCount(): number {
  return cardLinks().length
}

/**
 * The preview CTA, by test id.
 *
 * Matching on `href === '/marketplace'` alone found the SHARED HEADER's
 * "Marketplace" nav link, which exists on every public page and is not the
 * CTA. The test then passed on /marketplace, where the whole point is that no
 * CTA renders.
 */
function ctaLink(): HTMLElement | null {
  return screen.queryByTestId('preview-cta') ?? screen.queryByTestId('preview-cta-empty')
}

beforeEach(() => {
  listingRows = []
  requestedLimits = []
  requestedSelects = []
  addToCart.mockClear()
})
afterEach(cleanup)

describe('the read is bounded at twelve', () => {
  it('asks the database for exactly the cap, never more', async () => {
    listingRows = Array.from({ length: 40 }, (_, i) => listing(i))
    renderPreview()
    await waitFor(() => expect(cardCount()).toBeGreaterThan(0))
    const listingLimits = requestedLimits.filter((n) => n !== 2000)
    expect(listingLimits.length, 'no listings read happened').toBeGreaterThan(0)
    for (const n of listingLimits) {
      expect(n, `the homepage asked for ${n} rows`).toBeLessThanOrEqual(HOMEPAGE_MARKETPLACE_LIMIT)
    }
  })

  it('cannot render a thirteenth card even when the table has forty rows', async () => {
    listingRows = Array.from({ length: 40 }, (_, i) => listing(i))
    renderPreview()
    await waitFor(() => expect(cardCount()).toBeGreaterThan(0))
    expect(cardCount()).toBe(HOMEPAGE_MARKETPLACE_LIMIT)
  })

  it('selects named columns, not a star', async () => {
    listingRows = [listing(1)]
    renderPreview()
    await waitFor(() => expect(requestedSelects.length).toBeGreaterThan(0))
    for (const sel of requestedSelects) expect(sel).not.toContain('*')
  })

  it('the full marketplace is NOT capped at twelve', async () => {
    listingRows = Array.from({ length: 40 }, (_, i) => listing(i))
    renderPreview('en', false)
    await waitFor(() => expect(cardCount()).toBeGreaterThan(0))
    expect(
      Math.max(...requestedLimits.filter((n) => n !== 2000)),
      '/marketplace lost its browse limit',
    ).toBeGreaterThan(HOMEPAGE_MARKETPLACE_LIMIT)
  })
})

describe('each data boundary renders truthfully', () => {
  it('zero listings renders the existing empty state and no cards', async () => {
    listingRows = []
    renderPreview()
    await waitFor(() => expect(ctaLink()).toBeTruthy())
    expect(cardCount()).toBe(0)
    // The existing truthful empty state, not a fabricated one.
    expect(screen.queryAllByText(/listings appear here|no listings/i).length)
      .toBeGreaterThan(0)
    // No placeholder that could be mistaken for a real listing.
    expect(screen.queryByText(/sample|example|coming soon|lorem/i)).toBeNull()
  })

  it('fewer than twelve renders only what exists', async () => {
    listingRows = Array.from({ length: 5 }, (_, i) => listing(i))
    renderPreview()
    await waitFor(() => expect(cardCount()).toBeGreaterThan(0))
    expect(cardCount()).toBe(5)
  })

  it('exactly twelve renders exactly twelve', async () => {
    listingRows = Array.from({ length: 12 }, (_, i) => listing(i))
    renderPreview()
    await waitFor(() => expect(cardCount()).toBeGreaterThan(0))
    expect(cardCount()).toBe(12)
  })

  it('claims no count it has not rendered', async () => {
    // "12 listings" as copy would be a lie whenever five exist. The preview
    // caption deliberately carries no number.
    listingRows = Array.from({ length: 5 }, (_, i) => listing(i))
    renderPreview()
    await waitFor(() => expect(cardCount()).toBe(5))
    expect(document.body.textContent).not.toMatch(/\b12 listings\b/i)
  })
})

describe('the CTA goes to the existing marketplace route', () => {
  it('renders after the grid and points at /marketplace', async () => {
    listingRows = Array.from({ length: 12 }, (_, i) => listing(i))
    renderPreview()
    await waitFor(() => expect(cardCount()).toBe(12))
    const cta = ctaLink()
    expect(cta, 'no preview CTA rendered').toBeTruthy()
    expect(cta!.getAttribute('href')).toBe('/marketplace')
    expect(cta!.textContent).toMatch(/Explore all listings/i)
  })

  it('is absent on the full marketplace, where it would point at itself', async () => {
    listingRows = Array.from({ length: 12 }, (_, i) => listing(i))
    renderPreview('en', false)
    await waitFor(() => expect(cardCount()).toBeGreaterThan(0))
    expect(ctaLink(), '/marketplace renders a preview CTA pointing at itself').toBeNull()
  })

  it('is offered from the empty state too, where a filter may be hiding everything', async () => {
    listingRows = []
    renderPreview()
    await waitFor(() => {
      expect(ctaLink(), 'the empty state offers no way onward').toBeTruthy()
    })
  })
})

describe('the card experience is unchanged', () => {
  it('add to cart still works from a homepage card', async () => {
    listingRows = [listing(1)]
    renderPreview()
    await waitFor(() => expect(cardCount()).toBe(1))
    const addButtons = screen.getAllByRole('button').filter(
      (b) => /cart/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
    )
    expect(addButtons.length, 'no add-to-cart control on the homepage card')
      .toBeGreaterThan(0)
    fireEvent.click(addButtons[0])
    await waitFor(() => expect(addToCart).toHaveBeenCalled())
  })

  it('the wishlist control is still rendered', async () => {
    listingRows = [listing(1)]
    renderPreview()
    await waitFor(() => expect(cardCount()).toBe(1))
    const hearts = screen.getAllByRole('button').filter(
      (b) => /sav|wish|heart/i.test(b.getAttribute('aria-label') ?? ''),
    )
    expect(hearts.length, 'the wishlist heart disappeared from the card')
      .toBeGreaterThan(0)
  })
})

describe('the preview renders in all five languages', () => {
  for (const locale of LOCALES) {
    it(`${locale}: no raw translation key, and the CTA is translated`, async () => {
      listingRows = Array.from({ length: 12 }, (_, i) => listing(i))
      renderPreview(locale)
      await waitFor(() => expect(cardCount()).toBe(12))
      const text = document.body.textContent ?? ''
      // The A.3 failure mode: a key name where a sentence belongs.
      expect(text, `${locale} leaked a translation key`)
        .not.toMatch(/\bmarketplace\.[a-z][A-Za-z0-9_.]+/)
      expect(text, `${locale} left a placeholder unsubstituted`).not.toMatch(/\{\w+\}/)
      expect(ctaLink()?.textContent?.trim().length, `${locale} rendered an empty CTA`)
        .toBeGreaterThan(0)
    })
  }

  it('the CTA copy actually differs between languages', async () => {
    const seen = new Set<string>()
    for (const locale of LOCALES) {
      cleanup()
      listingRows = Array.from({ length: 12 }, (_, i) => listing(i))
      renderPreview(locale)
      await waitFor(() => expect(cardCount()).toBe(12))
      seen.add((ctaLink()?.textContent ?? '').trim())
    }
    expect(seen.size, `every locale rendered the same CTA: ${[...seen].join(' | ')}`)
      .toBeGreaterThan(1)
  })
})
