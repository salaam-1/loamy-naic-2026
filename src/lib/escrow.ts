import { supabase } from '@/lib/supabase'
import { PROCUREMENT_LIST_LIMIT } from '@/lib/limits'
import { codedError } from '@/lib/errors'

/**
 * Escrow via our payment partner (Paystack). The client never touches the
 * Paystack secret, computes no amounts, and holds no funds — it only starts the
 * hosted funding flow and requests release/refund through Edge Functions, which
 * do all authorisation, amount verification, and idempotency server-side.
 *
 * Copy rule: funds are always described as "held by our payment partner", never
 * "held by Loamy".
 */

export type EscrowStatus = 'initiated' | 'funded' | 'released' | 'partially_released' | 'refunded' | 'disputed'

export interface EscrowTransaction {
  id: string
  award_id: string
  company_id: string
  supplier_id: string
  provider: string
  amount: number
  released_amount: number
  currency: string
  status: EscrowStatus
  authorization_url: string | null
  funded_at: string | null
  released_at: string | null
  created_at: string
}

export interface EscrowEvent {
  id: string
  escrow_transaction_id: string
  event_type: string
  actor_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

export async function fetchEscrowForAward(awardId: string): Promise<EscrowTransaction | null> {
  const { data, error } = await supabase.from('escrow_transactions').select('*').eq('award_id', awardId).maybeSingle()
  if (error) throw error
  return (data as EscrowTransaction) ?? null
}

export async function fetchEscrowEvents(escrowId: string): Promise<EscrowEvent[]> {
  const { data, error } = await supabase.from('escrow_events').select('*').eq('escrow_transaction_id', escrowId)
    .order('created_at', { ascending: true }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as EscrowEvent[]
}

/** Start funding: returns the payment partner's hosted URL to redirect to. */
export async function fundEscrow(awardId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('escrow-initialize', { body: { award_id: awardId } })
  if (error) {
    const msg = await extractFnError(error)
    throw new Error(msg)
  }
  // The partner's own wording wins when it sent one; this fallback is ours,
  // so it carries a key and the screen can translate it.
  if (!data?.authorization_url) {
    throw data?.error
      ? new Error(data.error as string)
      : codedError('error.couldNotStartPayment', 'Could not start the payment.')
  }
  return data.authorization_url as string
}

export async function releaseEscrow(awardId: string, amount?: number): Promise<{ status: string; released?: number }> {
  const { data, error } = await supabase.functions.invoke('escrow-release', { body: { award_id: awardId, amount } })
  if (error) throw new Error(await extractFnError(error))
  if (data?.error) throw new Error(data.error)
  return data
}

export async function refundEscrow(awardId: string): Promise<{ status: string }> {
  const { data, error } = await supabase.functions.invoke('escrow-release', { body: { award_id: awardId, refund: true } })
  if (error) throw new Error(await extractFnError(error))
  if (data?.error) throw new Error(data.error)
  return data
}

/** Is the current user allowed to fund/release escrow for this company? */
export async function canSettle(companyId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('loamy_company_can_settle', { target: companyId })
  if (error) return false
  return data === true
}

// Edge Functions return errors as a JSON body on a non-2xx response; surface it.
async function extractFnError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context
  if (ctx && typeof ctx.json === 'function') {
    try { const b = await ctx.json(); if (b?.error) return b.error } catch { /* ignore */ }
  }
  return error instanceof Error ? error.message : 'Payment request failed.'
}
