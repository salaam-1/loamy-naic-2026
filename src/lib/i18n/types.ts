/**
 * Locale model for the platform.
 *
 * SCOPE
 *   Five languages ship: English (canonical), Hausa, Igbo, Yoruba, French.
 *   Adding a sixth is adding one entry here and one pack directory. No caller
 *   changes, no component changes, no schema change.
 *
 * DIRECTION
 *   Every locale carries `dir` even though all five are left-to-right today.
 *   It is here so a future right-to-left language is a data change rather than
 *   an architectural one; `LanguageProvider` already writes it to <html dir>.
 *
 * THE `intl` FIELD
 *   The BCP-47 tag handed to Intl for dates, numbers and plural rules. It is
 *   deliberately NOT the same thing as the UI language: money stays on the
 *   Nigerian convention regardless (see format.ts), because the currency and
 *   the amount are business facts, not presentation.
 */

export const LOCALES = ['en', 'ha', 'ig', 'yo', 'fr'] as const
export type Locale = (typeof LOCALES)[number]

export interface LocaleMeta {
  code: Locale
  /** What the language calls itself. A selector shows this, never a translation of it. */
  endonym: string
  /** English name, for developer tooling and aria descriptions in English contexts. */
  englishName: string
  /** BCP-47 tag for Intl date/number/plural formatting. */
  intl: string
  dir: 'ltr' | 'rtl'
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: { code: 'en', endonym: 'English', englishName: 'English', intl: 'en-NG', dir: 'ltr' },
  ha: { code: 'ha', endonym: 'Hausa', englishName: 'Hausa', intl: 'ha-NG', dir: 'ltr' },
  ig: { code: 'ig', endonym: 'Igbo', englishName: 'Igbo', intl: 'ig-NG', dir: 'ltr' },
  yo: { code: 'yo', endonym: 'Yorùbá', englishName: 'Yoruba', intl: 'yo-NG', dir: 'ltr' },
  fr: { code: 'fr', endonym: 'Français', englishName: 'French', intl: 'fr-FR', dir: 'ltr' },
}

export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Map a browser tag onto a supported locale.
 *
 * `navigator.language` is a full tag ('fr-CA', 'en-GB', 'ha-NG'), so the base
 * subtag is what matters. Anything unsupported returns null rather than a
 * guess, and the caller falls back to English. It never returns a locale the
 * platform does not actually ship.
 */
export function matchBrowserLocale(tags: readonly string[]): Locale | null {
  for (const tag of tags) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return null
}
