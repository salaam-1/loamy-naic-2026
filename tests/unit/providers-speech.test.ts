import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  STT_ACCEPTED_MIME, STT_MAX_AUDIO_BYTES, TTS_MAX_TEXT_LENGTH,
  noSpeechToTextProvider, noTextToSpeechProvider,
  providerStatus, setSpeechToTextProvider, setTextToSpeechProvider,
  speechToTextProvider, textToSpeechProvider,
  validateSttRequest, validateTtsRequest,
  type SttRequest, type TtsRequest,
} from '@/lib/providers'
import type { LoamLanguage } from '@/lib/loam/types'

/**
 * The two voice seams, disabled.
 *
 * WHAT THESE TESTS ARE FOR
 *   Phase D delivers contracts and disabled registrations -- no microphone,
 *   no transcription, no playback, no vendor. The thing most worth pinning is
 *   therefore NEGATIVE: that a disabled provider fails predictably and
 *   touches nothing. A seam that quietly asked for a microphone, or reached a
 *   network, before anyone had chosen a provider would be a privacy
 *   incident, not a bug.
 */

const AUDIO = new Uint8Array([1, 2, 3, 4])
const sttReq = (over: Partial<SttRequest> = {}): SttRequest => ({
  audio: AUDIO, mimeType: 'audio/webm', language: 'en', ...over,
})
const ttsReq = (over: Partial<TtsRequest> = {}): TtsRequest => ({
  text: 'Maize is a cereal grain.', language: 'en', ...over,
})

const ALL: LoamLanguage[] = ['en', 'ha', 'ig', 'yo']

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // Leave the registry as the module found it.
  setSpeechToTextProvider(noSpeechToTextProvider)
  setTextToSpeechProvider(noTextToSpeechProvider)
})

/* --------------------------------------------------------- registration */

describe('both seams are registered and disabled', () => {
  it('speech-to-text is disabled by default', () => {
    expect(speechToTextProvider()).toBe(noSpeechToTextProvider)
    expect(speechToTextProvider().info.mode).toBe('disabled')
    expect(speechToTextProvider().info.key).toBe('none')
  })

  it('text-to-speech is disabled by default', () => {
    expect(textToSpeechProvider()).toBe(noTextToSpeechProvider)
    expect(textToSpeechProvider().info.mode).toBe('disabled')
    expect(textToSpeechProvider().info.key).toBe('none')
  })

  it('both appear in providerStatus, so an admin view reports what IS', () => {
    const status = providerStatus()
    expect(status.stt.mode).toBe('disabled')
    expect(status.tts.mode).toBe('disabled')
    // The pre-existing seams are untouched by this phase.
    expect(status.weather.mode).toBe('live')
    expect(status.messaging.mode).toBe('disabled')
  })

  it('neither claims a single verified language', () => {
    /**
     * Zero is the truthful number. For TTS it is not even a placeholder: no
     * NCAIR synthesis model exists for any of the four. A language is
     * supported when someone has listened to it, not when a vendor lists it.
     */
    expect(noSpeechToTextProvider.languages).toEqual([])
    expect(noTextToSpeechProvider.languages).toEqual([])
    for (const l of ALL) {
      expect(noSpeechToTextProvider.supports(l), l).toBe(false)
      expect(noTextToSpeechProvider.supports(l), l).toBe(false)
      expect(noTextToSpeechProvider.voices(l), l).toEqual([])
    }
  })

  it('speech-to-text does not claim language detection', () => {
    expect(noSpeechToTextProvider.canDetectLanguage).toBe(false)
  })

  it('the registry can be swapped, which is the point of a seam', () => {
    const fake = {
      ...noSpeechToTextProvider,
      info: { key: 'fake', label: 'Fake', mode: 'sandbox' as const },
    }
    setSpeechToTextProvider(fake)
    expect(speechToTextProvider().info.key).toBe('fake')
    expect(providerStatus().stt.mode).toBe('sandbox')
  })
})

/* ------------------------------------------------------- disabled failure */

describe('a disabled provider fails predictably', () => {
  it('transcribe returns not_configured, not a throw', async () => {
    const r = await noSpeechToTextProvider.transcribe(sttReq())
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error.kind).toBe('not_configured')
    expect(r.error.retryable).toBe(false)
    expect(r.error.message).toBeTruthy()
  })

  it('synthesize returns not_configured, not a throw', async () => {
    const r = await noTextToSpeechProvider.synthesize(ttsReq())
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error.kind).toBe('not_configured')
    expect(r.error.retryable).toBe(false)
  })

  it('the error carries nothing a member should not read', async () => {
    const r = await noSpeechToTextProvider.transcribe(sttReq())
    if (r.ok) throw new Error('unreachable')
    for (const leak of ['Bearer', 'apikey', 'token', 'service_role', 'undefined', 'null']) {
      expect(r.error.message.toLowerCase(), leak).not.toContain(leak.toLowerCase())
    }
  })

  it('fails the same way every time, for every language', async () => {
    for (const l of ALL) {
      const s = await noSpeechToTextProvider.transcribe(sttReq({ language: l }))
      const t = await noTextToSpeechProvider.synthesize(ttsReq({ language: l }))
      expect(s.ok, l).toBe(false)
      expect(t.ok, l).toBe(false)
    }
  })

  it('fails without inspecting the audio at all', async () => {
    // Nonsense input, same answer: there is nowhere to send it, so the
    // honest response precedes validation.
    const r = await noSpeechToTextProvider.transcribe(
      sttReq({ audio: new Uint8Array(), mimeType: 'application/zip' }),
    )
    if (r.ok) throw new Error('unreachable')
    expect(r.error.kind).toBe('not_configured')
  })
})

/* ------------------------------------------------------- no side effects */

describe('a disabled provider touches nothing', () => {
  it('makes no network call', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await noSpeechToTextProvider.transcribe(sttReq())
    await noTextToSpeechProvider.synthesize(ttsReq())
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never asks for a microphone', async () => {
    const getUserMedia = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    await noSpeechToTextProvider.transcribe(sttReq())
    expect(getUserMedia, 'a recording is an act, not a setting').not.toHaveBeenCalled()
  })

  it('constructs no MediaRecorder', async () => {
    const MediaRecorder = vi.fn()
    vi.stubGlobal('MediaRecorder', MediaRecorder)
    await noSpeechToTextProvider.transcribe(sttReq())
    expect(MediaRecorder).not.toHaveBeenCalled()
  })

  it('plays no audio', async () => {
    const Audio = vi.fn()
    const play = vi.fn()
    vi.stubGlobal('Audio', Audio)
    vi.stubGlobal('speechSynthesis', { speak: play })
    await noTextToSpeechProvider.synthesize(ttsReq())
    expect(Audio, 'nothing plays before a provider exists').not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
  })

  it('neither module imports anything that could record or play', async () => {
    const fs = await import('node:fs')
    for (const f of ['src/lib/providers/stt.ts', 'src/lib/providers/tts.ts']) {
      const src = fs.readFileSync(f, 'utf8')
      /**
       * Call sites, not mentions. The doc comments legitimately explain what
       * a browser's MediaRecorder produces; what must not exist is code that
       * records, fetches or plays.
       */
      for (const forbidden of [
        'new MediaRecorder', '.getUserMedia(', 'navigator.mediaDevices',
        'new Audio(', 'speechSynthesis.', 'new SpeechRecognition',
        'fetch(', 'new XMLHttpRequest',
      ]) {
        expect(src, `${f} must not call ${forbidden}`).not.toContain(forbidden)
      }
    }
  })
})

/* ------------------------------------------------------------ validation */

describe('shared request validation, for the adapters that come later', () => {
  const limits = { maxAudioBytes: STT_MAX_AUDIO_BYTES }

  it('accepts a plausible recording', () => {
    expect(validateSttRequest(sttReq(), limits)).toBeNull()
  })

  it('accepts a browser mime type with codec parameters', () => {
    // Chrome produces 'audio/webm;codecs=opus'. Rejecting that would reject
    // every recording Chrome makes.
    expect(validateSttRequest(sttReq({ mimeType: 'audio/webm;codecs=opus' }), limits)).toBeNull()
  })

  it('rejects empty audio', () => {
    const e = validateSttRequest(sttReq({ audio: new Uint8Array() }), limits)
    expect(e?.kind).toBe('invalid_request')
    expect(e?.retryable).toBe(false)
  })

  it('rejects an oversized upload', () => {
    const e = validateSttRequest(
      sttReq({ audio: new Uint8Array(STT_MAX_AUDIO_BYTES + 1) }), limits,
    )
    expect(e?.kind).toBe('invalid_request')
    expect(e?.message).toMatch(/too long/i)
  })

  it('rejects a format nobody asked for', () => {
    for (const mime of ['application/zip', 'video/mp4', 'text/plain', '']) {
      expect(validateSttRequest(sttReq({ mimeType: mime }), limits)?.kind, mime)
        .toBe('invalid_request')
    }
  })

  it('accepts every format it advertises', () => {
    for (const mime of STT_ACCEPTED_MIME) {
      expect(validateSttRequest(sttReq({ mimeType: mime }), limits), mime).toBeNull()
    }
  })

  it('TTS accepts text in a supported language', () => {
    expect(validateTtsRequest(ttsReq(), { maxTextLength: 100, languages: ['en'] })).toBeNull()
  })

  it('TTS rejects an empty answer', () => {
    const e = validateTtsRequest(ttsReq({ text: '   ' }), { maxTextLength: 100, languages: ['en'] })
    expect(e?.kind).toBe('invalid_request')
  })

  it('TTS rejects text past the ceiling', () => {
    const e = validateTtsRequest(
      ttsReq({ text: 'x'.repeat(TTS_MAX_TEXT_LENGTH + 1) }),
      { maxTextLength: TTS_MAX_TEXT_LENGTH, languages: ['en'] },
    )
    expect(e?.kind).toBe('invalid_request')
  })

  it('TTS REFUSES an unsupported language instead of mispronouncing it', () => {
    /**
     * Rule 2. Reading Hausa with an English voice produces
     * confident-sounding gibberish, and a farmer hearing a mangled
     * application rate is worse off than one reading it. `rejected`, not
     * `invalid_request`: the request was understood and declined.
     */
    const e = validateTtsRequest(ttsReq({ language: 'ha' }), {
      maxTextLength: 4000, languages: ['en'],
    })
    expect(e?.kind).toBe('rejected')
    expect(e?.message).toMatch(/written answer is above/i)
  })

  it('the refusal points the member at the text, which is authoritative', () => {
    // Rule 1: audio is a rendering of the answer, never the answer.
    const e = validateTtsRequest(ttsReq({ language: 'yo' }), {
      maxTextLength: 4000, languages: [],
    })
    expect(e?.message).toMatch(/above/i)
  })

  it('preserves diacritics rather than stripping them to ease synthesis', () => {
    // "ƙasa" and "kasa" are different words; so are "ẹ" and "e".
    const text = 'Shuka a ƙasa mai ɗumi. Gbin àgbàdo. Kụọ ọka.'
    const req = ttsReq({ text, language: 'ha' })
    expect(validateTtsRequest(req, { maxTextLength: 4000, languages: ['ha'] })).toBeNull()
    expect(req.text).toBe(text)
  })
})

/* ------------------------------------------- nothing else changed */

describe('the existing paths are untouched', () => {
  it('the Copilot panel references no speech provider', async () => {
    const fs = await import('node:fs')
    const panel = fs.readFileSync('src/components/copilot/Copilot.tsx', 'utf8')
    for (const s of ['speechToTextProvider', 'textToSpeechProvider', 'synthesize', 'transcribe']) {
      expect(panel, `the panel must stay text-only in Phase D (${s})`).not.toContain(s)
    }
  })

  it('the Loam orchestrator references no speech provider', async () => {
    const fs = await import('node:fs')
    const orch = fs.readFileSync('src/lib/loam/orchestrator.ts', 'utf8')
    expect(orch).not.toContain('speechToText')
    expect(orch).not.toContain('textToSpeech')
  })
})
