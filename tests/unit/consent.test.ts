import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONSENT_STORAGE_KEY, buildRecord, consentAllows, defaultPreferences, getConsent,
  isAllowed, needsNotice, parseRecord, reloadConsent, resetConsent, setConsent, subscribeConsent,
  type ConsentRecord,
} from '../../src/lib/consent'
import { CONSENT_VERSION, NOTICE_VERSION, POLICY_VERSION } from '../../src/content/legal/privacy-policy'

/** A minimal localStorage, because the unit suite runs in node. */
function installStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
  vi.stubGlobal('localStorage', store)
  return { map, store }
}

beforeEach(() => { installStorage(); resetConsent() })
afterEach(() => { vi.unstubAllGlobals() })

describe('the default before anyone has chosen', () => {
  it('is essential only', () => {
    // The default IS the decision for most people. On would collect from
    // everyone who never read the notice.
    expect(defaultPreferences()).toEqual({ essential: true, analytics: false })
  })

  it('cannot be mutated for everyone else', () => {
    const a = defaultPreferences()
    a.analytics = true
    expect(defaultPreferences().analytics).toBe(false)
  })

  it('forbids optional activity with no record at all', () => {
    expect(isAllowed(null, 'analytics')).toBe(false)
  })

  it('still permits essential activity with no record', () => {
    // Authentication cannot wait for a cookie banner.
    expect(isAllowed(null, 'essential')).toBe(true)
  })
})

describe('a recorded choice', () => {
  it('captures the versions it was made against', () => {
    const r = buildRecord(true)
    expect(r.policyVersion).toBe(POLICY_VERSION)
    expect(r.consentVersion).toBe(CONSENT_VERSION)
    expect(r.noticeVersion).toBe(NOTICE_VERSION)
    expect(r.essential).toBe(true)
    expect(r.analytics).toBe(true)
    expect(Date.parse(r.recordedAt)).not.toBeNaN()
  })

  it('records a refusal as a real choice, not as an absent one', () => {
    // "Essential only" must be remembered, or the notice reappears forever
    // and the person is nagged into accepting.
    const r = buildRecord(false)
    expect(r.analytics).toBe(false)
    expect(needsNotice(r)).toBe(false)
  })

  it('contains no identifier of any kind', () => {
    // A consent record must never itself become a reason to collect
    // something. Only versions, one boolean and a timestamp.
    const r = buildRecord(true)
    expect(Object.keys(r).sort()).toEqual([
      'analytics', 'consentVersion', 'essential', 'noticeVersion', 'policyVersion', 'recordedAt',
    ])
    const serialised = JSON.stringify(r).toLowerCase()
    for (const forbidden of ['email', 'phone', 'user', 'id', 'ip', 'bvn', 'nin', 'device', 'token']) {
      expect(serialised, `must not contain ${forbidden}`).not.toContain(`"${forbidden}"`)
    }
  })
})

describe('when the notice must be shown again', () => {
  it('shows for a first-time visitor', () => {
    expect(needsNotice(null)).toBe(true)
  })

  it('does not show once a valid choice exists', () => {
    expect(needsNotice(buildRecord(false))).toBe(false)
    expect(needsNotice(buildRecord(true))).toBe(false)
  })

  it('shows again after a material policy change', () => {
    // This is the whole point of versioning: a change to what we do has to be
    // put back in front of the person.
    const old: ConsentRecord = { ...buildRecord(true), policyVersion: '0.9' }
    expect(needsNotice(old)).toBe(true)
  })

  it('shows again when the categories change', () => {
    const old: ConsentRecord = { ...buildRecord(true), consentVersion: '0' }
    expect(needsNotice(old)).toBe(true)
  })

  it('shows again when the notice itself changes', () => {
    const old: ConsentRecord = { ...buildRecord(true), noticeVersion: '0' }
    expect(needsNotice(old)).toBe(true)
  })

  it('withdraws optional permission while a re-ask is pending', () => {
    // An out-of-date record consented to a DIFFERENT policy, so it grants
    // nothing until the person is asked again.
    const old: ConsentRecord = { ...buildRecord(true), policyVersion: '0.9' }
    expect(isAllowed(old, 'analytics')).toBe(false)
    // Essential keeps working throughout.
    expect(isAllowed(old, 'essential')).toBe(true)
  })
})

describe('a stored record is untrusted input', () => {
  it('treats absent storage as no choice', () => {
    expect(parseRecord(null)).toBeNull()
  })

  it('treats malformed JSON as no choice', () => {
    expect(parseRecord('{not json')).toBeNull()
  })

  it('rejects a hand-edited record missing its versions', () => {
    // Browser storage is user-writable. "analytics: true" with no version
    // must not grant anything.
    expect(parseRecord(JSON.stringify({ analytics: true }))).toBeNull()
  })

  it('rejects a non-boolean analytics value', () => {
    expect(parseRecord(JSON.stringify({
      policyVersion: POLICY_VERSION, consentVersion: CONSENT_VERSION,
      analytics: 'yes', recordedAt: new Date().toISOString(),
    }))).toBeNull()
  })

  it('rejects an unparseable timestamp', () => {
    expect(parseRecord(JSON.stringify({
      policyVersion: POLICY_VERSION, consentVersion: CONSENT_VERSION,
      analytics: true, recordedAt: 'whenever',
    }))).toBeNull()
  })

  it('forces essential to true even if storage says otherwise', () => {
    const r = parseRecord(JSON.stringify({
      policyVersion: POLICY_VERSION, consentVersion: CONSENT_VERSION,
      noticeVersion: NOTICE_VERSION, essential: false, analytics: false,
      recordedAt: new Date().toISOString(),
    }))
    expect(r?.essential).toBe(true)
  })

  it('accepts an older record that predates the notice version field', () => {
    // Treated as version 0, which re-asks — but it must not crash or be
    // silently read as a grant.
    const r = parseRecord(JSON.stringify({
      policyVersion: POLICY_VERSION, consentVersion: CONSENT_VERSION,
      analytics: true, recordedAt: new Date().toISOString(),
    }))
    expect(r).not.toBeNull()
    expect(r?.noticeVersion).toBe('0')
  })
})

describe('preferences persist and are shared across the app', () => {
  it('survives a reload', () => {
    setConsent(true)
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY)
    expect(raw).toBeTruthy()
    // Simulate a fresh page: storage survives, the in-memory copy does not.
    installStorage({ [CONSENT_STORAGE_KEY]: raw! })
    reloadConsent()
    expect(getConsent()?.analytics).toBe(true)
    expect(needsNotice(getConsent())).toBe(false)
  })

  it('persists a refusal too, so the notice stays dismissed', () => {
    setConsent(false)
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY)
    installStorage({ [CONSENT_STORAGE_KEY]: raw! })
    reloadConsent()
    expect(needsNotice(getConsent())).toBe(false)
    expect(consentAllows('analytics')).toBe(false)
  })

  it('stores the current policy version', () => {
    setConsent(true)
    const stored = JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!)
    expect(stored.policyVersion).toBe(POLICY_VERSION)
  })

  it('tells every listener at once', () => {
    // Settings and an already-open Discover page must not disagree.
    const seen: (boolean | null)[] = []
    const stop = subscribeConsent((r) => seen.push(r?.analytics ?? null))
    setConsent(true)
    setConsent(false)
    stop()
    setConsent(true)
    expect(seen).toEqual([true, false])
  })

  it('never throws when storage is unavailable', () => {
    // Private windows and blocked site data throw on touch. A privacy control
    // that crashes the app is worse than none.
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    })
    resetConsent()
    expect(() => getConsent()).not.toThrow()
    expect(() => setConsent(true)).not.toThrow()
    expect(consentAllows('essential')).toBe(true)
  })
})

describe('optional technology respects the preference', () => {
  it('blocks analytics until it is turned on', () => {
    expect(consentAllows('analytics')).toBe(false)
    setConsent(true)
    expect(consentAllows('analytics')).toBe(true)
  })

  it('stops analytics the moment it is turned off', () => {
    setConsent(true)
    expect(consentAllows('analytics')).toBe(true)
    setConsent(false)
    // No reload in between: the check is per call, so an already-open page
    // cannot keep recording after consent is withdrawn.
    expect(consentAllows('analytics')).toBe(false)
  })

  it('never blocks essential functionality', () => {
    expect(consentAllows('essential')).toBe(true)
    setConsent(false)
    expect(consentAllows('essential')).toBe(true)
  })
})
