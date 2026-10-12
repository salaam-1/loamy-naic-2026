/**
 * Turning a thrown thing into something a member can read.
 *
 * WHY THIS EXISTS
 *   `e instanceof Error ? e.message : fallback` is the pattern used across the
 *   app, and it has a hole: supabase-js rejects with a PostgrestError, which is
 *   a plain object carrying `message`, `code`, `details` and `hint` — not an
 *   `Error`. So every such check fell through to the generic fallback and threw
 *   away the only accurate description of what went wrong. Phase 4 slice 2 QA
 *   caught this: a refused add-to-cart reported "Please try again" when the
 *   database had said "new row violates row-level security policy".
 *
 * WHAT IT DOES NOT DO
 *   It does not hide failures, and it does not invent reasons. Known Postgres
 *   error codes are translated into plain language because "23505" helps
 *   nobody; anything unrecognised is passed through as the server worded it,
 *   which is worse prose but true. The fallback is used only when there is
 *   genuinely no message to show.
 */

interface ErrorLike {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
}

function asErrorLike(e: unknown): ErrorLike | null {
  if (e === null || typeof e !== 'object') return null
  return e as ErrorLike
}

/**
 * A failure the application raises itself, carrying the key for its own words.
 *
 * WHY NOT JUST `new Error('...')`
 *   A thrown Error reaches the screen as one English sentence with nothing to
 *   look up, so it renders in English whatever language the member chose. The
 *   `code` here is the i18n key, which `errorParts` recognises and the UI
 *   translates; the message stays English so a log, a stack trace and a test
 *   assertion all read exactly as before.
 */
export function codedError(key: string, message: string): Error {
  return Object.assign(new Error(message), { code: key })
}

/** The raw message the thrower supplied, or '' if there is none. */
export function rawErrorMessage(e: unknown): string {
  if (typeof e === 'string') return e.trim()
  const o = asErrorLike(e)
  if (!o) return ''
  return typeof o.message === 'string' ? o.message.trim() : ''
}

/** The Postgres SQLSTATE or PostgREST code, when one was supplied. */
export function errorCode(e: unknown): string {
  const o = asErrorLike(e)
  return o && typeof o.code === 'string' ? o.code : ''
}

/**
 * Plain-language readings of the failures a member can actually cause. Each
 * one describes the refusal, never a success, and never guesses at a cause the
 * code does not establish.
 */
function plainLanguage(code: string, message: string): PlainReading | null {
  const m = message.toLowerCase()

  // A failure raised by `codedError` already knows its own key.
  if (code.startsWith('error.')) return { key: code, en: message }

  if (code === '42501' || m.includes('row-level security')) {
    return {
      key: 'error.notAllowed',
      en: 'You are not allowed to do that. If this is your own listing, you cannot buy from yourself.',
    }
  }
  if (code === '23505') return { key: 'error.alreadyThere', en: 'That is already there.' }
  if (code === '23514') return { key: 'error.outsideAllowed', en: 'That value is outside what this listing allows.' }
  if (code === '23503') return { key: 'error.noLongerAvailable', en: 'That item is no longer available.' }
  if (code === 'PGRST116') return { key: 'error.itemNotFound', en: 'That item could not be found.' }
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) {
    return { key: 'error.unreachable', en: 'Could not reach Loamy. Check your connection and try again.' }
  }
  return null
}

/**
 * What a failure can be SHOWN as, split from how it is worded.
 *
 * WHY A KEY AND AN ENGLISH STRING, NOT JUST A STRING
 *   Only the readings this file writes itself can be translated. The server's
 *   own wording cannot: it arrives as one English sentence from Postgres at
 *   runtime and there is no key for it. Pretending otherwise would mean
 *   shipping a translation of a message we have not seen.
 *
 *   So a failure this file recognises carries `key`, which the UI renders
 *   through `tOr(key, en)`; a failure it does not recognise carries `key:
 *   null` and the server's sentence in `text`, which stays English and is
 *   counted as English in the coverage report rather than as translated.
 */
export interface PlainReading {
  key: string
  en: string
}

export interface ErrorParts {
  /** An i18n key, when this file recognised the failure. */
  key: string | null
  /** What to render when there is no key: the server's words, or the fallback. */
  text: string
}

/**
 * The localizable form of `errorMessage`. Same decision, reported in parts so
 * the caller can translate the part that has a translation.
 */
export function errorParts(e: unknown, fallback: string): ErrorParts {
  const raw = rawErrorMessage(e)
  const plain = plainLanguage(errorCode(e), raw)
  if (plain) return { key: plain.key, text: plain.en }
  return { key: null, text: raw || fallback }
}

/**
 * A message safe to put in front of a member. Prefers a plain-language reading
 * of a known failure, falls back to the server's own wording, and uses
 * `fallback` only when nothing was supplied at all.
 */
export function errorMessage(e: unknown, fallback: string): string {
  const raw = rawErrorMessage(e)
  const plain = plainLanguage(errorCode(e), raw)
  if (plain) return plain.en
  return raw || fallback
}
