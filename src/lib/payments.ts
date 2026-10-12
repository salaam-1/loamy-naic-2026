import { supabase } from '@/lib/supabase'

/**
 * Marketplace payments (Paystack escrow) — thin client wrappers. All secret-key
 * work happens in the paystack-* Edge Functions; the browser only starts a
 * charge (and gets redirected to Paystack) or releases escrow via an RPC.
 */

/** True once a Paystack public key is present — used to keep the Pay UI dormant
 * until the operator wires payments. The redirect flow itself uses the server
 * secret key, but we gate the UI on this to avoid dead Pay buttons. */
export function paymentsConfigured(): boolean {
  return Boolean(import.meta.env.VITE_PAYSTACK_PUBLIC_KEY)
}

/** Start payment for a confirmed order; redirects the browser to Paystack. */
export async function startOrderPayment(orderId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('paystack-initialize', {
    body: { order_id: orderId },
  })
  if (error) throw new Error(error.message || 'Could not start payment.')
  const url = (data as { authorization_url?: string })?.authorization_url
  if (!url) throw new Error('Payment could not be started. Please try again.')
  window.location.href = url
}

/** Buyer confirms receipt of an in-escrow order, releasing it to the seller. */
export async function releaseOrder(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_release_order', { p_order: orderId })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Seller payouts (Paystack Transfers)
// ---------------------------------------------------------------------------

export interface PayoutAccount {
  user_id: string
  bank_code: string
  bank_name: string | null
  account_number: string
  account_name: string | null
  recipient_code: string | null
}

export interface Bank { name: string; code: string }

/** Read a FunctionsHttpError's JSON `error` message when present. */
async function invokeMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context
  if (ctx && typeof ctx.json === 'function') {
    try { const b = await ctx.json(); if (b?.error) return b.error as string } catch { /* ignore */ }
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export async function fetchBanks(): Promise<Bank[]> {
  const { data, error } = await supabase.functions.invoke('paystack-banks', { body: {} })
  if (error) throw new Error(await invokeMessage(error))
  return (data as { banks?: Bank[] })?.banks ?? []
}

export async function fetchMyPayoutAccount(): Promise<PayoutAccount | null> {
  const { data } = await supabase.from('seller_payout_accounts').select('*').maybeSingle()
  return (data as PayoutAccount) ?? null
}

/** Validate + save a seller bank account (creates a Paystack transfer recipient). */
export async function savePayoutAccount(
  bank_code: string,
  account_number: string,
  bank_name?: string,
): Promise<{ account_name: string }> {
  const { data, error } = await supabase.functions.invoke('paystack-create-recipient', {
    body: { bank_code, account_number, bank_name },
  })
  if (error) throw new Error(await invokeMessage(error))
  return data as { account_name: string }
}

/** Settle a released order into the seller's Loamy wallet. */
export async function payoutOrder(orderId: string): Promise<{ status: string }> {
  const { data, error } = await supabase.functions.invoke('paystack-payout', { body: { order_id: orderId } })
  if (error) throw new Error(await invokeMessage(error))
  return data as { status: string }
}
