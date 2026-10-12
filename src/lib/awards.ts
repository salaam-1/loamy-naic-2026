import { supabase } from '@/lib/supabase'
import { PROCUREMENT_LIST_LIMIT } from '@/lib/limits'

/**
 * RFQ awards — multi-supplier split fulfilment — and the contact-disclosure
 * gate. A supplier's phone is only ever fetched through loamy_supplier_contact,
 * which requires an award or an explicit "proceed" first.
 */

export type AwardStatus = 'awarded' | 'in_progress' | 'inspected' | 'delivered' | 'completed' | 'cancelled'

export interface RfqAward {
  id: string
  rfq_id: string
  bid_id: string
  supplier_id: string
  awarded_quantity: number
  awarded_price: number
  status: AwardStatus
  created_at: string
  supplier_name: string | null
  supplier_state: string | null
  delivery_date: string | null
  commodity: string | null
  unit: string | null
  rfq_reference: string | null
  contact_disclosed: boolean
}

export interface AwardInput {
  bid_id: string
  quantity: number
  price: number
}

export interface SupplierContact {
  full_name: string | null
  phone: string | null
}

export async function fetchAwards(rfqId: string): Promise<RfqAward[]> {
  const { data, error } = await supabase.from('loamy_rfq_awards_v').select('*').eq('rfq_id', rfqId)
    .order('created_at', { ascending: true }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as RfqAward[]
}

/** All awards visible to the caller's company (buyer logistics/overview). */
export async function fetchAllAwards(): Promise<RfqAward[]> {
  const { data, error } = await supabase.from('loamy_rfq_awards_v').select('*')
    .order('created_at', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as RfqAward[]
}

export async function awardBids(rfqId: string, awards: AwardInput[]): Promise<void> {
  const { error } = await supabase.rpc('loamy_award_bids', {
    p_rfq_id: rfqId,
    p_awards: awards.map((a) => ({ bid_id: a.bid_id, quantity: a.quantity, price: a.price })),
  })
  if (error) throw error
}

/** "Proceed with supplier": disclose contact without (yet) awarding. */
export async function discloseSupplierContact(rfqId: string, supplierId: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_disclose_supplier_contact', { p_rfq_id: rfqId, p_supplier_id: supplierId })
  if (error) throw error
}

/** Fetch a supplier's contact (only works after award/proceed). */
export async function getSupplierContact(rfqId: string, supplierId: string): Promise<SupplierContact> {
  const { data, error } = await supabase.rpc('loamy_supplier_contact', { p_rfq_id: rfqId, p_supplier_id: supplierId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { full_name: row?.full_name ?? null, phone: row?.phone ?? null }
}

/** Per-award fulfilment tracker (Parts 5–9 advance the later stages). */
/**
 * The award tracker, in order. `awardStageIndex` returns a position into this
 * array, so the ORDER is the state machine and nothing may reorder it. `slug`
 * keys the word a member reads; `en` is the fallback when a pack has not
 * reached that stage yet.
 */
export const AWARD_STAGES = [
  { slug: 'awarded', en: 'Awarded' },
  { slug: 'inspectionScheduled', en: 'Inspection scheduled' },
  { slug: 'inspectionPassed', en: 'Inspection passed' },
  { slug: 'escrowFunded', en: 'Escrow funded' },
  { slug: 'pickedUp', en: 'Picked up' },
  { slug: 'delivered', en: 'Delivered' },
  { slug: 'paymentReleased', en: 'Payment released' },
  { slug: 'completed', en: 'Completed' },
] as const

/** How far a given award status has progressed through AWARD_STAGES. */
export function awardStageIndex(status: AwardStatus): number {
  switch (status) {
    case 'awarded': return 0
    case 'in_progress': return 1
    case 'inspected': return 2
    case 'delivered': return 5
    case 'completed': return AWARD_STAGES.length - 1
    default: return 0
  }
}
