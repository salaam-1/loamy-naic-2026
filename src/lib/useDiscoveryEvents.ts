import { useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { safeMetadata, type DiscoveryEventType } from '@/lib/discovery'
import { consentAllows } from '@/lib/consent'

/**
 * Behavioural telemetry.
 *
 * Three properties worth stating, because each is a way this normally goes
 * wrong:
 *
 *  · It NEVER throws and never blocks a render. A page that breaks because
 *    analytics failed has its priorities inverted.
 *  · The session ref is opaque, generated here, and kept in sessionStorage —
 *    it dies with the tab. It is not a device fingerprint and not a cookie,
 *    and it cannot be joined to anything outside this session.
 *  · The actor is never sent. The server takes it from auth.uid(), so a
 *    forged actor is impossible rather than merely discouraged.
 *  · It is OPTIONAL and off by default. Nothing is recorded until the visitor
 *    has turned it on in the privacy notice, and turning it off in Settings
 *    stops it at once rather than at the next reload — the check is per call,
 *    not per mount, so an already-open Discover page cannot keep recording
 *    after consent is withdrawn.
 */

const SESSION_KEY = 'loamy.discovery.session'

/**
 * An opaque per-tab reference, created only once recording is allowed. Writing
 * it before consent would put an identifier on someone's device for an
 * activity they had not agreed to, however harmless that identifier is.
 */
function sessionRef(): string | undefined {
  try {
    let s = sessionStorage.getItem(SESSION_KEY)
    if (!s) {
      s = Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-6)
      sessionStorage.setItem(SESSION_KEY, s)
    }
    // Must match the server's ^[a-z0-9]{6,40}$ or the row is refused.
    return /^[a-z0-9]{6,40}$/.test(s) ? s : undefined
  } catch {
    // Private windows, blocked storage. A missing session ref is fine.
    return undefined
  }
}

export interface DiscoveryEventInput {
  objectType?: 'listing' | 'seller' | 'batch' | 'transaction' | 'buy_request' | 'search'
  objectId?: string
  commodity?: string | null
  state?: string | null
  quantity?: number | null
  unit?: string | null
  pricePerUnit?: number | null
  searchTerms?: string | null
  source?: string
  metadata?: Record<string, unknown>
}

export function useDiscoveryEvents(defaultSource = 'app') {
  // Collapses the duplicate view events a re-render or a StrictMode double
  // mount would otherwise produce, which would quietly inflate the very
  // signals the ranking reads.
  const recent = useRef<Map<string, number>>(new Map())

  const record = useCallback(
    (type: DiscoveryEventType, input: DiscoveryEventInput = {}) => {
      // Checked on every call, deliberately. Reading it once at mount would
      // let a page that was already open go on recording after the person
      // turned this off in another tab or in Settings.
      if (!consentAllows('analytics')) return

      const key = `${type}:${input.objectId ?? input.searchTerms ?? ''}`
      const now = Date.now()
      const last = recent.current.get(key)
      if (last && now - last < 2000) return
      recent.current.set(key, now)

      void supabase
        .rpc('loamy_record_discovery_event', {
          p_event_type: type,
          p_object_type: input.objectType ?? null,
          p_object_id: input.objectId ?? null,
          p_commodity: input.commodity ?? null,
          p_state: input.state ?? null,
          p_quantity: input.quantity ?? null,
          p_unit: input.unit ?? null,
          p_price_per_unit: input.pricePerUnit ?? null,
          p_search_terms: input.searchTerms ?? null,
          p_source: input.source ?? defaultSource,
          p_session_ref: sessionRef() ?? null,
          p_metadata: safeMetadata(input.metadata ?? {}),
        })
        .then(
          () => undefined,
          () => undefined, // telemetry never surfaces an error to the page
        )
    },
    [defaultSource],
  )

  return record
}
