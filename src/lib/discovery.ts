/**
 * Marketplace discovery — the presentation contract.
 *
 * The server does the ranking and returns its evidence. This file decides what
 * may be SAID about that evidence, and the rules are deliberately restrictive:
 *
 *   · a price comparison always names its market and its date
 *   · a superlative always names its comparison population
 *   · a landed cost is only ever shown when the freight half is observed
 *   · a recommendation without a reason is not a recommendation
 *
 * Every one of these is a way a marketplace can mislead a buyer while being
 * technically truthful, so each is a function with a test rather than a
 * template someone can shortcut.
 */

export type DiscoveryView = 'buy' | 'source' | 'opportunity'

export const VIEWS: { key: DiscoveryView; label: string; question: string }[] = [
  { key: 'buy', label: 'Buy', question: 'What can I buy right now?' },
  { key: 'source', label: 'Source', question: 'Where can I source this commodity?' },
  { key: 'opportunity', label: 'Opportunity', question: 'What supply am I not looking at?' },
]

export interface PriceComparison {
  comparable: boolean
  reason?: string
  message?: string
  market?: string
  recorded_date?: string
  stale?: boolean
  difference_percent?: number
  direction?: 'below' | 'above' | 'level'
  label?: string
  price_per_kg?: number
  reference_per_kg?: number
}

export interface LogisticsEstimate {
  available: boolean
  reason?: string
  message?: string
  rate_per_kg?: number
  observations?: number
  minimum_required?: number
  estimated_total?: number
  from_state?: string
  to_state?: string
  label?: string
}

export interface Reason { code: string; label: string }

export interface DiscoveryItem {
  listing_id: string
  commodity: string
  quantity: number
  unit: string
  total_kg: number | null
  price_per_unit: number
  price_per_kg: number | null
  currency: string
  state: string
  lga: string | null
  photos: string[]
  seller: {
    display_name: string
    username: string | null
    verified: boolean
    completed_transactions: number
  }
  score: number
  score_breakdown: Record<string, number>
  price_comparison: PriceComparison
  hidden_supply: { outside_your_usual_sourcing: boolean; caveat: string | null }
  lowest_observed: { among: number; as_of: string; label: string } | null
  reasons: Reason[]
}

export interface DiscoveryResult {
  view: DiscoveryView
  weights: Record<string, number>
  reference_market: string | null
  reference_market_note: string | null
  matching_listings: number
  returned: number
  familiar_states: string[]
  generated_at: string
  items: DiscoveryItem[]
  error?: string
}

// ---------------------------------------------------------------------------
// Price comparison
// ---------------------------------------------------------------------------

/**
 * The comparison line, or null.
 *
 * The market is ALWAYS in the string. "4.9% below Kano reference" is honest;
 * "4.9% below reference" invites the reader to supply "…in Nigeria", which is
 * a claim Loamy cannot make and has no data for.
 */
export function comparisonLabel(c: PriceComparison | null | undefined): string | null {
  if (!c?.comparable) return null
  if (!c.market) return null // a comparison with no named market is not shown
  if (c.label) return c.label

  const pct = Math.abs(c.difference_percent ?? 0).toFixed(1)
  if (c.direction === 'level') return `level with ${c.market} reference`
  return `${pct}% ${c.direction} ${c.market} reference`
}

/** The date qualifier that must accompany the label. */
export function comparisonQualifier(c: PriceComparison | null | undefined): string | null {
  if (!c?.comparable || !c.recorded_date) return null
  const d = new Date(c.recorded_date)
  const when = Number.isNaN(d.getTime())
    ? c.recorded_date
    : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
  return c.stale ? `recorded ${when} - may be out of date` : `recorded ${when}`
}

/** Why no comparison is shown, said plainly rather than left blank. */
export function comparisonRefusal(c: PriceComparison | null | undefined): string | null {
  if (c?.comparable) return null
  switch (c?.reason) {
    case 'no_market_specified':
      return 'Choose a reference market to compare prices.'
    case 'no_reference_data':
      return c.message ?? 'No recent price has been recorded for that market.'
    case 'unit_not_convertible':
      return c.message ?? 'This listing’s unit cannot be compared with the reference.'
    case 'no_price':
      return null
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Superlatives
// ---------------------------------------------------------------------------

/**
 * "Lowest observed price among 23 matching listings" — or nothing.
 *
 * There is deliberately no path to a bare "BEST PRICE" badge. A superlative
 * without a population and a moment is a marketing claim, not a fact, and a
 * buyer cannot check it.
 */
export function superlativeLabel(
  item: Pick<DiscoveryItem, 'lowest_observed'>,
): string | null {
  const lo = item.lowest_observed
  if (!lo) return null
  if (!lo.among || lo.among < 2) return null // "lowest of 1" is not information
  return lo.label ?? `Lowest observed price among ${lo.among} matching listings`
}

// ---------------------------------------------------------------------------
// Landed cost
// ---------------------------------------------------------------------------

export interface LandedCost {
  shown: boolean
  reason?: string
  commodity_per_kg?: number
  freight_per_kg?: number
  landed_per_kg?: number
  observations?: number
  note?: string
}

/**
 * Commodity price + observed freight.
 *
 * Returns shown:false whenever the freight half is not observed. The whole
 * point of a landed cost is that a buyer plans around it; a landed cost built
 * on an invented freight rate is worse than none, because it looks like
 * diligence.
 */
export function landedCost(
  item: Pick<DiscoveryItem, 'price_per_kg'>,
  logistics: LogisticsEstimate | null | undefined,
): LandedCost {
  const commodity = item.price_per_kg
  if (commodity == null) {
    return { shown: false, reason: 'unit_not_convertible' }
  }
  if (!logistics?.available || logistics.rate_per_kg == null) {
    return {
      shown: false,
      reason: logistics?.reason ?? 'no_logistics_data',
      commodity_per_kg: commodity,
      note: logistics?.message
        ?? 'Freight for this route has not been observed on Loamy yet, so no landed cost is shown.',
    }
  }
  return {
    shown: true,
    commodity_per_kg: commodity,
    freight_per_kg: logistics.rate_per_kg,
    landed_per_kg: Math.round((commodity + logistics.rate_per_kg) * 100) / 100,
    observations: logistics.observations,
    note: logistics.label,
  }
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

/**
 * A card may only present a listing as recommended when it can say why.
 * Otherwise it is a search result, which is an honest thing to be.
 */
export function isRecommended(item: Pick<DiscoveryItem, 'reasons'>): boolean {
  return (item.reasons?.length ?? 0) > 0
}

/** Reasons worth the limited room on a card, in the order they help a buyer. */
const REASON_PRIORITY = [
  'quantity_covers_request',
  'below_reference',
  'you_buy_this',
  'seller_verified',
  'in_delivery_state',
  'hidden_supply',
  'established_seller',
  'commodity_match',
]

export function topReasons(item: Pick<DiscoveryItem, 'reasons'>, max = 3): Reason[] {
  const seen = new Set<string>()
  return [...(item.reasons ?? [])]
    .filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)))
    .sort((a, b) => {
      const ia = REASON_PRIORITY.indexOf(a.code)
      const ib = REASON_PRIORITY.indexOf(b.code)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    .slice(0, max)
}

// ---------------------------------------------------------------------------
// Seller signals
// ---------------------------------------------------------------------------

export interface SellerSignals {
  verified: boolean
  member_since: string
  completed_transactions: number
  active_listings: number
  rating: { count: number; has_enough: boolean; average: number | null; minimum_for_average: number }
  fulfilment:
    | { available: true; rate_percent: number; sample: number }
    | { available: false; reason: string; sample: number; minimum: number }
}

/**
 * The signals a card may show, as individual facts.
 *
 * Never combined into one number. An opaque seller score is unappealable: a
 * seller cannot tell what to fix, and a buyer cannot tell what it weighed.
 */
export function sellerFacts(s: SellerSignals | null | undefined): string[] {
  if (!s) return []
  const out: string[] = []
  if (s.verified) out.push('Verified')
  if (s.completed_transactions > 0) {
    out.push(`${s.completed_transactions} completed transaction${s.completed_transactions === 1 ? '' : 's'}`)
  }
  if (s.fulfilment?.available) {
    out.push(`${s.fulfilment.rate_percent}% fulfilment over ${s.fulfilment.sample} deliveries`)
  }
  // The 3-review rule from Block 1 holds here too: no average below it.
  if (s.rating?.has_enough && s.rating.average != null) {
    out.push(`${s.rating.average.toFixed(1)} from ${s.rating.count} reviews`)
  } else if ((s.rating?.count ?? 0) > 0) {
    out.push(`${s.rating.count} review${s.rating.count === 1 ? '' : 's'}`)
  }
  if (s.active_listings > 0) out.push(`${s.active_listings} active listing${s.active_listings === 1 ? '' : 's'}`)
  return out
}

// ---------------------------------------------------------------------------
// Event names, shared with the server's CHECK constraint
// ---------------------------------------------------------------------------

export const DISCOVERY_EVENTS = [
  'search', 'view_listing', 'view_seller', 'save_listing', 'unsave_listing',
  'add_to_cart', 'remove_from_cart', 'start_checkout', 'abandon_checkout',
  'enquire', 'contact_seller', 'request_verification', 'request_financing',
  'complete_transaction', 'reject_listing', 'report_listing',
] as const

export type DiscoveryEventType = (typeof DISCOVERY_EVENTS)[number]

/** Keys that must never reach the event metadata blob. */
export const FORBIDDEN_METADATA_KEYS = [
  'email', 'phone', 'bvn', 'nin', 'password', 'token', 'ip', 'address',
]

/**
 * Strip anything that should not be logged, before it leaves the browser.
 * The database refuses these too; this is the first of the two gates, so a
 * mistake never becomes a rejected request the user sees.
 */
export function safeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (FORBIDDEN_METADATA_KEYS.includes(k.toLowerCase())) continue
    if (v === null || v === undefined) continue
    out[k] = v
  }
  return out
}
