/** Stage 2 domain types + display metadata for farms, crop records, financing. */

import {
  FINANCING_STATUS_META,
  type FinancingStatus,
  type StatusMeta,
} from '@/lib/financingLifecycle'

export const OWNERSHIP_TYPES = ['owned', 'leased', 'family'] as const
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number]

export const OWNERSHIP_LABELS: Record<OwnershipType, string> = {
  owned: 'Owned',
  leased: 'Leased',
  family: 'Family land',
}

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected'

export const VERIFICATION_META: Record<
  VerificationStatus,
  { label: string; chip: string; description: string }
> = {
  unverified: {
    label: 'Not verified',
    chip: 'bg-emerald-950/5 text-emerald-900/60',
    description:
      'This farm has not been verified yet. Verified farms carry more weight with partner banks and buyers.',
  },
  pending: {
    label: 'Verification pending',
    chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    description:
      'Verification has been requested. A field visit will be arranged - you will be notified at each step.',
  },
  verified: {
    label: 'Verified',
    chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    description: 'This farm has been verified through a field visit.',
  },
  rejected: {
    label: 'Verification unsuccessful',
    chip: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    description:
      'The last verification attempt was unsuccessful. Review your farm details and request verification again.',
  },
}

export interface Farm {
  id: string
  owner_id: string
  farm_name: string
  state: string
  lga: string
  address_description: string | null
  latitude: number | null
  longitude: number | null
  size_hectares: number
  primary_crops: string[]
  ownership_type: OwnershipType
  verification_status: VerificationStatus
  created_at: string
  updated_at: string
}

export interface CropRecord {
  id: string
  farm_id: string
  crop: string
  season_year: number
  planting_date: string | null
  expected_harvest_date: string | null
  actual_harvest_date: string | null
  expected_yield_kg: number | null
  actual_yield_kg: number | null
  notes: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Financing. Loamy is NOT a lender: farmers APPLY here, the partner bank
// DECIDES at the bank. There is deliberately no 'approved'/'declined' status
// anywhere in this codebase — the terminal state is 'decided_external'.
// ---------------------------------------------------------------------------

// No platform-side amount limit: the farmer states what they need and the
// partner bank decides. (The former ₦500,000 pilot cap was removed — both here
// and in the DB check constraint, see 20260919100001.)
/**
 * An application's status, as the database defines it.
 *
 * This used to be a five-value union while the check constraint permitted
 * thirteen, so a farmer whose application was approved or declined saw an
 * undefined chip on their own dashboard. Both the type and the presentation
 * now come from the one lifecycle contract.
 */
export type ApplicationStatus = FinancingStatus

export const APPLICATION_STATUS_META: Record<
  FinancingStatus,
  { label: string; chip: string; description: string }
> = Object.fromEntries(
  (Object.entries(FINANCING_STATUS_META) as [FinancingStatus, StatusMeta][]).map(
    ([status, meta]) => [status, { label: meta.label, chip: meta.chip, description: meta.applicant }],
  ),
) as Record<FinancingStatus, { label: string; chip: string; description: string }>

export interface IntendedItem {
  item: string
  qty: string
}

export interface FinancingApplication {
  id: string
  applicant_id: string
  farm_id: string | null
  product_type: 'input_financing'
  structure: string
  amount_requested: number
  purpose: string
  intended_items: IntendedItem[]
  disbursement_preference: 'supplier_payment' | 'cash' | null
  status: ApplicationStatus
  decision_note: string | null
  created_at: string
  updated_at: string
}

/** Statuses that count as "active" on the dashboard stat card. */
export const ACTIVE_APPLICATION_STATUSES: ApplicationStatus[] = [
  'submitted',
  'under_review',
  'info_requested',
]
