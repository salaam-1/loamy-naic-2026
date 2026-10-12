/**
 * Server-only client for the hosted Yoruba ASR endpoint.
 *
 * Never import this module into browser code. The Modal API key is read
 * exclusively from the backend environment and is never logged or returned.
 */
export interface ModalYorubaTranscript {
  text: string
  language: 'yo'
}

const DEFAULT_MODAL_URL =
  'https://braventitechnologies--loamy-yoruba-asr.modal.run'

export async function transcribeWithModalYoruba(
  audio: Uint8Array,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<ModalYorubaTranscript> {
  const apiKey = env.LOAM_MODAL_STT_API_KEY?.trim()
  const endpoint = env.LOAM_MODAL_STT_URL?.trim() || DEFAULT_MODAL_URL

  if (!apiKey) {
    throw new Error('STT_NOT_CONFIGURED')
  }

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('STT_CONFIGURATION_ERROR')
  }

  // Do not allow an environment setting to send the secret to an arbitrary
  // host. The deployed service is expected to use HTTPS.
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'braventitechnologies--loamy-yoruba-asr.modal.run'
  ) {
    throw new Error('STT_CONFIGURATION_ERROR')
  }

  if (audio.byteLength === 0 || audio.byteLength > 2_000_000) {
    throw new Error('STT_INVALID_AUDIO')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        audio_base64: Buffer.from(audio).toString('base64'),
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      if (response.status === 429) throw new Error('STT_RATE_LIMITED')
      if (response.status === 413) throw new Error('STT_INVALID_AUDIO')
      throw new Error('STT_UPSTREAM_FAILED')
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new Error('STT_INVALID_RESPONSE')
    }

    if (!body || typeof body !== 'object') {
      throw new Error('STT_INVALID_RESPONSE')
    }

    const result = body as Record<string, unknown>
    const text = typeof result.text === 'string' ? result.text.trim() : ''

    if (!text || result.language !== 'yo') {
      throw new Error('STT_INVALID_RESPONSE')
    }

    return { text, language: 'yo' }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('STT_')) {
      throw error
    }
    if (controller.signal.aborted) throw new Error('STT_TIMEOUT')
    throw new Error('STT_UPSTREAM_FAILED')
  } finally {
    clearTimeout(timeout)
  }
}
