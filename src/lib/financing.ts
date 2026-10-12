/**
 * Buyer financing — the presentation contract.
 *
 * The rules here exist because a financing UI can mislead in ways an ordinary
 * marketplace UI cannot:
 *
 *   · never say "approved" about anything Loamy decided
 *   · never say "paid" before a settlement is on record
 *   · never present a SANDBOX simulation as a real credit decision
 *   · never show a member a naira figure that reads as an entitlement
 *
 * Each is a function with a test rather than a template someone can shortcut.
 */

export type StageStatus =
  | 'done' | 'active' | 'waiting' | 'blocked' | 'failed' | 'skipped' | 'pending'

export interface JourneyStage {
  step: number
  code: string
  label: string
  status: StageStatus
  responsible: 'buyer' | 'seller' | 'bank' | 'loamy' | 'logistics_provider'
  detail: string | null
  next: string | null
  your_action?: string | null
  blocked_by?: string[] | null
  is_sandbox?: boolean
  agent_display?: string | null
  flags?: string[] | null
  mode?: string | null
}

export interface Journey {
  found: boolean
  reason?: string
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
  }
  financing: {
    ref: string
    status: string
    is_sandbox: boolean
    amount_requested: number
    approved_amount: number | null
    disbursed_amount: number
    repayment_status: string | null
  } | null
  stages: JourneyStage[]
  generated_at: string
}

// ---------------------------------------------------------------------------
// Stage presentation
// ---------------------------------------------------------------------------

/** Whose move it is, in words a buyer reads rather than a role slug. */
export function responsibleLabel(who: JourneyStage['responsible']): string {
  switch (who) {
    case 'buyer': return 'You'
    case 'seller': return 'The seller'
    case 'bank': return 'The financing institution'
    case 'loamy': return 'Loamy'
    case 'logistics_provider': return 'The carrier'
    default: return 'Someone else'
  }
}

export const STAGE_TONE: Record<StageStatus, 'good' | 'busy' | 'warn' | 'bad' | 'idle'> = {
  done: 'good',
  active: 'busy',
  waiting: 'busy',
  blocked: 'warn',
  failed: 'bad',
  skipped: 'idle',
  pending: 'idle',
}

export const STAGE_WORD: Record<StageStatus, string> = {
  done: 'Done',
  active: 'Your move',
  waiting: 'In progress',
  blocked: 'Blocked',
  failed: 'Stopped',
  skipped: 'Not needed',
  pending: 'Not started',
}

/**
 * Which stage to show at the top.
 *
 * A stage the BUYER must act on beats one that is merely in progress: the
 * whole reason a tracker exists is to tell someone whether they are waiting
 * or being waited on.
 */
export function currentStage(stages: JourneyStage[]): JourneyStage | null {
  if (!stages?.length) return null
  return (
    stages.find((s) => s.status === 'failed') ??
    stages.find((s) => s.status === 'active') ??
    stages.find((s) => s.status === 'blocked') ??
    stages.find((s) => s.status === 'waiting') ??
    stages.find((s) => s.status === 'pending') ??
    stages[stages.length - 1]
  )
}

/** Progress, counting only stages that actually apply to this purchase. */
export function progress(stages: JourneyStage[]): { done: number; total: number; percent: number } {
  const applicable = (stages ?? []).filter((s) => s.status !== 'skipped')
  const done = applicable.filter((s) => s.status === 'done').length
  const total = applicable.length || 1
  return { done, total, percent: Math.round((done / total) * 100) }
}

// ---------------------------------------------------------------------------
// The four things this UI must never say
// ---------------------------------------------------------------------------

/**
 * The payment line for a purchase.
 *
 * Returns "Payment complete" ONLY when a settlement is actually recorded.
 * Every other state says what is genuinely true, which is usually that
 * nothing has moved yet.
 */
export function paymentLabel(j: Pick<Journey, 'financing' | 'transaction'>): string {
  const settled = Number(j.financing?.disbursed_amount ?? 0) > 0
  if (settled) return 'Seller settled by the institution'

  const state = j.transaction?.payment_state
  switch (state) {
    case 'released': return 'Payment released'
    case 'held': return 'Payment held'
    case 'pending': return 'Payment started'
    case 'authorized': return 'Payment authorised'
    case 'refunded': return 'Payment refunded'
    case 'failed': return 'Payment failed'
    default: return 'No payment yet'
  }
}

/**
 * A decision line. A sandbox result is labelled as a simulation EVERY time it
 * is rendered, not once in a footnote.
 */
export function decisionLabel(f: Journey['financing']): string | null {
  if (!f) return null
  const sim = f.is_sandbox ? ' (sandbox simulation - not a real credit decision)' : ''
  switch (f.status) {
    case 'approved': return `Approved by the institution${sim}`
    // Said distinctly: a borrower who asked for more than they got must not
    // read "approved" and discover the shortfall at settlement.
    case 'partially_approved': return `Partly approved by the institution${sim}`
    case 'rejected': return `Declined by the institution${sim}`
    case 'expired': return 'The approval expired'
    case 'disbursed': return `Settled${sim}`
    case 'completed': return 'This facility is closed'
    case 'draft': return 'Not submitted yet'
    case 'submitted':
    case 'under_review': return 'With the institution for assessment'
    case 'info_requested':
    case 'additional_information_required': return 'The institution needs more information'
    case 'cancelled': return 'Withdrawn'
    // The legacy Stage 5 path: the bank decided outside Loamy and only
    // recorded that it happened. Loamy does not know the outcome and must
    // not imply one.
    case 'decided_external':
      return 'The institution has decided and communicates the outcome to you directly'
    default: return f.status
  }
}

/**
 * An eligibility signal is never an amount.
 *
 * The directive forbids "You qualify for ₦500,000" unless a bank actually
 * approved that. This returns words, never a figure, and there is no code
 * path that turns a signal into one.
 */
export function eligibilityLabel(signal: { band?: string; available?: boolean } | null): string {
  if (!signal?.available) return 'Bank assessment required'
  return 'Eligibility assessment available'
}

export const ELIGIBILITY_DISCLAIMER =
  'A Loamy signal based on platform activity. It is not a credit decision, ' +
  'not an offer, and not a guarantee. The institution decides.'

// ---------------------------------------------------------------------------
// Settlement conditions
// ---------------------------------------------------------------------------

export interface Condition {
  code: string
  label: string
  passed: boolean
  detail?: unknown
  note?: string
}

export interface Readiness {
  ready: boolean
  reason?: string
  application?: string
  is_sandbox?: boolean
  conditions?: Condition[]
  blocked_by?: string[]
}

/**
 * Why settlement is blocked, one sentence per server code.
 *
 * `loamy_settlement_readiness` returns `blocked_by` as a list of CODES, and
 * this map turns each into words on the client -- which is what makes them
 * translatable at all. The code is the key: `bank.condition.<code>`. A code
 * this build has not heard of falls through to its own text rather than
 * rendering a key, so a new server condition degrades to readable English
 * instead of to `bank.condition.something_new`.
 */
const CONDITION_HELP: Record<string, string> = {
  bank_approved: 'The institution has not approved this application yet.',
  approval_current: 'The approval has expired. Apply again, or pay directly.',
  supplier_direct_supported: 'This institution does not pay sellers directly.',
  transaction_live: 'The purchase is no longer live.',
  commodity_verified: 'A Loamy agent still has to inspect the stock.',
  verification_current: 'The last inspection is too old and must be repeated.',
  seller_payout_ready: 'The seller has not told Loamy where to send settlement.',
  no_blocking_flags: 'An unresolved check on the inspection needs review.',
  not_over_committed: 'More of this stock is committed than exists.',
  not_already_settled: 'This application has already been settled.',
}

/** Why settlement cannot happen yet, in plain words, in blocking order. */
export function blockingReasons(r: Readiness | null | undefined): string[] {
  if (!r || r.ready) return []
  return (r.blocked_by ?? []).map((code) => CONDITION_HELP[code] ?? code.replace(/_/g, ' '))
}

/**
 * The same blockers as {code, english} pairs, so a surface can translate them.
 *
 * `blockingReasons` is kept exactly as it was for callers that only need the
 * English, and this returns the code beside it for callers that can do better.
 */
export function blockingConditions(
  r: Readiness | null | undefined,
): { code: string; english: string }[] {
  if (!r || r.ready) return []
  return (r.blocked_by ?? []).map((code) => ({
    code,
    english: CONDITION_HELP[code] ?? code.replace(/_/g, ' '),
  }))
}

// ---------------------------------------------------------------------------
// Bank capabilities
// ---------------------------------------------------------------------------

export interface BankCapabilities {
  available: boolean
  reason?: string
  bank: string
  bank_id: string
  integration_mode: string
  is_sandbox: boolean
  capabilities: {
    check_eligibility: boolean
    submit_application: boolean
    account_opening: boolean
    account_opening_url: string | null
    status_callback: boolean
    supplier_direct: boolean
  }
  contact_note: string | null
}

/**
 * What a bank's card may offer. A capability that is false is not rendered as
 * a disabled button with a tooltip — it is simply not offered, because an
 * unavailable path presented as nearly-available wastes the member's time.
 */
export function bankOffers(b: BankCapabilities | null | undefined): string[] {
  if (!b?.available) return []
  const out: string[] = []
  if (b.capabilities.supplier_direct) out.push('Pays the seller directly')
  if (b.capabilities.account_opening) out.push('Can open an account for you')
  if (b.capabilities.status_callback) out.push('Reports status back to Loamy')
  if (b.is_sandbox) out.push('Sandbox - no real money moves')
  return out
}
