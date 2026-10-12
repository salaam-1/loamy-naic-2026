/**
 * Growth Partner field operations — the presentation contract.
 *
 * Four rules, each of which a field app normally gets wrong:
 *
 *   · a flag is a REVIEW SIGNAL, never an accusation of fraud
 *   · commission wording distinguishes owed from paid, always
 *   · GPS accuracy is shown as a quality, not hidden behind a tick
 *   · an agent is never shown a single score for their own work
 */

export type TaskStatus =
  | 'pending' | 'available' | 'assigned' | 'accepted' | 'in_progress'
  | 'submitted' | 'under_review' | 'approved' | 'rejected'
  | 'needs_more_information' | 'resubmit_requested' | 'expired' | 'cancelled'

export const TASK_STATE: Record<TaskStatus, { label: string; tone: 'good' | 'busy' | 'warn' | 'bad' | 'idle' }> = {
  pending:               { label: 'Not published', tone: 'idle' },
  available:             { label: 'Open to claim', tone: 'busy' },
  assigned:              { label: 'Assigned to you', tone: 'busy' },
  accepted:              { label: 'Accepted', tone: 'busy' },
  in_progress:           { label: 'In progress', tone: 'busy' },
  submitted:             { label: 'With Loamy', tone: 'busy' },
  under_review:          { label: 'Under review', tone: 'busy' },
  approved:              { label: 'Approved', tone: 'good' },
  rejected:              { label: 'Rejected', tone: 'bad' },
  needs_more_information:{ label: 'More needed', tone: 'warn' },
  resubmit_requested:    { label: 'More needed', tone: 'warn' },
  expired:               { label: 'Expired', tone: 'idle' },
  cancelled:             { label: 'Cancelled', tone: 'idle' },
}

export const TASK_TYPE_LABEL: Record<string, string> = {
  identity_verification: 'Identity',
  farmer_verification: 'Farmer',
  farm_verification: 'Farm',
  farm_geospatial: 'Farm mapping',
  business_verification: 'Business',
  buyer_verification: 'Buyer',
  seller_verification: 'Seller',
  commodity_verification: 'Commodity',
  batch_verification: 'Batch',
  quantity_verification: 'Quantity',
  quality_verification: 'Quality',
  transaction_verification: 'Transaction',
  loading_verification: 'Loading',
  warehouse_verification: 'Warehouse',
  warehouse_arrival_verification: 'Warehouse arrival',
  logistics_verification: 'Logistics',
  delivery_verification: 'Delivery',
  document_verification: 'Document',
  market_price_collection: 'Market prices',
  field_support: 'Field support',
}

export function taskTypeLabel(t: string): string {
  return TASK_TYPE_LABEL[t] ?? t.replace(/_/g, ' ')
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/**
 * Every flag means the same thing operationally: a human should look. The
 * copy says so, because an agent who reads "fraud" next to a poor GPS fix
 * stops trusting the system — and so does the reviewer.
 */
const FLAG_COPY: Record<string, string> = {
  no_gps: 'No GPS fix was recorded',
  low_gps_accuracy: 'GPS accuracy was poor at capture',
  gps_far_from_subject: 'Captured away from the registered location',
  no_reference_location: 'No registered location to compare against',
  future_timestamp: 'Device clock was ahead',
  captured_before_case_existed: 'Capture pre-dates the request',
  duplicate_evidence: 'The same file appears on another case',
  repeated_identical_coordinates: 'Same coordinates used for a different subject',
  impossible_travel: 'Distance between captures is faster than road travel',
  rapid_completion: 'Case completed unusually quickly',
  quantity_mismatch: 'Quantity differs from the record',
  no_loading_photo: 'No loading photograph',
  no_waybill: 'No waybill reference',
  no_quantity_confirmed: 'Quantity not confirmed',
}

export function flagLabel(code: string): string {
  return FLAG_COPY[code] ?? code.replace(/_/g, ' ')
}

/** The standing explanation that must accompany any flag list. */
export const FLAG_DISCLAIMER =
  'Flags mean a reviewer will look at this case. They are not an accusation, ' +
  'and they do not reject anything on their own.'

/** Flags never block submission — they route it. */
export function blocksSubmission(): boolean {
  return false
}

// ---------------------------------------------------------------------------
// GPS
// ---------------------------------------------------------------------------

export type GpsQuality = 'good' | 'fair' | 'poor' | 'none'

/**
 * Accuracy as a QUALITY, shown to the agent while they are standing there —
 * so they can move ten metres and try again rather than discovering at review
 * that the fix was useless.
 */
export function gpsQuality(accuracyM: number | null | undefined): {
  quality: GpsQuality
  label: string
  advice: string | null
} {
  if (accuracyM == null) {
    return { quality: 'none', label: 'No fix', advice: 'Wait for a GPS fix before capturing.' }
  }
  if (accuracyM <= 20) {
    return { quality: 'good', label: `±${Math.round(accuracyM)} m`, advice: null }
  }
  if (accuracyM <= 100) {
    return { quality: 'fair', label: `±${Math.round(accuracyM)} m`, advice: null }
  }
  return {
    quality: 'poor',
    label: `±${Math.round(accuracyM)} m`,
    advice: 'Accuracy is low. Step into the open and wait a moment - this will be flagged for review.',
  }
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export type CommissionStatus =
  | 'estimated' | 'pending' | 'approved' | 'payable' | 'paid'
  | 'reversed' | 'disputed' | 'accrued' | 'paid_externally'

export const COMMISSION_STATE: Record<CommissionStatus, { label: string; help: string }> = {
  estimated:       { label: 'Estimated', help: 'What this task is expected to pay if the work is approved.' },
  pending:         { label: 'Pending',   help: 'Your work was approved. Loamy is reviewing the commission.' },
  approved:        { label: 'Approved',  help: 'Agreed as owed to you. Not yet released for payment.' },
  payable:         { label: 'Payable',   help: 'Cleared for payment. The money has not moved yet.' },
  paid:            { label: 'Paid',      help: 'Settled, with a payment reference on record.' },
  reversed:        { label: 'Reversed',  help: 'Withdrawn after review. The reason is recorded.' },
  disputed:        { label: 'Disputed',  help: 'Under dispute. Nothing moves until it is resolved.' },
  accrued:         { label: 'Pending',   help: 'Recorded before the current commission workflow.' },
  paid_externally: { label: 'Paid',      help: 'Settled outside Loamy, before the current workflow.' },
}

export interface CommissionSummary {
  currency: string
  pending: number
  approved: number
  payable: number
  paid: number
  reversed: number
  disputed: number
  count: number
}

/**
 * "Owed" and "paid" are different numbers and are never added together.
 *
 * An agent who sees one total cannot tell what has actually reached them,
 * which is the single most important thing about being paid.
 */
export function earningsBreakdown(s: CommissionSummary | null | undefined): {
  owed: number
  paid: number
  owedLabel: string
  paidLabel: string
  note: string
} {
  const owed = Number(s?.pending ?? 0) + Number(s?.approved ?? 0) + Number(s?.payable ?? 0)
  const paid = Number(s?.paid ?? 0)
  return {
    owed,
    paid,
    owedLabel: `₦${owed.toLocaleString('en-NG')}`,
    paidLabel: `₦${paid.toLocaleString('en-NG')}`,
    note: 'Owed is what your approved work has earned. Paid is what has actually been settled.',
  }
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

const ELIGIBILITY_COPY: Record<string, string> = {
  not_a_growth_partner: 'This account is not set up for field work.',
  account_inactive: 'This account is not active.',
  suspended: 'Your account is suspended. Contact Loamy.',
  marked_unavailable: 'You have marked yourself unavailable.',
  training_incomplete: 'This task type needs training you have not completed.',
  not_cleared_for_this_task_type: 'You are not cleared for this task type yet.',
  workload_at_capacity: 'You already hold the maximum number of open tasks.',
  outside_service_area: 'This task is outside your service area.',
}

/** Every reason, in words, so an agent knows what to fix. */
export function eligibilityReasons(reasons: string[] | undefined): string[] {
  return (reasons ?? []).map((r) => ELIGIBILITY_COPY[r] ?? r.replace(/_/g, ' '))
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export interface Performance {
  training_status: string
  availability: string
  suspended: boolean
  tasks: Record<string, number>
  average_turnaround_hours: number
  review_outcomes: Record<string, number>
  evidence: Record<string, number>
  flags_by_kind: Record<string, number>
  commission: Record<string, number>
  service_areas: { state: string; lgas: string[]; commodities: string[] }[]
}

/**
 * Completion rate, with its denominator, or nothing.
 *
 * Below a handful of decided cases a percentage is noise dressed as a
 * measurement — the same rule the marketplace applies to seller ratings.
 */
export function completionRate(p: Performance | null | undefined): {
  shown: boolean
  percent?: number
  sample?: number
  caption: string
} {
  const approved = Number(p?.tasks?.approved ?? 0)
  const rejected = Number(p?.tasks?.rejected ?? 0)
  const decided = approved + rejected
  if (decided < 5) {
    return {
      shown: false,
      caption: `${decided} decided case${decided === 1 ? '' : 's'} - a rate needs at least 5`,
    }
  }
  return {
    shown: true,
    percent: Math.round((approved / decided) * 100),
    sample: decided,
    caption: `${approved} approved of ${decided} decided`,
  }
}
