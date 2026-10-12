import { LOCALE_META, type Locale } from '@/lib/i18n/types'
import type { LoamLanguage } from '@/lib/loam/types'

/**
 * The bridge between the app's locale and the language Loam answers in.
 *
 * WHY THEY ARE NOT THE SAME TYPE
 *   The platform ships five locales (`en ha ig yo fr`). Loam answers in four
 *   -- the ones N-ATLaS's model card documents. French is a real interface
 *   locale with a full translation pack and NOT a language the model is
 *   documented to speak, so a French member gets a French interface and an
 *   English answer. Collapsing the two types would have made that distinction
 *   impossible to express, and the alternative -- asking the model for French
 *   because a dropdown offered it -- is the kind of unverified claim this
 *   codebase keeps refusing to make.
 */
export const LOAM_LANGUAGES: readonly LoamLanguage[] = ['en', 'ha', 'ig', 'yo'] as const

export function isLoamLanguage(value: unknown): value is LoamLanguage {
  return typeof value === 'string' && (LOAM_LANGUAGES as readonly string[]).includes(value)
}

/**
 * The language Loam should answer in, given the member's saved interface
 * locale. Falls back to English for a locale Loam does not cover, and for a
 * member who has never chosen one.
 */
export function loamLanguageFromLocale(locale: Locale | null | undefined): LoamLanguage {
  return isLoamLanguage(locale) ? locale : 'en'
}

/**
 * What to show on a language control: the language's own name for itself.
 *
 * Reuses `LOCALE_META`, so the panel cannot drift from the rest of the
 * platform and "Yorùbá" keeps its diacritics. A selector that renders a
 * translation of a language's name rather than its endonym is useless to the
 * person who needs it.
 */
export function loamLanguageLabel(language: LoamLanguage): string {
  return LOCALE_META[language].endonym
}

/** The short code shown when there is no room for a full name. */
export function loamLanguageCode(language: LoamLanguage): string {
  return language.toUpperCase()
}
