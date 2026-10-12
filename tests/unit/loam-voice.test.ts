import { describe, expect, it, vi } from 'vitest'
import {
  VOICE_LANGUAGES, VOICE_LANGUAGE_LABEL, chatLanguageFor, isVoiceLanguage, narrowsLanguage,
} from '@/lib/loam/voice'
import {
  RECORDER_MAX_SECONDS, RecorderError, encodeWav, startRecording,
} from '@/lib/loam/voice-recorder'
import { inspectWav } from '@/lib/providers/wav'
import { LOAM_LANGUAGES } from '@/lib/loam/language'

/**
 * The five voice languages, and the WAV the browser produces for them.
 *
 * No microphone and no AudioContext: both are injected, so these run in node
 * and assert behaviour rather than mocking it away.
 */

/* ------------------------------------------------------------- languages */

describe('five spoken languages, four answered languages', () => {
  it('offers all five, including Nigerian Pidgin', () => {
    expect([...VOICE_LANGUAGES]).toEqual(['en', 'ha', 'ig', 'yo', 'pcm'])
  })

  it('is deliberately WIDER than the languages Loam answers in', () => {
    /**
     * `LoamLanguage` is the four N-ATLaS's card documents. Speech covers a
     * fifth because a separate ASR model transcribes it. Widening
     * `LoamLanguage` instead would assert that the conversational model
     * answers in Pidgin, which nobody has established.
     */
    expect([...LOAM_LANGUAGES]).toEqual(['en', 'ha', 'ig', 'yo'])
    expect(VOICE_LANGUAGES.length).toBe(LOAM_LANGUAGES.length + 1)
    for (const l of LOAM_LANGUAGES) expect(VOICE_LANGUAGES).toContain(l)
    expect(LOAM_LANGUAGES).not.toContain('pcm')
  })

  it('labels each language with its own name for itself', () => {
    // A selector showing "Yoruba" to someone looking for "Yorùbá" is useless
    // to the person who needs it.
    expect(VOICE_LANGUAGE_LABEL.yo).toBe('Yorùbá')
    expect(VOICE_LANGUAGE_LABEL.pcm).toMatch(/Naijá/)
    for (const l of VOICE_LANGUAGES) expect(VOICE_LANGUAGE_LABEL[l]).toBeTruthy()
  })

  it('narrows only Pidgin, and says so', () => {
    for (const l of ['en', 'ha', 'ig', 'yo'] as const) {
      expect(chatLanguageFor(l), l).toBe(l)
      expect(narrowsLanguage(l), l).toBe(false)
    }
    // Pidgin is transcribed as Pidgin and ANSWERED in English, because
    // N-ATLaS has no documented Pidgin mode.
    expect(chatLanguageFor('pcm')).toBe('en')
    expect(narrowsLanguage('pcm')).toBe(true)
  })

  it('validates a language code', () => {
    expect(isVoiceLanguage('pcm')).toBe(true)
    for (const bad of ['fr', 'sw', '', null, undefined, 42, 'PCM']) {
      expect(isVoiceLanguage(bad), String(bad)).toBe(false)
    }
  })
})

/* ---------------------------------------------------------- wav encoding */

describe('the browser writes a WAV the worker can actually read', () => {
  it('produces a header that the shared validator accepts', () => {
    /**
     * The two sides are tested against each other on purpose: the recorder
     * writes the header and `inspectWav` -- the same parser the provider and
     * the route use -- has to accept it. A recorder that produced bytes its
     * own validator rejected would fail only at runtime.
     */
    const samples = new Float32Array(16_000)
    const wav = encodeWav(samples, 16_000)
    const r = inspectWav(wav)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.facts.sampleRate).toBe(16_000)
      expect(r.facts.channels).toBe(1)
      expect(r.facts.bitsPerSample).toBe(16)
      expect(r.facts.durationSeconds).toBeCloseTo(1, 3)
    }
  })

  it('declares whatever rate the hardware gave, not a rate we wish for', () => {
    // An AudioContext runs at hardware rate; asking for 16 kHz is a request
    // browsers ignore. The worker resamples, so honesty here is what matters.
    for (const rate of [44_100, 48_000]) {
      const wav = encodeWav(new Float32Array(rate), rate)
      const r = inspectWav(wav)
      // `inspectWav` requires 16 kHz, so a 48 kHz file is correctly refused
      // by the browser-side validator and resampled server-side instead.
      expect(r.ok).toBe(false)
      // But the HEADER must still say 48000, which is what lets the worker
      // resample correctly.
      expect(new DataView(wav.buffer).getUint32(24, true)).toBe(rate)
    }
  })

  it('is exactly 44 bytes of header plus two bytes per sample', () => {
    const wav = encodeWav(new Float32Array(1000), 16_000)
    expect(wav.byteLength).toBe(44 + 2000)
  })

  it('clamps out-of-range samples instead of letting them wrap', () => {
    /**
     * A sample above 1.0 multiplied and cast would wrap from +32767 to a
     * large negative value -- an audible click, and in a sequence, noise the
     * model would try to transcribe.
     */
    const wav = encodeWav(new Float32Array([2, -2, 0]), 16_000)
    const view = new DataView(wav.buffer)
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
    expect(view.getInt16(48, true)).toBe(0)
  })

  it('round-trips a known signal', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 8000)
    const view = new DataView(wav.buffer)
    expect(view.getInt16(44, true)).toBe(0)
    // setInt16 truncates toward zero: 0.5 * 32767 = 16383.5 -> 16383.
    expect(view.getInt16(46, true)).toBe(16383)
    expect(view.getInt16(48, true)).toBe(-0.5 * 0x8000)
    expect(view.getInt16(50, true)).toBe(32767)
  })
})

/* -------------------------------------------------------------- recorder */

/** A minimal AudioContext good enough to drive the capture path. */
function fakeAudio(sampleRate = 48_000) {
  const stopped: string[] = []
  let processor: { onaudioprocess: ((e: unknown) => void) | null } = { onaudioprocess: null }
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } })
  const ctx = {
    sampleRate,
    createMediaStreamSource: vi.fn(() => node()),
    createGain: vi.fn(() => node()),
    createScriptProcessor: vi.fn(() => {
      processor = { ...node(), onaudioprocess: null } as never
      return processor
    }),
    close: vi.fn(async () => { stopped.push('context') }),
  }
  const track = { stop: vi.fn(() => { stopped.push('track') }) }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  return {
    stopped,
    track,
    feed(samples: Float32Array) {
      processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } })
    },
    deps: {
      getUserMedia: vi.fn(async () => stream),
      // A constructor, not an arrow: the recorder calls `new Ctx()`.
      AudioContextImpl: (function Fake() { return ctx }) as unknown as typeof AudioContext,
    },
  }
}

describe('the microphone is only ever opened deliberately', () => {
  it('maps a denied permission to a message that says what to do', async () => {
    const denied = Object.assign(new Error('nope'), { name: 'NotAllowedError' })
    await expect(startRecording({
      getUserMedia: vi.fn(async () => { throw denied }),
      AudioContextImpl: fakeAudio().deps.AudioContextImpl,
    })).rejects.toMatchObject({ kind: 'permission_denied' })

    try {
      await startRecording({
        getUserMedia: vi.fn(async () => { throw denied }),
        AudioContextImpl: fakeAudio().deps.AudioContextImpl,
      })
    } catch (e) {
      expect((e as RecorderError).message).toMatch(/allow it in your browser settings/i)
      expect((e as RecorderError).message).toMatch(/type instead/i)
    }
  })

  it('distinguishes no microphone from a refusal', async () => {
    await expect(startRecording({
      getUserMedia: vi.fn(async () => {
        throw Object.assign(new Error('x'), { name: 'NotFoundError' })
      }),
      AudioContextImpl: fakeAudio().deps.AudioContextImpl,
    })).rejects.toMatchObject({ kind: 'no_microphone' })
  })

  it('reports an unsupported browser rather than throwing something opaque', async () => {
    await expect(startRecording({ getUserMedia: undefined, AudioContextImpl: undefined }))
      .rejects.toMatchObject({ kind: 'unsupported' })
  })

  it('records, then releases the microphone on stop', async () => {
    const a = fakeAudio(48_000)
    const rec = await startRecording(a.deps)
    a.feed(new Float32Array(48_000).fill(0.25))
    const { wav, sampleRate, seconds } = await rec.stop()

    expect(sampleRate).toBe(48_000)
    expect(seconds).toBeCloseTo(1, 2)
    expect(wav.byteLength).toBe(44 + 48_000 * 2)
    // The recording indicator going out depends on every track stopping.
    expect(a.track.stop).toHaveBeenCalled()
    expect(a.stopped).toContain('track')
    expect(a.stopped).toContain('context')
  })

  it('releases the microphone on cancel and keeps nothing', async () => {
    const a = fakeAudio()
    const rec = await startRecording(a.deps)
    a.feed(new Float32Array(1000).fill(0.5))
    rec.cancel()
    expect(a.track.stop).toHaveBeenCalled()
    // Cancelling is a discard, so there is nothing left to hand anybody.
    await expect(rec.stop()).rejects.toMatchObject({ kind: 'empty' })
  })

  it('refuses an empty recording instead of sending silence', async () => {
    const a = fakeAudio()
    const rec = await startRecording(a.deps)
    await expect(rec.stop()).rejects.toMatchObject({ kind: 'empty' })
    expect(a.track.stop).toHaveBeenCalled()
  })

  it('refuses a recording past the duration ceiling', async () => {
    const a = fakeAudio(16_000)
    const rec = await startRecording(a.deps)
    a.feed(new Float32Array(16_000 * (RECORDER_MAX_SECONDS + 2)))
    await expect(rec.stop()).rejects.toMatchObject({ kind: 'too_long' })
  })

  it('asks for a single channel', async () => {
    const a = fakeAudio()
    await startRecording(a.deps)
    const constraints = a.deps.getUserMedia.mock.calls[0]![0] as MediaStreamConstraints
    expect((constraints.audio as MediaTrackConstraints).channelCount).toBe(1)
  })
})
