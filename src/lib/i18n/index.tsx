import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'
import { en, type TranslationKey, type TranslationPack } from './packs/en'
import { PACKS } from './packs'
import { formatDateLong, formatDateShort, formatMoney, formatNumber, formatRelative, pluralKey } from './format'
import { DEFAULT_LOCALE, LOCALE_META, isLocale, matchBrowserLocale, type Locale } from './types'

export { LOCALES, LOCALE_META, DEFAULT_LOCALE, isLocale, type Locale } from './types'
export type { TranslationKey, TranslationPack } from './packs/en'

/** Matches the existing `loamy.*` convention (loamy.privacy.consent, loamy.device). */
export const LANGUAGE_STORAGE_KEY = 'loamy.language'

// ---------------------------------------------------------------------------
// Missing-key reporting
// ---------------------------------------------------------------------------

/**
 * Every key that fell back, recorded for the coverage tooling.
 *
 * This is a development and test signal ONLY. A member must never be shown a
 * key name, a warning or an empty element because a translation is absent:
 * they get the English, which is a complete sentence written by a human. The
 * record exists so the gap is visible to us, not to them.
 */
const missing = new Map<string, Set<string>>()

export function recordMissing(locale: Locale, key: string): void {
  if (import.meta.env.PROD) return
  if (!missing.has(locale)) missing.set(locale, new Set())
  missing.get(locale)!.add(key)
}

/** Snapshot for tests and the coverage script. */
export function missingKeys(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [loc, keys] of missing) out[loc] = [...keys].sort()
  return out
}

export function clearMissingKeys(): void {
  missing.clear()
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function readStored(): Locale | null {
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isLocale(raw) ? raw : null
  } catch {
    // Private mode, blocked storage, SSR. Not an error: fall through.
    return null
  }
}

function writeStored(locale: Locale): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale)
  } catch {
    // The choice still applies for this session; it just will not survive a reload.
  }
}

function browserLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
  return matchBrowserLocale(tags.filter(Boolean))
}

/**
 * The order the product promises:
 *   1. the member's explicit saved preference
 *   2. an anonymous choice made on this device
 *   3. the browser's language, but only if Loamy actually ships it
 *   4. English
 *
 * A browser language never displaces an explicit choice. Someone who chose
 * English on a Hausa-configured phone meant it.
 */
export function resolveLocale(explicit: Locale | null | undefined): Locale {
  if (explicit && isLocale(explicit)) return explicit
  const stored = readStored()
  if (stored) return stored
  return browserLocale() ?? DEFAULT_LOCALE
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

const INTERPOLATION = /\{(\w+)\}/g

export type TVars = Record<string, string | number>

function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template
  return template.replace(INTERPOLATION, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

/**
 * Look a key up with the full fallback chain.
 *
 * locale pack -> English -> the key itself.
 *
 * The last step cannot normally happen, because TranslationKey is derived from
 * the English pack, so an unknown key will not compile. It exists for strings
 * built at runtime (a status slug joined onto a prefix, say), where returning
 * the key is still better than rendering nothing.
 */
export function translate(locale: Locale, key: TranslationKey | string, vars?: TVars): string {
  const pack: TranslationPack = PACKS[locale] ?? {}
  const hit = pack[key as TranslationKey]
  if (typeof hit === 'string' && hit.length > 0) return interpolate(hit, vars)

  if (locale !== DEFAULT_LOCALE) recordMissing(locale, String(key))

  const fallback = en[key as TranslationKey]
  if (typeof fallback === 'string') return interpolate(fallback, vars)

  recordMissing(locale, String(key))
  return String(key)
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Whether the member's choice reached their account.
 *
 * Settings must not say "saved" when the write failed. The language still
 * applies for the session either way, because the local choice is authoritative
 * for rendering; what fails is only the part that follows them to another
 * device, and the UI has to say which happened.
 */
export type LanguageSaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface I18nValue {
  locale: Locale
  /** Translate. Accepts a typed key; a runtime-built string is allowed and falls back. */
  t: (key: TranslationKey | string, vars?: TVars) => string
  /** Translate a counted string, choosing the plural form by the locale's rules. */
  tPlural: (base: TranslationKey | string, count: number, vars?: TVars) => string
  /**
   * Translate, falling back to a supplied English string rather than to the
   * key name.
   *
   * WHY THIS EXISTS AS A SHARED FUNCTION
   *   Much of the product's vocabulary lives in `src/lib/*` maps -- nav
   *   labels in roles.ts, the financing lifecycle, the field-ops task and
   *   flag copy -- where the English is DATA that other code reads. The pack
   *   translates those maps key by key, but a key the pack has not reached
   *   yet must render the map's English, never `verification.flag.no_gps`.
   *
   *   Three components had each written this four-line helper themselves. A
   *   fourth copy is how they start to differ.
   */
  tOr: (key: TranslationKey | string, english: string, vars?: TVars) => string
  setLocale: (next: Locale) => void
  /** Result of persisting the last explicit choice. 'idle' when anonymous. */
  saveState: LanguageSaveState
  /** Money. Always Nigerian convention — see format.ts. */
  money: (amount: number) => string
  num: (value: number) => string
  dateShort: (iso: string | null | undefined) => string
  dateLong: (date: Date) => string
  relative: (iso: string) => string
  dir: 'ltr' | 'rtl'
}

const I18nContext = createContext<I18nValue | null>(null)

export function LanguageProvider({
  children,
  explicitLocale = null,
  onLocaleChange,
}: {
  children: ReactNode
  /** The signed-in member's saved preference, when there is one. */
  explicitLocale?: Locale | null
  /**
   * Called when the member picks a language, so a caller can persist it. May
   * return a promise; its outcome drives `saveState`.
   */
  onLocaleChange?: (locale: Locale) => void | Promise<unknown>
}) {
  const [locale, setLocaleState] = useState<Locale>(() => resolveLocale(explicitLocale))
  const [saveState, setSaveState] = useState<LanguageSaveState>('idle')

  // A preference that arrives after sign-in wins over whatever was resolved for
  // the anonymous visitor, but only when it actually differs.
  useEffect(() => {
    if (explicitLocale && isLocale(explicitLocale) && explicitLocale !== locale) {
      setLocaleState(explicitLocale)
    }
    // locale is intentionally not a dependency: this reacts to the PROFILE
    // changing, not to the member switching language in the selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explicitLocale])

  useEffect(() => {
    const meta = LOCALE_META[locale]
    document.documentElement.lang = meta.code
    document.documentElement.dir = meta.dir
  }, [locale])

  const setLocale = useCallback(
    (next: Locale) => {
      if (!isLocale(next)) return
      // The interface changes immediately and the device remembers it, whether
      // or not the account write succeeds. Rendering never waits on the network.
      setLocaleState(next)
      writeStored(next)

      if (!onLocaleChange) {
        setSaveState('idle')
        return
      }
      const result = onLocaleChange(next)
      if (!result || typeof (result as Promise<unknown>).then !== 'function') {
        setSaveState('idle')
        return
      }
      setSaveState('saving')
      void (result as Promise<unknown>).then(
        () => setSaveState('saved'),
        () => setSaveState('error'),
      )
    },
    [onLocaleChange],
  )

  const value = useMemo<I18nValue>(() => {
    const t = (key: TranslationKey | string, vars?: TVars) => translate(locale, key, vars)
    return {
      locale,
      t,
      tPlural: (base, count, vars) =>
        t(pluralKey(String(base), count, locale), { count, ...(vars ?? {}) }),
      tOr: (key, english, vars) => {
        const out = t(key, vars)
        return out === key ? english : out
      },
      setLocale,
      saveState,
      money: formatMoney,
      num: (v: number) => formatNumber(v, locale),
      dateShort: (iso) => formatDateShort(iso, locale),
      dateLong: (d) => formatDateLong(d, locale),
      relative: (iso) => formatRelative(iso, locale),
      dir: LOCALE_META[locale].dir,
    }
  }, [locale, setLocale, saveState])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/**
 * The hook components use.
 *
 * Outside a provider it returns a working English translator rather than
 * throwing. A missing provider must never be able to blank a screen, and tests
 * that render a single component in isolation should not need the whole tree.
 */
export function useT(): I18nValue {
  const ctx = useContext(I18nContext)
  if (ctx) return ctx
  const t = (key: TranslationKey | string, vars?: TVars) => translate(DEFAULT_LOCALE, key, vars)
  return {
    locale: DEFAULT_LOCALE,
    t,
    tPlural: (base, count, vars) =>
      t(pluralKey(String(base), count, DEFAULT_LOCALE), { count, ...(vars ?? {}) }),
    tOr: (key, english, vars) => {
      const out = t(key, vars)
      return out === key ? english : out
    },
    setLocale: () => {},
    saveState: 'idle',
    money: formatMoney,
    num: (v: number) => formatNumber(v, DEFAULT_LOCALE),
    dateShort: (iso) => formatDateShort(iso, DEFAULT_LOCALE),
    dateLong: (d) => formatDateLong(d, DEFAULT_LOCALE),
    relative: (iso) => formatRelative(iso, DEFAULT_LOCALE),
    dir: 'ltr',
  }
}
