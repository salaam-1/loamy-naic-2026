import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_STT_UNVERIFIED_LANGUAGES, LOCAL_STT_VERIFIED_LANGUAGES,
  STT_MAX_AUDIO_BYTES, STT_MAX_AUDIO_SECONDS, STT_REQUIRED_SAMPLE_RATE, STT_WAV_MIME,
  createLocalYorubaStt, enableLocalYorubaStt, inspectWav,
  noSpeechToTextProvider, providerStatus, setSpeechToTextProvider, speechToTextProvider,
  type SttRequest,
} from '@/lib/providers'
import type { VoiceLanguage } from '@/lib/loam/voice'

/**
 * The local Yoruba speech-to-text adapter.
 *
 * WHAT THESE TESTS ARE FOR
 *   The model is real and runs on CPU, so the risks are no longer "does a
 *   seam exist". They are: that it activates by accident, that it claims
 *   languages it has not been verified on, that it hands arbitrary bytes to a
 *   decoder because a MIME string said WAV, and that it reports a blank
 *   transcript as a success.
 *
 *   No model is loaded here. Every test injects a fake fetch; the real worker
 *   is a separate process and a unit test must never need 922 MiB of weights.
 */

/* --------------------------------------------------------------- helpers */

/** A real RIFF/WAVE file, built byte by byte so the parser is tested for real. */
function wav(opts: {
  sampleRate?: number; channels?: number; bits?: number
  seconds?: number; encoding?: number
} = {}): Uint8Array {
  const sampleRate = opts.sampleRate ?? STT_REQUIRED_SAMPLE_RATE
  const channels = opts.channels ?? 1
  const bits = opts.bits ?? 16
  const seconds = opts.seconds ?? 1
  const encoding = opts.encoding ?? 1

  const bytesPerFrame = (bits / 8) * channels
  const dataBytes = Math.max(0, Math.round(sampleRate * seconds) * bytesPerFrame)
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const b = new Uint8Array(buf)
  const put = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) b[at + i] = s.charCodeAt(i)
  }
  put(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); put(8, 'WAVE')
  put(12, 'fmt '); v.setUint32(16, 16, true)
  v.setUint16(20, encoding, true); v.setUint16(22, channels, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * bytesPerFrame, true)
  v.setUint16(32, bytesPerFrame, true); v.setUint16(34, bits, true)
  put(36, 'data'); v.setUint32(40, dataBytes, true)
  return b
}

const GOOD_WAV = wav({ seconds: 2 })

const req = (over: Partial<SttRequest> = {}): SttRequest => ({
  audio: GOOD_WAV, mimeType: 'audio/wav', language: 'yo', ...over,
})

/** A fetch that answers once with the given status and body. */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch
}

const adapter = (status: number, body: unknown, over: Record<string, unknown> = {}) =>
  createLocalYorubaStt({
    fetchImpl: fakeFetch(status, body),
    accessToken: async () => 'PLACEHOLDER-test-jwt-value',
    ...over,
  })

afterEach(() => {
  vi.restoreAllMocks()
  setSpeechToTextProvider(noSpeechToTextProvider)
})

/* ---------------------------------------------------- disabled by default */

describe('speech-to-text stays off unless someone turns it on', () => {
  it('the default provider is still the disabled one', () => {
    expect(speechToTextProvider()).toBe(noSpeechToTextProvider)
    expect(speechToTextProvider().info.mode).toBe('disabled')
    expect(speechToTextProvider().info.key).toBe('none')
  })

  it('providerStatus reports disabled, and the other seams are unchanged', () => {
    const status = providerStatus()
    expect(status.stt.mode).toBe('disabled')
    // Building an STT adapter must not disturb anything else.
    expect(status.weather.mode).toBe('live')
    expect(status.tts.mode).toBe('disabled')
    expect(status.messaging.mode).toBe('disabled')
    expect(status.financing.mode).toBe('disabled')
  })

  it('merely CREATING the adapter does not register it', () => {
    /**
     * The distinction the seam's first rule depends on. Importing a module or
     * constructing an object must never be what puts a microphone pipeline
     * live; that has to be an explicit act.
     */
    createLocalYorubaStt({ fetchImpl: fakeFetch(200, { text: 'bale' }) })
    expect(speechToTextProvider()).toBe(noSpeechToTextProvider)
  })

  it('only enableLocalYorubaStt() registers it, and it can be put back', () => {
    const p = enableLocalYorubaStt({ fetchImpl: fakeFetch(200, { text: 'bale' }) })
    expect(speechToTextProvider()).toBe(p)
    expect(speechToTextProvider().info.key).toBe('loam-local-stt')
    setSpeechToTextProvider(noSpeechToTextProvider)
    expect(speechToTextProvider()).toBe(noSpeechToTextProvider)
  })
})

/* -------------------------------------------------------------- languages */

describe('it separates verified languages from merely routable ones', () => {
  const a = adapter(200, { text: 'bale' })

  it('advertises the four languages with their own verified model', () => {
    /**
     * Four SEPARATE official NCAIR checkpoints, each run against a real
     * recording in its own language and read by a person:
     *   yo Yoruba-ASR | ha Hausa-ASR | ig Igbo-ASR | en NigerianAccentedEnglish
     */
    expect([...a.languages]).toEqual(['en', 'ha', 'ig', 'yo'])
    expect([...LOCAL_STT_VERIFIED_LANGUAGES]).toEqual(['en', 'ha', 'ig', 'yo'])
  })

  it('keeps Nigerian Pidgin in a separate list, because its model is absent', () => {
    /**
     * NCAIR publishes no Pidgin ASR model -- four ASR models plus the
     * N-ATLaS text model, verified against the Hub API. The worker is
     * configured with a third-party fine-tune that is not installed, so
     * nothing has been heard and `languages` must not claim it.
     */
    expect([...LOCAL_STT_UNVERIFIED_LANGUAGES]).toEqual(['pcm'])
    expect(a.languages).not.toContain('pcm')
    expect(a.supports('pcm')).toBe(false)
  })

  it('supports Igbo through its OWN model, not through a stand-in', () => {
    /**
     * Whisper has no `<|ig|>` token, so the base model cannot be conditioned
     * on Igbo at all. NCAIR1/Igbo-ASR reaches it through the checkpoint's own
     * decoding -- which is why the worker passes no `language` for Igbo, and
     * why "ig is supported" is a claim about that model and nothing else.
     */
    expect(a.supports('ig')).toBe(true)
    expect([...LOCAL_STT_VERIFIED_LANGUAGES]).toContain('ig')
  })

  it('does not claim language detection', () => {
    expect(a.canDetectLanguage).toBe(false)
  })

  it('refuses an unverified language by default, and says why', async () => {
    const fetchImpl = fakeFetch(200, { text: 'should never be reached' })
    const p = createLocalYorubaStt({ fetchImpl, accessToken: async () => 'PLACEHOLDER-jwt' })
    const r = await p.transcribe(req({ language: 'pcm' }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('not_configured')
      // Specific, and it names what to do instead. Never a silent fallback
      // to the English model: Pidgin is not accented English.
      expect(r.error.message).toMatch(/not set up on this machine/i)
      expect(r.error.message).toMatch(/English, Hausa, Igbo or Yoru/i)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reaches an unverified language only with the explicit opt-in', async () => {
    const fetchImpl = fakeFetch(200, { text: 'maize is a cereal grain', verified: false })
    const p = createLocalYorubaStt({
      fetchImpl, accessToken: async () => 'PLACEHOLDER-jwt', allowUnverified: true,
    })
    expect(p.supports('pcm')).toBe(true)
    const r = await p.transcribe(req({ language: 'pcm' }))
    expect(r.ok).toBe(true)
    // Reached, and still marked unverified. The opt-in widens access, not truth.
    if (r.ok) expect(r.value.verified).toBe(false)
  })

  it('the opt-in does NOT widen the advertised language list', async () => {
    const p = createLocalYorubaStt({
      fetchImpl: fakeFetch(200, { text: 'x' }), allowUnverified: true,
    })
    // `languages` answers "what works". A language with no installed model
    // is not that, however the opt-in is set.
    expect([...p.languages]).toEqual(['en', 'ha', 'ig', 'yo'])
    expect(p.languages).not.toContain('pcm')
  })

  it('never silently substitutes the model of one language for another', () => {
    /**
     * The hazard this whole design exists to prevent. Each language is a
     * DIFFERENT model, so a wrong route is not a slightly worse transcript --
     * it is fluent text that transcribes nothing. Pidgin has no installed
     * model, and the correct behaviour is to say so, not to use the English
     * one because Pidgin "is a kind of English". It is not.
     */
    expect(LOCAL_STT_VERIFIED_LANGUAGES).not.toContain('pcm')
    expect(LOCAL_STT_UNVERIFIED_LANGUAGES).toContain('pcm')
    for (const lang of LOCAL_STT_VERIFIED_LANGUAGES) {
      expect(LOCAL_STT_UNVERIFIED_LANGUAGES, lang).not.toContain(lang)
    }
  })

  it('refuses null (detect it for me) rather than guessing', async () => {
    const fetchImpl = fakeFetch(200, { text: 'nope' })
    const p = createLocalYorubaStt({ fetchImpl, accessToken: async () => 'PLACEHOLDER-jwt' })
    const r = await p.transcribe(req({ language: null }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('invalid_request')
      expect(r.error.retryable).toBe(false)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------- the audio */

describe('audio is validated by its bytes, not by its label', () => {
  it('rejects empty audio', async () => {
    const r = await adapter(200, { text: 'x' }).transcribe(req({ audio: new Uint8Array() }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('invalid_request')
  })

  it('rejects audio over the shared 2,000,000-byte limit', async () => {
    expect(STT_MAX_AUDIO_BYTES).toBe(2_000_000)
    const huge = new Uint8Array(STT_MAX_AUDIO_BYTES + 1)
    huge.set(GOOD_WAV.subarray(0, 44))
    const r = await adapter(200, { text: 'x' }).transcribe(req({ audio: huge }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('invalid_request')
  })

  it('rejects a MIME type the decoder cannot read', async () => {
    // STT_ACCEPTED_MIME lists six formats; `soundfile` reads one of them.
    expect([...STT_WAV_MIME]).toEqual(['audio/wav', 'audio/x-wav'])
    for (const mimeType of ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg']) {
      const r = await adapter(200, { text: 'x' }).transcribe(req({ mimeType }))
      expect(r.ok, mimeType).toBe(false)
    }
  })

  it('rejects a WebM blob relabelled as WAV', async () => {
    /**
     * The check that matters most. MediaRecorder produces WebM by default; if
     * the label were trusted, those bytes would reach the decoder and whatever
     * came back would be reported as a transcript.
     */
    const webm = new Uint8Array(200)
    webm.set([0x1a, 0x45, 0xdf, 0xa3]) // EBML magic
    const r = await adapter(200, { text: 'x' }).transcribe(
      req({ audio: webm, mimeType: 'audio/wav' }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toMatch(/not a WAV/i)
  })

  it('rejects a truncated WAV header', async () => {
    const r = await adapter(200, { text: 'x' }).transcribe(
      req({ audio: GOOD_WAV.subarray(0, 20) }),
    )
    expect(r.ok).toBe(false)
  })
})

describe('inspectWav refuses what the model cannot be measured on', () => {
  it('accepts 16 kHz mono PCM and reports the duration', () => {
    const r = inspectWav(wav({ seconds: 5.23 }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.facts.sampleRate).toBe(16_000)
      expect(r.facts.channels).toBe(1)
      expect(r.facts.durationSeconds).toBeCloseTo(5.23, 2)
    }
  })

  it('refuses the wrong sample rate instead of resampling it', () => {
    // Silently resampling would change the input the model is measured on.
    const r = inspectWav(wav({ sampleRate: 44_100 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/16 kHz/)
  })

  it('refuses stereo instead of downmixing it', () => {
    const r = inspectWav(wav({ channels: 2 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/mono/i)
  })

  it('refuses a recording longer than the duration ceiling', () => {
    /**
     * A byte limit is not a duration limit. 2,000,000 bytes of 16 kHz mono
     * 16-bit PCM is about 62 seconds, and CPU inference runs slower than
     * realtime -- so one request could hold the single slot for minutes.
     */
    expect(STT_MAX_AUDIO_SECONDS).toBe(30)
    const long = inspectWav(wav({ seconds: STT_MAX_AUDIO_SECONDS + 1 }))
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.reason).toMatch(/30 seconds/)
  })

  it('refuses an encoding it cannot read rather than guessing', () => {
    const r = inspectWav(wav({ encoding: 0xfffe })) // WAVE_FORMAT_EXTENSIBLE
    expect(r.ok).toBe(false)
  })

  it('refuses a header with no data chunk', () => {
    const r = inspectWav(wav({ seconds: 0 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/no audio/i)
  })
})

/* ------------------------------------------------------------ the server */

describe('what comes back from the server is validated', () => {
  it('returns a transcript on success, with no fabricated confidence', async () => {
    const r = await adapter(200, { text: '  bale o  ', audioSeconds: 5.23 }).transcribe(req())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.text).toBe('bale o')
      expect(r.value.provider).toBe('loam-local-stt')
      // Absent, not zero. Zero would read as certainty that it is wrong.
      expect(r.value.confidence).toBeNull()
      // Not a detection claim: the language was asked for, not recognised.
      expect(r.value.detectedLanguage).toBeNull()
      expect(r.mode).toBe('live')
    }
  })

  it('rejects a blank transcript returned with status 200', async () => {
    for (const body of [{ text: '' }, { text: '   ' }, { text: null }, {}]) {
      const r = await adapter(200, body).transcribe(req())
      expect(r.ok, JSON.stringify(body)).toBe(false)
      if (!r.ok) expect(r.error.kind).toBe('rejected')
    }
  })

  it('maps a missing session to unauthorized without sending audio', async () => {
    const fetchImpl = fakeFetch(200, { text: 'nope' })
    const p = createLocalYorubaStt({ fetchImpl, accessToken: async () => null })
    const r = await p.transcribe(req())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('unauthorized')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps each server status to the right provider error kind', async () => {
    const cases: [number, string, boolean][] = [
      [401, 'unauthorized', false],
      [400, 'invalid_request', false],
      [413, 'invalid_request', false],
      [415, 'invalid_request', false],
      [422, 'rejected', false],
      [503, 'unavailable', true],
      [504, 'timeout', true],
    ]
    for (const [status, kind, retryable] of cases) {
      const r = await adapter(status, { error: 'nope' }).transcribe(req())
      expect(r.ok, String(status)).toBe(false)
      if (!r.ok) {
        expect(r.error.kind, String(status)).toBe(kind)
        expect(r.error.retryable, String(status)).toBe(retryable)
      }
    }
  })

  it('treats an unreachable worker as unavailable, not as a crash', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const p = createLocalYorubaStt({ fetchImpl, accessToken: async () => 'PLACEHOLDER-jwt' })
    const r = await p.transcribe(req())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('unavailable')
  })

  it('treats an abort as a timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e
    }) as unknown as typeof fetch
    const p = createLocalYorubaStt({ fetchImpl, accessToken: async () => 'PLACEHOLDER-jwt' })
    const r = await p.transcribe(req())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('timeout')
  })

  it('honours caller cancellation', async () => {
    const ac = new AbortController()
    // Models real `fetch`: an already-aborted signal rejects immediately
    // rather than waiting for an 'abort' event that has already fired.
    const fetchImpl = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_r, reject) => {
      const fail = () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
      }
      if (init?.signal?.aborted) return fail()
      init?.signal?.addEventListener('abort', fail, { once: true })
    })) as unknown as typeof fetch
    const p = createLocalYorubaStt({ fetchImpl, accessToken: async () => 'PLACEHOLDER-jwt' })
    const pending = p.transcribe(req({ signal: ac.signal }))
    ac.abort()
    const r = await pending
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('timeout')
  })
})

/* ------------------------------------------------------- what it sends */

describe('the request it sends', () => {
  it('posts raw bytes same-origin with the JWT and the language, and no worker secret', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: 'bale' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch
    const p = createLocalYorubaStt({ fetchImpl, accessToken: async () => 'PLACEHOLDER-jwt' })
    await p.transcribe(req())

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as
      [string, RequestInit]
    // Same-origin. The browser never learns the worker's address.
    expect(url).toBe('/loam/stt/transcribe')
    expect(url).not.toMatch(/127\.0\.0\.1|localhost|:\d{4}/)
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(headers['X-Loam-Language']).toBe('yo')
    expect(headers.Authorization).toMatch(/^Bearer /)
    // The worker secret is a server-side credential and must never be here.
    expect(Object.keys(headers).join(',')).not.toMatch(/worker-secret/i)
  })

  it('never names the worker host or secret anywhere in client source', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/lib/providers/stt-local.ts', 'utf8')
    expect(src).not.toMatch(/127\.0\.0\.1/)
    expect(src).not.toMatch(/LOAM_STT_WORKER_SECRET/)
    expect(src).not.toMatch(/X-Loam-Worker-Secret/)
  })
})
