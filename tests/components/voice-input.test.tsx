import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Voice input as a member meets it.
 *
 * WHAT THIS GUARDS
 *   The dangerous failures here are not visual. They are: audio moving
 *   without anybody asking, a transcript being SENT rather than offered, a
 *   language being silently swapped for another, and a denied microphone
 *   turning into a dead button with no explanation.
 *
 *   No microphone, no AudioContext and no model: `startRecording` and the
 *   provider are both mocked. What is exercised is the component's own
 *   behaviour.
 */

const transcribe = vi.fn()
const supports = vi.fn()
const startRecording = vi.fn()
const stop = vi.fn()
const cancel = vi.fn()

vi.mock('@/lib/loam/voice-recorder', async () => {
  const actual = await vi.importActual<typeof import('@/lib/loam/voice-recorder')>(
    '@/lib/loam/voice-recorder',
  )
  return { ...actual, startRecording: (...a: unknown[]) => startRecording(...a) }
})

vi.mock('@/lib/providers/stt', async () => {
  const actual = await vi.importActual<typeof import('@/lib/providers/stt')>('@/lib/providers/stt')
  return {
    ...actual,
    speechToTextProvider: () => ({
      info: { key: 'loam-local-stt', label: 'Local', mode: 'live' as const },
      languages: ['en', 'ha', 'ig', 'yo'] as const,
      maxAudioBytes: 2_000_000,
      canDetectLanguage: false,
      supports: (l: string) => supports(l),
      transcribe: (...a: unknown[]) => transcribe(...a),
    }),
  }
})

import { VoiceInput } from '@/components/copilot/VoiceInput'
import { RecorderError } from '@/lib/loam/voice-recorder'

const onTranscript = vi.fn()

function setup(chatLanguage: 'en' | 'ha' | 'ig' | 'yo' | 'pcm' = 'yo') {
  return render(
    <VoiceInput chatLanguage={chatLanguage} onTranscript={onTranscript} />,
  )
}

beforeEach(() => {
  supports.mockReturnValue(true)
  stop.mockResolvedValue({ wav: new Uint8Array([1, 2, 3]), sampleRate: 48_000, seconds: 2 })
  cancel.mockReset()
  startRecording.mockResolvedValue({ stop, cancel, elapsed: () => 1.2 })
  transcribe.mockResolvedValue({
    ok: true, mode: 'live',
    value: { text: 'afọ ọhụrụ ga-adị mma', provider: 'loam-local-stt', verified: true },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/* -------------------------------------------------------- no audio by default */

describe('nothing is recorded until somebody asks', () => {
  it('does not touch the microphone on mount', () => {
    setup()
    // The single most important assertion in this file.
    expect(startRecording).not.toHaveBeenCalled()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('shows a Speak control rather than a live recorder', () => {
    setup()
    expect(screen.getByRole('button', { name: /record a question/i })).toBeTruthy()
    expect(screen.queryByText(/listening/i)).toBeNull()
  })
})

/* ------------------------------------------------------------- all five */

describe('the selector offers all five languages', () => {
  it('lists English, Hausa, Igbo, Yorùbá and Naijá', () => {
    setup()
    const select = screen.getByLabelText(/voice input language/i) as HTMLSelectElement
    const values = [...select.options].map((o) => o.value)
    expect(values).toEqual(['en', 'ha', 'ig', 'yo', 'pcm'])
    const labels = [...select.options].map((o) => o.textContent)
    expect(labels).toContain('Yorùbá')
    expect(labels.some((l) => l?.includes('Naijá'))).toBe(true)
  })

  it('defaults to the language the member is already using Loam in', () => {
    setup('ha')
    expect((screen.getByLabelText(/voice input language/i) as HTMLSelectElement).value).toBe('ha')
  })

  it('warns BEFORE recording that Pidgin is answered in English', async () => {
    setup('pcm')
    // Said up front, not after the member has spoken.
    expect(await screen.findByText(/loam answers in english/i)).toBeTruthy()
  })

  it('does not warn for the four Loam answers in', () => {
    setup('yo')
    expect(screen.queryByText(/loam answers in english/i)).toBeNull()
  })
})

/* --------------------------------------------------------- the happy path */

describe('record, transcribe, hand to the composer', () => {
  it('passes the chosen language to the provider and never submits', async () => {
    const user = userEvent.setup()
    setup('ig')
    await user.click(screen.getByRole('button', { name: /record a question/i }))
    await user.click(await screen.findByRole('button', { name: /stop recording/i }))

    await waitFor(() => expect(transcribe).toHaveBeenCalled())
    const req = transcribe.mock.calls[0]![0] as { language: string; mimeType: string }
    expect(req.language).toBe('ig')
    expect(req.mimeType).toBe('audio/wav')

    // Offered, not sent. The caller puts it in the composer.
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('afọ ọhụrụ ga-adị mma', 'ig'))
  })

  it('preserves diacritics exactly', async () => {
    const user = userEvent.setup()
    setup('ig')
    await user.click(screen.getByRole('button', { name: /record a question/i }))
    await user.click(await screen.findByRole('button', { name: /stop recording/i }))
    await waitFor(() => expect(onTranscript).toHaveBeenCalled())
    const [text] = onTranscript.mock.calls[0] as [string]
    expect(text).toBe('afọ ọhụrụ ga-adị mma')
    expect([...text].filter((c) => c.codePointAt(0)! > 127).join('')).toBe('ọọụụị')
  })

  it('shows a recording indicator while listening', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /record a question/i }))
    const status = await screen.findByRole('status')
    expect(status.textContent).toMatch(/listening/i)
  })

  it('shows progress while transcribing', async () => {
    const user = userEvent.setup()
    let release: (v: unknown) => void = () => {}
    transcribe.mockReturnValue(new Promise((r) => { release = r }))
    setup()
    await user.click(screen.getByRole('button', { name: /record a question/i }))
    await user.click(await screen.findByRole('button', { name: /stop recording/i }))
    expect(await screen.findByText(/transcribing/i)).toBeTruthy()
    expect(screen.getByText(/runs on your machine/i)).toBeTruthy()
    release({ ok: true, mode: 'live', value: { text: 'x', provider: 'p' } })
  })

  it('locks the language while recording, so the model cannot change mid-take', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /record a question/i }))
    await screen.findByRole('button', { name: /stop recording/i })
    expect((screen.getByLabelText(/voice input language/i) as HTMLSelectElement).disabled).toBe(true)
  })
})

/* ------------------------------------------------------------ discarding */

describe('a recording can be thrown away', () => {
  it('cancels without transcribing or handing anything over', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /record a question/i }))
    await user.click(await screen.findByRole('button', { name: /discard recording/i }))

    expect(cancel).toHaveBeenCalled()
    expect(transcribe).not.toHaveBeenCalled()
    expect(onTranscript).not.toHaveBeenCalled()
    // Back to the idle control.
    expect(await screen.findByRole('button', { name: /record a question/i })).toBeTruthy()
  })

  it('releases the microphone if the panel closes mid-recording', async () => {
    const user = userEvent.setup()
    const view = setup()
    await user.click(screen.getByRole('button', { name: /record a question/i }))
    await screen.findByRole('button', { name: /stop recording/i })
    view.unmount()
    // Otherwise the browser's recording indicator stays on after the panel is
    // gone, which is the kind of thing that destroys trust in a microphone.
    expect(cancel).toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------- errors */

describe('failures are explained, not swallowed', () => {
  it('explains a denied microphone and what to do instead', async () => {
    const user = userEvent.setup()
    startRecording.mockRejectedValue(
      new RecorderError('permission_denied',
        'Microphone access was blocked. Allow it in your browser settings, or type instead.'),
    )
    setup()
    await user.click(screen.getByRole('button', { name: /record a question/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/blocked/i)
    expect(alert.textContent).toMatch(/type instead/i)
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('surfaces a transcription failure without losing the composer', async () => {
    const user = userEvent.setup()
    transcribe.mockResolvedValue({
      ok: false,
      error: {
        kind: 'not_configured', retryable: false,
        message: 'Pidgin voice input is not set up on this machine yet.',
      },
    })
    setup('pcm')
    await user.click(screen.getByRole('button', { name: /record a question/i }))
    await user.click(await screen.findByRole('button', { name: /stop recording/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/not set up on this machine/i)
    // Nothing is handed over on failure -- no empty string, no placeholder.
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('refuses a language the provider does not support, before recording', async () => {
    const user = userEvent.setup()
    supports.mockReturnValue(false)
    setup('pcm')
    await user.click(screen.getByRole('button', { name: /record a question/i }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    // The microphone is never opened for a language that cannot be served.
    expect(startRecording).not.toHaveBeenCalled()
  })

  it('reports a disabled provider as a session setting, not a user error', async () => {
    const user = userEvent.setup()
    supports.mockReturnValue(false)
    const { rerender } = render(
      <VoiceInput chatLanguage="yo" onTranscript={onTranscript} />,
    )
    void rerender
    await user.click(screen.getByRole('button', { name: /record a question/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/not set up yet|not switched on/i)
  })
})

/* ---------------------------------------------------------- accessibility */

describe('it is reachable without a mouse', () => {
  it('labels every control', () => {
    setup()
    expect(screen.getByLabelText(/voice input language/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /record a question in/i })).toBeTruthy()
  })

  it('names the language in the record button, so the label is not just "mic"', () => {
    setup('ha')
    expect(screen.getByRole('button', { name: /record a question in Hausa/i })).toBeTruthy()
  })

  it('announces recording and transcription through live regions', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /record a question/i }))
    const status = await screen.findByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
  })

  it('can be driven by keyboard alone', async () => {
    const user = userEvent.setup()
    setup()
    const button = screen.getByRole('button', { name: /record a question/i })
    button.focus()
    expect(document.activeElement).toBe(button)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(startRecording).toHaveBeenCalled())
  })
})
