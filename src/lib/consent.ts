/**
 * Privacy preferences.
 *
 * TWO CATEGORIES, AND ONLY TWO
 *
 *   The brief asked for essential, analytics, marketing and personalisation.
 *   Loamy has two of those, so the UI offers two:
 *
 *     essential   authentication, cart, the offline field-evidence queue, and
 *                 this preference record itself. Not optional, and presented
 *                 as not optional rather than as a switch that does nothing.
 *
 *     analytics   `discovery_events`: searches and listing views. One switch
 *                 rather than two, because analytics and personalisation are
 *                 literally the same rows -- loamy_discover derives "you have
 *                 bought this before" and "outside the states you usually
 *                 search" from that table and nothing else. Offering them as
 *                 separate choices would imply an independence that does not
 *                 exist, and turning one off while the other kept working
 *                 would be a lie told by a checkbox.
 *
 *   There is NO marketing category, because there is no marketing technology
 *   in this codebase. No pixels, no ad networks, no email tracking. Adding the
 *   category for the look of it would be the "unnecessary categories merely
 *   for appearance" the brief warns against, and would invite someone to turn
 *   on a thing that does not exist.
 *
 * OFF UNTIL CHOSEN
 *
 *   Before a person decides, `analytics` is false. Not "true until they
 *   object" -- the default IS the decision for most people, and a default of
 *   on would collect from everyone who never read the notice.
 *
 * VERSIONED
 *
 *   The record stores the policy, consent and notice versions it was given
 *   against. Bumping POLICY_VERSION or CONSENT_VERSION in
 *   src/content/legal/privacy-policy.ts is the entire mechanism for asking
 *   again. Nothing else needs to change and no cache needs clearing.
 */

import { CONSENT_VERSION, NOTICE_VERSION, POLICY_VERSION } from '@/content/legal/privacy-policy'

export type ConsentCategory = 'essential' | 'analytics'

export interface ConsentRecord {
  policyVersion: string
  consentVersion: string
  noticeVersion: string
  /** Always true. Stored so a record is self-describing when read back. */
  essential: true
  analytics: boolean
  /** ISO timestamp of the choice. */
  recordedAt: string
}

/** The key holding the record. One key, one value, no shadow copies. */
export const CONSENT_STORAGE_KEY = 'loamy.privacy.consent'

/**
 * The preferences in force before anyone has chosen. Essential only.
 *
 * Deliberately a function: returning a shared object would let a caller mutate
 * the default for everyone else.
 */
export function defaultPreferences(): { essential: true; analytics: boolean } {
  return { essential: true, analytics: false }
}

/**
 * Build a record from a choice.
 *
 * `recordedAt` is the only timestamp and there is no identifier of any kind:
 * no user id, no email, no device reference, no IP. A consent record should
 * never itself be a reason to collect something.
 */
export function buildRecord(analytics: boolean, now: Date = new Date()): ConsentRecord {
  return {
    policyVersion: POLICY_VERSION,
    consentVersion: CONSENT_VERSION,
    noticeVersion: NOTICE_VERSION,
    essential: true,
    analytics: Boolean(analytics),
    recordedAt: now.toISOString(),
  }
}

/**
 * Validate anything claiming to be a record.
 *
 * Browser storage is user-writable and survives deploys, so a stored value is
 * untrusted input. A malformed or hand-edited record is treated as absent,
 * which re-asks rather than silently granting anything.
 */
export function parseRecord(raw: string | null): ConsentRecord | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r.policyVersion !== 'string') return null
  if (typeof r.consentVersion !== 'string') return null
  if (typeof r.analytics !== 'boolean') return null
  if (typeof r.recordedAt !== 'string' || Number.isNaN(Date.parse(r.recordedAt))) return null
  return {
    policyVersion: r.policyVersion,
    consentVersion: r.consentVersion,
    // Notice version was added after the first record shape; a record without
    // it is still a valid choice and should not re-prompt on that alone.
    noticeVersion: typeof r.noticeVersion === 'string' ? r.noticeVersion : '0',
    essential: true,
    analytics: r.analytics,
    recordedAt: r.recordedAt,
  }
}

/**
 * Whether the notice should be shown.
 *
 * True when there is no valid record, or when the policy, consent or notice
 * version has moved on. That last part is the point of versioning: a material
 * change to what we do with information has to be put back in front of the
 * person, not assumed to be covered by a choice they made about something
 * else.
 */
export function needsNotice(record: ConsentRecord | null): boolean {
  if (!record) return true
  return (
    record.policyVersion !== POLICY_VERSION ||
    record.consentVersion !== CONSENT_VERSION ||
    record.noticeVersion !== NOTICE_VERSION
  )
}

/** Whether an optional category may run right now. */
export function isAllowed(record: ConsentRecord | null, category: ConsentCategory): boolean {
  if (category === 'essential') return true
  // An out-of-date record does not grant anything: the person consented to a
  // different policy. Essential keeps working; optional waits to be re-asked.
  if (!record || needsNotice(record)) return false
  return record.analytics === true
}

// ---------------------------------------------------------------------------
// Storage. Every access is guarded: private windows and blocked site data
// throw on touch, and a privacy control that crashes the app is worse than
// no privacy control.
// ---------------------------------------------------------------------------

export function readRecord(): ConsentRecord | null {
  try {
    return parseRecord(localStorage.getItem(CONSENT_STORAGE_KEY))
  } catch {
    return null
  }
}

export function writeRecord(record: ConsentRecord): boolean {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record))
    return true
  } catch {
    // Storage unavailable. The choice holds for this session in memory and is
    // simply asked again next time, which is the honest failure.
    return false
  }
}

export function clearRecord(): void {
  try {
    localStorage.removeItem(CONSENT_STORAGE_KEY)
  } catch {
    /* nothing to do */
  }
}

// ---------------------------------------------------------------------------
// A tiny store, so every surface agrees.
//
// The notice, the settings screen and the telemetry hook all need the same
// answer at the same moment. Without this, turning analytics off in Settings
// would leave an already-mounted Discover page happily recording until the
// next reload.
// ---------------------------------------------------------------------------

let current: ConsentRecord | null | undefined
const listeners = new Set<(r: ConsentRecord | null) => void>()

/** The record in force, read once then held. */
export function getConsent(): ConsentRecord | null {
  if (current === undefined) current = readRecord()
  return current
}

/** Record a choice and tell every listener immediately. */
export function setConsent(analytics: boolean): ConsentRecord {
  const record = buildRecord(analytics)
  current = record
  writeRecord(record)
  for (const fn of listeners) fn(record)
  return record
}

export function subscribeConsent(fn: (r: ConsentRecord | null) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * Drop the cached copy and re-read storage.
 *
 * Needed because the cache is per-tab: if someone saves preferences in
 * another tab, this tab's copy is stale until something tells it to look
 * again. useConsent wires this to the browser's `storage` event, so a choice
 * made anywhere takes effect everywhere.
 */
export function reloadConsent(): ConsentRecord | null {
  current = readRecord()
  for (const fn of listeners) fn(current)
  return current
}

/** Testing and "show me the notice again" both need this. */
export function resetConsent(): void {
  current = null
  clearRecord()
  for (const fn of listeners) fn(null)
}

/** Convenience for call sites that only care about one category. */
export function consentAllows(category: ConsentCategory): boolean {
  return isAllowed(getConsent(), category)
}
