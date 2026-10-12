import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * ROUTE-LEVEL tests for /u/:username.
 *
 * §27: "Do not test only isolated components." These mount the real route
 * component behind the real router, with the RPC layer stubbed at the
 * supabase client, and assert what a visitor actually ends up looking at.
 *
 * The RPCs are stubbed rather than hit because the response BOUNDARY is
 * already proven against the live database in
 * tests/security/public-profile-boundary.test.ts. What these add is the other
 * half: given a payload the server would really return, does the route render
 * the right thing — and, just as importantly, does it refrain from rendering
 * a field the payload does not carry.
 */

const rpc = vi.fn()
const from = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
  isSupabaseConfigured: true,
}))

let mockSession: unknown = null
let mockProfile: unknown = null
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    session: mockSession,
    profile: mockProfile,
    loading: false,
    flagEnabled: () => false,
    canVerify: false,
    heldRoles: [],
    signOut: vi.fn(),
    switchRole: vi.fn(),
    refreshProfile: vi.fn(),
    refreshRoles: vi.fn(),
  }),
}))

vi.mock('@/context/CartContext', () => ({
  useCart: () => ({ cartCount: 0, wishlistCount: 0, cart: [], wishlist: [] }),
}))

vi.mock('@/lib/useConsent', () => ({
  useConsent: () => ({
    record: null, mustAsk: false, analytics: false,
    allows: () => false, save: vi.fn(), reopen: vi.fn(),
  }),
}))

const { default: PublicProfile } = await import('../../src/pages/public/PublicProfile')

/** A payload shaped exactly like loamy_profile_by_username returns. */
function payload(over: Record<string, unknown> = {}) {
  return {
    found: true,
    username: 'sahel_grains',
    display_name: 'Sahel Grains',
    headline: 'Aggregating maize from verified farms in Kaduna.',
    bio: null,
    avatar_url: null,
    state: 'Kaduna',
    category: 'Trader',
    roles: ['trader'],
    verified_badge: false,
    member_since: '2026-01-15T00:00:00.000Z',
    is_self: false,
    visibility: 'public',
    active_listings: 0,
    completed_transactions: 0,
    commodities: [],
    states_served: [],
    listings: [],
    ...over,
  }
}

function stub({ profile, reviews = [], summary = null }: {
  profile: Record<string, unknown> | { found: false }
  reviews?: unknown[]
  summary?: unknown
}) {
  rpc.mockImplementation((fn: string) => {
    if (fn === 'loamy_profile_by_username') return Promise.resolve({ data: profile })
    if (fn === 'loamy_profile_reviews') {
      return Promise.resolve({ data: { found: true, items: reviews } })
    }
    if (fn === 'loamy_rating_summary') return Promise.resolve({ data: summary })
    return Promise.resolve({ data: null })
  })
  from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'u1' } }) }) }),
  }))
}

function renderRoute(username = 'sahel_grains') {
  return render(
    <MemoryRouter initialEntries={[`/u/${username}`]}>
      <Routes>
        <Route path="/u/:username" element={<PublicProfile />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockSession = null
  mockProfile = null
  rpc.mockReset()
  from.mockReset()
})
afterEach(cleanup)

describe('the route resolves a real profile', () => {
  it('renders the identity, not a database record', async () => {
    stub({ profile: payload() })
    renderRoute()
    const h1 = await screen.findByRole('heading', { level: 1, name: /sahel grains/i })
    expect(screen.getByText('@sahel_grains')).toBeTruthy()
    // Presence, not uniqueness: "Kaduna" is one of 37 options in the shell's
    // deliver-to picker AND appears in this fixture's headline. Asserting a
    // single match would be testing the fixture, not the route.
    const hero = h1.closest('section')!
    expect(within(hero).getAllByText(/kaduna/i).length).toBeGreaterThan(0)
    expect(within(hero).getByText(/trader/i)).toBeTruthy()
  })

  it('shows a loading state before the payload arrives, with no name in it', async () => {
    // Flashing the wrong profile for a frame is worse than a skeleton.
    let resolve: (v: unknown) => void = () => {}
    rpc.mockImplementation(() => new Promise((r) => { resolve = r }))
    from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }))
    renderRoute()
    const status = await screen.findByRole('status')
    expect(within(status).queryByText(/sahel grains/i)).toBeNull()
    resolve({ data: payload() })
  })

  it('renders exactly one h1', async () => {
    stub({ profile: payload() })
    renderRoute()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})

describe('a profile that cannot be seen', () => {
  it('shows the not-found state', async () => {
    stub({ profile: { found: false } })
    renderRoute('nobody-here')
    expect(await screen.findByRole('heading', { name: /profile not found/i })).toBeTruthy()
  })

  it('does not reveal whether the handle exists', async () => {
    // The server returns {found:false} for private AND missing alike; the
    // page must not add a distinction the server refused to make.
    stub({ profile: { found: false } })
    renderRoute('nobody-here')
    await screen.findByRole('heading', { name: /profile not found/i })
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/private/i)
    expect(body).not.toMatch(/taken|exists|registered/i)
  })

  it('offers a way out', async () => {
    stub({ profile: { found: false } })
    renderRoute('nobody-here')
    expect(await screen.findByRole('link', { name: /explore the marketplace/i })).toBeTruthy()
  })
})

describe('what a visitor sees versus the owner', () => {
  it('gives a visitor no owner controls', async () => {
    stub({ profile: payload({ is_self: false }) })
    renderRoute()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('link', { name: /edit profile/i })).toBeNull()
    expect(screen.queryByText(/this is your public profile/i)).toBeNull()
  })

  it('gives the owner edit and visibility controls', async () => {
    mockSession = { user: { id: 'u1' } }
    mockProfile = { id: 'u1', platform_role: 'trader' }
    stub({ profile: payload({ is_self: true }) })
    renderRoute()
    expect(await screen.findByRole('link', { name: /edit profile/i })).toBeTruthy()
    expect(screen.getByText(/this is your public profile/i)).toBeTruthy()
  })

  it('tells the owner who can actually see it', async () => {
    mockSession = { user: { id: 'u1' } }
    mockProfile = { id: 'u1', platform_role: 'trader' }
    stub({ profile: payload({ is_self: true, visibility: 'members' }) })
    renderRoute()
    expect(await screen.findByText(/only signed-in loamy members/i)).toBeTruthy()
  })

  it('offers sharing to everyone', async () => {
    stub({ profile: payload() })
    renderRoute()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('button', { name: /share profile|copy link/i })).toBeTruthy()
  })
})

describe('verification is never invented', () => {
  it('shows no badge when the backend says unverified', async () => {
    stub({ profile: payload({ verified_badge: false }) })
    renderRoute()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(/^verified$/i)).toBeNull()
  })

  it('shows the badge when the backend says verified', async () => {
    stub({ profile: payload({ verified_badge: true }) })
    renderRoute()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText(/^verified$/i)).toBeTruthy()
  })

  it('never shows an evaluative claim', async () => {
    stub({ profile: payload({ verified_badge: true, completed_transactions: 40 }) })
    renderRoute()
    await screen.findByRole('heading', { level: 1 })
    const body = document.body.textContent ?? ''
    for (const claim of ['top seller', 'trusted', 'recommended', 'best', 'reliability', 'trust score']) {
      expect(body.toLowerCase()).not.toContain(claim)
    }
  })
})

describe('listings', () => {
  it('renders the seller listings the payload carries', async () => {
    stub({
      profile: payload({
        active_listings: 1,
        commodities: ['Maize'],
        listings: [{
          id: 'l1', commodity: 'Maize', listing_type: 'commodity', quantity: 100,
          unit: 'kg', price_per_unit: 500, currency: 'NGN', state: 'Kaduna',
          lga: null, photos: [], created_at: '2026-08-05T00:00:00.000Z',
        }],
      }),
    })
    renderRoute()
    await screen.findByRole('heading', { level: 1 })
    // "Maize" is also a commodity chip linking to a filtered marketplace, so
    // the listing is identified by its own route rather than by its label.
    const links = screen.getAllByRole('link', { name: /maize/i })
    expect(links.some((l) => l.getAttribute('href') === '/marketplace/l1')).toBe(true)
  })

  it('shows an empty state rather than a fake count', async () => {
    stub({ profile: payload({ active_listings: 0, listings: [] }) })
    renderRoute()
    expect(await screen.findByText(/no active listings/i)).toBeTruthy()
  })

  it('omits the trades-in section when there are no commodities', async () => {
    stub({ profile: payload({ commodities: [] }) })
    renderRoute()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(/trades in/i)).toBeNull()
  })
})

describe('transaction signals stay privacy-safe', () => {
  it('shows a completed count and nothing about the deals', async () => {
    stub({ profile: payload({ completed_transactions: 27 }) })
    renderRoute()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText('27')).toBeTruthy()
    const body = (document.body.textContent ?? '').toLowerCase()
    // No counterparty, no amount, no reference.
    expect(body).not.toMatch(/txn-/)
    expect(body).not.toMatch(/₦/)
  })

  it('omits the stat entirely at zero', async () => {
    // A "0 completed transactions" line reads as a judgement a new member
    // has not earned. Scoped to the hero's stat list: the reviews empty state
    // legitimately mentions "completed a transaction" in its explanation.
    stub({ profile: payload({ completed_transactions: 0 }) })
    renderRoute()
    const h1 = await screen.findByRole('heading', { level: 1 })
    const hero = h1.closest('section')!
    expect(within(hero).queryByText(/completed transaction/i)).toBeNull()
  })
})

describe('reviews', () => {
  it('explains why there are none rather than showing an empty box', async () => {
    stub({ profile: payload(), reviews: [] })
    renderRoute()
    expect(await screen.findByText(/no reviews yet/i)).toBeTruthy()
  })

  it('renders a review without exposing its author', async () => {
    stub({
      profile: payload(),
      reviews: [{
        ref: 'REV-1', rating: 5, quality: 5, communication: 5, timeliness: 5,
        comment: 'Delivered on time.', response: null, responded_at: null,
        reviewer_label: 'A verified buyer', reviewer_state: 'Kano',
        created_at: '2026-08-01T00:00:00.000Z',
      }],
    })
    renderRoute()
    expect(await screen.findByText(/delivered on time/i)).toBeTruthy()
    expect(screen.getByText(/a verified buyer/i)).toBeTruthy()
    // No profile link out of a review: that would deanonymise it.
    expect(screen.queryByRole('link', { name: /a verified buyer/i })).toBeNull()
  })

  it('does not publish an average the server withheld', async () => {
    // has_enough false => the backend refuses to state a rating. The page
    // must not compute one from the distribution.
    stub({
      profile: payload(),
      summary: { count: 2, has_enough: false, minimum_for_average: 3, average: null, distribution: {} },
    })
    mockSession = { user: { id: 'u2' } }
    renderRoute()
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(screen.getByText(/before a rating is shown/i)).toBeTruthy())
  })
})
