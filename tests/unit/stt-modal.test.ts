import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createModalYorubaStt,
  noSpeechToTextProvider,
  setSpeechToTextProvider,
  type SttRequest,
} from '@/lib/providers'

function makeWav(): Uint8Array {
  const sampleRate = 16_000
  const dataBytes = sampleRate * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const put = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      bytes[at + i] = value.charCodeAt(i)
    }
  }

  put(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  put(36, 'data')
  view.setUint32(40, dataBytes, true)
  return bytes
}

const goodWav = makeWav()

const request = (overrides: Partial<SttRequest> = {}): SttRequest => ({
  audio: goodWav,
  mimeType: 'audio/wav',
  language: 'yo',
  ...overrides,
})

function responseFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch
}

afterEach(() => {
  vi.restoreAllMocks()
  setSpeechToTextProvider(noSpeechToTextProvider)
})

describe('hosted Yoruba speech-to-text adapter', () => {
  it('can be constructed without registering or activating it', () => {
    const provider = createModalYorubaStt({
      accessToken: async () => 'test-jwt',
      fetchImpl: responseFetch(200, { text: 'test', language: 'yo' }),
    })

    expect(provider.info.key).toBe('loam-modal-yoruba-stt')
    expect(provider.supports('yo')).toBe(true)
    expect(provider.supports('en')).toBe(false)
    expect(provider.supports('ha')).toBe(false)
    expect(provider.supports('ig')).toBe(false)
    expect(provider.supports('pcm')).toBe(false)
    expect(provider.languages).toEqual([])
    expect(provider.canDetectLanguage).toBe(false)
    expect(noSpeechToTextProvider.info.mode).toBe('disabled')
  })

  it('rejects non-Yoruba requests without making a network request', async () => {
    const fetchImpl = responseFetch(200, { text: 'should not be used', language: 'yo' })
    const provider = createModalYorubaStt({
      accessToken: async () => 'test-jwt',
      fetchImpl,
    })

    const result = await provider.transcribe(request({ language: 'en' }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalid_request')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects malformed WAV data before requesting a token or contacting the server', async () => {
    const accessToken = vi.fn(async () => 'test-jwt')
    const fetchImpl = responseFetch(200, { text: 'test', language: 'yo' })
    const provider = createModalYorubaStt({ accessToken, fetchImpl })

    const result = await provider.transcribe(request({
      audio: new Uint8Array([1, 2, 3, 4]),
    }))

    expect(result.ok).toBe(false)
    expect(accessToken).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires a session before sending audio', async () => {
    const fetchImpl = responseFetch(200, { text: 'test', language: 'yo' })
    const provider = createModalYorubaStt({
      accessToken: async () => null,
      fetchImpl,
    })

    const result = await provider.transcribe(request())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('unauthorized')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends WAV audio to the Loam backend and marks the transcript unverified', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      text: 'Ẹ káàbọ̀',
      language: 'yo',
      provider: 'modal-yoruba-asr',
      verified: false,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch

    const provider = createModalYorubaStt({
      endpoint: 'https://loam-copilot-backend.fly.dev/loam/stt/transcribe',
      accessToken: async () => 'test-jwt',
      fetchImpl,
    })

    const result = await provider.transcribe(request())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.text).toBe('Ẹ káàbọ̀')
      expect(result.value.provider).toBe('modal-yoruba-asr')
      expect(result.value.verified).toBe(false)
      expect(result.mode).toBe('live')
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://loam-copilot-backend.fly.dev/loam/stt/transcribe')
    expect(url).not.toContain('modal.run')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/octet-stream')
    expect(new Headers(init.headers).get('X-Loam-Language')).toBe('yo')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-jwt')
    expect(init.body).toBeInstanceOf(Uint8Array)
  })

  it('rejects an empty or wrong-language successful response', async () => {
    const provider = createModalYorubaStt({
      accessToken: async () => 'test-jwt',
      fetchImpl: responseFetch(200, { text: '   ', language: 'yo' }),
    })

    const result = await provider.transcribe(request())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('rejected')
  })

  it('rejects a successful response that omits the language field', async () => {
    const provider = createModalYorubaStt({
      accessToken: async () => 'test-jwt',
      fetchImpl: responseFetch(200, { text: 'Ẹ káàbọ̀' }),
    })

    const result = await provider.transcribe(request())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('rejected')
  })
  it('maps server errors without including the JWT in the error message', async () => {
    const jwt = 'test-jwt-not-for-output'
    const provider = createModalYorubaStt({
      accessToken: async () => jwt,
      fetchImpl: responseFetch(503, { error: 'STT_UPSTREAM_FAILED' }),
    })

    const result = await provider.transcribe(request())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('unavailable')
      expect(result.error.message).not.toContain(jwt)
    }
  })
})
