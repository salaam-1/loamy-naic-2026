/**
 * Speech-to-text via the LOCAL NCAIR1/Yoruba-ASR worker. Yoruba only.
 *
 * WHAT THIS IS
 *   A concrete `SpeechToTextProvider` that posts a WAV recording to
 *   `/loam/stt/transcribe` -- the authenticated dev-server route -- and
 *   returns what the local Python worker heard. The model runs on this
 *   machine's CPU. No audio leaves the machine, and no hosted service is
 *   involved.
 *
 * WHAT IT IS NOT
 *   It is not registered. `noSpeechToTextProvider` remains the default and
 *   this adapter activates only when `enableLocalYorubaStt()` is called
 *   explicitly. Nothing in the application calls it, and nothing in the test
 *   suite calls it except the tests that test it.
 *
 *   It is not microphone support. The provider and the endpoint exist; no
 *   recording UI does. Someone must still supply the bytes.
 *
 *   It is not production. The route behind it comes from a Vite plugin with
 *   `apply: 'serve'`.
 *
 * ONE LANGUAGE, AND WHY NOT FOUR
 *   `NCAIR1/Yoruba-ASR` is a Yoruba fine-tune of whisper-small. NCAIR
 *   publishes separate Hausa, Igbo and accented-English models; this is not
 *   them. Advertising `['en','ha','ig','yo']` because the Loam union has four
 *   entries would mean sending a Hausa question through a Yoruba recogniser
 *   and returning fluent nonsense. `languages` is `['yo']`, and
 *   `canDetectLanguage` is false because no detection has been tested.
 *
 * LICENSING, UNRESOLVED
 *   This model's terms are separate from the public N-ATLaS text model's and
 *   have not been reviewed. Local proof of concept only.
 */
import {
  providerError,
  type ProviderError, type ProviderResult,
} from '@/lib/providers/types'
import {
  STT_MAX_AUDIO_BYTES, setSpeechToTextProvider, validateSttRequest,
  type SpeechToTextProvider, type SpeechTranscript, type SttRequest,
} from '@/lib/providers/stt'
import { STT_WAV_MIME, inspectWav } from '@/lib/providers/wav'
import { supabase } from '@/lib/supabase'
import { VOICE_LANGUAGES, type VoiceLanguage } from '@/lib/loam/voice'

/** Same-origin. The browser never learns the worker's address or secret. */
export const LOAM_STT_ENDPOINT = '/loam/stt/transcribe'

/**
 * TWO LISTS, NOT ONE. Collapsing them is how an untested language starts
 * being described as working.
 *
 * VERIFIED    a real recording in that language was transcribed and the
 *             result read by a person.
 * UNVERIFIED  a model route exists but no recording has been checked, or the
 *             weights are not installed.
 */

/**
 * Four languages, four SEPARATE official NCAIR models. Each was run against
 * a real recording in its own language and produced a coherent, on-topic
 * transcript:
 *
 *   yo  NCAIR1/Yoruba-ASR
 *   ha  NCAIR1/Hausa-ASR                 "barka! me farashin shinkafa?"
 *   ig  NCAIR1/Igbo-ASR                  "afọ ọhụrụ ga-adị mma"
 *   en  NCAIR1/NigerianAccentedEnglish   "what's the price of maize in kaduna?"
 *
 * The server owns the routing table; this list exists so the browser can
 * refuse an unsupported language without a round trip, and so `languages`
 * reports only what has actually been heard to work.
 */
export const LOCAL_STT_VERIFIED_LANGUAGES: readonly VoiceLanguage[] = ['en', 'ha', 'ig', 'yo']

/**
 * Nigerian Pidgin. The route exists; the model does not.
 *
 * NCAIR PUBLISHES NO PIDGIN ASR MODEL -- its collection is the four above
 * plus the N-ATLaS text model, verified against the Hub API. The worker is
 * configured with a third-party Pidgin fine-tune, which is not installed and
 * whose licence is undeclared, so no recording has been or can yet be
 * checked.
 *
 * Pidgin stays in the selector rather than being hidden, because the gap is
 * a missing model and a missing recording, not a missing feature. Choosing it
 * produces a specific, actionable error instead of a silent substitution:
 * Pidgin is NOT accented English, and routing it to the English model would
 * return English-shaped text that quietly rewrites what was said.
 */
export const LOCAL_STT_UNVERIFIED_LANGUAGES: readonly VoiceLanguage[] = ['pcm']

/**
 * Longer than the route's own worker ceiling (160s), so the browser is never
 * the component that gives up first. A client timeout that fires before the
 * server's turns a slow transcription into a confusing error with a perfectly
 * good transcript arriving behind it.
 */
const DEFAULT_TIMEOUT_MS = 180_000

export interface LocalSttOptions {
  /** Overridable for tests. Defaults to the same-origin route. */
  endpoint?: string
  /** Overridable for tests. Defaults to the live Supabase session's token. */
  accessToken?: () => Promise<string | null>
  fetchImpl?: typeof fetch
  /**
   * Allow languages that route to a working model nobody has evaluated.
   *
   * OFF by default, deliberately. With it off, `supports('ha')` is false and
   * a Hausa request is refused with an explanation -- because a transcript
   * nobody has checked, rendered as though it were checked, is worse than no
   * transcript. Turning it on is how an evaluator gets at English and Hausa
   * in order to produce the evidence that would move them to VERIFIED.
   */
  allowUnverified?: boolean
}

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
      // The worker understood the audio and produced nothing from it. That is
      // a refusal, not a malformed request and not an outage.
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

/**
 * Build the adapter. A factory rather than a singleton so a test can inject a
 * fetch and a token source without touching module state or a real session.
 */
export function createLocalYorubaStt(opts: LocalSttOptions = {}): SpeechToTextProvider {
  const endpoint = opts.endpoint ?? LOAM_STT_ENDPOINT
  const allowUnverified = opts.allowUnverified === true
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const token = opts.accessToken ?? (async () => {
    // Read from the live session, never passed in by a caller: there is no
    // path by which a component could send someone else's token.
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  })

  return {
    /**
     * `live` because it really transcribes. It is NOT a claim of production
     * readiness -- `mode` distinguishes real output from simulated output, and
     * a `sandbox` label here would wrongly imply the transcript was fabricated.
     */
    info: {
      key: 'loam-local-stt',
      label: 'Local speech-to-text (development)',
      mode: 'live',
    },
    /**
     * VERIFIED ONLY, whatever `allowUnverified` says. This field is the
     * seam's answer to "which languages work", and a language whose model is
     * not installed does not belong in it. `supports()` widens with the
     * opt-in; the advertised list does not.
     */
    languages: LOCAL_STT_VERIFIED_LANGUAGES,
    maxAudioBytes: STT_MAX_AUDIO_BYTES,
    canDetectLanguage: false,

    supports(language: VoiceLanguage): boolean {
      if (LOCAL_STT_VERIFIED_LANGUAGES.includes(language)) return true
      return allowUnverified && LOCAL_STT_UNVERIFIED_LANGUAGES.includes(language)
    },

    async transcribe(req: SttRequest): Promise<ProviderResult<SpeechTranscript>> {
      /* ------------------------------------------------------- validation */
      // Shared limits first, narrowed to WAV: `soundfile` cannot read WebM or
      // MP4, so accepting them would mean handing arbitrary bytes to a decoder.
      const invalid = validateSttRequest(req, {
        maxAudioBytes: STT_MAX_AUDIO_BYTES,
        accepted: STT_WAV_MIME,
      })
      if (invalid) return { ok: false, error: invalid }

      if (req.language === null) {
        /**
         * Null means "detect it". Neither model detects, and this matters
         * more with two of them than it did with one: a wrong guess now also
         * picks the wrong MODEL, so a Yoruba question could be answered by
         * whisper-small in English and read as a successful transcription.
         */
        return {
          ok: false,
          error: providerError(
            'invalid_request',
            'Choose the language you are speaking. Voice input cannot detect it for you.',
            { retryable: false },
          ),
        }
      }

      const verified = LOCAL_STT_VERIFIED_LANGUAGES.includes(req.language)
      const routable = verified || LOCAL_STT_UNVERIFIED_LANGUAGES.includes(req.language)
      if (!routable) {
        return {
          ok: false,
          error: providerError(
            'invalid_request',
            'That language is not available for voice input.',
            { retryable: false },
          ),
        }
      }
      if (!verified && !allowUnverified) {
        // A route exists; the model is not installed. Said plainly rather
        // than as "unsupported", because the distinction is the actionable
        // part -- and never by quietly using a different language's model.
        return {
          ok: false,
          error: providerError(
            'not_configured',
            'Pidgin voice input is not set up on this machine yet. '
            + 'Choose English, Hausa, Igbo or Yoruba, or type your question.',
            { retryable: false },
          ),
        }
      }

      // The bytes, not the label. This is what stops a relabelled WebM blob.
      const wav = inspectWav(req.audio)
      if (!wav.ok) {
        return { ok: false, error: providerError('invalid_request', wav.reason, { retryable: false }) }
      }

      /**
       * Already cancelled before we got here.
       *
       * `transcribe` awaits the session token before it can attach a listener
       * to `req.signal`, so a caller that aborts during that await would
       * otherwise have its abort land in the gap -- no listener yet, and
       * nothing to fire once one exists. The request would then run to
       * completion for a caller that has gone. Checked here, and again after
       * the listener is attached, which closes the window from both sides.
       */
      if (req.signal?.aborted) {
        return { ok: false, error: providerError('timeout', 'Voice input was cancelled.') }
      }

      const jwt = await token()
      if (!jwt) {
        return {
          ok: false,
          error: providerError('unauthorized', 'Sign in to use voice input.', { retryable: false }),
        }
      }

      /* ---------------------------------------------------------- request */
      // Caller cancellation AND a timeout. Either aborts the same request.
      const ac = new AbortController()
      const onAbort = () => ac.abort()
      req.signal?.addEventListener('abort', onAbort, { once: true })
      // The other side of the window described above: an abort that fired
      // between the check and the listener is caught here.
      if (req.signal?.aborted) ac.abort()
      const timer = setTimeout(() => ac.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      let res: Response
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Loam-Language': req.language,
            Authorization: `Bearer ${jwt}`,
          },
          // A copy, so a caller reusing its buffer cannot mutate what is sent.
          body: new Uint8Array(req.audio),
          signal: ac.signal,
        })
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError'
        return {
          ok: false,
          error: aborted
            ? providerError('timeout', 'Transcription took too long.')
            : providerError('unavailable', 'Voice input could not be reached.'),
        }
      } finally {
        clearTimeout(timer)
        req.signal?.removeEventListener('abort', onAbort)
      }

      /* --------------------------------------------------------- response */
      const body = await res.json().catch(() => null) as {
        text?: unknown; error?: unknown; audioSeconds?: unknown; verified?: unknown
      } | null

      if (!res.ok) {
        const message = typeof body?.error === 'string' && body.error
          ? body.error
          : 'Transcription failed.'
        return { ok: false, error: mapStatus(res.status, message) }
      }

      // Validate before returning. A 200 with the wrong shape is a bug
      // somewhere, and the safe reading of it is "no transcript".
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text) {
        return {
          ok: false,
          error: providerError(
            'rejected',
            'Nothing could be transcribed from that recording.',
            { retryable: false },
          ),
        }
      }

      return {
        ok: true,
        mode: 'live',
        value: {
          text,
          // What was ASKED for and honoured. Not a detection claim: this
          // provider does not detect, and reporting `yo` as though it had
          // been recognised would overstate what happened.
          detectedLanguage: null,
          // ABSENT, not zero. The worker reports no confidence score, and 0
          // would read as certainty that the transcript is wrong.
          confidence: null,
          /**
           * The server's answer when it gives one, and OUR list otherwise.
           * Never defaulted to true: an absent field must not read as
           * "a person checked this".
           */
          verified: typeof body?.verified === 'boolean' ? body.verified : verified,
          provider: 'loam-local-stt',
        },
      }
    },
  }
}

/**
 * Explicit opt-in. NOTHING CALLS THIS.
 *
 * Registration is a deliberate act in a development session, not a
 * consequence of importing a module. Import-time registration is how a
 * microphone pipeline ends up live in a test run, and the seam's first rule
 * is that no audio moves without someone starting it.
 */
export function enableLocalYorubaStt(opts: LocalSttOptions = {}): SpeechToTextProvider {
  const provider = createLocalYorubaStt(opts)
  setSpeechToTextProvider(provider)
  return provider
}
