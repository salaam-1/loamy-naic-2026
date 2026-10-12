import { supabase } from '@/lib/supabase'

/**
 * Fees, resolved from the authoritative schedule.
 *
 * WHY NOTHING HERE HAS A PERCENTAGE IN IT
 *
 *   The product direction names four rates -- marketplace 5%, loan
 *   facilitation 3%, logistics 10%, warehouse 10% -- and then says, in
 *   capitals, not to hardcode them into UI components. So this module does
 *   not know any of them. It asks `loamy_resolve_fee`, which reads the
 *   `fee_schedules` table: scope, basis, value, payer, min, max, effective
 *   window, most-specific-rule-wins.
 *
 *   That is not pedantry. A rate baked into a React component is a rate that
 *   disagrees with the ledger the moment someone edits the schedule, and the
 *   number the buyer was shown is the one they will hold you to.
 *
 * WHAT "NO RULE" MEANS
 *
 *   `loamy_resolve_fee` returns {resolved: false, fee: 0} when no active rule
 *   matches. That is a real answer -- it means no fee applies -- and this
 *   module passes it through as `applies: false` so the UI can omit the line
 *   entirely. §28: "Only show fees that actually apply." A ₦0 row implies a
 *   fee that was calculated and came to nothing, which is a different claim.
 *
 * WHAT THIS MODULE DOES NOT DO
 *
 *   It does not snapshot. Freezing the schedule onto a transaction happens
 *   server-side, in the `loamy_snapshot_transaction_fee` trigger that fires
 *   when a transaction reaches `accepted`. A client-side snapshot would be a
 *   number the buyer's browser chose, which is exactly the wrong place for
 *   it. What the client shows at checkout is an ESTIMATE of a rule that the
 *   server will re-resolve and freeze at acceptance.
 */

/** The scopes `fee_schedules.scope` accepts. */
export type FeeScope =
  | 'marketplace_transaction'
  | 'verification'
  | 'logistics'
  | 'warehouse'
  | 'financing_facilitation'
  | 'withdrawal'
  // Growth Partner commission. Present in the live schedule with seven
  // configured rules and absent from the first version of this union, which
  // meant the fee admin silently hid every one of them.
  | 'verification_commission'

export type FeePayer = 'buyer' | 'seller' | 'split' | 'platform'

export interface ResolvedFee {
  scope: FeeScope
  /** False when no active rule matched. The UI should omit the line. */
  applies: boolean
  amount: number
  basis: 'bps' | 'flat' | null
  /** Basis points when basis==='bps', naira when 'flat'. */
  value: number | null
  payer: FeePayer | null
  /** The schedule row this came from, for support and reconciliation. */
  scheduleRef: string | null
}

/** Human label per scope. One place, so checkout and admin agree. */
export const FEE_LABEL: Record<FeeScope, string> = {
  marketplace_transaction: 'Marketplace fee',
  financing_facilitation: 'Financing facilitation fee',
  logistics: 'Logistics fee',
  warehouse: 'Warehouse fee',
  verification: 'Verification fee',
  withdrawal: 'Withdrawal fee',
  verification_commission: 'Growth Partner commission',
}

/**
 * How a rate reads to a person. Basis points are how the schedule stores a
 * rate and are meaningless to a buyer, so 500 becomes "5%".
 */
export function describeRate(fee: ResolvedFee): string | null {
  if (!fee.applies || fee.value === null) return null
  if (fee.basis === 'bps') {
    // Trailing zeros trimmed: a rate reads as "2.5%", not "2.50%". Money
    // keeps its decimals; a rate does not need them.
    const pct = fee.value / 100
    return `${Number(pct.toFixed(2))}%`
  }
  return 'fixed'
}

function parse(scope: FeeScope, data: unknown): ResolvedFee {
  const r = (data ?? {}) as Record<string, unknown>
  const applies = r.resolved === true
  return {
    scope,
    applies,
    amount: applies ? Number(r.fee ?? 0) : 0,
    basis: applies ? ((r.basis as 'bps' | 'flat') ?? null) : null,
    value: applies && r.value !== null && r.value !== undefined ? Number(r.value) : null,
    payer: applies ? ((r.payer as FeePayer) ?? null) : null,
    scheduleRef: applies ? ((r.schedule_ref as string) ?? null) : null,
  }
}

/** Resolve one fee. Never throws: a fee that cannot be resolved does not apply. */
export async function resolveFee(
  scope: FeeScope,
  amount: number,
  opts: { transactionType?: string; userRole?: string; commodityGroup?: string } = {},
): Promise<ResolvedFee> {
  const { data, error } = await supabase.rpc('loamy_resolve_fee', {
    p_scope: scope,
    p_amount: amount,
    p_transaction_type: opts.transactionType ?? null,
    p_user_role: opts.userRole ?? null,
    p_partner_id: null,
    p_commodity_group: opts.commodityGroup ?? null,
  })
  if (error) {
    // A failed lookup is not a free order and not a guessed fee. It is an
    // unknown, and the caller shows the subtotal alone rather than inventing
    // a number the server will later disagree with.
    return { scope, applies: false, amount: 0, basis: null, value: null, payer: null, scheduleRef: null }
  }
  return parse(scope, data)
}

export interface FeeBreakdown {
  subtotal: number
  /** Only the fees that actually resolved. */
  fees: ResolvedFee[]
  /** Subtotal plus the fees this party actually pays. */
  total: number
}

/**
 * What the BUYER pays.
 *
 * A fee whose payer is 'seller' or 'platform' is still shown — a buyer is
 * entitled to see the economics of the deal — but it is not added to their
 * total. 'split' is charged to the buyer here because the schedule does not
 * carry a split ratio; until it does, treating half as zero would understate
 * what they owe, and that is the error that matters.
 */
export function buyerTotal(subtotal: number, fees: ResolvedFee[]): number {
  const payable = fees
    .filter((f) => f.applies && (f.payer === 'buyer' || f.payer === 'split'))
    .reduce((sum, f) => sum + f.amount, 0)
  return subtotal + payable
}

export function isBuyerPayable(fee: ResolvedFee): boolean {
  return fee.applies && (fee.payer === 'buyer' || fee.payer === 'split')
}

/**
 * The fee picture for a marketplace checkout.
 *
 * Only marketplace_transaction is resolved here. Logistics, warehouse and
 * financing fees are real, but they attach when the buyer actually chooses
 * transport, storage or finance — which happens after checkout. Showing them
 * now would quote for services nobody has agreed to.
 */
export async function checkoutFees(subtotal: number): Promise<FeeBreakdown> {
  const marketplace = await resolveFee('marketplace_transaction', subtotal, {
    transactionType: 'marketplace',
  })
  const fees = [marketplace].filter((f) => f.applies)
  return { subtotal, fees, total: buyerTotal(subtotal, fees) }
}
