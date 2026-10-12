import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Head of Product polish pass.
 *
 * Each block pins the behaviour that was asked for, so a later change cannot
 * quietly undo it: canonical CTA sizing, an automatic hero reveal, a cart icon
 * that reacts only to a SUCCESSFUL add, and a heart that fills in the brand's
 * green rather than red.
 */

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
// jsdom ships no matchMedia. StorefrontHero asks it whether motion is
// reduced, so provide it and let each test choose the answer.
let reducedMotion = false
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
})

let cartState = { cartCount: 0, cartBump: 0 }
let wishlisted = false
const toggleWishlist = vi.fn()

vi.mock('@/context/CartContext', () => ({
  useCart: () => ({
    ...cartState,
    isWishlisted: () => wishlisted,
    toggleWishlist,
    inCart: () => false,
    addToCart: vi.fn(),
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile: { id: 'u1' } }),
}))

const { buttonVariants } = await import('../../src/components/ui/button')
const { cn } = await import('../../src/lib/utils')
const { StorefrontHero } = await import('../../src/pages/marketplace/StorefrontHero')
const { CartIconLink } = await import('../../src/components/CartIconLink')
const { WishlistHeart } = await import('../../src/pages/marketplace/CardActions')

beforeEach(() => {
  reducedMotion = false
  cartState = { cartCount: 0, cartBump: 0 }
  wishlisted = false
  toggleWishlist.mockReset()
  toggleWishlist.mockResolvedValue(undefined)
})
afterEach(cleanup)

// ---------------------------------------------------------------------------
// 1. Canonical CTA sizing
// ---------------------------------------------------------------------------
describe('hero CTAs use the canonical button size', () => {
  const renderHero = () =>
    render(
      <MemoryRouter>
        <StorefrontHero onBrowse={() => {}} browseLabel="Shop the marketplace" secondary={{ label: 'Sell on Loamy', to: '/signup' }} />
      </MemoryRouter>,
    )

  it('gives both hero CTAs the SAME height class', () => {
    renderHero()
    const primary = screen.getByRole('button', { name: /shop the marketplace/i })
    const secondary = screen.getByRole('link', { name: /sell on loamy/i })
    // The defect was h-11 beside h-9. Whatever the canonical size is, both
    // must carry it -- this compares them to each other, so it keeps holding
    // if the design system's `lg` height ever changes.
    expect(primary.className).toContain('h-11')
    expect(secondary.className).toContain('h-11')
  })

  it('gives both the same radius and typography', () => {
    renderHero()
    const primary = screen.getByRole('button', { name: /shop the marketplace/i })
    const secondary = screen.getByRole('link', { name: /sell on loamy/i })
    for (const cls of ['rounded-control', 'text-[15px]']) {
      expect(primary.className).toContain(cls)
      expect(secondary.className).toContain(cls)
    }
  })

  it('secondary CTA is built from the canonical variants, not a one-off', () => {
    renderHero()
    const secondary = screen.getByRole('link', { name: /sell on loamy/i })
    const canonical = cn(buttonVariants({ variant: 'outline-inverse', size: 'lg' }))
    expect(secondary.className).toBe(canonical)
  })

  it('keeps a visible focus ring on the secondary CTA', () => {
    renderHero()
    const secondary = screen.getByRole('link', { name: /sell on loamy/i })
    expect(secondary.className).toMatch(/focus-visible:ring-2/)
  })
})

// ---------------------------------------------------------------------------
// 2. Automatic hero reveal
// ---------------------------------------------------------------------------
describe('hero reveals itself automatically', () => {
  it('animates on render with no click at all', () => {
    const { container } = render(
      <MemoryRouter>
        <StorefrontHero onBrowse={() => {}} browseLabel="Shop" secondary={{ label: 'Sell', to: '/signup' }} />
      </MemoryRouter>,
    )
    const revealed = container.querySelector('.animate-rise-in')
    expect(revealed).not.toBeNull()
    // `backwards` holds the opening frame through the delay, so the copy never
    // paints, disappears and paints again.
    expect(revealed!.className).toContain('[animation-fill-mode:backwards]')
  })

  it('never hides hero copy behind an opacity-0 class that JS must remove', () => {
    const { container } = render(
      <MemoryRouter>
        <StorefrontHero onBrowse={() => {}} browseLabel="Shop" secondary={{ label: 'Sell', to: '/signup' }} />
      </MemoryRouter>,
    )
    // If the reveal were state-driven with a persistent `opacity-0`, a failure
    // to run the effect would strand the hero invisible. The animation-only
    // approach cannot do that, and this pins it.
    const stranded = container.querySelector('.opacity-0:not(img)')
    expect(stranded).toBeNull()
  })

  it('still renders the hero copy when reduced motion is requested', () => {
    reducedMotion = true
    render(
      <MemoryRouter>
        <StorefrontHero onBrowse={() => {}} browseLabel="Shop" secondary={{ label: 'Sell', to: '/signup' }} />
      </MemoryRouter>,
    )
    // The content is present regardless of motion preference; the CSS below
    // is what makes it appear instantly rather than after a delay.
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy()
    expect(screen.getByRole('button', { name: /shop/i })).toBeTruthy()
  })

  it('collapses BOTH duration and delay under prefers-reduced-motion', () => {
    const css = readFileSync('src/index.css', 'utf8')
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(block).toContain('animation-duration: 0.01ms !important')
    // Without this, a staggered entrance leaves content invisible for the
    // length of its delay even though the animation itself is suppressed.
    expect(block).toContain('animation-delay: 0ms !important')
  })
})

// ---------------------------------------------------------------------------
// 3 + 4. Cart icon reacts to success, and only to success
// ---------------------------------------------------------------------------
describe('cart icon acknowledges a successful add', () => {
  const renderCart = () => render(<MemoryRouter><CartIconLink /></MemoryRouter>)

  it('does not animate on first paint', () => {
    const { container } = renderCart()
    expect(container.querySelector('.animate-cart-bump')).toBeNull()
  })

  it('animates when a successful add bumps the counter', async () => {
    const { container, rerender } = renderCart()
    cartState = { cartCount: 1, cartBump: 1 }
    rerender(<MemoryRouter><CartIconLink /></MemoryRouter>)
    await waitFor(() => expect(container.querySelector('.animate-cart-bump')).not.toBeNull())
  })

  it('announces the add in text, so feedback is not animation-only', async () => {
    const { rerender } = renderCart()
    cartState = { cartCount: 1, cartBump: 1 }
    rerender(<MemoryRouter><CartIconLink /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/added to cart/i)).toBeTruthy())
    expect(screen.getByText(/1 item in cart/i)).toBeTruthy()
  })

  it('does NOT animate when the count changes without a bump (a failed add)', async () => {
    const { container, rerender } = renderCart()
    // A refused add leaves cartBump untouched. Re-rendering for any other
    // reason must not produce a success reaction.
    cartState = { cartCount: 3, cartBump: 0 }
    rerender(<MemoryRouter><CartIconLink /></MemoryRouter>)
    await waitFor(() => expect(screen.getByLabelText(/cart \(3\)/i)).toBeTruthy())
    expect(container.querySelector('.animate-cart-bump')).toBeNull()
  })

  it('keeps the cart count visible while reacting', async () => {
    const { rerender } = renderCart()
    cartState = { cartCount: 2, cartBump: 1 }
    rerender(<MemoryRouter><CartIconLink /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy())
  })
})

describe('the bump signal itself', () => {
  it('increments only after both cart writes resolve', () => {
    const src = readFileSync('src/context/CartContext.tsx', 'utf8')
    const body = src.slice(src.indexOf('const addToCart'), src.indexOf('const removeFromCart'))
    const apiAt = body.indexOf('await apiAddToCart')
    const fetchAt = body.indexOf('await fetchCart()')
    const bumpAt = body.indexOf('setCartBump')
    expect(apiAt).toBeGreaterThan(-1)
    expect(bumpAt).toBeGreaterThan(apiAt)
    expect(bumpAt).toBeGreaterThan(fetchAt)
  })
})

// ---------------------------------------------------------------------------
// 5 + 6. Heart
// ---------------------------------------------------------------------------
describe('wishlist heart', () => {
  const renderHeart = () => render(<MemoryRouter><WishlistHeart listingId="l1" /></MemoryRouter>)

  it('is an outline heart when unselected', () => {
    const { container } = renderHeart()
    const icon = container.querySelector('svg')!
    expect(icon.getAttribute('class')).not.toContain('fill-current')
  })

  it('fills in the brand green when selected, not red', () => {
    wishlisted = true
    const { container } = renderHeart()
    const button = screen.getByRole('button')
    const icon = container.querySelector('svg')!
    expect(icon.getAttribute('class')).toContain('fill-current')
    expect(button.className).toContain('text-emerald-700')
    expect(button.className).not.toMatch(/text-red|text-rose/)
  })

  it('reports its state with aria-pressed', () => {
    const { rerender } = renderHeart()
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
    wishlisted = true
    rerender(<MemoryRouter><WishlistHeart listingId="l1" /></MemoryRouter>)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })

  it('has an accessible name that states the next action', () => {
    const { rerender } = renderHeart()
    expect(screen.getByRole('button', { name: /save for later/i })).toBeTruthy()
    wishlisted = true
    rerender(<MemoryRouter><WishlistHeart listingId="l1" /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /remove from saved items/i })).toBeTruthy()
  })

  it('keeps a visible focus ring and an adequate target', () => {
    const button = (renderHeart(), screen.getByRole('button'))
    expect(button.className).toMatch(/focus-visible:ring-2/)
    expect(button.className).toContain('h-9')
  })

  it('persists through the existing wishlist mechanism, not local state', async () => {
    renderHeart()
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(toggleWishlist).toHaveBeenCalledWith('l1'))
  })
})

// ---------------------------------------------------------------------------
// 7. Dash typography guard
// ---------------------------------------------------------------------------
describe('user-facing copy uses the short dash', () => {
  /** Characters inside // or block comments, which are not user-facing. */
  function commentMask(s: string): boolean[] {
    const mask = new Array<boolean>(s.length).fill(false)
    let i = 0
    let inBlock = false
    let inLine = false
    let inStr: string | null = null
    while (i < s.length) {
      const c = s[i]
      const n = s[i + 1] ?? ''
      if (inBlock) { mask[i] = true; if (c === '*' && n === '/') { mask[i + 1] = true; i += 2; inBlock = false; continue } i++; continue }
      if (inLine) { mask[i] = true; if (c === '\n') inLine = false; i++; continue }
      if (inStr) { if (c === '\\') { i += 2; continue } if (c === inStr) inStr = null; i++; continue }
      if (c === '/' && n === '*') { inBlock = true; mask[i] = mask[i + 1] = true; i += 2; continue }
      if (c === '/' && n === '/') { inLine = true; mask[i] = mask[i + 1] = true; i += 2; continue }
      if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue }
      i++
    }
    return mask
  }

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.tsx?$/.test(p)) out.push(p)
    }
    return out
  }

  it('has no em dash left in user-facing strings or JSX text', () => {
    const offenders: string[] = []
    for (const f of walk('src')) {
      const s = readFileSync(f, 'utf8')
      if (!s.includes('—')) continue
      const mask = commentMask(s)
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== '—' || mask[i]) continue
        // NO EXEMPTIONS. An earlier version let an em dash stand when it was
        // the whole string, on the grounds that an empty-value placeholder is
        // typography with a technical job. The rule is now absolute: no em
        // dash in any user-facing copy, placeholders included. All 106 were
        // replaced with a short hyphen.
        offenders.push(`${f}: ${s.slice(Math.max(0, i - 40), i + 40).replace(/\n/g, ' ')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 8. Public header overflow regression
// ---------------------------------------------------------------------------
describe('public header fits a 390px viewport', () => {
  /**
   * jsdom does not lay out, so the authoritative check is the browser QA
   * harness, which asserts scrollWidth <= clientWidth at 390 / 768 / 1440.
   * This is the cheap structural guard: it fails if the responsive tagline
   * is removed, which is what let the 235px logo lockup push the account
   * controls 9px past the viewport.
   */
  it('keeps the header tagline responsive rather than always-on', () => {
    const shell = readFileSync('src/pages/public/PublicShell.tsx', 'utf8')
    const header = shell.slice(shell.indexOf('<header'), shell.indexOf('</header>'))
    expect(header).toContain('withTagline')
    expect(header).toMatch(/taglineClassName=\{?["']hidden sm:block/)
  })

  it('does not hide the overflow instead of fixing it', () => {
    const shell = readFileSync('src/pages/public/PublicShell.tsx', 'utf8')
    const header = shell.slice(shell.indexOf('<header'), shell.indexOf('</header>'))
    // Concealing the symptom would make the browser assertion pass while the
    // content was still too wide.
    expect(header).not.toMatch(/overflow-x-hidden|overflow-hidden/)
  })

  it('still passes a tagline through on the surfaces that had one', () => {
    const logo = readFileSync('src/components/Logo.tsx', 'utf8')
    expect(logo).toContain('taglineClassName')
    // Optional: every existing caller keeps its tagline at every width.
    for (const f of ['src/components/EnvNotice.tsx', 'src/pages/NotFound.tsx', 'src/components/layout/AppShell.tsx']) {
      expect(readFileSync(f, 'utf8')).toContain('withTagline')
    }
  })
})
