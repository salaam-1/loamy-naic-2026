/**
 * Field evidence capture — the pure layer.
 *
 * The forensic audit found the agent UI calling `loamy_gps_check`, a Stage-4
 * function that compares one coordinate to a farm pin and returns a distance.
 * The authoritative engine is `loamy_submit_evidence`, which additionally
 * records a content hash, the device clock skew, and runs duplicate,
 * impossible-travel and repeated-coordinate checks.
 *
 * Everything here is deliberately free of React and Supabase so the parts
 * that matter for fraud — hashing, idempotency, offline ordering — can be
 * tested without a database.
 *
 * TWO RULES THIS FILE EXISTS TO HOLD:
 *
 *   1. A captured timestamp is the DEVICE's claim and is never rewritten.
 *      When a capture is queued offline and uploaded three hours later, the
 *      server sees the original `captured_at` and its own receipt time, and
 *      the difference is recorded rather than hidden. Stamping upload time
 *      onto a field capture would destroy the only signal that says when the
 *      agent was actually standing there.
 *
 *   2. Idempotency is (case, content hash). The same photograph re-sent after
 *      a failed upload must not become two pieces of evidence.
 */

export type EvidenceType = 'photo' | 'video' | 'gps_point' | 'measurement' | 'document' | 'note'

export interface GeoFix {
  lat: number
  lng: number
  accuracyM: number | null
  capturedAt: string
}

export interface PendingEvidence {
  /** Stable client id: also the idempotency key. */
  id: string
  caseId: string
  evidenceType: EvidenceType
  capturedAt: string
  contentHash: string | null
  storagePath: string | null
  lat: number | null
  lng: number | null
  accuracyM: number | null
  quantity: number | null
  unit: string | null
  note: string | null
  /** Bytes still to upload, if this was captured offline. */
  blob?: Blob
  /** MIME of `blob`, kept so the storage path survives a reload. */
  mime: string | null
  attempts: number
  lastError: string | null
  /** ISO time of the last upload attempt, or null if never tried. */
  lastAttemptAt: string | null
  queuedAt: string
  state: 'queued' | 'uploading' | 'uploaded' | 'failed'
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * SHA-256 of the file bytes, hex encoded.
 *
 * This is what makes duplicate detection work server-side: the same
 * photograph filed against two farms produces the same hash, and
 * `loamy_submit_evidence` flags it. Hashing the bytes rather than the
 * filename matters — a rename is trivial.
 */
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The idempotency key for a queued capture.
 *
 * Deliberately (case, hash) and not a random id: a retry of the same
 * photograph must collide, and two genuinely different photographs on the
 * same case must not.
 */
export function idempotencyKey(caseId: string, contentHash: string | null, fallback: string): string {
  return contentHash ? `${caseId}:${contentHash}` : `${caseId}:${fallback}`
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

export type FileRejection =
  | { ok: true }
  | { ok: false; reason: 'too_large' | 'wrong_type' | 'empty'; message: string }

/**
 * Client-side gate. The storage policy is the real boundary — this exists so
 * an agent standing in a field learns immediately rather than after a slow
 * upload on a bad connection.
 */
export function checkFile(file: { type: string; size: number }): FileRejection {
  if (file.size === 0) {
    return { ok: false, reason: 'empty', message: 'That file is empty.' }
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      message: `Files must be under ${Math.round(MAX_EVIDENCE_BYTES / 1024 / 1024)} MB. Try a smaller photo.`,
    }
  }
  if (![...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].includes(file.type)) {
    return {
      ok: false,
      reason: 'wrong_type',
      message: 'Only photographs and video can be submitted as evidence.',
    }
  }
  return { ok: true }
}

export function evidenceTypeFor(mime: string): EvidenceType {
  if (ALLOWED_VIDEO_TYPES.includes(mime)) return 'video'
  return 'photo'
}

/** Storage path. Foldered by case, which is what the bucket policy keys on. */
export function storagePathFor(caseId: string, contentHash: string, mime: string): string {
  const ext = mime === 'image/png' ? 'png'
    : mime === 'image/webp' ? 'webp'
    : mime === 'video/mp4' ? 'mp4'
    : mime === 'video/quicktime' ? 'mov'
    : mime === 'video/webm' ? 'webm'
    : 'jpg'
  return `${caseId}/${contentHash.slice(0, 32)}.${ext}`
}

// ---------------------------------------------------------------------------
// Offline state
// ---------------------------------------------------------------------------

export type SyncState = 'synced' | 'pending' | 'uploading' | 'failed' | 'offline'

/**
 * What the agent is told about synchronisation.
 *
 * The directive is explicit that offline capture must communicate its state
 * rather than pretend. "Saved" and "sent" are different words here on
 * purpose: an agent who thinks a capture reached Loamy when it is sitting in
 * a queue will walk away from a farm they have to revisit.
 */
export function syncLabel(
  pending: number,
  failed: number,
  online: boolean,
): { state: SyncState; label: string; detail: string } {
  if (failed > 0) {
    return {
      state: 'failed',
      label: `${failed} not sent`,
      detail: 'Some captures could not be uploaded. They are saved on this device and will retry.',
    }
  }
  if (!online) {
    return {
      state: 'offline',
      label: pending > 0 ? `${pending} saved offline` : 'Offline',
      detail: pending > 0
        ? 'Saved on this device. They will upload when you have signal.'
        : 'No connection. You can still capture evidence; it will upload later.',
    }
  }
  if (pending > 0) {
    return {
      state: 'uploading',
      label: `Sending ${pending}`,
      detail: 'Uploading captures from this device.',
    }
  }
  return { state: 'synced', label: 'All sent', detail: 'Every capture has reached Loamy.' }
}

/**
 * Retry backoff, capped. A field device on a bad connection should not spin.
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, attempts - 1))
}

/** After this many failures we stop retrying automatically and tell the agent. */
export const MAX_UPLOAD_ATTEMPTS = 5

export function shouldRetry(item: Pick<PendingEvidence, 'attempts' | 'state'>): boolean {
  return item.state !== 'uploaded' && item.attempts < MAX_UPLOAD_ATTEMPTS
}

/**
 * Whether a queued item may be attempted right now.
 *
 * Separate from `shouldRetry` because they answer different questions:
 * `shouldRetry` asks whether we have given up, `isDue` asks whether enough
 * time has passed since the last try. An item that has never been attempted
 * is due immediately.
 */
export function isDue(
  item: Pick<PendingEvidence, 'attempts' | 'state' | 'lastAttemptAt'>,
  now: number = Date.now(),
): boolean {
  if (!shouldRetry(item)) return false
  if (!item.lastAttemptAt) return true
  return now - new Date(item.lastAttemptAt).getTime() >= retryDelayMs(item.attempts)
}

// ---------------------------------------------------------------------------
// Flags, for the agent
// ---------------------------------------------------------------------------

/**
 * What a returned flag means to the person who just captured it.
 *
 * Reuses the wording rules from fieldops.ts: a flag routes work to review, it
 * does not accuse anyone. An agent who reads "fraud" next to a poor GPS fix
 * stops trusting the system.
 */
export function captureFeedback(flags: string[]): { tone: 'ok' | 'review'; message: string } {
  if (!flags || flags.length === 0) {
    return { tone: 'ok', message: 'Captured.' }
  }
  return {
    tone: 'review',
    message: 'Captured. A reviewer will look at this one before it is approved.',
  }
}
