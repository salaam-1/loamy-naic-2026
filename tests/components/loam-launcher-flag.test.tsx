import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Does the `loam` flag actually put the launcher on screen?
 *
 * WHY THIS EXISTS
 *   The launcher went missing from the dashboard and the flag was the suspect.
 *   Reading `flagEnabled` did not settle it: the logic looks right on the page.
 *   This renders the REAL <AuthProvider> and the REAL <Copilot> and asks the
 *   question the way the browser asks it, so the answer is observed rather
 *   than argued.
 *
 * WHAT IS REAL AND WHAT IS NOT
 *   Real: AuthContext's flag resolution, Copilot's gate, the launcher markup.
 *   Mocked: Supabase (otherwise this tests staging's row values) and Loam's
 *   transport/persistence (the launcher must not need a model to appear).
 */

const flagRow = { loam: false, copilot: false }
const profileRow = {
  id: 'u1', full_name: 'Test Member', platform_role: 'farmer',
  onboarding_complete: true, category: 'Farmer',
}

vi.mock('@/lib/supabase', () => {
  const table = (name: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () =>
          name === 'platform_config'
            ? { data: { flags: flagRow }, error: null }
            : name === 'profiles'
              ? { data: profileRow, error: null }
              : { data: null, error: null },
      }),
    }),
    update: () => ({ eq: async () => ({ error: null }) }),
  })
  return {
    supabase: {
      from: table,
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'u1', user_metadata: {} } } },
        }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({}),
      },
    },
  }
})

vi.mock('@/lib/userRoles', () => ({ fetchMyRoles: async () => [], switchRole: async () => {} }))
vi.mock('@/lib/loam/transport', () => ({
  askLoam: async () => ({ answer: '', level: null }),
  LoamUnavailable: class extends Error {},
}))
vi.mock('@/lib/loam/conversations', () => ({
  appendLoamExchange: async () => {},
  createConversation: async () => null,
  latestConversation: async () => null,
  loadMessages: async () => [],
}))

import { AuthProvider } from '@/context/AuthContext'
import { Copilot } from '@/components/copilot/Copilot'

function mount() {
  return render(
    <MemoryRouter>
      <AuthProvider><Copilot /></AuthProvider>
    </MemoryRouter>,
  )
}

const launcher = () => screen.queryByRole('button', { name: /loam/i })

beforeEach(() => {
  localStorage.clear()
  flagRow.loam = false
  window.history.replaceState({}, '', '/dashboard')
})
afterEach(() => { cleanup(); localStorage.clear() })

describe('the loam flag and the launcher', () => {
  it('shows the launcher when the environment flag is on', async () => {
    flagRow.loam = true
    mount()
    await waitFor(() => expect(launcher()).not.toBeNull())
  })

  it('shows the launcher when the dev override turns it on', async () => {
    localStorage.setItem('loamy.dev.flags', '{"loam":true}')
    mount()
    await waitFor(() => expect(launcher()).not.toBeNull())
  })

  it('shows the launcher when the dev flag is set from the URL', async () => {
    window.history.replaceState({}, '', '/dashboard?loam=1')
    mount()
    await waitFor(() => expect(launcher()).not.toBeNull())
    // and it is remembered, so moving off the query string keeps it on
    expect(JSON.parse(localStorage.getItem('loamy.dev.flags')!)).toMatchObject({ loam: true })
  })

  it('pins the flag off from the URL even when the environment has it on', async () => {
    flagRow.loam = true
    window.history.replaceState({}, '', '/dashboard?loam=0')
    mount()
    await waitFor(() => expect(screen.queryByText(/test member/i)).toBeDefined())
    expect(launcher()).toBeNull()
  })

  it('ignores a query parameter that is not a declared flag', async () => {
    window.history.replaceState({}, '', '/dashboard?nonsense=1')
    mount()
    await waitFor(() => expect(screen.queryByText(/test member/i)).toBeDefined())
    expect(launcher()).toBeNull()
    expect(localStorage.getItem('loamy.dev.flags')).toBeNull()
  })

  it('hides the launcher when the flag is off and no override is set', async () => {
    mount()
    await waitFor(() => expect(screen.queryByText(/test member/i)).toBeDefined())
    expect(launcher()).toBeNull()
  })
})
