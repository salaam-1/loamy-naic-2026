/**
 * The languages VOICE INPUT offers, which are not the languages Loam answers in.
 *
 * WHY A SEPARATE TYPE FROM `LoamLanguage`
 *   `LoamLanguage` is `en | ha | ig | yo` -- the four N-ATLaS's model card
 *   documents, used by the orchestrator, the evidence layer, the database and
 *   the i18n packs. Speech recognition covers a FIFTH, Nigerian Pidgin
 *   (`pcm`), because a separate ASR model transcribes it.
 *
 *   Widening `LoamLanguage` to five would assert that N-ATLaS answers in
 *   Pidgin, which nobody has established, and would ripple through every
 *   layer that stores or switches on it. So the two stay separate types and
 *   `chatLanguageFor` makes the narrowing explicit and visible.
 *
 * WHAT THE PIDGIN NARROWING DOES AND DOES NOT DO
 *   A Pidgin transcript is submitted with `language: 'en'` -- that is the
 *   label on the REQUEST, telling Loam which documented language to answer
 *   in. THE TRANSCRIPT TEXT IS NEVER TRANSLATED, rewritten or normalised. It
 *   reaches the composer exactly as the model produced it, diacritics and
 *   all, and the member can edit it before sending.
 *
 *   Nigerian Pidgin is its own language (ISO 639-3 `pcm`), not accented
 *   English. Recognising it is not evidence that the conversational model
 *   handles it, which is precisely why the narrowing is written down here
 *   rather than left implicit.
 */
import type { LoamLanguage } from '@/lib/loam/types'

/** The five languages the speech service has a model route for. */
export const VOICE_LANGUAGES = ['en', 'ha', 'ig', 'yo', 'pcm'] as const

export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return typeof value === 'string' && (VOICE_LANGUAGES as readonly string[]).includes(value)
}

/**
 * Each language's name for itself, with the English gloss where the endonym
 * alone would not be recognised by someone scanning a dropdown.
 *
 * Endonyms, not translations: a selector that renders "Yoruba" to a Yoruba
 * speaker looking for "Yorùbá" is useless to the person who needs it.
 */
export const VOICE_LANGUAGE_LABEL: Record<VoiceLanguage, string> = {
  en: 'English',
  ha: 'Hausa',
  ig: 'Igbo',
  yo: 'Yorùbá',
  pcm: 'Naijá (Pidgin)',
}

/**
 * Which documented language Loam should ANSWER in for a given spoken input.
 *
 * Identity for the four Loam covers. Pidgin narrows to English, because
 * N-ATLaS has no documented Pidgin mode and claiming one would be the kind of
 * unverified assertion this codebase refuses to make.
 */
export function chatLanguageFor(voice: VoiceLanguage): LoamLanguage {
  return voice === 'pcm' ? 'en' : voice
}

/** True when the answer will come back in a different language than was spoken. */
export function narrowsLanguage(voice: VoiceLanguage): boolean {
  return voice === 'pcm'
}
