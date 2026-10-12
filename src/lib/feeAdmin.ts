/**
 * Ending and reinstating a fee rule.
 *
 * WHY THIS MODULE EXISTS
 *   On 2026-09-21 an accidental click in the admin fee surface ended the
 *   ₦2,500 Growth Partner commission for farm verification. One `onClick`,
 *   one `supabase.from('fee_schedules').update({active:false, ...})`, live,
 *   with no confirmation, no reason, no audit row and no way back. Every
 *   approved farm verification after that accrued nothing, and nobody was
 *   told.
 *
 *   The table no longer accepts UPDATE or DELETE from any client. These two
 *   calls are the only doors, and both require a written reason.
 *
 * WHY "RESTORE" DOES NOT REOPEN THE OLD ROW
 *   `effective_from`/`effective_to` describe a period during which a rule was
 *   in force, and that period is a historical fact. Reopening the ended row
 *   would assert it had applied continuously, which is false, and would erase
 *   the gap — a gap during which real work accrued nothing and which
 *   reconciliation has to be able to see. So a restore clones the rule into a
 *   new period starting now. Every commercial term is copied verbatim by the
 *   server, so a restore can never become a quiet rate change.
 */
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'

export type EndFeeRuleOutcome =
  | { ok: true; ended: true; ref: string | null; scope: string; value: number; basis: string }
  /** The rule was already ended. Not an error — a double-click lands here. */
  | { ok: true; ended: false; reason: 'already_ended'; ref: string | null }
  | { ok: false; error: string }

export type RestoreFeeRuleOutcome =
  | {
      ok: true
      restored: true
      newRef: string | null
      restoredFrom: string | null
      value: number
      basis: string
      payer: string
      /** How long no rule was in force. Worth showing: it is the outage. */
      gapFrom: string | null
      gapTo: string
    }
  | {
      ok: true
      restored: false
      reason: 'still_in_force' | 'equivalent_rule_already_in_force'
      ref: string | null
    }
  | { ok: false; error: string }

/** End a live fee rule. The reason is mandatory and is recorded in the audit trail. */
export async function endFeeRule(ruleId: string, reason: string): Promise<EndFeeRuleOutcome> {
  const { data, error } = await supabase.rpc('loamy_end_fee_rule', {
    p_rule_id: ruleId,
    p_reason: reason,
  })
  if (error) return { ok: false, error: errorMessage(error, 'The rule could not be ended.') }

  const r = data as Record<string, unknown>
  if (!r?.ended) {
    return { ok: true, ended: false, reason: 'already_ended', ref: (r?.ref as string) ?? null }
  }
  return {
    ok: true, ended: true,
    ref: (r.ref as string) ?? null,
    scope: r.scope as string,
    value: Number(r.value),
    basis: r.basis as string,
  }
}

/** Reinstate an ended rule as a new rule effective from now. */
export async function restoreFeeRule(ruleId: string, reason: string): Promise<RestoreFeeRuleOutcome> {
  const { data, error } = await supabase.rpc('loamy_restore_fee_rule', {
    p_rule_id: ruleId,
    p_reason: reason,
  })
  if (error) return { ok: false, error: errorMessage(error, 'The rule could not be reinstated.') }

  const r = data as Record<string, unknown>
  if (!r?.restored) {
    return {
      ok: true, restored: false,
      reason: r?.reason as 'still_in_force' | 'equivalent_rule_already_in_force',
      ref: (r?.ref as string) ?? null,
    }
  }
  return {
    ok: true, restored: true,
    newRef: (r.new_ref as string) ?? null,
    restoredFrom: (r.restored_from as string) ?? null,
    value: Number(r.value),
    basis: r.basis as string,
    payer: r.payer as string,
    gapFrom: (r.gap_from as string) ?? null,
    gapTo: r.gap_to as string,
  }
}

/** How a rate reads to a person. Shared by the table and the confirmation. */
export function describeRate(basis: string, value: number): string {
  return basis === 'bps'
    ? `${Number((value / 100).toFixed(2))}%`
    : `₦${value.toLocaleString('en-NG')} flat`
}

/**
 * Who bears a fee, in a sentence rather than a slug.
 *
 * `loamy` matters most here: a `verification_commission` rule is money Loamy
 * PAYS OUT to a Growth Partner. Ending one does not save a member anything —
 * it stops a partner being paid, which is the opposite of what "end fee rule"
 * sounds like, and is precisely the mistake this surface let through.
 */
export function payerConsequence(scope: string, payer: string): string {
  if (scope === 'verification_commission' || payer === 'loamy') {
    return 'Loamy PAYS this out. Ending it means the partner who does this work is paid nothing.'
  }
  if (payer === 'split') return 'Charged to the buyer and seller.'
  return `Charged to the ${payer}.`
}
