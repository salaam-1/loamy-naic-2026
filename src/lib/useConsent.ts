/**
 * React binding for the privacy preference store.
 *
 * Every surface that cares — the notice, Settings → Privacy, and the
 * telemetry hook — reads through this, so a change made in one place takes
 * effect in the others immediately rather than at the next reload.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  getConsent, needsNotice, reloadConsent, resetConsent, setConsent, subscribeConsent,
  type ConsentCategory, type ConsentRecord,
} from '@/lib/consent'
import { CONSENT_STORAGE_KEY, isAllowed } from '@/lib/consent'

export interface ConsentState {
  record: ConsentRecord | null
  /** True when the notice should be on screen. */
  mustAsk: boolean
  analytics: boolean
  allows: (category: ConsentCategory) => boolean
  save: (analytics: boolean) => void
  /** Show the notice again, for "manage preferences" from a footer link. */
  reopen: () => void
}

export function useConsent(): ConsentState {
  const [record, setRecord] = useState<ConsentRecord | null>(() => getConsent())

  useEffect(() => subscribeConsent(setRecord), [])

  // Cross-tab: `storage` fires in the OTHER tabs when one of them writes. A
  // person who turns analytics off in Settings should not have it still
  // running in the marketplace tab they left open.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === CONSENT_STORAGE_KEY) reloadConsent()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const save = useCallback((analytics: boolean) => { setConsent(analytics) }, [])
  const reopen = useCallback(() => { resetConsent() }, [])
  const allows = useCallback((c: ConsentCategory) => isAllowed(record, c), [record])

  return {
    record,
    mustAsk: needsNotice(record),
    analytics: isAllowed(record, 'analytics'),
    allows,
    save,
    reopen,
  }
}
