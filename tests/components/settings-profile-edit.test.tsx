import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * ROUTE-LEVEL tests for the owner's edit journey (§6).
 *
 * The editor is the existing Settings screen, so these mount it behind the
 * router with the supabase client stubbed and assert the whole loop: values
 * load, a change is saved, the profile is refreshed BEFORE success is
 * claimed, and the way back to the public page exists.
 *
 * Authorization is NOT asserted here. It cannot be: the boundary is RLS, and
 * a stub would prove only that a mock returned what it was told to. That half
 * lives in tests/security/public-profile-boundary.test.ts against the real
 * database.
 */

const update = vi.fn()
const eq = vi.fn()
const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ update: (...a: unknown[]) => update(...a) }),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  },
}))

let mockProfile: Record<string, unknown> | null = null
const refreshProfile = vi.fn(async () => {})
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: mockProfile,
    session: { user: { id: 'u1', email: 'owner@example.com' } },
    loading: false,
    refreshProfile,
    flagEnabled: () => false,
    canVerify: false,
    heldRoles: [],
  }),
}))

vi.mock('@/components/MyRoles', () => ({ MyRoles: () => null }))
vi.mock('@/components/PayoutAccountCard', () => ({ PayoutAccountCard: () => null }))

const { default: Settings } = await import('../../src/pages/shared/Settings')

function baseProfile(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    full_name: 'Sahel Grains',
    phone: '08000000000',
    headline: 'Aggregating maize in Kaduna',
    bio: 'We buy from verified farms.',
    state: 'Kaduna',
    username: 'sahel_grains',
    profile_visibility: 'public',
    avatar_url: null,
    digital_id: 'LM-0001',
    bvn_verified: false,
    nin_verified: false,
    ...over,
  }
}

function renderSettings() {
  return render(<MemoryRouter><Settings /></MemoryRouter>)
}

beforeEach(() => {
  mockProfile = baseProfile()
  update.mockReset()
  eq.mockReset()
  rpc.mockReset()
  refreshProfile.mockClear()
  update.mockImplementation(() => ({ eq: async (...a: unknown[]) => { eq(...a); return { error: null } } }))
  rpc.mockResolvedValue({ data: { available: true } })
})
afterEach(cleanup)

describe('the editor loads what the public profile shows', () => {
  it('pre-fills every field that appears on /u/:username', () => {
    renderSettings()
    expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe('Sahel Grains')
    expect((screen.getByLabelText(/^headline$/i) as HTMLInputElement).value).toBe('Aggregating maize in Kaduna')
    expect((screen.getByLabelText(/^about$/i) as HTMLTextAreaElement).value).toBe('We buy from verified farms.')
    expect((screen.getByLabelText(/^state$/i) as HTMLSelectElement).value).toBe('Kaduna')
  })

  it('offers headline and about at all', () => {
    // These were rendered publicly and editable nowhere before §14 — the
    // regression this file exists to prevent.
    expect(screen.queryByLabelText(/^headline$/i)).toBeNull()
    renderSettings()
    expect(screen.getByLabelText(/^headline$/i)).toBeTruthy()
    expect(screen.getByLabelText(/^about$/i)).toBeTruthy()
  })

  it('says plainly that the phone is not public', () => {
    renderSettings()
    expect(screen.getByText(/never shown publicly/i)).toBeTruthy()
  })

  it('says location is state-level only', () => {
    renderSettings()
    expect(screen.getByText(/never shows your exact address/i)).toBeTruthy()
  })
})

describe('saving', () => {
  it('will not submit until something changed', () => {
    renderSettings()
    expect((screen.getByRole('button', { name: /save profile/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables save and flags unsaved changes on edit', () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText(/^headline$/i), { target: { value: 'New headline' } })
    expect((screen.getByRole('button', { name: /save profile/i }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(/unsaved changes/i)).toBeTruthy()
  })

  it('persists the changed public fields', async () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText(/^headline$/i), { target: { value: 'Sesame and soybean' } })
    fireEvent.change(screen.getByLabelText(/^about$/i), { target: { value: 'Ten years in Kano.' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][0]).toMatchObject({
      full_name: 'Sahel Grains',
      headline: 'Sesame and soybean',
      bio: 'Ten years in Kano.',
      state: 'Kaduna',
    })
  })

  it('scopes the write to the owner row', async () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText(/^headline$/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await waitFor(() => expect(eq).toHaveBeenCalledWith('id', 'u1'))
  })

  it('stores an emptied field as null, not as an empty string', async () => {
    // The public profile renders a section only when the field has content;
    // "" would render an empty About.
    renderSettings()
    fireEvent.change(screen.getByLabelText(/^about$/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][0].bio).toBeNull()
  })

  it('refreshes the profile BEFORE claiming success', async () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText(/^headline$/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    // The message says the public profile now shows this, so the app has to
    // actually hold the saved state by the time it appears.
    const ok = await screen.findByText(/your public profile now shows these details/i)
    expect(ok).toBeTruthy()
    expect(refreshProfile).toHaveBeenCalled()
  })

  it('surfaces a server error instead of failing silently', async () => {
    update.mockImplementation(() => ({ eq: async () => ({ error: { message: 'permission denied' } }) }))
    renderSettings()
    fireEvent.change(screen.getByLabelText(/^headline$/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    expect(await screen.findByText(/permission denied/i)).toBeTruthy()
    expect(refreshProfile).not.toHaveBeenCalled()
  })

  it('rejects an empty name before touching the server', async () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    expect(await screen.findByText(/name cannot be empty/i)).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })

  it('clears a stale success message as soon as editing resumes', async () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText(/^headline$/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await screen.findByText(/your public profile now shows/i)
    fireEvent.change(screen.getByLabelText(/^headline$/i), { target: { value: 'xy' } })
    expect(screen.queryByText(/your public profile now shows/i)).toBeNull()
  })
})

describe('the way back to the public page', () => {
  it('links to the canonical profile URL', () => {
    renderSettings()
    const link = screen.getByRole('link', { name: /view public profile/i })
    expect(link.getAttribute('href')).toBe('/u/sahel_grains')
  })

  it('offers no link when there is no handle yet', () => {
    mockProfile = baseProfile({ username: null })
    renderSettings()
    expect(screen.queryByRole('link', { name: /view public profile/i })).toBeNull()
  })
})

describe('nothing here writes a protected column', () => {
  it('sends only the low-sensitivity profile fields', async () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText(/^headline$/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    const keys = Object.keys(update.mock.calls[0][0]).sort()
    expect(keys).toEqual(['bio', 'full_name', 'headline', 'phone', 'state'])
    // verified_badge, bvn_verified, nin_verified and username are frozen by
    // database triggers; the editor must not even attempt them.
    for (const forbidden of ['verified_badge', 'bvn_verified', 'nin_verified', 'username', 'role', 'active']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})
