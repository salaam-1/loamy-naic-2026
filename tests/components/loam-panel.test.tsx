import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

/**
 * The Loam panel as a member sees it.
 *
 * WHAT THIS GUARDS
 *   Phase 2 turned the engineering harness into a product surface. The risk is
 *   leakage in both directions: internal vocabulary reaching the user, and the
 *   old Co-pilot being broken by Loam's arrival. Both are asserted here, in a
 *   real render rather than over the source.
 *
 * The transport is mocked. These tests are about the surface, not the engine --
 * the engine has 167 tests of its own and runs at 3 tokens a second.
 */

const askLoam = vi.fn()
const appendLoamExchange = vi.fn().mockResolvedValue(undefined)
const latestConversation = vi.fn().mockResolvedValue(null)
const loadMessages = vi.fn().mockResolvedValue([])
const createConversation = vi.fn().mockResolvedValue('conv-1')
const deterministicAnswer = vi.fn()

let flags: Record<string, boolean> = { loam: true }

/** Mutable so a test can give the member a saved interface language. */
const auth: { languagePreference: string | null } = { languagePreference: null }

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1', platform_role: 'farmer', full_name: 'Test Farmer' },
    flagEnabled: (k: string) => flags[k] === true,
    session: { access_token: 'jwt' },
    languagePreference: auth.languagePreference,
  }),
}))

vi.mock('@/lib/loam/transport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/loam/transport')>('@/lib/loam/transport')
  return { ...actual, askLoam: (...a: unknown[]) => askLoam(...a) }
})

// Loam's persistence moved to loam/ so Loam's module graph never reaches the
// legacy engine, which copilot/conversations.ts imports at module level.
vi.mock('@/lib/loam/conversations', () => ({
  appendLoamExchange: (...a: unknown[]) => appendLoamExchange(...a),
  latestConversation: (...a: unknown[]) => latestConversation(...a),
  loadMessages: (...a: unknown[]) => loadMessages(...a),
  createConversation: (...a: unknown[]) => createConversation(...a),
}))

// The legacy module is still mocked: the Co-pilot path uses it.
vi.mock('@/lib/copilot/conversations', () => ({
  createConversation: (...a: unknown[]) => createConversation(...a),
  loadMessages: (...a: unknown[]) => loadMessages(...a),
  logFlaggedQuestion: vi.fn(),
}))

/**
 * Still mocked, and that is the point: if the panel ever imports the legacy
 * engine again, `deterministicAnswer` would start being called and the tests
 * at the bottom of this file would fail.
 */
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

import { Copilot } from '@/components/copilot/Copilot'

const GROUNDED = {
  answer: 'Plant maize once the rains are established, usually from late May into mid-June.',
  language: 'en' as const,
  demand: 'specific' as const,
  level: 2 as const,
  evidence: [{
    level: 2 as const,
    claim: 'In the Northern Guinea Savanna, maize is sown from late May into mid-June.',
    source: 'Loam knowledge pack v0, planting guidance - PENDING AGRONOMIST REVIEW',
    asOf: null,
  }],
  modelUsed: true,
  declined: false,
  guard: { unsupportedNumbers: [], unsupportedPeriods: [], fellBack: false },
  reasoning: ['Neighbours who sowed early last year lost seedlings.'],
  dropped: [],
  modelMs: 42_000,
  timings: { classifyMs: 1, retrieveMs: 2, promptMs: 0, inferenceMs: 42_000, guardMs: 3, totalMs: 42_006 },
}

const FARM_ANSWER = {
  ...GROUNDED,
  answer: 'You have one farm recorded, Rafin Kaya in Giwa, Kaduna, at 3.5 hectares.',
  demand: 'personal' as const,
  level: 1 as const,
  evidence: [{ level: 1 as const, claim: 'Farm: Rafin Kaya, 3.5 hectares.', source: 'Loamy farm records', asOf: '2026-06-02' }],
  reasoning: [],
}

const DECLINED = {
  ...GROUNDED,
  answer: 'I do not have recorded information to answer that reliably, so I will not guess.',
  level: 4 as const,
  evidence: [],
  modelUsed: false,
  declined: true,
  reasoning: [],
  modelMs: null,
}

async function openPanel() {
  const user = userEvent.setup()
  render(<MemoryRouter><Copilot /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: /open loam/i }))
  return user
}

// This config does not enable vitest globals, so RTL's auto-cleanup does not
// run and a second render would stack a second panel in the same document.
afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  // The panel caches its thread in localStorage and marks the disclaimer seen
  // in sessionStorage. Both survive cleanup(), so without this a later test
  // starts with the previous test's conversation and no empty state.
  try { localStorage.clear(); sessionStorage.clear() } catch { /* not available */ }
  flags = { loam: true }
  latestConversation.mockResolvedValue(null)
  loadMessages.mockResolvedValue([])
  createConversation.mockResolvedValue('conv-1')
  appendLoamExchange.mockResolvedValue(undefined)
  // jsdom implements neither of these; the panel scrolls its thread on update
  // and StorefrontHero-style components query matchMedia.
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  })
})

describe('the empty state tells a member what Loam is for', () => {
  it('shows Loam branding, not Co-pilot branding', async () => {
    await openPanel()
    expect(screen.getByText('Agricultural copilot')).toBeTruthy()
    expect(screen.queryByText('Your farming co-pilot'), 'that is the old surface').toBeNull()
  })

  it('offers suggested prompts covering the demo story', async () => {
    await openPanel()
    // General agronomy, location-specific guidance, and the member's own data.
    expect(screen.getByRole('button', { name: /why does crop rotation matter/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /plant maize in kaduna/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /on my farm/i })).toBeTruthy()
  })

  it('states what Loam answers from, including the review caveat', async () => {
    await openPanel()
    const disclaimer = screen.getByText(/pending expert review/i)
    expect(disclaimer.textContent).toMatch(/does not predict future prices/i)
    expect(disclaimer.textContent).toMatch(/not have enough verified information/i)
  })

  it('invites a question about the farm rather than about prices', async () => {
    await openPanel()
    const box = screen.getByRole('textbox', { name: /ask loam/i })
    expect(box.getAttribute('placeholder')).toMatch(/your farm/i)
  })
})

describe('an answer shows what it stands on, in product language', () => {
  it('labels guidance as agricultural guidance', async () => {
    askLoam.mockResolvedValue(GROUNDED)
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(screen.getByText(/late May into mid-June/)).toBeTruthy())
    expect(screen.getByText('Agricultural guidance')).toBeTruthy()
  })

  it("labels the member's own records as coming from their Loamy data", async () => {
    askLoam.mockResolvedValue(FARM_ANSWER)
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /on my farm/i }))
    await waitFor(() => expect(screen.getByText(/Rafin Kaya/)).toBeTruthy())
    expect(screen.getByText('From your Loamy data')).toBeTruthy()
  })

  it('says plainly when it has nothing verified, rather than hedging', async () => {
    askLoam.mockResolvedValue(DECLINED)
    const user = await openPanel()
    await user.type(screen.getByRole('textbox', { name: /ask loam/i }), 'When do I plant pineapple in Sokoto?{Enter}')
    await waitFor(() => expect(screen.getByText(/I will not guess/)).toBeTruthy())
    expect(screen.getByText('Not enough verified information')).toBeTruthy()
  })

  it('renders the review caveat in plain words, never the internal string', async () => {
    askLoam.mockResolvedValue(GROUNDED)
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(screen.getByText(/late May into mid-June/)).toBeTruthy())
    expect(screen.getByText(/Agricultural guidance \(pending expert review\)/)).toBeTruthy()
    expect(document.body.textContent, 'engineer phrasing must not reach a farmer')
      .not.toContain('PENDING AGRONOMIST REVIEW')
  })

  it('keeps the model’s own thinking in a separate labelled block', async () => {
    askLoam.mockResolvedValue(GROUNDED)
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(screen.getByText(/late May into mid-June/)).toBeTruthy())
    const label = screen.getByText(/Loam’s own thinking, not from records/i)
    expect(label).toBeTruthy()
    // The reasoning sentence is present but NOT inside the answer paragraph.
    const answerNode = screen.getByText(/late May into mid-June/)
    expect(answerNode.textContent).not.toContain('Neighbours who sowed early')
    expect(screen.getByText(/Neighbours who sowed early/)).toBeTruthy()
  })
})

describe('internal vocabulary never reaches the user', () => {
  it('shows no levels, scores, gates, anchors or timings', async () => {
    askLoam.mockResolvedValue(GROUNDED)
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(screen.getByText(/late May into mid-June/)).toBeTruthy())

    const text = document.body.textContent ?? ''
    for (const internal of [
      'L1', 'L2', 'L3', 'L4', 'grounding', 'evidence gate', 'anchor', 'polarity',
      'contextOnly', 'fellBack', 'unsupportedNumbers', 'demand=', 'num_ctx',
      'Model reasoning', 'Loamy platform data',
    ]) {
      expect(text, `"${internal}" is internal`).not.toContain(internal)
    }
    // Inference timing is reported by the API for scripts, not shown here.
    expect(text).not.toMatch(/42\.0s|42000/)
  })

  it('leaks no inference host or model configuration into the DOM', async () => {
    askLoam.mockResolvedValue(GROUNDED)
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(screen.getByText(/late May into mid-June/)).toBeTruthy())
    const html = document.body.innerHTML
    expect(html).not.toContain('11434')
    expect(html).not.toContain('natlas-q4km')
    expect(html).not.toContain('You are Loam, the agricultural assistant')
  })
})

describe('the wait is explained rather than hidden', () => {
  it('shows a counting processing state that names the model and the expected wait', async () => {
    let resolve!: (v: unknown) => void
    askLoam.mockReturnValue(new Promise((r) => { resolve = r }))
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/Loam is thinking/i)
    expect(status.textContent, 'the wait is a fact worth stating').toMatch(/up to a minute/i)
    expect(status.textContent).toMatch(/N-ATLaS/)

    resolve(GROUNDED)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
})

describe('the conversation persists through the existing tables', () => {
  it('creates a thread and stores both messages', async () => {
    askLoam.mockResolvedValue(GROUNDED)
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(appendLoamExchange).toHaveBeenCalled())

    expect(createConversation).toHaveBeenCalledWith('user-1', 'en')
    const [cid, question, answerText, opts] = appendLoamExchange.mock.calls[0]
    expect(cid).toBe('conv-1')
    expect(question).toMatch(/plant maize in Kaduna/i)
    expect(answerText).toBe(GROUNDED.answer)
    expect(opts.answered).toBe(true)
    expect(opts.sources[0].level).toBe(2)
  })

  it('restores a previous thread when Loam is reopened', async () => {
    latestConversation.mockResolvedValue('conv-old')
    loadMessages.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'Why does crop rotation matter?', data_as_of: null, was_answered: true, data_sources: [] },
      {
        id: 'm2', role: 'assistant', content: 'Rotation keeps soil nitrogen up.',
        data_as_of: null, was_answered: true,
        data_sources: [{ source: 'Loam knowledge pack v0 - PENDING AGRONOMIST REVIEW', level: 2 }],
      },
    ])
    await openPanel()
    await waitFor(() => expect(screen.getByText(/Rotation keeps soil nitrogen up/)).toBeTruthy())
    expect(screen.getByText(/Why does crop rotation matter/)).toBeTruthy()
    // Provenance survives the round trip, still in product language.
    expect(screen.getByText(/Agricultural guidance \(pending expert review\)/)).toBeTruthy()
  })

  it('still shows the answer when persistence fails', async () => {
    askLoam.mockResolvedValue(GROUNDED)
    appendLoamExchange.mockRejectedValue(new Error('offline'))
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(screen.getByText(/late May into mid-June/)).toBeTruthy())
  })
})

describe('failure is reported without technical detail', () => {
  it('shows a plain message when Loam cannot be reached', async () => {
    askLoam.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:11434'))
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(screen.getByText(/could not be reached/i)).toBeTruthy())
    expect(document.body.textContent).not.toContain('ECONNREFUSED')
    expect(document.body.textContent).not.toContain('127.0.0.1')
  })
})

describe('there is only one assistant, and it is Loam', () => {
  it('renders NOTHING when `copilot` is on by itself', () => {
    /**
     * The legacy Co-pilot can no longer reach a user. Previously this
     * combination rendered the keyword router behind Loam's name and mascot,
     * which is how a member came to be answered by the old engine while
     * reading "Loam" in the header.
     *
     * No assistant is the correct outcome here. It is quieter than a fallback
     * and far safer than silently serving the engine Loam replaced.
     */
    flags = { copilot: true, loam: false }
    const { container } = render(<MemoryRouter><Copilot /></MemoryRouter>)
    expect(container.textContent).toBe('')
  })

  it('renders nothing when both flags are off', () => {
    flags = {}
    const { container } = render(<MemoryRouter><Copilot /></MemoryRouter>)
    expect(container.textContent).toBe('')
  })

  it('renders Loam when `loam` is on, whatever `copilot` says', async () => {
    for (const copilot of [true, false]) {
      flags = { loam: true, copilot }
      const user = userEvent.setup()
      render(<MemoryRouter><Copilot /></MemoryRouter>)
      await user.click(screen.getByRole('button', { name: /open loam/i }))
      expect(screen.getByText('Agricultural copilot'), `copilot=${copilot}`).toBeTruthy()
      expect(screen.queryByText('Your farming co-pilot')).toBeNull()
      cleanup()
    }
  })

  it('never calls the legacy engine, whatever the question', async () => {
    // "i want to sell" is the exact phrase parseIntent maps to 'rfq'.
    askLoam.mockResolvedValue(DECLINED)
    const user = await openPanel()
    await user.type(screen.getByRole('textbox', { name: /ask loam/i }), 'I want to sell 20 bags of maize{Enter}')
    await waitFor(() => expect(askLoam).toHaveBeenCalled())
    expect(deterministicAnswer, 'the legacy engine must be unreachable').not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('Confirm & continue')
  })
})

describe('the processing state ends when the answer appears', () => {
  it('re-enables the composer immediately, without waiting on persistence', async () => {
    /**
     * REGRESSION. Persistence used to be awaited before the enclosing `finally`
     * cleared `sending`, so three round trips to the database ran after the
     * answer had rendered. Measured in a real browser: the answer was on screen
     * for ten seconds while the composer stayed disabled and "Loam is thinking"
     * spun underneath it.
     *
     * A persistence call that never settles is the sharpest version of that
     * bug, so that is what this test uses.
     */
    askLoam.mockResolvedValue(GROUNDED)
    appendLoamExchange.mockReturnValue(new Promise(() => { /* never settles */ }))

    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(screen.getByText(/late May into mid-June/)).toBeTruthy())

    // The answer is visible, so Loam has finished as far as the member cares.
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(
      screen.getByRole('textbox', { name: /ask loam/i }).hasAttribute('disabled'),
      'the composer must not wait on a database write',
    ).toBe(false)
  })
})

describe('Loam states its terms once, in its own name', () => {
  it('does not render the Co-pilot disclaimer alongside the Loam one', async () => {
    /**
     * REGRESSION, found in a screenshot rather than by a test. The panel footer
     * carried a persistent "Loamy Co-pilot reports observed prices..." line. On
     * the Loam surface that put two disclaimers on screen at once -- one of them
     * branded as the other assistant, and about prices rather than about what
     * Loam actually does.
     */
    await openPanel()
    const text = document.body.textContent ?? ''
    expect(text, 'the other assistant must not name itself here').not.toContain('Loamy Co-pilot')
    expect(text.match(/does not predict future prices/g) ?? [], 'said once, not twice').toHaveLength(1)
  })

  it('the Co-pilot disclaimer can no longer appear at all', () => {
    // It used to render whenever `copilot` was on. Now `copilot` renders
    // nothing, so the string has no path to a screen.
    flags = { copilot: true, loam: false }
    const { container } = render(<MemoryRouter><Copilot /></MemoryRouter>)
    expect(container.textContent).toBe('')
  })
})

describe('a policy refusal is not shown as missing information', () => {
  const POLICY_REFUSAL = {
    ...DECLINED,
    answer: 'Future price forecasts are not something Loam provides. Loamy does not predict prices.',
    demand: 'forecast' as const,
    refusal: 'policy' as const,
  }
  const NO_EVIDENCE = { ...DECLINED, refusal: 'no_evidence' as const }

  it('labels a forecast refusal as a capability boundary', async () => {
    /**
     * Both refusals used to read "Not enough verified information", so Loam
     * declining ON PRINCIPLE looked like Loam not knowing -- and contradicted
     * the refusal's own offer to show recorded prices.
     */
    askLoam.mockResolvedValue(POLICY_REFUSAL)
    const user = await openPanel()
    await user.type(screen.getByRole('textbox', { name: /ask loam/i }), 'What will maize cost in March?{Enter}')
    await waitFor(() => expect(screen.getByText(/Loamy does not predict prices/)).toBeTruthy())

    expect(screen.getByText('Not something Loam provides'), 'the chip').toBeTruthy()
    expect(screen.queryByText('Not enough verified information'), 'this is a choice, not a gap').toBeNull()
  })

  it('still labels a genuine evidence gap as one', async () => {
    askLoam.mockResolvedValue(NO_EVIDENCE)
    const user = await openPanel()
    await user.type(screen.getByRole('textbox', { name: /ask loam/i }), 'When do I plant pineapple in Sokoto?{Enter}')
    await waitFor(() => expect(screen.getByText(/I will not guess/)).toBeTruthy())
    expect(screen.getByText('Not enough verified information')).toBeTruthy()
    expect(screen.queryByText('Not something Loam provides')).toBeNull()
  })

  it('exposes no internal vocabulary for either refusal', async () => {
    askLoam.mockResolvedValue(POLICY_REFUSAL)
    const user = await openPanel()
    await user.type(screen.getByRole('textbox', { name: /ask loam/i }), 'What will maize cost in March?{Enter}')
    await waitFor(() => expect(screen.getByText(/Loamy does not predict prices/)).toBeTruthy())
    const text = document.body.textContent ?? ''
    for (const internal of ['L4', 'policy class', 'safety rule', 'forecast classifier', 'evidence gate', 'refusal']) {
      expect(text, `"${internal}" is internal`).not.toContain(internal)
    }
  })
})

describe('no placeholder metadata is rendered', () => {
  it('omits the date entirely when there is none', async () => {
    // It printed "Data as of -" on every guidance answer, a literal dash where
    // a date should be, reading as unfinished UI.
    askLoam.mockResolvedValue(GROUNDED)
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(screen.getByText(/late May into mid-June/)).toBeTruthy())

    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Data as of -')
    expect(text, 'no date exists, so none is claimed').not.toContain('Data as of')
    // The provenance that DOES exist is still shown.
    expect(screen.getByText(/Agricultural guidance \(pending expert review\)/)).toBeTruthy()
  })

  it('shows the date when there is one', async () => {
    askLoam.mockResolvedValue(FARM_ANSWER)
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /on my farm/i }))
    await waitFor(() => expect(screen.getByText(/Rafin Kaya/)).toBeTruthy())
    expect(screen.getByText(/Data as of/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Data as of -')
  })

  it('renders no footer at all when a turn has neither date nor source', async () => {
    askLoam.mockResolvedValue({ ...DECLINED, refusal: 'policy' as const })
    const user = await openPanel()
    await user.type(screen.getByRole('textbox', { name: /ask loam/i }), 'What will maize cost in March?{Enter}')
    await waitFor(() => expect(screen.getByText(/I will not guess/)).toBeTruthy())
    expect(document.body.textContent).not.toContain('Data as of')
  })
})

describe('Co-pilot affordances do not appear inside Loam', () => {
  it('shows no "Not helpful?" under a Loam answer', async () => {
    /**
     * This one actually rendered. Loam sets kind 'answer' too, so the
     * improvement-loop button appeared under every grounded Loam response. It
     * writes to copilot_flagged_questions, whose meaning is "the deterministic
     * engine failed to find an answer" -- which does not describe a Loam turn.
     */
    askLoam.mockResolvedValue(GROUNDED)
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: /plant maize in kaduna/i }))
    await waitFor(() => expect(screen.getByText(/late May into mid-June/)).toBeTruthy())
    expect(screen.queryByText('Not helpful?')).toBeNull()
  })

  it('offers no "Confirm & continue" draft flow', async () => {
    // draftResult() in copilot/engine.ts is the only producer of kind 'draft',
    // and Loam never calls it -- the gate is explicit so it cannot reappear.
    askLoam.mockResolvedValue(GROUNDED)
    const user = await openPanel()
    await user.type(screen.getByRole('textbox', { name: /ask loam/i }), 'I want to sell 20 bags of maize{Enter}')
    await waitFor(() => expect(screen.getByText(/late May into mid-June/)).toBeTruthy())
    expect(document.body.textContent).not.toContain('Confirm & continue')
  })

  it('routes a selling question through Loam, not the keyword router', async () => {
    // "i want to sell" is the exact phrase parseIntent() maps to 'rfq'. Under
    // Loam it must reach the transport instead.
    askLoam.mockResolvedValue(GROUNDED)
    const user = await openPanel()
    await user.type(screen.getByRole('textbox', { name: /ask loam/i }), 'I want to sell 20 bags of maize{Enter}')
    await waitFor(() => expect(askLoam).toHaveBeenCalled())
    expect(deterministicAnswer, 'the old engine must not be consulted').not.toHaveBeenCalled()
    expect(askLoam.mock.calls[0][0].message).toContain('20 bags of maize')
  })

  it('the draft flow has no surface left to appear on', async () => {
    /**
     * This test used to assert the opposite: that with `copilot` on and `loam`
     * off, the legacy draft flow still rendered "Confirm & continue". That was
     * correct while two assistants shared one panel. It is wrong now -- the
     * legacy engine has no route to a screen, so the draft flow cannot render
     * for anyone.
     *
     * The capability itself is not lost, only unimplemented in Loam. Drafting
     * a listing from a sentence is on the rebuild list in
     * docs/loam-legacy-audit.md; until it exists, Loam declines rather than
     * handing the question to the old router.
     */
    flags = { copilot: true, loam: false }
    deterministicAnswer.mockResolvedValue({
      intent: 'rfq', kind: 'draft', language: 'en',
      content: 'I can prepare a listing. Review the details below.',
      slots: { commodity: 'Maize', quantity: 20, unit: 'bags' },
      dataSources: [], dataAsOf: null, wasAnswered: true,
    })
    const { container } = render(<MemoryRouter><Copilot /></MemoryRouter>)
    expect(container.textContent, 'no assistant renders at all').toBe('')
    expect(deterministicAnswer).not.toHaveBeenCalled()
  })
})

describe('the panel speaks every language Loam does', () => {
  /**
   * The panel was `'en' | 'ha'` while the orchestrator, the classifier and
   * `/loam/chat` had handled four languages for some time -- so Igbo and
   * Yoruba were answerable and unreachable. These tests pin the control and
   * the saved preference, not the model's fluency.
   */
  beforeEach(() => {
    flags = { loam: true }
    auth.languagePreference = null
  })

  async function openPanel() {
    const user = userEvent.setup()
    render(<MemoryRouter><Copilot /></MemoryRouter>)
    /**
     * Matched on "loam" alone, not "open loam". With a saved Hausa
     * preference the label is "Bude Loam, mataimakin noma" -- the control is
     * translated, which is the point of this block, so a selector built from
     * the English wording would fail for exactly the case under test.
     */
    await user.click(screen.getByRole('button', { name: /loam/i }))
    /**
     * By id, not by role. There are now TWO selects in the panel: this one,
     * the language Loam ANSWERS in, and the voice-input one, the language the
     * member SPEAKS. They are different lists -- voice covers a fifth,
     * Nigerian Pidgin -- so `getByRole('combobox')` is ambiguous and this
     * block is specifically about the answer language.
     */
    const select = document.getElementById('loam-language') as HTMLSelectElement
    expect(select, 'the answer-language select must exist').toBeTruthy()
    return { select, user }
  }

  it('offers all four languages, by their own names', async () => {
    const { select } = await openPanel()
    const options = Array.from(select.querySelectorAll('option'))
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['en', 'ha', 'ig', 'yo'])
    expect(options.map((o) => o.textContent)).toEqual(['English', 'Hausa', 'Igbo', 'Yorùbá'])
  })

  it('defaults to English when the member has never chosen', async () => {
    const { select } = await openPanel()
    expect(select.value).toBe('en')
  })

  it('honours a SAVED Hausa preference without being asked again', async () => {
    auth.languagePreference = 'ha'
    const { select } = await openPanel()
    expect(select.value).toBe('ha')
  })

  it('honours a saved Yoruba preference', async () => {
    auth.languagePreference = 'yo'
    const { select } = await openPanel()
    expect(select.value).toBe('yo')
  })

  it('gives a FRENCH member an English answer language, not a faked French one', async () => {
    // French is a real interface locale and NOT a language the model card
    // documents. Interface French, answers English.
    auth.languagePreference = 'fr'
    const { select } = await openPanel()
    expect(select.value).toBe('en')
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value')))
      .not.toContain('fr')
  })

  it('lets the member change it', async () => {
    const { select, user } = await openPanel()
    await user.selectOptions(select, 'ig')
    expect(select.value).toBe('ig')
  })

  it('labels the control for a screen reader', async () => {
    const { select } = await openPanel()
    // No jest-dom in this project, so assert the attributes directly.
    const id = select.getAttribute('id')
    expect(id).toBeTruthy()
    expect(document.querySelector(`label[for="${id}"]`)?.textContent).toBeTruthy()
    expect(select.getAttribute('title')).toBeTruthy()
  })
})
