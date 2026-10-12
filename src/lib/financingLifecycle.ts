/**
 * The financing lifecycle — one presentation contract, for every surface.
 *
 * WHY THIS EXISTS
 *   Before Phase 4 slice 3 there were THREE status maps, each written against
 *   a different snapshot of the lifecycle and each missing the states the
 *   others had:
 *
 *     src/lib/bank.ts       BANK_STATUS_META   4 statuses
 *     src/lib/farming.ts    APPLICATION_STATUS_META  5 statuses
 *     src/lib/financing.ts  decisionLabel()    covers approved/rejected
 *
 *   The live check constraint permits THIRTEEN. So a bank officer looking at
 *   an approved application saw an undefined chip, and a farmer whose
 *   application was rejected saw nothing at all. This module is the single
 *   map, covering every value the database can actually hold.
 *
 * TWO WORDS FOR ONE STATE
 *   `info_requested` and `additional_information_required` both exist and
 *   both mean the bank asked a question. The legacy `loamy_bank_set_status`
 *   writes the first; the authoritative `loamy_financing_decision` writes the
 *   second. Live data contains both, so both render identically. Merging them
 *   is a data migration on production rows and is deliberately deferred.
 *
 * WHERE AUTHORITY LIVES
 *   Not here. `loamy_financing_decision` validates every decision, derives
 *   the actor from the session and refuses what it refuses. The helpers below
 *   decide what a portal may OFFER, and catch the obvious before a round
 *   trip. A client that ignored all of it would still be stopped.
 */
import { formatNaira } from '@/lib/utils'


/** Every value `financing_applications_status_check` permits. */
export type FinancingStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'info_requested'
  | 'additional_information_required'
  | 'approved'
  | 'partially_approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'disbursed'
  | 'completed'
  | 'decided_external'

/** Every decision `loamy_financing_decision` accepts. */
export type FinancingDecision =
  | 'under_review'
  | 'additional_information_required'
  | 'approved'
  | 'partially_approved'
  | 'rejected'

export interface StatusMeta {
  /** For the bank officer, who is looking at their own queue. */
  label: string
  chip: string
  /** For the applicant, who is waiting. Written in the second person. */
  applicant: string
  /** True once the bank has answered — used to stop offering review actions. */
  decided: boolean
}

export const FINANCING_STATUS_META: Record<FinancingStatus, StatusMeta> = {
  draft: {
    label: 'Draft',
    chip: 'bg-emerald-950/5 text-emerald-900/60',
    applicant: 'Not submitted yet - continue where you left off.',
    decided: false,
  },
  submitted: {
    label: 'Submitted',
    chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    applicant: 'Received. Your application is with the institution.',
    decided: false,
  },
  under_review: {
    label: 'Under review',
    chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    applicant: 'The institution is reviewing your application.',
    decided: false,
  },
  info_requested: {
    label: 'Information requested',
    chip: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
    applicant: 'The institution has asked for more information.',
    decided: false,
  },
  additional_information_required: {
    label: 'Information requested',
    chip: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
    applicant: 'The institution has asked for more information.',
    decided: false,
  },
  approved: {
    label: 'Approved',
    chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    applicant: 'The institution approved your application.',
    decided: true,
  },
  partially_approved: {
    label: 'Partially approved',
    chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    applicant: 'The institution approved part of what you asked for.',
    decided: true,
  },
  rejected: {
    label: 'Declined',
    chip: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    applicant: 'The institution declined this application.',
    decided: true,
  },
  expired: {
    label: 'Expired',
    chip: 'bg-emerald-950/5 text-emerald-900/60',
    applicant: 'The approval expired before it was used.',
    decided: true,
  },
  cancelled: {
    label: 'Withdrawn',
    chip: 'bg-emerald-950/5 text-emerald-900/60',
    applicant: 'This application was withdrawn.',
    decided: true,
  },
  disbursed: {
    label: 'Settled',
    chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    applicant: 'The institution has settled this facility.',
    decided: true,
  },
  completed: {
    label: 'Completed',
    chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    applicant: 'This facility is closed.',
    decided: true,
  },
  decided_external: {
    label: 'Decided outside Loamy',
    chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    applicant: 'The institution decided and communicates the outcome to you directly.',
    decided: true,
  },
}

/**
 * Status presentation that never returns undefined.
 *
 * A status this build has not heard of is shown as itself rather than as a
 * blank chip — a new database value should look unfamiliar, not invisible.
 */
export function statusMeta(status: string | null | undefined): StatusMeta {
  const known = FINANCING_STATUS_META[status as FinancingStatus]
  if (known) return known
  return {
    label: status ? status.replace(/_/g, ' ') : 'Unknown',
    chip: 'bg-emerald-950/5 text-emerald-900/60',
    applicant: 'This application is in a state Loamy does not recognise.',
    decided: false,
  }
}

export interface DecisionMeta {
  /** The button. */
  label: string
  /** What the officer is confirming, shown above the form. */
  intent: string
  requiresAmount: boolean
  /** A refusal or a question is useless to the applicant without one. */
  requiresNote: boolean
  tone: 'primary' | 'outline' | 'danger'
}

/**
 * The five decisions, keyed by the DB value the server accepts.
 *
 * `label` and `intent` stay English here because they are the fallback a
 * surface renders through `tOr` when a pack has not reached that decision.
 * The authority over WHICH of these may be offered is
 * `loamy_financing_permitted_decisions`, not this map.
 */
export const DECISION_META: Record<FinancingDecision, DecisionMeta> = {
  under_review: {
    label: 'Move to review',
    intent: 'Tell the applicant their file is being assessed.',
    requiresAmount: false,
    requiresNote: false,
    tone: 'outline',
  },
  additional_information_required: {
    label: 'Request information',
    intent: 'Ask the applicant for what you need. They see this message.',
    requiresAmount: false,
    requiresNote: true,
    tone: 'outline',
  },
  approved: {
    label: 'Approve',
    intent: 'Record your institution’s approval and its terms.',
    requiresAmount: true,
    requiresNote: false,
    tone: 'primary',
  },
  partially_approved: {
    label: 'Approve part',
    intent: 'Approve less than was requested, and say what you are funding.',
    requiresAmount: true,
    requiresNote: false,
    tone: 'primary',
  },
  rejected: {
    label: 'Decline',
    intent: 'Record your institution’s decision to decline.',
    requiresNote: true,
    requiresAmount: false,
    tone: 'danger',
  },
}

/**
 * The decisions a portal may offer, from the server's own list.
 *
 * `loamy_application_bundle` returns `permitted_decisions` from
 * `loamy_financing_permitted_decisions`, which is the single definition. If
 * the server sends nothing, NOTHING is offered — a portal that invents
 * actions when the backend went quiet is worse than one that offers none.
 */
export function offeredDecisions(permitted: unknown): FinancingDecision[] {
  if (!Array.isArray(permitted)) return []
  const order: FinancingDecision[] = [
    'under_review', 'additional_information_required',
    'approved', 'partially_approved', 'rejected',
  ]
  return order.filter((d) => permitted.includes(d))
}

// ---------------------------------------------------------------------------
// The approval amount
// ---------------------------------------------------------------------------

export type AmountCheck =
  | { ok: true; value: number }
  | {
    ok: false
    value: number
    /** English, unchanged: what logs, tests and non-localized callers read. */
    message: string
    /** The same refusal as an i18n key, for a surface that can translate it. */
    messageKey: string
    /** Interpolation for `messageKey`, already formatted. */
    vars?: Record<string, string | number>
  }

/**
 * Mirrors the server's two rules and invents no third.
 *
 * `loamy_financing_decision` requires an approval amount greater than zero
 * and not greater than `amount_requested`. There is no ladder, no minimum, no
 * rounding, and no platform-side cap — the ₦500,000 pilot cap was removed
 * from both the UI and the check constraint in `20260919100001`. So none is
 * reintroduced here.
 */
export function checkApprovalAmount(raw: string | number, requested: number): AmountCheck {
  const text = typeof raw === 'number' ? String(raw) : raw.trim()
  if (text === '') {
    return {
      ok: false, value: 0,
      message: 'Enter the approved amount.',
      messageKey: 'bank.validation.enterApprovedAmount',
    }
  }

  const value = Number(text)
  if (!Number.isFinite(value)) {
    return {
      ok: false, value: 0,
      message: 'Enter a number.',
      messageKey: 'bank.validation.enterANumber',
    }
  }
  if (value <= 0) {
    return {
      ok: false, value,
      message: 'An approval needs an amount greater than zero.',
      messageKey: 'bank.validation.amountAboveZero',
    }
  }
  if (value > requested) {
    // Money keeps the Nigerian convention in every language, so it goes
    // through `formatNaira` rather than a locale-dependent `toLocaleString`.
    // The previous hardcoded 'en-NG' was the same defect found in the A.3
    // analytics screen: a formatter choosing a locale of its own.
    const shown = formatNaira(requested)
    return {
      ok: false,
      value,
      message: `An approval cannot exceed the ${shown} requested.`,
      messageKey: 'bank.validation.amountNotAboveRequested',
      vars: { requested: shown },
    }
  }
  return { ok: true, value }
}

/**
 * Tenor, in days. The column is `int` with a `> 0` check and nothing more —
 * no maximum, no standard terms — so that is exactly what is validated.
 */
export function checkTenorDays(raw: string): {
  ok: boolean
  value: number | null
  message?: string
  messageKey?: string
} {
  const text = raw.trim()
  if (text === '') return { ok: true, value: null }
  const value = Number(text)
  if (!Number.isInteger(value)) {
    return {
      ok: false, value: null,
      message: 'Tenor is a whole number of days.',
      messageKey: 'bank.validation.tenorWholeNumber',
    }
  }
  if (value <= 0) {
    return {
      ok: false, value: null,
      message: 'Tenor must be greater than zero days.',
      messageKey: 'bank.validation.tenorAboveZero',
    }
  }
  return { ok: true, value }
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

/**
 * Whether a decision recorded here would be a simulation.
 *
 * Mirrors the server: sandbox when the bank's integration is in sandbox mode,
 * OR the decision came from the sandbox adapter. The UI calls this BEFORE the
 * decision so the officer is told what they are about to record, and reads
 * `is_sandbox` off the row afterwards for what was recorded.
 */
export function wouldBeSandbox(integrationMode: string | null | undefined): boolean {
  return (integrationMode ?? 'sandbox') === 'sandbox'
}

export const SANDBOX_DECISION_WARNING =
  'Sandbox mode: this is test data, not a credit decision, and commits no ' +
  'funds. The applicant sees it labelled as a simulation.'

export const LIVE_DECISION_NOTE =
  'Live mode: the applicant is told the decision came from your institution.'

/** Provenance, in words. Never presented as more than it is. */
export function provenanceLabel(source: string | null | undefined, isSandbox: boolean): string {
  const base =
    source === 'bank_officer' ? 'Recorded by an officer of the institution'
      : source === 'bank_api' ? 'Received from the institution’s system'
      : source === 'sandbox_adapter' ? 'Produced by the Loamy sandbox adapter'
      : 'Provenance not recorded'
  return isSandbox ? `${base} - sandbox simulation, not a real credit decision` : base
}
