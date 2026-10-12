import { supabase } from '@/lib/supabase'
import { PROCUREMENT_LIST_LIMIT } from '@/lib/limits'
import type { InspectionMode, PaymentMode, PricingMode, Visibility } from '@/lib/rfqs'

/**
 * Supplier bids + a transparent, rule-based ranking. The ranking is computed
 * here on the client from REAL facts (price, distance, delivery date,
 * verification, completed transactions) so the buyer can see the breakdown and
 * reweight it. It is deliberately NOT called "AI" and predicts nothing.
 */

export type BidStatus = 'submitted' | 'shortlisted' | 'awarded' | 'declined' | 'withdrawn'

/** An open RFQ as seen by a qualifying supplier (no buyer contact details). */
export interface OpenRfq {
  id: string
  reference: string
  commodity: string
  variety_id: string | null
  grade: string | null
  moisture_content: number | null
  quantity: number
  unit: string
  packaging_type: string | null
  delivery_state: string | null
  delivery_address: string | null
  delivery_deadline: string | null
  delivery_schedule: string | null
  pricing_mode: PricingMode
  max_price: number | null
  visibility: Visibility
  inspection_mode: InspectionMode
  payment_mode: PaymentMode
  published_at: string | null
  closes_at: string | null
  company_name: string
  already_bid: boolean
}

/** A bid as seen by the buyer, enriched with real supplier track record. */
export interface RfqBid {
  id: string
  rfq_id: string
  supplier_id: string
  price_per_unit: number
  unit: string
  available_quantity: number
  delivery_date: string | null
  farm_origin: string | null
  photos: string[]
  documents: string[]
  note: string | null
  status: BidStatus
  submitted_at: string
  supplier_name: string | null
  supplier_state: string | null
  supplier_verified: boolean
  completed_transactions: number
  on_time_rate: number | null
}

export interface NewBid {
  rfq_id: string
  price_per_unit: number
  unit: string
  available_quantity: number
  delivery_date?: string | null
  farm_origin?: string | null
  note?: string | null
}

export async function fetchOpenRfqs(): Promise<OpenRfq[]> {
  const { data, error } = await supabase.from('loamy_open_rfqs').select('*')
    .order('published_at', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as OpenRfq[]
}

export async function submitBid(b: NewBid): Promise<void> {
  const { error } = await supabase.rpc('loamy_submit_bid', {
    p_rfq_id: b.rfq_id,
    p_price_per_unit: b.price_per_unit,
    p_unit: b.unit,
    p_available_quantity: b.available_quantity,
    p_delivery_date: b.delivery_date ?? null,
    p_farm_origin: b.farm_origin ?? null,
    p_photos: [],
    p_documents: [],
    p_note: b.note ?? null,
  })
  if (error) throw error
}

export async function withdrawBid(bidId: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_withdraw_bid', { p_bid_id: bidId })
  if (error) throw error
}

/** Bids the current supplier has placed (their own rows in the enriched view). */
export async function fetchMyBids(): Promise<RfqBid[]> {
  const { data: uid } = await supabase.auth.getUser()
  const me = uid.user?.id
  const { data, error } = await supabase.from('loamy_rfq_bids_v').select('*').eq('supplier_id', me ?? '')
    .order('submitted_at', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as RfqBid[]
}

/** All bids on one RFQ (buyer view). */
export async function fetchBidsForRfq(rfqId: string): Promise<RfqBid[]> {
  const { data, error } = await supabase.from('loamy_rfq_bids_v').select('*').eq('rfq_id', rfqId)
    .order('price_per_unit', { ascending: true }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as RfqBid[]
}

// ---- Rule-based ranking -----------------------------------------------------

export type RankFactor = 'price' | 'delivery' | 'distance' | 'verification' | 'track_record'

export const FACTOR_LABELS: Record<RankFactor, string> = {
  price: 'Price',
  delivery: 'Delivery date',
  distance: 'Distance',
  verification: 'Verification',
  track_record: 'Track record',
}

export const DEFAULT_WEIGHTS: Record<RankFactor, number> = {
  price: 0.40, delivery: 0.20, distance: 0.15, verification: 0.15, track_record: 0.10,
}

export interface RankedBid {
  bid: RfqBid
  score: number                       // 0..100
  factors: Record<RankFactor, number> // each 0..1 (higher = better)
}

/** Rank bids transparently. Each factor is normalised 0..1 across the bid set;
 *  the score is the weighted average. Purely deterministic and explainable. */
export function rankBids(
  bids: RfqBid[],
  rfq: { delivery_state: string | null; delivery_deadline: string | null },
  weights: Record<RankFactor, number> = DEFAULT_WEIGHTS,
): RankedBid[] {
  const active = bids.filter((b) => b.status !== 'withdrawn' && b.status !== 'declined')
  if (active.length === 0) return []

  const prices = active.map((b) => b.price_per_unit)
  const minP = Math.min(...prices), maxP = Math.max(...prices)
  const maxTx = Math.max(1, ...active.map((b) => b.completed_transactions))
  const deadline = rfq.delivery_deadline ? Date.parse(rfq.delivery_deadline) : null

  const wSum = (Object.values(weights).reduce((a, b) => a + b, 0)) || 1

  const scored = active.map((b) => {
    // Price: cheapest = 1, dearest = 0.
    const price = maxP === minP ? 1 : (maxP - b.price_per_unit) / (maxP - minP)
    // Delivery: meets deadline = 1; later scaled down; unknown = 0.5.
    let delivery = 1
    if (!b.delivery_date) delivery = 0.5
    else if (deadline != null) {
      const dd = Date.parse(b.delivery_date)
      delivery = dd <= deadline ? 1 : Math.max(0, 1 - (dd - deadline) / (1000 * 60 * 60 * 24 * 30))
    }
    // Distance: same state = 1, different = 0.4, unknown = 0.5 (state-level proxy).
    const distance = !rfq.delivery_state || !b.supplier_state ? 0.5 : b.supplier_state === rfq.delivery_state ? 1 : 0.4
    const verification = b.supplier_verified ? 1 : 0
    const track_record = b.completed_transactions > 0 ? b.completed_transactions / maxTx : 0
    const factors: Record<RankFactor, number> = { price, delivery, distance, verification, track_record }

    const raw = (Object.keys(factors) as RankFactor[]).reduce((acc, k) => acc + weights[k] * factors[k], 0) / wSum
    return { bid: b, score: Math.round(raw * 1000) / 10, factors }
  })

  return scored.sort((a, b) => b.score - a.score)
}
