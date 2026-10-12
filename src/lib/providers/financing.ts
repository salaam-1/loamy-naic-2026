/**
 * FINANCING PROVIDER SEAM — the contract a partner bank's integration fills.
 *
 * WHAT THIS IS FOR
 *   Loamy's financing domain is already bank-agnostic in the database: a bank
 *   is a row, `integration_mode` says sandbox/live/disabled, capability flags
 *   say what it supports, and `loamy_financing_decision` records a decision
 *   with its provenance. No bank is named anywhere in that model, and none is
 *   named here. Sterling, when it arrives, is ONE adapter implementing this
 *   interface — not a branch in domain logic, not a field on a table.
 *
 * WHAT THIS IS NOT
 *   It is not an implementation of anybody's API, and it does not guess at
 *   one. Every operation below exists because LOAMY'S OWN lifecycle needs it,
 *   derived from `loamy_apply_financing_for_transaction`,
 *   `loamy_financing_decision`, `loamy_link_bank_account` and
 *   `loamy_settle_supplier_direct`. When real documentation arrives, the work
 *   is to satisfy these operations — not to reshape the domain around a
 *   vendor.
 *
 * THE LINE THAT MUST NOT BE CROSSED
 *   An adapter TRANSPORTS a decision. It never MAKES one.
 *
 *   The sandbox adapter below therefore does not approve anything. A
 *   simulator that returns "approved" would be a fabricated credit decision,
 *   which is the single thing this codebase has been most careful to avoid —
 *   and Loamy already has the honest mechanism for exercising the workflow:
 *   `loamy_sandbox_bank_decision`, which is admin-only, applies no credit
 *   policy, refuses to run against a live bank, and marks its output
 *   `is_sandbox`. The sandbox adapter here simulates the TRANSPORT (submission
 *   accepted, reference issued, status pending) and nothing else.
 *
 * WHERE AUTHORITY STAYS
 *   With the database. Nothing an adapter returns writes a decision directly.
 *   A decision received from a provider must be applied through
 *   `loamy_financing_decision` with `p_source: 'bank_api'`, which re-checks
 *   the bank, the amount and the lifecycle, and records provenance. An
 *   adapter that wrote to `financing_applications` itself would bypass every
 *   guard in the system.
 */
import {
  NOT_CONFIGURED, providerError,
  type Idempotent, type ProviderEvent, type ProviderInfo,
  type ProviderMode, type ProviderResult,
} from '@/lib/providers/types'

// ---------------------------------------------------------------------------
// Account verification and opening
// ---------------------------------------------------------------------------

/**
 * Confirming a member holds an account with this institution.
 *
 * NOTE WHAT IS ABSENT: no BVN, no NIN, no full account number. Loamy sends
 * the last four digits and a name to match, exactly as `bank_account_links`
 * stores them, and the bank answers yes or no. If an institution requires a
 * BVN, the institution collects it — that is the standing rule and this
 * interface has nowhere to put one.
 */
export interface AccountVerificationRequest extends Idempotent {
  bankId: string
  /** Last four digits only. The column is constrained to `^[0-9]{4}$`. */
  accountLast4: string
  accountNameHint?: string
}

export interface AccountVerificationResult {
  verified: boolean
  /** The bank's opaque handle for this relationship. Meaningless to Loamy. */
  bankReference?: string
  /** Masked by the BANK, for display confirmation only. */
  accountNameMasked?: string
  reason?: string
}

export interface AccountOpeningRequest extends Idempotent {
  bankId: string
  /**
   * Loamy does not open accounts and does not forward identity documents.
   * This asks the bank for a hosted URL to send the member to, which is what
   * `banks.account_opening_url` and `loamy_link_bank_account` already do.
   */
  returnUrl?: string
}

export interface AccountOpeningResult {
  /** Where to send the member. Loamy collects nothing further. */
  hostedUrl: string
  expiresAt?: string
  bankReference?: string
}

// ---------------------------------------------------------------------------
// Application submission and status
// ---------------------------------------------------------------------------

/**
 * What Loamy can tell a bank about an application.
 *
 * This mirrors `loamy_application_bundle`, which is already the bank's entire
 * window onto an applicant. An adapter must not reach for anything the bundle
 * does not expose: no internal user ids, no email, no referral data, no
 * evidence photos. The transaction context is included because the whole
 * premise of transaction-linked financing is that the bank can see what it is
 * funding.
 */
export interface FinancingSubmission extends Idempotent {
  bankId: string
  /** Loamy's own business reference, FIN-000123. Also the idempotency root. */
  applicationRef: string
  productType: string
  structure: string
  amountRequested: number
  currency: string
  purpose: string
  applicant: {
    displayName: string
    digitalId: string
    phone: string
    state: string | null
    verifiedBadge: boolean
    memberSince: string
  }
  transaction?: {
    ref: string
    commodity: string
    quantity: number
    unit: string
    subtotal: number
    batchRef: string | null
    sellerName: string | null
    sellerState: string | null
  }
  /** Supporting evidence Loamy holds, as references rather than payloads. */
  attachments?: { kind: string; ref: string }[]
}

export interface FinancingSubmissionResult {
  accepted: boolean
  /** The bank's reference for the application. Stored on the row. */
  bankReference?: string
  /** Where the bank says it is. Never interpreted as a decision. */
  status: FinancingProviderStatus
  reason?: string
}

/**
 * The provider's own status vocabulary, normalised.
 *
 * Deliberately NOT Loamy's status enum. Mapping into
 * `financing_applications.status` happens in one place, through
 * `loamy_financing_decision`, so a provider cannot introduce a status Loamy's
 * lifecycle does not have.
 */
export type FinancingProviderStatus =
  | 'received'
  | 'in_review'
  | 'information_required'
  | 'decided'
  | 'withdrawn'
  | 'expired'
  | 'unknown'

export interface FinancingStatusResult {
  status: FinancingProviderStatus
  bankReference?: string
  lastUpdatedAt?: string
  /** Present only when `status === 'decided'`. */
  decision?: FinancingProviderDecision
  /** Present when the bank is waiting on the applicant. */
  documentsRequired?: DocumentRequirement[]
}

/**
 * A decision as the BANK expressed it.
 *
 * `approvedAmount` is the bank's figure. Loamy re-validates it against
 * `amount_requested` when applying, because the database refuses an approval
 * that exceeds the request regardless of who sent it.
 */
export interface FinancingProviderDecision {
  outcome: 'approved' | 'partially_approved' | 'rejected'
  approvedAmount?: number
  currency?: string
  tenorDays?: number
  /** As the institution words it. Loamy models no interest and adds none. */
  pricingNote?: string
  conditions?: string
  bankReference?: string
  decidedAt?: string
  expiresAt?: string
  reason?: string
}

export interface DocumentRequirement {
  code: string
  label: string
  /** Whether the bank will proceed without it. */
  mandatory: boolean
  /** A bank-hosted upload target, when the bank collects it directly. */
  hostedUploadUrl?: string
}

// ---------------------------------------------------------------------------
// Supplier verification and settlement
// ---------------------------------------------------------------------------

/**
 * Confirming the SELLER can receive a supplier-direct payment.
 *
 * Gated on `banks.supports_supplier_direct`, which defaults to false and is
 * never assumed — not every institution pays a third party.
 */
export interface SupplierVerificationRequest extends Idempotent {
  bankId: string
  supplierNameHint: string
  accountLast4: string
}

export interface SupplierVerificationResult {
  verified: boolean
  supplierReference?: string
  accountNameMasked?: string
  reason?: string
}

/**
 * Instructing settlement — which Loamy REQUESTS and never performs.
 *
 * Loamy is not a custodian and holds no balance. This asks the institution to
 * pay the seller against an approved facility. What comes back is a request
 * acknowledgement, NOT a confirmation that money moved; only a subsequent
 * event or status carries that, and only then may `external_settlement` and
 * the memorandum ledger record it.
 */
export interface SettlementInstruction extends Idempotent {
  bankId: string
  applicationRef: string
  transactionRef: string
  amount: number
  currency: string
  supplierReference: string
  narration: string
}

export interface SettlementAcknowledgement {
  /** The instruction was accepted for processing. NOT that it completed. */
  accepted: boolean
  externalReference?: string
  /** The bank's expectation, if it gives one. Never displayed as a promise. */
  expectedValueDate?: string
  reason?: string
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export interface FinancingProvider {
  readonly info: ProviderInfo

  verifyAccount(req: AccountVerificationRequest): Promise<ProviderResult<AccountVerificationResult>>
  /** Only where `banks.supports_account_opening` is true. */
  openAccount(req: AccountOpeningRequest): Promise<ProviderResult<AccountOpeningResult>>

  submitApplication(req: FinancingSubmission): Promise<ProviderResult<FinancingSubmissionResult>>
  getApplicationStatus(applicationRef: string): Promise<ProviderResult<FinancingStatusResult>>
  getDocumentRequirements(applicationRef: string): Promise<ProviderResult<DocumentRequirement[]>>

  /** Only where `banks.supports_supplier_direct` is true. */
  verifySupplier(req: SupplierVerificationRequest): Promise<ProviderResult<SupplierVerificationResult>>
  instructSettlement(req: SettlementInstruction): Promise<ProviderResult<SettlementAcknowledgement>>

  /**
   * Verify and normalise an inbound webhook.
   *
   * An adapter that cannot verify a signature MUST return `verified: false`
   * rather than assuming good faith. The caller is then responsible for
   * refusing to change authoritative state.
   */
  parseEvent(raw: unknown, signature?: string): Promise<ProviderResult<ProviderEvent>>
}

// ---------------------------------------------------------------------------
// The default: nothing is configured
// ---------------------------------------------------------------------------

function unconfigured<T>(): Promise<ProviderResult<T>> {
  return Promise.resolve({ ok: false, error: NOT_CONFIGURED })
}

/**
 * What ships today. Every operation reports that no integration exists, which
 * is the truth: no bank API is connected to Loamy.
 */
export const noFinancingProvider: FinancingProvider = {
  info: { key: 'none', label: 'No bank integration', mode: 'disabled' },
  verifyAccount: unconfigured,
  openAccount: unconfigured,
  submitApplication: unconfigured,
  getApplicationStatus: unconfigured,
  getDocumentRequirements: unconfigured,
  verifySupplier: unconfigured,
  instructSettlement: unconfigured,
  parseEvent: unconfigured,
}

/**
 * A deterministic SANDBOX adapter, for exercising the workflow without a bank.
 *
 * READ THIS BEFORE EXTENDING IT.
 *   It simulates TRANSPORT, not judgement. Submissions are accepted and given
 *   a reference; status always comes back `in_review`; `getApplicationStatus`
 *   NEVER returns a decision, because a simulated approval is a fabricated
 *   credit decision and this codebase does not produce those. Exercising an
 *   approval end to end is done through `loamy_sandbox_bank_decision`, which
 *   is admin-only, marks the result `is_sandbox`, and refuses to run against
 *   a live bank.
 *
 *   Every reference it issues is prefixed `SANDBOX-`, so a simulated
 *   reference can never be mistaken for a bank's in a database row, a log or
 *   a support conversation.
 *
 *   It is deterministic: the same input yields the same reference, so a retry
 *   after a timeout is recognisable rather than producing a second record.
 */
export const sandboxFinancingProvider: FinancingProvider = {
  info: { key: 'sandbox', label: 'Sandbox (simulation)', mode: 'sandbox' },

  async verifyAccount(req) {
    return {
      ok: true, mode: 'sandbox',
      value: {
        // Says yes to a well-formed request and nothing more. It performs no
        // identity check, because it has nothing to check against.
        verified: /^[0-9]{4}$/.test(req.accountLast4),
        bankReference: `SANDBOX-ACC-${req.idempotencyKey}`,
        accountNameMasked: req.accountNameHint ? maskName(req.accountNameHint) : undefined,
        reason: /^[0-9]{4}$/.test(req.accountLast4)
          ? 'Simulated verification. No account was checked.'
          : 'Provide the last four digits only.',
      },
    }
  },

  async openAccount() {
    // Loamy never opens an account, and there is no hosted page to simulate.
    return {
      ok: false,
      error: providerError('not_configured',
        'Account opening is handled by the institution and has no sandbox.',
        { retryable: false }),
    }
  },

  async submitApplication(req) {
    return {
      ok: true, mode: 'sandbox',
      value: {
        accepted: true,
        bankReference: `SANDBOX-${req.applicationRef}`,
        status: 'in_review',
        reason: 'Simulated submission. No institution received this.',
      },
    }
  },

  async getApplicationStatus(applicationRef) {
    return {
      ok: true, mode: 'sandbox',
      value: {
        status: 'in_review',
        bankReference: `SANDBOX-${applicationRef}`,
        // Deliberately never a decision. See the note above.
        decision: undefined,
      },
    }
  },

  async getDocumentRequirements() {
    return { ok: true, mode: 'sandbox', value: [] }
  },

  async verifySupplier(req) {
    return {
      ok: true, mode: 'sandbox',
      value: {
        verified: /^[0-9]{4}$/.test(req.accountLast4),
        supplierReference: `SANDBOX-SUP-${req.idempotencyKey}`,
        reason: 'Simulated verification. No account was checked.',
      },
    }
  },

  async instructSettlement(req) {
    return {
      ok: true, mode: 'sandbox',
      value: {
        // Accepted for processing, which is all an acknowledgement ever means.
        // Nothing here says money moved, and nothing may record that it did.
        accepted: true,
        externalReference: `SANDBOX-STL-${req.idempotencyKey}`,
        reason: 'Simulated instruction. No funds moved and no bank was contacted.',
      },
    }
  },

  async parseEvent(raw) {
    return {
      ok: true, mode: 'sandbox',
      value: {
        providerKey: 'sandbox',
        externalId: `SANDBOX-EVT-${Date.now()}`,
        type: 'simulated',
        receivedAt: new Date().toISOString(),
        // A simulated event is never treated as verified, so it can never be
        // used to change authoritative state.
        verified: false,
        mode: 'sandbox',
        payload: raw,
      },
    }
  },
}

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.map((p) => (p.length <= 1 ? p : `${p[0]}${'*'.repeat(Math.min(p.length - 1, 5))}`)).join(' ')
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

let active: FinancingProvider = noFinancingProvider

/** Register the adapter for a bank. Called at startup, never per request. */
export function setFinancingProvider(p: FinancingProvider): void {
  active = p
}

export function financingProvider(): FinancingProvider {
  return active
}

/**
 * Whether a workflow that needs this provider may be OFFERED.
 *
 * A capability that is not available is not rendered as a disabled button
 * with a tooltip — it is simply not offered, because an unavailable path
 * presented as nearly-available wastes the member's time.
 */
export function financingProviderMode(): ProviderMode {
  return active.info.mode
}
