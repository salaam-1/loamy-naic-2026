/**
 * Hosted Yoruba speech-to-text adapter.
 *
 * Browser audio is sent only to the authenticated Loam backend.
 * The Modal endpoint and API key remain server-side.
 * Transcripts are explicitly unverified until their quality is evaluated.
 */
import {
  providerError,
  type ProviderError,
  type ProviderResult,
} from '@/lib/providers/types'
import {
  STT_MAX_AUDIO_BYTES,
  setSpeechToTextProvider,
  validateSttRequest,
  type SpeechToTextProvider,
  type SpeechTranscript,
  type SttRequest,
} from '@/lib/providers/stt'
import { STT_WAV_MIME, inspectWav } from '@/lib/providers/wav'
import { supabase } from '@/lib/supabase'
import { LOAM_API_BASE } from '@/lib/loam/transport'
import type { VoiceLanguage } from '@/lib/loam/voice'

export const MODAL_STT_ENDPOINT =
  `${LOAM_API_BASE}/loam/stt/transcribe`

const MODAL_STT_TIMEOUT_MS = 180_000

function mapStatus(status: number, message: string): ProviderError {
  switch (status) {
    case 401:
    case 403:
      return providerError('unauthorized', message, { retryable: false })
    case 400:
    case 413:
    case 415:
      return providerError('invalid_request', message, { retryable: false })
    case 422:
      return providerError('rejected', message, { retryable: false })
    case 429:
      return providerError('rate_limited', message)
    case 503:
      return providerError('unavailable', message)
    case 504:
      return providerError('timeout', message)
    default:
      return providerError('unknown', message, { retryable: false })
  }
}

export interface ModalSttOptions {
  endpoint?: string
  accessToken?: () => Promise<string | null>
  fetchImpl?: typeof fetch
}

export function createModalYorubaStt(
  opts: ModalSttOptions = {},
): SpeechToTextProvider {
  const endpoint = opts.endpoint ?? MODAL_STT_ENDPOINT
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const token = opts.accessToken ?? (async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  })

  return {
    info: {
      key: 'loam-modal-yoruba-stt',
      label: 'Hosted Yoruba speech-to-text',
      mode: 'live',
    },

    // No language is advertised as verified until transcript quality has
    // been reviewed by a person.
    languages: [],
    maxAudioBytes: STT_MAX_AUDIO_BYTES,
    canDetectLanguage: false,

    supports(language: VoiceLanguage): boolean {
      return language === 'yo'
    },

    async transcribe(
      req: SttRequest,
    ): Promise<ProviderResult<SpeechTranscript>> {
      const invalid = validateSttRequest(req, {
        maxAudioBytes: STT_MAX_AUDIO_BYTES,
        accepted: STT_WAV_MIME,
      })
      if (invalid) return { ok: false, error: invalid }

      if (req.language !== 'yo') {
        return {
          ok: false,
          error: providerError(
            'invalid_request',
            'Hosted voice input currently supports Yoruba only.',
            { retryable: false },
          ),
        }
      }

      const wav = inspectWav(req.audio)
      if (!wav.ok) {
        return {
          ok: false,
          error: providerError('invalid_request', wav.reason, {
            retryable: false,
          }),
        }
      }

      if (req.signal?.aborted) {
        return {
          ok: false,
          error: providerError('timeout', 'Voice input was cancelled.'),
        }
      }

      let jwt: string | null
      try {
        jwt = await token()
      } catch {
        return {
          ok: false,
          error: providerError(
            'unauthorized',
            'Your session could not be verified. Sign in again.',
            { retryable: false },
          ),
        }
      }

      if (!jwt) {
        return {
          ok: false,
          error: providerError(
            'unauthorized',
            'Sign in to use voice input.',
            { retryable: false },
          ),
        }
      }

      const controller = new AbortController()
      const onAbort = () => controller.abort()
      req.signal?.addEventListener('abort', onAbort, { once: true })
      if (req.signal?.aborted) controller.abort()

      const timer = setTimeout(
        () => controller.abort(),
        req.timeoutMs ?? MODAL_STT_TIMEOUT_MS,
      )

      let response: Response
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Loam-Language': 'yo',
            Authorization: `Bearer ${jwt}`,
          },
          body: new Uint8Array(req.audio),
          signal: controller.signal,
        })
      } catch {
        return {
          ok: false,
          error: controller.signal.aborted
            ? providerError('timeout', 'Transcription took too long or was cancelled.')
            : providerError('unavailable', 'Voice input could not reach the server.'),
        }
      } finally {
        clearTimeout(timer)
        req.signal?.removeEventListener('abort', onAbort)
      }

      const body = await response.json().catch(() => null) as {
        text?: unknown
        error?: unknown
        language?: unknown
        verified?: unknown
      } | null

      if (!response.ok) {
        const message = typeof body?.error === 'string' && body.error
          ? body.error
          : 'Yoruba transcription failed.'
        return {
          ok: false,
          error: mapStatus(response.status, message),
        }
      }

      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text || body?.language !== 'yo') {
        return {
          ok: false,
          error: providerError(
            'rejected',
            'No valid Yoruba transcript was returned.',
            { retryable: false },
          ),
        }
      }

      return {
        ok: true,
        mode: 'live',
        value: {
          text,
          detectedLanguage: null,
          confidence: null,
          verified: false,
          provider: 'modal-yoruba-asr',
        },
      }
    },
  }
}

/** Explicit registration; importing this module does not activate recording. */
export function enableModalYorubaStt(
  opts: ModalSttOptions = {},
): SpeechToTextProvider {
  const provider = createModalYorubaStt(opts)
  setSpeechToTextProvider(provider)
  return provider
}
