/**
 * PAYMENT PROVIDER SEAM — interface only, NOT implemented.
 *
 * Loamy does not, and in the pilot never will, hold/move/process money: farmers
 * apply through Loamy and the partner BANK decides and disburses off-platform.
 * This seam exists so a Phase-2 payment/settlement provider can be plugged in
 * WITHOUT refactoring existing code. There is no functional implementation here
 * and no code path anywhere calls a live method — the default provider throws.
 *
 * TODO(phase-2): implement a concrete provider (bank rails / licensed wallet)
 * behind this interface and register it via setPaymentProvider().
 *
 * SECURITY-REVIEW: before ANY concrete provider is wired, the backend engineer
 * must design: (1) that Loamy records references/status only and never touches
 * fund custody in-app, (2) idempotency + reconciliation against the bank of
 * record, (3) audit logging of every reference through loamy_audit_internal,
 * (4) that no amount/settlement field is ever written to a Loamy table beyond
 * the status-only repayment_milestones already in place. See HANDOFF.md
 * "Provider seams".
 */

export interface DisbursementReference {
  application_id: string
  /** Bank-side reference for a disbursement that already happened OFF-platform. */
  external_reference: string
  disbursed_on: string
}

export interface RepaymentStatusUpdate {
  milestone_id: string
  status: 'met' | 'missed'
  /** Bank-side note; never an amount processed by Loamy. */
  note?: string
}

/**
 * The seam. A Phase-2 implementation records bank-confirmed references and
 * milestone status — it must never execute a payment from within Loamy.
 */
export interface PaymentProvider {
  readonly name: string
  /** Record (not execute) a bank-confirmed disbursement reference. */
  recordDisbursement(ref: DisbursementReference): Promise<void>
  /** Record a bank-confirmed repayment milestone status change. */
  recordRepaymentStatus(update: RepaymentStatusUpdate): Promise<void>
}

class NotConfiguredPaymentProvider implements PaymentProvider {
  readonly name = 'not-configured'
  private fail(): never {
    // Deliberate: no payment provider ships in the shelf build. Wiring one is a
    // Phase-2 decision gated by the SECURITY-REVIEW above.
    throw new Error(
      'No payment provider is configured. Loamy holds no funds in the pilot; ' +
        'financing is decided and disbursed by the partner bank off-platform.',
    )
  }
  recordDisbursement(): Promise<void> {
    return this.fail()
  }
  recordRepaymentStatus(): Promise<void> {
    return this.fail()
  }
}

let active: PaymentProvider = new NotConfiguredPaymentProvider()

/** Phase-2 entry point: register a concrete provider once one exists. */
export function setPaymentProvider(provider: PaymentProvider): void {
  active = provider
}

export function getPaymentProvider(): PaymentProvider {
  return active
}

/** True only when a real provider has been registered (always false in shelf build). */
export function isPaymentProviderConfigured(): boolean {
  return active.name !== 'not-configured'
}
