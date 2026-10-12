/**
 * React binding for the offline evidence queue.
 *
 * The hook owns three things the component should not: one queue instance per
 * mount, the browser's online/offline signal, and a timer that retries with
 * backoff. Everything it decides is delegated to the pure layer so the rules
 * stay testable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_UPLOAD_ATTEMPTS, syncLabel, type PendingEvidence, type SyncState } from '@/lib/evidence'
import {
  EvidenceQueue, defaultStore,
  type CaptureInput, type FlushReport, type UploadResult,
} from '@/lib/evidenceQueue'
import { supabaseUploader } from '@/lib/evidenceUpload'

export interface EvidenceQueueState {
  items: PendingEvidence[]
  pending: number
  failed: number
  online: boolean
  sync: { state: SyncState; label: string; detail: string }
  /** Results of the most recent successful sends, so the UI can show flags. */
  lastResults: UploadResult[]
  capture: (input: CaptureInput) => Promise<PendingEvidence>
  flush: () => Promise<FlushReport>
  discard: (id: string) => Promise<void>
  retry: (id: string) => Promise<void>
}

/** Poll interval. Cheap: a flush with nothing due is two map reads. */
const TICK_MS = 15_000

export function useEvidenceQueue(onSynced?: () => void): EvidenceQueueState {
  const queue = useMemo(() => new EvidenceQueue(defaultStore(), supabaseUploader), [])
  const [items, setItems] = useState<PendingEvidence[]>([])
  const [lastResults, setLastResults] = useState<UploadResult[]>([])
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine)
  // Kept in a ref so the ticker never closes over a stale callback.
  const syncedRef = useRef(onSynced)
  syncedRef.current = onSynced

  const refresh = useCallback(async () => {
    setItems(await queue.list())
  }, [queue])

  const flush = useCallback(async () => {
    const report = await queue.flush()
    if (report.results.length > 0) {
      setLastResults(report.results)
      // Something reached the server; the case detail is now stale.
      syncedRef.current?.()
    }
    await refresh()
    return report
  }, [queue, refresh])

  const capture = useCallback(async (input: CaptureInput) => {
    const item = await queue.enqueue(input)
    await refresh()
    // Try immediately. If there is no signal this fails fast and the item
    // simply waits -- the agent is never blocked on the network.
    void flush()
    return item
  }, [queue, refresh, flush])

  const discard = useCallback(async (id: string) => {
    await queue.discard(id)
    await refresh()
  }, [queue, refresh])

  const retry = useCallback(async (id: string) => {
    await queue.retry(id)
    await refresh()
    void flush()
  }, [queue, refresh, flush])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    // Coming back into signal is the moment that matters most: an agent who
    // walks out of a dead zone should not have to press anything.
    const up = () => { setOnline(true); void flush() }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    const timer = window.setInterval(() => { if (navigator.onLine) void flush() }, TICK_MS)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
      window.clearInterval(timer)
    }
  }, [flush])

  // "Failed" means GIVEN UP, not "the last try did not work". An item that
  // failed once and retries in two seconds is still pending, and telling the
  // agent otherwise would send them back to a farm for nothing.
  const failed = items.filter((i) => i.attempts >= MAX_UPLOAD_ATTEMPTS).length
  const pending = items.length - failed

  return {
    items,
    pending,
    failed,
    online,
    sync: syncLabel(pending, failed, online),
    lastResults,
    capture,
    flush,
    discard,
    retry,
  }
}
