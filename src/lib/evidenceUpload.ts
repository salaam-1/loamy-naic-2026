/**
 * The Supabase half of evidence capture: bytes to the private bucket, then
 * the authoritative RPC.
 *
 * Kept apart from evidenceQueue.ts so the queue's ordering and retry logic
 * stays testable without a database, and so the two-step contract is readable
 * in one screen.
 *
 * WHY loamy_submit_evidence AND NOT loamy_gps_check
 *
 * The forensic audit found the field UI calling `loamy_gps_check`, which does
 * one thing: distance from a pin, written into a JSON blob on the task row.
 * `loamy_submit_evidence` is the Block 5 engine and is the only path that
 *
 *   - writes a real `verification_evidence` row with a business ref,
 *   - records `clock_skew_seconds` (device claim vs server receipt),
 *   - detects duplicate content across cases by hash,
 *   - checks repeated coordinates and impossible travel,
 *   - moves the case to in_progress through the guarded transition.
 *
 * Capture that does not go through it produces nothing a reviewer can rely
 * on, which is why the old path is removed rather than kept alongside.
 */

import { supabase } from '@/lib/supabase'
import { type PendingEvidence } from '@/lib/evidence'
import { deviceHash, type UploadResult, type Uploader } from '@/lib/evidenceQueue'

export const EVIDENCE_BUCKET = 'verification-evidence'

/**
 * Uploads the bytes (if any) and records the evidence row.
 *
 * `upsert: true` is deliberate. The storage path is derived from the content
 * hash, so a retry after a failed RPC writes the identical bytes to the
 * identical key: overwriting is correct and duplicating is not. The server
 * still decides whether the same hash on a DIFFERENT case is a duplicate --
 * that judgement is not the client's to make.
 */
export const supabaseUploader: Uploader = async (item: PendingEvidence): Promise<UploadResult> => {
  if (item.blob && item.storagePath) {
    const { error: upErr } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(item.storagePath, item.blob, {
        upsert: true,
        contentType: item.mime ?? 'application/octet-stream',
      })
    if (upErr) throw new Error(upErr.message)
  }

  const { data, error } = await supabase.rpc('loamy_submit_evidence', {
    p_case_id: item.caseId,
    p_evidence_type: item.evidenceType,
    // The device's claim, carried through however long the item sat in the
    // queue. The server compares it with its own clock and keeps the gap.
    p_captured_at: item.capturedAt,
    p_storage_path: item.storagePath,
    p_content_hash: item.contentHash,
    p_lat: item.lat,
    p_lng: item.lng,
    p_accuracy_m: item.accuracyM,
    p_device_hash: deviceHash(),
    p_quantity: item.quantity,
    p_unit: item.unit,
    p_note: item.note,
  })
  if (error) throw new Error(error.message)

  const r = (data ?? {}) as Record<string, unknown>
  return {
    evidenceId: String(r.evidence_id ?? ''),
    flags: Array.isArray(r.flags) ? (r.flags as string[]) : [],
    distanceM: r.distance_m === null || r.distance_m === undefined ? null : Number(r.distance_m),
    clockSkewSeconds:
      r.clock_skew_seconds === null || r.clock_skew_seconds === undefined
        ? null
        : Number(r.clock_skew_seconds),
  }
}

/** A signed URL for one stored capture. The bucket has no public read path. */
export async function signedEvidenceUrl(storagePath: string, seconds = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, seconds)
  return data?.signedUrl ?? null
}
