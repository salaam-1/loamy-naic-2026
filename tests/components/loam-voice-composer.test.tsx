import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

/**
 * Where voice meets the EXISTING Loam composer.
 *
 * WHAT THIS GUARDS
 *   That speech recognition is an input method and not a second assistant. A
 *   transcript must land in the same textarea a typed question lands in, go
 *   through the same `askLoam` call, and never be submitted on the member's
 *   behalf. If voice ever grew its own submit path it would bypass the
 *   orchestrator, the evidence layer and the guard, and this file is what
 *   fails when that happens.
 *
 *   `VoiceInput` itself is stubbed down to a button that reports a
 *   transcript. Its own behaviour is tested in voice-input.test.tsx; what is
 *   under test here is the wiring.
 */

const askLoam = vi.fn()
const appendLoamExchange = vi.fn().mockResolvedValue(undefined)
const latestConversation = vi.fn().mockResolvedValue(null)
const loadMessages = vi.fn().mockResolvedValue([])
const createConversation = vi.fn().mockResolvedValue('conv-1')
const deterministicAnswer = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1', platform_role: 'farmer', full_name: 'Test Farmer' },
    flagEnabled: (k: string) => k === 'loam',
    session: { access_token: 'jwt' },
    languagePreference: null,
  }),
}))

vi.mock('@/lib/loam/transport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/loam/transport')>('@/lib/loam/transport')
  return { ...actual, askLoam: (...a: unknown[]) => askLoam(...a) }
})

vi.mock('@/lib/loam/conversations', () => ({
  appendLoamExchange: (...a: unknown[]) => appendLoamExchange(...a),
  latestConversation: (...a: unknown[]) => latestConversation(...a),
  loadMessages: (...a: unknown[]) => loadMessages(...a),
  createConversation: (...a: unknown[]) => createConversation(...a),
}))

vi.mock('@/lib/copilot/conversations', () => ({
  createConversation: (...a: unknown[]) => createConversation(...a),
  loadMessages: (...a: unknown[]) => loadMessages(...a),
  logFlaggedQuestion: vi.fn(),
}))

/** Still mocked: if the panel ever reaches the legacy engine again, it shows. */
vi.mock('@/lib/copilot/engine', () => ({
  answer: (...a: unknown[]) => deterministicAnswer(...a),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: () => Promise.resolve({ data: null, error: null }),
      select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) }),
    }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'jwt' } } }) },
  },
  isSupabaseConfigured: true,
}))

vi.mock('@/lib/copilot/stt/adapter', () => ({
  getSttAdapter: () => ({ available: false, listen: vi.fn() }),
}))

/**
 * A stand-in for the voice control: one button that reports a transcript in
 * Igbo. Everything downstream of `onTranscript` is the real Copilot.
 */
vi.mock('@/components/copilot/VoiceInput', () => ({
  VoiceInput: ({ onTranscript }: {
    onTranscript: (t: string, l: string) => void
  }) => (
    <button type="button" onClick={() => onTranscript('afọ ọhụrụ ga-adị mma', 'ig')}>
      fake-transcribe
    </button>
  ),
}))

import { Copilot } from '@/components/copilot/Copilot'

const ANSWER = {
  answer: 'Plant maize once the rains are established.',
  language: 'ig' as const,
  demand: 'specific' as const,
  level: 2 as const,
  evidence: [],
  modelUsed: true,
  declined: false,
  guard: { unsupportedNumbers: [], unsupportedPeriods: [], fellBack: false },
  kind: 'answer',
  lane: 'grounded' as const,
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  render(<MemoryRouter><Copilot /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: /loam/i }))
  return screen.getByRole('textbox') as HTMLTextAreaElement
}

beforeEach(() => {
  askLoam.mockResolvedValue(ANSWER)
  // jsdom has no Element.scrollTo; the panel scrolls its transcript on every
  // turn. Same stub the existing panel test uses.
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a transcript lands in the existing composer', () => {
  it('fills the same textarea a typed question uses, and does NOT send', async () => {
    const user = userEvent.setup()
    const composer = await openPanel(user)

    await user.click(screen.getByRole('button', { name: /fake-transcribe/i }))

    await waitFor(() => expect(composer.value).toBe('afọ ọhụrụ ga-adị mma'))
    // The assertion that matters most: nothing was submitted.
    expect(askLoam).not.toHaveBeenCalled()
  })

  it('tells the member to check it before sending', async () => {
    const user = userEvent.setup()
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: /fake-transcribe/i }))
    expect(await screen.findByText(/check it before sending/i)).toBeTruthy()
  })

  it('appends rather than destroying something already typed', async () => {
    const user = userEvent.setup()
    const composer = await openPanel(user)
    await user.type(composer, 'Kedu')
    await user.click(screen.getByRole('button', { name: /fake-transcribe/i }))
    await waitFor(() => expect(composer.value).toBe('Kedu afọ ọhụrụ ga-adị mma'))
  })

  it('can be edited before it is sent', async () => {
    const user = userEvent.setup()
    const composer = await openPanel(user)
    await user.click(screen.getByRole('button', { name: /fake-transcribe/i }))
    await waitFor(() => expect(composer.value).toContain('afọ'))

    await user.type(composer, ' ugbua')
    expect(composer.value).toBe('afọ ọhụrụ ga-adị mma ugbua')

    await user.click(screen.getByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(askLoam).toHaveBeenCalledTimes(1))
    // The EDITED text is what was submitted, not the raw transcript.
    expect((askLoam.mock.calls[0]![0] as { message: string }).message)
      .toBe('afọ ọhụrụ ga-adị mma ugbua')
  })
})

describe('it goes through the existing Loam pipeline, not around it', () => {
  it('submits via askLoam with the spoken language', async () => {
    const user = userEvent.setup()
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: /fake-transcribe/i }))
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('afọ'))
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => expect(askLoam).toHaveBeenCalledTimes(1))
    const req = askLoam.mock.calls[0]![0] as { message: string; language: string }
    // Igbo is one of the four Loam answers in, so it passes through intact.
    expect(req.language).toBe('ig')
    expect(req.message).toBe('afọ ọhụrụ ga-adị mma')
  })

  it('never reaches the legacy deterministic engine', async () => {
    const user = userEvent.setup()
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: /fake-transcribe/i }))
    await user.click(screen.getByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(askLoam).toHaveBeenCalled())
    expect(deterministicAnswer).not.toHaveBeenCalled()
  })

  it('clears the voice notice once the turn is sent', async () => {
    const user = userEvent.setup()
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: /fake-transcribe/i }))
    expect(await screen.findByText(/check it before sending/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(screen.queryByText(/check it before sending/i)).toBeNull())
  })
})

describe('typed chat is untouched', () => {
  it('still sends a typed question with no voice involved', async () => {
    const user = userEvent.setup()
    const composer = await openPanel(user)
    await user.type(composer, 'When should I plant maize?')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => expect(askLoam).toHaveBeenCalledTimes(1))
    expect((askLoam.mock.calls[0]![0] as { message: string }).message)
      .toBe('When should I plant maize?')
    // No voice notice for something that was typed.
    expect(screen.queryByText(/check it before sending/i)).toBeNull()
  })

  it('still submits on Enter', async () => {
    const user = userEvent.setup()
    const composer = await openPanel(user)
    await user.type(composer, 'Price of maize?{Enter}')
    await waitFor(() => expect(askLoam).toHaveBeenCalledTimes(1))
  })

  it('renders the answer, whichever way the question arrived', async () => {
    const user = userEvent.setup()
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: /fake-transcribe/i }))
    await user.click(screen.getByRole('button', { name: /^send$/i }))
    // The answer text appears in more than one node (the turn and its
    // accessible announcement), so assert at least one rather than exactly one.
    const shown = await screen.findAllByText(/plant maize once the rains/i)
    expect(shown.length).toBeGreaterThan(0)
  })
})
