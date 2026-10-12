import { supabase } from '@/lib/supabase'
import { PROCUREMENT_LIST_LIMIT } from '@/lib/limits'
import { codedError } from '@/lib/errors'

/**
 * Buy Request (RFQ) data access for the Processor dashboard. Drafts are written
 * with plain inserts/updates under RLS (company-scoped, procurement-gated);
 * publishing and lifecycle transitions go through SECURITY DEFINER RPCs so the
 * status machine and supplier notifications run server-side.
 */

export type PricingMode = 'fixed' | 'open_bidding'
export type Visibility = 'open' | 'invited' | 'verified_only' | 'founding_members'
export type InspectionMode = 'loamy_partner' | 'company_inspector' | 'third_party'
export type PaymentMode = 'escrow' | 'bank_transfer'
export type RfqStatus = 'draft' | 'open' | 'closed' | 'awarded' | 'completed' | 'cancelled'

export interface Rfq {
  id: string
  company_id: string
  created_by: string
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
  delivery_warehouse_id: string | null
  delivery_deadline: string | null
  delivery_schedule: string | null
  pricing_mode: PricingMode
  max_price: number | null
  visibility: Visibility
  inspection_mode: InspectionMode
  payment_mode: PaymentMode
  status: RfqStatus
  published_at: string | null
  closes_at: string | null
  created_at: string
  updated_at: string
}

/** The subset a draft is created/edited with (server fills reference, status). */
export type RfqDraft = Partial<Omit<Rfq, 'id' | 'company_id' | 'created_by' | 'reference' | 'status' | 'created_at' | 'updated_at' | 'published_at' | 'closes_at'>>

export interface RfqTemplate {
  id: string
  company_id: string
  name: string
  payload: RfqDraft
  created_at: string
}

/**
 * The choice vocabularies a buy request is built from.
 *
 * THE VALUE IS THE DATA; THE LABEL IS THE WORDS
 *   Each entry's `value` is what is written to `rfqs.unit`, `rfqs.packaging_type`
 *   and `rfqs.grade`, so it stays English in the database, in every export and
 *   in every bid a supplier reads back. `slug` keys the label a member reads.
 *   Translating the stored value instead would mean a request posted in Hausa
 *   and a bid placed in English no longer described the same goods.
 *
 *   `UNITS`, `PACKAGING_TYPES` and `GRADES` keep their original shape -- a
 *   readonly array of the stored strings -- because other modules and the
 *   wizard's validation read them that way. The slug lives beside them in
 *   `*_SLUG` rather than replacing them.
 */
export const UNITS = ['kg', 'tonne (1,000 kg)', 'bag (100 kg)', 'bag (50 kg)', 'crate', 'litre'] as const
export const PACKAGING_TYPES = ['Woven polypropylene bag', 'Jute bag', 'Bulk / loose', 'Sealed sack', 'Crate', 'Big bag (bulk bag)'] as const
export const GRADES = ['Grade A / Premium', 'Grade B / Standard', 'Grade C / Fair', 'Ungraded'] as const

export const UNIT_SLUG: Record<string, string> = {
  'kg': 'kg',
  'tonne (1,000 kg)': 'tonne',
  'bag (100 kg)': 'bag100',
  'bag (50 kg)': 'bag50',
  'crate': 'crate',
  'litre': 'litre',
}
export const PACKAGING_SLUG: Record<string, string> = {
  'Woven polypropylene bag': 'wovenPolypropylene',
  'Jute bag': 'jute',
  'Bulk / loose': 'bulk',
  'Sealed sack': 'sealedSack',
  'Crate': 'crate',
  'Big bag (bulk bag)': 'bigBag',
}
export const GRADE_SLUG: Record<string, string> = {
  'Grade A / Premium': 'a',
  'Grade B / Standard': 'b',
  'Grade C / Fair': 'c',
  'Ungraded': 'ungraded',
}

export const VISIBILITY_LABELS: Record<Visibility, { label: string; help: string }> = {
  open: { label: 'Open to all suppliers', help: 'Any verified trader, exporter, aggregator, or warehouse can see and bid.' },
  verified_only: { label: 'Verified suppliers only', help: 'Only suppliers who have completed verification can bid.' },
  founding_members: { label: 'Founding members only', help: 'Restrict to Loamy founding-member suppliers.' },
  invited: { label: 'Invited suppliers only', help: 'No broadcast - you invite specific suppliers (coming with the supplier directory).' },
}

export const INSPECTION_LABELS: Record<InspectionMode, { label: string; help: string }> = {
  loamy_partner: { label: 'Loamy Growth Partner', help: 'Recommended - an independent, GPS-verified field inspection before release.' },
  company_inspector: { label: 'Your own inspector', help: 'Your QA officer inspects and confirms quality.' },
  third_party: { label: 'Independent third party', help: 'A licensed third-party inspection agency you appoint.' },
}

export const PAYMENT_LABELS: Record<PaymentMode | 'letter_of_credit', { label: string; help: string; disabled?: boolean }> = {
  escrow: { label: 'Escrow via payment partner', help: 'Recommended - funds are held by our payment partner (Paystack) and released on confirmed delivery.' },
  bank_transfer: { label: 'Direct bank transfer', help: 'You pay the supplier directly outside Loamy. No escrow protection.' },
  letter_of_credit: { label: 'Letter of Credit', help: 'Coming soon for large export contracts.', disabled: true },
}

async function currentCompanyId(): Promise<string | null> {
  const { data, error } = await supabase.from('companies').select('id').order('created_at', { ascending: true }).limit(1)
  if (error) throw error
  return data?.[0]?.id ?? null
}

export async function fetchRfqs(): Promise<Rfq[]> {
  const { data, error } = await supabase.from('rfqs').select('*')
    .order('created_at', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as Rfq[]
}

export async function fetchRfq(id: string): Promise<Rfq | null> {
  const { data, error } = await supabase.from('rfqs').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Rfq) ?? null
}

/** Create a new draft for the caller's company; returns the row (with reference). */
export async function createRfqDraft(draft: RfqDraft): Promise<Rfq> {
  const company_id = await currentCompanyId()
  if (!company_id) throw codedError('error.registerCompanyFirst', 'Register your company before creating a buy request.')
  const { data, error } = await supabase.from('rfqs').insert({ company_id, ...draft }).select('*').single()
  if (error) throw error
  return data as Rfq
}

/** Save wizard progress. Only permitted while the RFQ is still a draft. */
export async function updateRfqDraft(id: string, patch: RfqDraft): Promise<void> {
  const { error } = await supabase.from('rfqs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function deleteRfqDraft(id: string): Promise<void> {
  const { error } = await supabase.from('rfqs').delete().eq('id', id)
  if (error) throw error
}

export async function publishRfq(id: string, closesAt?: string | null): Promise<void> {
  const { error } = await supabase.rpc('loamy_publish_rfq', { p_rfq_id: id, p_closes_at: closesAt ?? null })
  if (error) throw error
}

export async function closeRfq(id: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_close_rfq', { p_rfq_id: id })
  if (error) throw error
}

export async function cancelRfq(id: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_cancel_rfq', { p_rfq_id: id })
  if (error) throw error
}

// Templates
export async function fetchTemplates(): Promise<RfqTemplate[]> {
  const { data, error } = await supabase.from('rfq_templates').select('*')
    .order('created_at', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as RfqTemplate[]
}

export async function saveTemplate(name: string, payload: RfqDraft): Promise<void> {
  const company_id = await currentCompanyId()
  if (!company_id) throw codedError('error.noCompanyFound', 'No company found.')
  const { error } = await supabase.from('rfq_templates').insert({ company_id, name, payload })
  if (error) throw error
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('rfq_templates').delete().eq('id', id)
  if (error) throw error
}
