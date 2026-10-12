/**
 * The offline evidence queue.
 *
 * Section 6 of the production directive: "Offline capture remains a real
 * requirement and must now be implemented rather than deferred." A growth
 * partner standing in a field in Zamfara has no signal. If capture requires a
 * connection, the work does not happen; if it fails silently, the agent walks
 * away believing Loamy has evidence it never received.
 *
 * DESIGN NOTES THAT ARE NOT ARBITRARY
 *
 *   1. ORDER IS PRESERVED. Captures are flushed oldest-first, because
 *      `loamy_submit_evidence` derives `impossible_travel` from the agent's
 *      PREVIOUS capture by `received_at`. Uploading a morning capture after an
 *      afternoon one would manufacture a fraud signal against an honest agent.
 *      A transient failure therefore STOPS the flush rather than skipping
 *      ahead. Items that have exhausted their retries are passed over --
 *      otherwise one poisoned capture would wedge the queue forever -- and are
 *      surfaced to the agent instead.
 *
 *   2. THE DEVICE CLOCK IS NEVER REWRITTEN. `capturedAt` is stamped when the
 *      agent presses the button and travels with the item. The server records
 *      its own receipt time and stores the difference in
 *      `clock_skew_seconds`. Restamping on upload would erase the only
 *      evidence of when the agent was actually there.
 *
 *   3. THE STORE IS INJECTED. IndexedDB in the browser, an in-memory map in
 *      tests and during SSR. The queue's real logic -- ordering, retry,
 *      idempotency -- is the part worth testing, and it should not need a
 *      browser to run.
 *
 *   4. UPLOAD IS TWO STEPS AND THE SECOND IS AUTHORITATIVE. Bytes go to the
 *      private bucket, then `loamy_submit_evidence` records the row. If the
 *      bucket write succeeds and the RPC fails, the retry re-uses the SAME
 *      storage path (derived from the content hash), so the object is
 *      overwritten rather than duplicated, and the case+hash pair keeps the
 *      evidence row single.
 */

import {
  type EvidenceType, type PendingEvidence,
  MAX_UPLOAD_ATTEMPTS, hashBlob, isDue, storagePathFor,
} from '@/lib/evidence'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface QueueStore {
  all(): Promise<PendingEvidence[]>
  put(item: PendingEvidence): Promise<void>
  remove(id: string): Promise<void>
}

/** For tests and for any environment without IndexedDB. */
export function memoryStore(seed: PendingEvidence[] = []): QueueStore {
  const map = new Map<string, PendingEvidence>(seed.map((i) => [i.id, i]))
  return {
    async all() { return [...map.values()] },
    async put(item) { map.set(item.id, item) },
    async remove(id) { map.delete(id) },
  }
}

const DB_NAME = 'loamy-evidence'
const STORE = 'pending'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * IndexedDB rather than localStorage: a photograph is megabytes of binary and
 * localStorage holds ~5 MB of *strings*. Blobs are structured-cloneable, so
 * the bytes survive a reload, a crash, and a flat battery.
 */
export function indexedDbStore(): QueueStore {
  return {
    async all() {
      const db = await openDb()
      const rows = await promisify(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
      db.close()
      return rows as PendingEvidence[]
    },
    async put(item) {
      const db = await openDb()
      const tx = db.transaction(STORE, 'readwrite')
      await promisify(tx.objectStore(STORE).put(item))
      db.close()
    },
    async remove(id) {
      const db = await openDb()
      const tx = db.transaction(STORE, 'readwrite')
      await promisify(tx.objectStore(STORE).delete(id))
      db.close()
    },
  }
}

/** IndexedDB where it exists, memory where it does not. Never throws. */
export function defaultStore(): QueueStore {
  try {
    if (typeof indexedDB !== 'undefined') return indexedDbStore()
  } catch {
    /* private browsing can throw on access */
  }
  return memoryStore()
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadResult {
  evidenceId: string
  flags: string[]
  distanceM: number | null
  clockSkewSeconds: number | null
}

/**
 * Sends one capture. Injected so the queue can be tested without Supabase and
 * so the two-step (bucket, then RPC) contract is visible in one place.
 *
 * MUST throw on failure. A resolved promise means the evidence row exists.
 */
export type Uploader = (item: PendingEvidence) => Promise<UploadResult>

export interface CaptureInput {
  caseId: string
  evidenceType: EvidenceType
  /** The DEVICE's claim about when this was taken. Never overwritten. */
  capturedAt?: string
  lat?: number | null
  lng?: number | null
  accuracyM?: number | null
  quantity?: number | null
  unit?: string | null
  note?: string | null
  blob?: Blob
  mime?: string | null
}

export interface QueueCounts {
  pending: number
  failed: number
  total: number
}

export interface FlushReport {
  uploaded: number
  failed: number
  /** Results for items that reached the server this pass, newest last. */
  results: UploadResult[]
  /** True when the flush stopped early to preserve capture order. */
  stoppedEarly: boolean
}

/**
 * A stable identifier for this INSTALL, not this device.
 *
 * Block 7 forbade device fingerprinting, and this is deliberately not one: it
 * is a random value generated once and kept in localStorage, derived from
 * nothing about the hardware, cleared when the agent clears site data, and
 * used only so a reviewer can see that six captures came from one handset. It
 * cannot be correlated across sites or with other devices.
 */
export function deviceHash(): string | null {
  try {
    const KEY = 'loamy.device'
    let v = localStorage.getItem(KEY)
    if (!v) {
      v = crypto.randomUUID()
      localStorage.setItem(KEY, v)
    }
    return v
  } catch {
    return null
  }
}

export class EvidenceQueue {
  constructor(
    private readonly store: QueueStore,
    private readonly upload: Uploader,
  ) {}

  /**
   * Accept a capture. Always succeeds locally -- that is the point. The blob
   * is hashed here rather than at upload time so the content hash (and
   * therefore the idempotency of a later retry) is fixed at capture.
   */
  async enqueue(input: CaptureInput): Promise<PendingEvidence> {
    const capturedAt = input.capturedAt ?? new Date().toISOString()
    const mime = input.mime ?? input.blob?.type ?? null
    const contentHash = input.blob ? await hashBlob(input.blob) : null
    const item: PendingEvidence = {
      // (case, hash) is the idempotency key. Re-adding the same photograph to
      // the same case overwrites the queued item instead of doubling it.
      id: contentHash
        ? `${input.caseId}:${contentHash}`
        : `${input.caseId}:${capturedAt}:${Math.random().toString(36).slice(2, 8)}`,
      caseId: input.caseId,
      evidenceType: input.evidenceType,
      capturedAt,
      contentHash,
      storagePath: contentHash && mime ? storagePathFor(input.caseId, contentHash, mime) : null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      accuracyM: input.accuracyM ?? null,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      note: input.note ?? null,
      blob: input.blob,
      mime,
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
      queuedAt: new Date().toISOString(),
      state: 'queued',
    }
    await this.store.put(item)
    return item
  }

  async list(): Promise<PendingEvidence[]> {
    const rows = await this.store.all()
    // Capture order, not queue order: see note 1 at the top of this file.
    return rows.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  }

  async counts(): Promise<QueueCounts> {
    const rows = await this.store.all()
    const failed = rows.filter((r) => r.attempts >= MAX_UPLOAD_ATTEMPTS).length
    return { pending: rows.length - failed, failed, total: rows.length }
  }

  /** Drop one capture the agent has decided against. */
  async discard(id: string): Promise<void> {
    await this.store.remove(id)
  }

  /** Give an exhausted item its attempts back, because the agent asked. */
  async retry(id: string): Promise<void> {
    const item = (await this.store.all()).find((r) => r.id === id)
    if (!item) return
    await this.store.put({ ...item, attempts: 0, state: 'queued', lastError: null, lastAttemptAt: null })
  }

  /**
   * Try to send everything that is due, oldest capture first.
   *
   * Stops at the first transient failure. On a field device a failure almost
   * always means the connection has gone again, so pressing on would burn the
   * remaining attempts of every other capture for nothing -- and would break
   * the ordering the server's travel checks depend on.
   */
  async flush(now: number = Date.now()): Promise<FlushReport> {
    const report: FlushReport = { uploaded: 0, failed: 0, results: [], stoppedEarly: false }
    for (const item of await this.list()) {
      if (item.state === 'uploaded') {
        await this.store.remove(item.id)
        continue
      }
      // Exhausted items are stepped over, never retried silently: the agent
      // has been told about them and decides.
      if (item.attempts >= MAX_UPLOAD_ATTEMPTS) {
        report.failed += 1
        continue
      }
      if (!isDue(item, now)) {
        report.stoppedEarly = true
        break
      }

      await this.store.put({ ...item, state: 'uploading' })
      try {
        const result = await this.upload(item)
        report.results.push(result)
        report.uploaded += 1
        // Gone from the queue only once the server has the row.
        await this.store.remove(item.id)
      } catch (err) {
        await this.store.put({
          ...item,
          attempts: item.attempts + 1,
          state: 'failed',
          lastError: err instanceof Error ? err.message : String(err),
          lastAttemptAt: new Date(now).toISOString(),
        })
        report.failed += 1
        report.stoppedEarly = true
        break
      }
    }
    return report
  }
}
