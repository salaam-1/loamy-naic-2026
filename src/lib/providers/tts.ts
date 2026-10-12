/**
 * TEXT-TO-SPEECH PROVIDER SEAM.
 *
 * NOT IMPLEMENTED, NOT REGISTERED, AND NO PROVIDER SELECTED.
 *
 * WHY THIS IS A SEAM AND NOT AN IMPLEMENTATION
 *   N-ATLaS generates text and nothing else. And unlike transcription, where
 *   NCAIR at least publishes four ASR models, **no NCAIR text-to-speech model
 *   exists**. The only adjacent artefact found is `AWARRITech/awarri_tts_v2_eval`,
 *   which has no declared task and no downloads, so its suitability is
 *   unknown. Synthesis is therefore a service nobody has chosen, for
 *   languages nobody has verified.
 *
 *   So the architecture is:
 *
 *     N-ATLaS -> text -> TTS provider -> audio -> member hears it
 *
 *   The TEXT is the answer. Audio is a rendering of it. That ordering is a
 *   safety property, not a layering preference: see rule 1.
 *
 * THREE RULES A CONCRETE ADAPTER MUST HOLD
 *
 * 1. THE TEXT IS AUTHORITATIVE AND ALWAYS SHOWN. Synthesis failing must never
 *    discard, delay or replace a completed answer. A member who cannot hear
 *    the audio must still be able to read every word, including the units and
 *    the warnings.
 *
 * 2. NEVER SPEAK A LANGUAGE WITH THE WRONG VOICE. If the response language is
 *    not in `languages`, the adapter refuses and the interface says so.
 *    Reading Hausa with an English voice produces confident-sounding
 *    gibberish, and a farmer hearing a mangled application rate is worse off
 *    than one reading it. `languages` is the list a reviewer has actually
 *    listened to -- a vendor's claim is not evidence.
 *
 * 3. AUDIO IS NOT RETAINED AND NOT PLAYED UNASKED. Generated speech is
 *    discarded after playback, and nothing plays on page load. Spoken
 *    responses are opt-in.
 */
import {
  NOT_CONFIGURED, providerError,
  type ProviderError, type ProviderInfo, type ProviderResult,
} from '@/lib/providers/types'
import type { LoamLanguage } from '@/lib/loam/types'

/**
 * A ceiling on one synthesis request. Loam's answers are two to five short
 * sentences by design, so this is generous; it exists to stop a pathological
 * input becoming a long audio bill.
 */
export const TTS_MAX_TEXT_LENGTH = 4_000

export interface TtsRequest {
  /**
   * Exactly the text that was shown, with its Unicode intact. An adapter must
   * not strip diacritics to make synthesis easier: "ƙasa" and "kasa" are
   * different words, and so are "ẹ" and "e".
   */
  text: string
  /** The language the text is in. Not optional — see rule 2. */
  language: LoamLanguage
  /** Provider-specific voice id, when the member or admin has chosen one. */
  voice?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface SynthesizedSpeech {
  audio: Uint8Array
  /** e.g. 'audio/mpeg'. The caller needs this to play the bytes. */
  mimeType: string
  /** Seconds, when the provider reports it. */
  durationSeconds?: number | null
  /** The voice actually used, which may differ from the one requested. */
  voice?: string
  provider: string
}

export interface TextToSpeechProvider {
  readonly info: ProviderInfo
  /**
   * Languages VERIFIED to synthesize intelligibly. Empty until someone has
   * listened. See rule 2.
   */
  readonly languages: readonly LoamLanguage[]
  readonly maxTextLength: number
  synthesize(req: TtsRequest): Promise<ProviderResult<SynthesizedSpeech>>
  supports(language: LoamLanguage): boolean
  /** Voices offered for a language. Empty when none, or when unsupported. */
  voices(language: LoamLanguage): readonly string[]
}

/** Shared request validation, so every adapter enforces the same limits. */
export function validateTtsRequest(
  req: TtsRequest,
  limits: { maxTextLength: number; languages: readonly LoamLanguage[] },
): ProviderError | null {
  if (!req.text?.trim()) {
    return providerError('invalid_request', 'There is nothing to read aloud.', { retryable: false })
  }
  if (req.text.length > limits.maxTextLength) {
    return providerError(
      'invalid_request',
      'That answer is too long to read aloud in one go.',
      { retryable: false },
    )
  }
  if (!limits.languages.includes(req.language)) {
    /**
     * `rejected` rather than `invalid_request`: the request is well formed
     * and the provider understood it. It simply will not speak this
     * language, and rule 2 forbids doing it badly instead.
     */
    return providerError(
      'rejected',
      'Spoken answers are not available in this language yet. The written answer is above.',
      { retryable: false },
    )
  }
  return null
}

/**
 * The disabled provider. Fails immediately, touches nothing.
 *
 * It does not synthesize, does not reach the network, constructs no `Audio`
 * and plays nothing. `languages` is empty because zero have been verified --
 * and for TTS that is not a placeholder, it is the current state of the
 * world: no NCAIR synthesis model exists for any of the four.
 */
export const noTextToSpeechProvider: TextToSpeechProvider = {
  info: { key: 'none', label: 'No text-to-speech provider', mode: 'disabled' },
  languages: [],
  maxTextLength: TTS_MAX_TEXT_LENGTH,
  supports: () => false,
  voices: () => [],
  async synthesize() {
    return { ok: false, error: NOT_CONFIGURED }
  },
}

let active: TextToSpeechProvider = noTextToSpeechProvider

export function setTextToSpeechProvider(p: TextToSpeechProvider): void {
  active = p
}

export function textToSpeechProvider(): TextToSpeechProvider {
  return active
}
