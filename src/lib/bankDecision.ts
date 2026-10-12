/**
 * Recording a bank's financing decision.
 *
 * This module is a thin call onto `loamy_financing_decision`, which is the
 * authoritative decision mechanism and has been since Phase 6. It was never
 * reachable from the product: until Phase 4 slice 3 the bank portal called
 * `loamy_bank_set_status`, which can only say "under review", "info
 * requested" or "decided elsewhere" — there was no approve and no decline.
 *
 * WHAT IS DELIBERATELY NOT SENT
 *   The actor. The bank. The applicant. The transaction. The status.
 *   `loamy_financing_decision` derives the officer from `auth.uid()` and the
 *   bank from `loamy_officer_bank()`, and sets the status itself from the
 *   decision. There is no parameter through which a browser could name a
 *   different officer, a different institution, or a status of its choosing —
 *   and this module adds none.
 *
 *   `p_source` is likewise not a caller's choice here. A bank officer working
 *   in the portal is `bank_officer`, always. `bank_api` belongs to a real
 *   integration and `sandbox_adapter` to the admin-only simulator; neither is
 *   something a portal button may claim to be. Whether the RESULT is a
 *   sandbox decision is decided by the server from the bank's
 *   `integration_mode`, not from anything sent here.
 */
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import type { FinancingDecision } from '@/lib/financingLifecycle'

export interface DecisionInput {
  applicationId: string
  decision: FinancingDecision
  /** Required by the server for approved / partially_approved. */
  approvedAmount?: number | null
  /** The message the applicant reads. Required for a question or a refusal. */
  note?: string | null
  conditions?: string | null
  tenorDays?: number | null
  pricingNote?: string | null
  bankReference?: string | null
  expiresAt?: string | null
}

export type DecisionResult = { ok: true } | { ok: false; error: string }

/**
 * Returns the failure rather than throwing, so a caller cannot accidentally
 * carry on as though the decision was recorded. Slice 2 established this: a
 * write that fails silently is the worst outcome available, and a financing
 * decision is the last place to repeat it.
 */
export async function recordFinancingDecision(input: DecisionInput): Promise<DecisionResult> {
  const { error } = await supabase.rpc('loamy_financing_decision', {
    p_application_id: input.applicationId,
    p_decision: input.decision,
    p_approved_amount: input.approvedAmount ?? null,
    p_conditions: input.conditions?.trim() || null,
    p_note: input.note?.trim() || null,
    p_tenor_days: input.tenorDays ?? null,
    p_pricing_note: input.pricingNote?.trim() || null,
    p_bank_reference: input.bankReference?.trim() || null,
    p_expires_at: input.expiresAt || null,
    // Fixed. See the note above: a portal button is a bank officer, and
    // cannot claim to be an API or the simulator.
    p_source: 'bank_officer',
  })

  if (error) {
    return { ok: false, error: errorMessage(error, 'The decision could not be recorded.') }
  }
  return { ok: true }
}
