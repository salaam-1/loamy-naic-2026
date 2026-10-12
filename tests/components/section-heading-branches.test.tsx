import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * RENDERED-BRANCH heading tests for the sections in SECTIONS_WITH_OWN_HEADING.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE SOURCE-LEVEL CHECK
 *   ux-refine-role-aware.test.tsx asserts, by reading the files, that no early
 *   return precedes a section's <h1>. That check is cheap and it catches the
 *   shape of the bug, but it is still a check on source text: it cannot prove
 *   that the heading actually reaches the DOM, and a future refactor could
 *   satisfy it while rendering nothing.
 *
 *   These tests mount the real components and assert the heading is in the
 *   document in each branch the member can actually land on.
 *
 * THE BUG THEY LOCK DOWN
 *   RoleDashboard suppresses its own page title for these sections, on the
 *   promise that the section renders one. Six of them rendered their <h1> only
 *   in the populated branch: loading returned a bare skeleton and, for four of
 *   them, an empty result returned an EmptyState whose title is a <p>. So a
 *   member with no listings, or one still fetching, got a page with no heading
 *   at all. It presented as a probe flake because it tracked the fixture's row
 *   count rather than the viewport.
 *
 * ON THE ERROR BRANCH
 *   None of these components has a return that bypasses the heading on error;
 *   they set an error message and render it inside the normal tree. The
 *   source-level test is what guarantees that stays true, because "no early
 *   return precedes the h1" covers every branch at once, including ones no
 *   fixture here happens to reach.
 */

// --- supabase: a chainable builder that resolves to whatever a test sets ----
let rows: unknown[] = []
let resolveQueries = true
let pending: Array<() => void> = []

function builder(): unknown {
  const chain: Record<string, unknown> = {}
  const self = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'then') {
        return (onFulfilled: (v: unknown) => unknown) => {
          const value = { data: rows, error: null }
          if (resolveQueries) return Promise.resolve(value).then(onFulfilled)
          // Loading branch: a promise that never settles during the assertion.
          return new Promise(() => { pending.push(() => undefined) }).then(onFulfilled)
        }
      }
      return () => self
    },
  })
  return self
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => builder(),
    rpc: () => builder(),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  },
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'u1', platform_role: 'farmer', full_name: 'Test Farmer', state: 'Kaduna' },
    session: { user: { id: 'u1' } },
    loading: false,
    refreshProfile: async () => {},
    flagEnabled: () => true,
    canVerify: false,
    heldRoles: ['farmer'],
  }),
}))

let batches: unknown[] = []
vi.mock('@/lib/stock', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchMyBatches: async () => batches,
  fetchListedQuantities: async () => ({}),
}))

vi.mock('@/lib/marketplace', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchPublicProfiles: async () => ({}),
}))

const { default: MyListings } = await import('../../src/pages/marketplace/MyListings')
const { default: MyInterests } = await import('../../src/pages/marketplace/MyInterests')
const { default: Directory } = await import('../../src/pages/marketplace/Directory')
const { default: MyBookings } = await import('../../src/pages/booking/MyBookings')
const { default: MyStock } = await import('../../src/pages/shared/MyStock')
const { default: BookingsInbox } = await import('../../src/pages/booking/BookingsInbox')

/** Rows shaped well enough that the populated branch renders without throwing. */
const FIXTURES: Record<string, unknown[]> = {
  'My Listings': [{
    id: 'l1', commodity: 'Maize', quantity_kg: 100, unit: 'kg', price_per_unit: 500,
    status: 'active', created_at: '2026-09-01T00:00:00Z', state: 'Kaduna', lga: 'Zaria',
    description: '', batch_id: null, photos: [], listing_type: 'produce',
  }],
  'My Interests': [{
    id: 'i1', status: 'open', created_at: '2026-09-01T00:00:00Z',
    listing: { commodity: 'Maize', price_per_unit: 500, unit: 'kg' },
    directory: null, listing_id: 'l1', directory_id: null, message: '',
  }],
  Directory: [{
    id: 'd1', business_name: 'Kaduna Cold Store', service_type: 'warehouse',
    state: 'Kaduna', lga: 'Zaria', description: 'Storage', created_at: '2026-09-01T00:00:00Z',
    owner_id: 'u2', capacity: null, contact_phone: null,
  }],
  'My Bookings': [{
    id: 'b1', status: 'requested', created_at: '2026-09-01T00:00:00Z',
    directory_id: 'd1', requester_id: 'u1', owner_id: 'u2',
    requested_date: '2026-10-01', note: '', quantity: null,
  }],
  'Bookings Inbox': [{
    id: 'b2', status: 'requested', created_at: '2026-09-01T00:00:00Z',
    directory_id: 'd1', requester_id: 'u3', owner_id: 'u1',
    requested_date: '2026-10-01', note: '', quantity: null,
  }],
}

const SECTIONS: Array<[string, () => JSX.Element]> = [
  ['My Listings', () => <MyListings />],
  ['My Interests', () => <MyInterests />],
  ['Directory', () => <Directory />],
  ['My Bookings', () => <MyBookings />],
  ['My Stock', () => <MyStock />],
  ['Bookings Inbox', () => <BookingsInbox />],
]

function mount(node: JSX.Element) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

/** Exactly one heading, and it says something. */
function expectOneHeading(label: string) {
  const h1s = screen.queryAllByRole('heading', { level: 1 })
  expect(h1s.length, label + ': expected exactly one h1').toBe(1)
  expect((h1s[0].textContent ?? '').trim().length, label + ': heading is empty').toBeGreaterThan(0)
}

beforeEach(() => {
  rows = []
  batches = []
  resolveQueries = true
  pending = []
})
afterEach(cleanup)

describe('every heading-owning section renders its heading in every branch', () => {
  for (const [name, node] of SECTIONS) {
    it(name + ': heading is present while the data is still loading', async () => {
      resolveQueries = false
      mount(node())
      // Asserted synchronously, before anything resolves: this is the branch
      // that used to render a bare skeleton with no heading.
      expectOneHeading(name + ' [loading]')
    })

    it(name + ': heading is present when the result is empty', async () => {
      rows = []
      batches = []
      mount(node())
      await waitFor(() => expectOneHeading(name + ' [empty]'))
    })

    it(name + ': heading is present when there is data', async () => {
      rows = FIXTURES[name] ?? []
      batches = name === 'My Stock'
        ? [{
            id: 'bt1', commodity: 'Maize', quantity_kg: 100, unit: 'kg',
            status: 'created', verification_status: 'unverified',
            created_at: '2026-09-01T00:00:00Z', harvest_date: '2026-08-01',
            state: 'Kaduna', lga: 'Zaria', farm_id: null, owner_id: 'u1',
          }]
        : []
      mount(node())
      await waitFor(() => expectOneHeading(name + ' [populated]'))
    })
  }
})
