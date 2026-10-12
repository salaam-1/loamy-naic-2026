/**
 * Bank portal domain: the pipeline, the application bundle, the Credit
 * Intelligence Report, and Stage 7 servicing.
 *
 * THE STAGE 5 RULE, AND WHAT REPLACED IT
 *   This file used to open with "no approve/decline exists in Loamy. The Bank
 *   decides inside the Bank; Loamy records only that a decision was
 *   communicated." That was true of Stage 5 and stopped being true at Phase 6,
 *   which added `loamy_financing_decision` — a real approve/reject carrying
 *   amount, tenor, pricing, bank reference and provenance. It simply had no
 *   caller until Phase 4 slice 3.
 *
 *   The principle underneath it has NOT changed and must not: Loamy is not the
 *   lender and owns no credit policy. The bank decides; Loamy records the
 *   decision, who made it, whether it came from an officer, an API or the
 *   sandbox, and refuses to let anyone else write it. What changed is that the
 *   bank can now record that decision here instead of only by telephone.
 */

import type { FinancingStatus } from '@/lib/financingLifecycle'

// Verbatim footer, required on every report (per brief).
export const REPORT_FOOTER = 'Decision support only. All financing decisions rest with the Bank.'

// Verbatim risk label (never "AI").
export const RISK_METHOD_LABEL = 'Risk classification - rule-based, from platform records.'

export type RiskTier = 'Low' | 'Medium' | 'High' | 'Very High'

export const RISK_TIER_META: Record<RiskTier, { chip: string }> = {
  Low: { chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  Medium: { chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  High: { chip: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  'Very High': { chip: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
}

export interface RiskFactor {
  key: string
  label: string
  detail: string
  points: number
}

export interface RiskAssessment {
  method: string
  score: number
  tier: RiskTier
  factors: RiskFactor[]
  computed_at: string
}

export interface PipelineRow {
  id: string
  /** FIN-000123. Added in slice 3 — the queue had no business reference. */
  ref: string | null
  applicant_name: string | null
  digital_id: string | null
  verified_badge: boolean
  product_type: string
  structure: string
  amount_requested: number
  approved_amount: number | null
  state: string | null
  /**
   * Any value the check constraint permits, not the four Stage 5 statuses.
   * The pipeline used to filter decided applications out entirely, so a bank
   * lost sight of its own decisions the moment it made them.
   */
  status: FinancingStatus | string
  risk_tier: RiskTier
  is_sandbox: boolean
  decision_source: string | null
  decided_at: string | null
  transaction_ref: string | null
  commodity: string | null
  created_at: string
}

export interface ApplicationBundle {
  application: {
    id: string
    ref: string | null
    product_type: string
    structure: string
    /** What was ASKED for. Never conflated with the two below. */
    amount_requested: number
    /** What the BANK approved. Null until it decides. */
    approved_amount: number | null
    /** What actually MOVED. Three distinct numbers, kept apart. */
    disbursed_amount: number
    purpose: string
    intended_items: { item: string; qty: string }[]
    disbursement_preference: 'supplier_payment' | 'cash' | null
    status: string
    status_history: { from: string; to: string; at: string }[]
    decision_note: string | null
    conditions: string | null
    tenor_days: number | null
    pricing_note: string | null
    bank_reference: string | null
    expires_at: string | null
    decided_at: string | null
    decision_source: 'bank_officer' | 'bank_api' | 'sandbox_adapter' | null
    is_sandbox: boolean
    repayment_status: string | null
    submitted_at: string
    updated_at: string
  }
  /**
   * What the money is for. Null on the older farmer input-financing path,
   * which is not transaction-linked.
   */
  transaction: {
    ref: string
    commodity: string
    quantity: number
    unit: string
    subtotal: number
    currency: string
    status: string
    payment_state: string
    fulfilment_state: string
    /** Display name and state only — the same fields the public marketplace
     *  already publishes. No seller id, no contact, no seller financials. */
    seller_name: string | null
    seller_state: string | null
    batch_ref: string | null
  } | null
  /** So the portal can say plainly whether a decision here is a simulation. */
  bank: {
    name: string | null
    ref: string | null
    integration_mode: string
    is_sandbox: boolean
    supports_supplier_direct: boolean
  }
  /** From loamy_financing_permitted_decisions — the server's own list. */
  permitted_decisions: string[]
  /** Append-only decision trail for this application. */
  events: {
    event_type: string
    actor_kind: 'applicant' | 'bank' | 'platform' | 'system'
    previous_status: string | null
    new_status: string | null
    amount: number | null
    note: string | null
    /** Named fields only. The raw `detail` blob is deliberately not sent:
     *  it carried the seller's internal user id. */
    source: string | null
    is_sandbox: boolean
    tenor_days: string | null
    bank_reference: string | null
    occurred_at: string
  }[]
  identity: {
    full_name: string | null
    digital_id: string | null
    phone: string | null
    state: string | null
    verified_badge: boolean
    member_since: string
  } | null
  farms: {
    id: string
    farm_name: string
    state: string
    lga: string
    size_hectares: number
    primary_crops: string[]
    ownership_type: string
    verification_status: string
    latitude: number | null
    longitude: number | null
    verified_at: string | null
    crop_records: {
      crop: string
      season_year: number
      planting_date: string | null
      expected_harvest_date: string | null
      actual_harvest_date: string | null
      expected_yield_kg: number | null
      actual_yield_kg: number | null
    }[]
  }[]
  activity: {
    active_listings: number
    concluded_deals: number
    onboarded_by_partner: boolean
  }
  financing_context: {
    prior_applications: {
      id: string
      ref: string | null
      amount_requested: number
      status: string
      decision_note: string | null
      created_at: string
    }[]
    milestones: { milestone_type: string; due_date: string; status: string }[]
  }
}

export interface CreditReport {
  id: string
  application_id: string
  bank_id: string
  generated_by: string
  snapshot: { bundle: ApplicationBundle; risk: RiskAssessment; bank: string }
  risk_tier: RiskTier
  created_at: string
}

export interface RepaymentMilestone {
  id: string
  application_id: string
  milestone_type: 'instalment' | 'delivery'
  due_date: string
  status: 'upcoming' | 'met' | 'missed'
  note: string | null
  created_at: string
}

/**
 * Status presentation now comes from ONE place.
 *
 * This map used to hold four statuses while the database permitted thirteen,
 * so an approved or declined application rendered an undefined chip in the
 * bank's own portal. `statusMeta` covers every permitted value and never
 * returns undefined.
 */
export { statusMeta as bankStatusMeta } from '@/lib/financingLifecycle'

// ---------------------------------------------------------------------------
// Stage 7 (Phase 2) — financing servicing. Loamy RECORDS bank-confirmed
// facilities/disbursements/repayments; it never holds funds or executes
// transfers. Every amount here is a bank-of-record figure, not a Loamy balance.
// ---------------------------------------------------------------------------

export const LOAN_SECTORS = [
  'Agriculture Production',
  'Agri-processing',
  'Trading & Distribution',
  'Equipment Financing',
  'Other',
] as const

export interface Facility {
  id: string
  application_id: string
  bank_id: string
  borrower_id: string
  principal: number
  structure: string
  sector: string
  status: 'active' | 'closed' | 'written_off'
  opened_on: string
  closed_on: string | null
  created_at: string
}

export interface DisbursementRecord {
  id: string
  facility_id: string
  amount: number
  disbursed_on: string
  external_reference: string | null
  created_at: string
}

export interface RepaymentInstalment {
  id: string
  facility_id: string
  due_date: string
  amount_due: number
  amount_paid: number | null
  status: 'upcoming' | 'paid' | 'partial' | 'overdue'
  paid_on: string | null
  external_reference: string | null
}

export interface Collateral {
  id: string
  facility_id: string
  kind: string
  description: string | null
  estimated_value: number | null
  created_at: string
}

export interface BankPortfolio {
  total_principal: number
  active_facilities: number
  borrowers: number
  disbursed_mtd: number
  by_sector: Record<string, number>
  par30_amount: number
  top_borrowers: { full_name: string | null; digital_id: string | null; outstanding: number }[]
}

export const REPAYMENT_STATUS_META: Record<RepaymentInstalment['status'], { label: string; chip: string }> = {
  upcoming: { label: 'Upcoming', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  paid: { label: 'Paid', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  partial: { label: 'Partial', chip: 'bg-gold-100 text-gold-700' },
  overdue: { label: 'Overdue', chip: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
}

/** Early-warning rules for monitoring — computed live, never stored. */
export function earlyWarnings(milestones: RepaymentMilestone[]): string[] {
  return earlyWarningCounts(milestones).map((w) => w.english)
}

/**
 * The same early warnings, as {key, count, english} so a surface can translate
 * and pluralise them properly.
 *
 * `earlyWarnings` kept its exact English for callers that only need a string.
 * The "(s)" in that version is the shape a sentence takes when nobody could
 * pluralise it; a surface with a translator can do better, per language, and
 * `tPlural` knows that Igbo and Yoruba do not split at one at all.
 */
export function earlyWarningCounts(
  milestones: RepaymentMilestone[],
): { key: string; count: number; english: string }[] {
  const out: { key: string; count: number; english: string }[] = []
  const missed = milestones.filter((m) => m.status === 'missed')
  if (missed.length > 0) {
    out.push({
      key: 'bank.warning.missedMilestones',
      count: missed.length,
      english: `${missed.length} missed milestone(s)`,
    })
  }
  const overdue = milestones.filter(
    (m) => m.status === 'upcoming' && new Date(m.due_date) < new Date(),
  )
  if (overdue.length > 0) {
    out.push({
      key: 'bank.warning.overdueMilestones',
      count: overdue.length,
      english: `${overdue.length} overdue milestone(s) not yet updated`,
    })
  }
  return out
}
