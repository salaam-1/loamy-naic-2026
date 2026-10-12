/**
 * SPEECH-TO-TEXT PROVIDER SEAM.
 *
 * NOT IMPLEMENTED, NOT REGISTERED, AND NO PROVIDER SELECTED.
 *
 * WHY THIS IS A SEAM AND NOT AN IMPLEMENTATION
 *   N-ATLaS does not transcribe. Its `capabilities` list no audio, it has no
 *   projector, and its repository declares no `pipeline_tag` at all. NCAIR
 *   does publish ASR -- NigerianAccentedEnglish, Hausa-ASR, Igbo-ASR,
 *   Yoruba-ASR -- but as four SEPARATE `transformers` models, every one of
 *   them with an empty `inferenceProviderMapping`. So transcription is a
 *   different service from inference, and nobody has chosen or stood one up.
 *
 *   The architecture that follows from that evidence is:
 *
 *     user voice -> STT provider -> text -> Loam -> N-ATLaS -> text -> TTS
 *
 *   which is why this lives in `providers/` beside weather and messaging, and
 *   not behind `ModelAdapter`. Putting transcription on the model interface
 *   would encode a claim about N-ATLaS that is false.
 *
 * THREE RULES A CONCRETE ADAPTER MUST HOLD
 *
 * 1. NO AUDIO LEAVES WITHOUT THE MEMBER STARTING IT. A recording is an act,
 *    not a setting. An adapter is called after someone taps a microphone, and
 *    never on page load, never speculatively, never to "warm up".
 *
 * 2. A LANGUAGE IS SUPPORTED WHEN IT HAS BEEN TESTED, NOT WHEN IT IS
 *    ADVERTISED. `languages` is the list a reviewer has actually heard work.
 *    A vendor claiming "100+ languages" is not evidence about Hausa, and a
 *    language appearing in a dropdown is not evidence about anything. An
 *    empty list is the correct declaration for an unverified provider.
 *
 * 3. AUDIO IS NOT KEPT. Raw audio is biometric-adjacent and a farmer's voice
 *    recording is not something Loamy needs to retain. An adapter transcribes
 *    and discards; it does not persist the bytes, and it does not log them or
 *    the full transcript.
 */
import {
  NOT_CONFIGURED, providerError,
  type ProviderError, type ProviderInfo, type ProviderResult,
} from '@/lib/providers/types'
import type { VoiceLanguage } from '@/lib/loam/voice'

/**
 * SPOKEN language, not the language Loam answers in.
 *
 * `VoiceLanguage` is the four `LoamLanguage` covers PLUS Nigerian Pidgin
 * (`pcm`), which a separate ASR model transcribes. This seam uses it because
 * what a member speaks is a different question from what the conversational
 * model is documented to answer in -- see src/lib/loam/voice.ts.
 */

/**
 * The audio formats a browser can realistically produce from MediaRecorder.
 * A concrete adapter narrows this to what its service accepts.
 */
export const STT_ACCEPTED_MIME = [
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav',
] as const

/**
 * A ceiling, not a target. Roughly a minute of compressed speech. An
 * unbounded upload is a denial-of-service surface and a bill.
 */
export const STT_MAX_AUDIO_BYTES = 2_000_000

export interface SttRequest {
  /** Raw audio bytes. The caller owns recording; this seam owns transcription. */
  audio: Uint8Array
  /** As reported by the recorder, e.g. 'audio/webm'. */
  mimeType: string
  /**
   * The language to transcribe as, or null to ask the provider to detect it.
   *
   * Null is a REQUEST, not an expectation. A provider that cannot detect
   * reliably should refuse with `invalid_request` rather than guess, because
   * a confident mis-detection sends a Hausa question through an English
   * recogniser and returns plausible nonsense.
   */
  language: VoiceLanguage | null
  /** Caller cancellation — a member navigating away, or tapping stop. */
  signal?: AbortSignal
  timeoutMs?: number
}

export interface SpeechTranscript {
  /** What was heard. Never logged in full by an adapter. */
  text: string
  /**
   * The language the provider believes it heard, when it says so. Absent
   * means "not reported", which is different from "English".
   */
  detectedLanguage?: VoiceLanguage | null
  /**
   * 0..1 when the provider reports one. ABSENT IS NOT ZERO -- a provider that
   * reports no confidence has not expressed doubt, and treating that as 0
   * would hide every transcript behind a warning.
   */
  confidence?: number | null
  /** Which adapter produced this, for support threads. */
  provider: string
  /**
   * Whether this LANGUAGE has been verified on real audio by a person, as
   * opposed to merely being routable to a model that loads.
   *
   * ABSENT MEANS UNKNOWN, NOT VERIFIED. A multi-model adapter can reach a
   * language nobody has listened to yet -- Whisper will happily return fluent
   * Hausa-shaped text of unknown quality -- and a caller rendering that
   * should be able to mark it. See rule 2 above: `languages` lists what has
   * been heard to work, and this says which side of that line a given
   * transcript fell on.
   */
  verified?: boolean
}

export interface SpeechToTextProvider {
  readonly info: ProviderInfo
  /**
   * Languages VERIFIED to transcribe acceptably with this provider. Empty
   * until someone has listened to the output. See rule 2.
   */
  readonly languages: readonly VoiceLanguage[]
  /** Largest upload this adapter accepts. */
  readonly maxAudioBytes: number
  /** Whether this provider can be asked to detect the language itself. */
  readonly canDetectLanguage: boolean
  transcribe(req: SttRequest): Promise<ProviderResult<SpeechTranscript>>
  supports(language: VoiceLanguage): boolean
}

/**
 * Shared request validation, so every future adapter enforces the same
 * limits in the same place rather than each inventing its own.
 *
 * Returns null when the request is acceptable.
 */
export function validateSttRequest(
  req: SttRequest,
  limits: { maxAudioBytes: number; accepted?: readonly string[] } = {
    maxAudioBytes: STT_MAX_AUDIO_BYTES,
  },
): ProviderError | null {
  if (!req.audio || req.audio.byteLength === 0) {
    return providerError('invalid_request', 'No audio was recorded.', { retryable: false })
  }
  if (req.audio.byteLength > limits.maxAudioBytes) {
    return providerError(
      'invalid_request',
      'That recording is too long. Try a shorter question.',
      { retryable: false },
    )
  }
  const accepted = limits.accepted ?? STT_ACCEPTED_MIME
  // Compare the type only: browsers append codec parameters, e.g.
  // 'audio/webm;codecs=opus', and rejecting those would reject every
  // recording Chrome produces.
  const base = req.mimeType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!base || !accepted.includes(base)) {
    return providerError(
      'invalid_request',
      'That audio format is not supported.',
      { retryable: false },
    )
  }
  return null
}

/**
 * The disabled provider. Fails immediately, touches nothing.
 *
 * It does not read `req.audio`, does not validate it, does not reach the
 * network and does not ask for a microphone -- there is nothing to send it
 * to, so the honest response is `not_configured` before anything else
 * happens. `languages` is empty because zero languages have been verified,
 * which is the truthful number for a provider that does not exist.
 */
export const noSpeechToTextProvider: SpeechToTextProvider = {
  info: { key: 'none', label: 'No speech-to-text provider', mode: 'disabled' },
  languages: [],
  maxAudioBytes: STT_MAX_AUDIO_BYTES,
  canDetectLanguage: false,
  supports: () => false,
  async transcribe() {
    return { ok: false, error: NOT_CONFIGURED }
  },
}

let active: SpeechToTextProvider = noSpeechToTextProvider

export function setSpeechToTextProvider(p: SpeechToTextProvider): void {
  active = p
}

export function speechToTextProvider(): SpeechToTextProvider {
  return active
}
