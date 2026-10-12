/** Stage 4 domain types + metadata: field verification workflow & partner
 * earnings. Earnings are TRACKED, NOT PAID — payouts happen off-platform. */

// Verbatim copy required on every earnings surface (per brief).
export const PAYOUT_COPY = 'Payouts are processed outside the platform during the pilot period.'

// Block 5 introduced two working states that this union never learned about,
// so the UI fell back to raw snake_case for them. `accepted` is an agent who
// has taken the case but not yet started; `needs_more_information` is the
// reviewer asking for one more thing without sending the whole case back.
export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'accepted'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'resubmit_requested'
  | 'needs_more_information'

export const TASK_STATUS_META: Record<TaskStatus, { label: string; chip: string }> = {
  pending: { label: 'Awaiting partner', chip: 'bg-emerald-950/5 text-emerald-900/60' },
  assigned: { label: 'Assigned', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  accepted: { label: 'Accepted by partner', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  in_progress: { label: 'Visit in progress', chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  submitted: { label: 'Awaiting admin review', chip: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  approved: { label: 'Approved', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  rejected: { label: 'Rejected', chip: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  resubmit_requested: { label: 'Resubmission requested', chip: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
  needs_more_information: { label: 'More evidence requested', chip: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
}

/**
 * DEPRECATED (P0-3, 2026-09-20). Written by `loamy_gps_check`, which field
 * capture no longer calls. GPS now lives on `verification_evidence` rows with
 * distance, accuracy, clock skew and flags -- read it from
 * `loamy_task_detail().evidence`, not from this blob. Kept only because
 * historical task rows still carry it.
 */
export interface GpsCheck {
  partner_lat: number
  partner_lng: number
  farm_lat: number | null
  farm_lng: number | null
  distance_meters: number | null
  captured_at: string
}

export interface ChecklistItem {
  value: boolean | null
  note: string
}

export interface TaskEvidence {
  gps_check?: GpsCheck
  checklist?: Record<string, ChecklistItem>
  partner_note?: string
}

export const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: 'farm_exists', label: 'The farm exists at the visited location' },
  { key: 'crops_match', label: 'Crops on the ground match the declaration' },
  { key: 'size_plausible', label: 'Declared size is plausible' },
  { key: 'identity_confirmed', label: 'Farmer identity confirmed in person' },
]

export interface VerificationTask {
  id: string
  task_type: 'farm_verification' | 'identity_verification' | 'business_verification'
  subject_farm_id: string | null
  subject_user_id: string
  assigned_to: string | null
  status: TaskStatus
  priority: 'low' | 'normal' | 'high'
  evidence: TaskEvidence
  reviewer_id: string | null
  reviewer_note: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface TaskFarmInfo {
  farm_name: string
  state: string
  lga: string
  size_hectares: number
  primary_crops: string[]
  latitude: number | null
  longitude: number | null
  owner_name: string | null
}

export interface PartnerAssignment {
  id: string
  partner_id: string
  state: string
  lgas: string[]
  active: boolean
  created_at: string
}

export interface OnboardedFarmer {
  id: string
  partner_id: string
  farmer_id: string
  onboarding_method: 'field_assisted' | 'referral_link'
  created_at: string
}

export interface PartnerEarning {
  id: string
  partner_id: string
  earning_type: 'onboarding' | 'verification'
  reference_id: string
  amount: number
  status: 'accrued' | 'paid_externally'
  paid_note: string | null
  created_at: string
}

/** GPS agreement threshold for the honest match/mismatch label. A mismatch
 * does NOT auto-fail — registered pins can be imprecise; it flags for admin. */
/** DEPRECATED (P0-3): the threshold is `verification_max_distance_m` in
 *  platform_config and is applied server-side. This client-side copy is no
 *  longer consulted by any capture or review surface. */
export const GPS_MATCH_THRESHOLD_M = 250

export const MIN_EVIDENCE_PHOTOS = 2
/** DEPRECATED (P0-3): capture is queue-backed and no longer caps a batch
 *  client-side; size and type are gated by src/lib/evidence.ts and by the
 *  bucket policy. */
export const MAX_EVIDENCE_PHOTOS = 6
