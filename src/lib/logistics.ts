import { supabase } from '@/lib/supabase'
import { PROCUREMENT_LIST_LIMIT } from '@/lib/limits'

/**
 * Logistics: transport jobs (Loamy-brokered or external) and warehouse
 * reservations from the service directory. Live GPS tracking is Phase 2 — only
 * the milestone timeline exists here (see HANDOFF.md). No in-platform payment
 * for storage.
 */

export type TransportStatus = 'broadcast' | 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'completed' | 'cancelled'

export interface TransportJob {
  id: string
  /** Null on a job that came from a marketplace purchase. */
  award_id: string | null
  rfq_id: string | null
  company_id: string | null
  supplier_id: string | null
  /**
   * Set when this job serves a marketplace purchase rather than an RFQ
   * award. The two origins share the table, the statuses and the transition
   * rules, but NOT the authorisation branch -- a purchase job moves through
   * loamy_logistics_transition, an RFQ job through the company path.
   */
  transaction_id: string | null
  mode: 'loamy' | 'external'
  pickup_location: string | null
  dropoff_location: string | null
  pickup_state: string | null
  dropoff_state: string | null
  commodity: string | null
  quantity: number | null
  unit: string | null
  requested_date: string | null
  assigned_provider_id: string | null
  external_provider_name: string | null
  status: TransportStatus
  pickup_confirmed_at: string | null
  delivered_at: string | null
  pod_url: string | null
  provider_name?: string | null
  supplier_name?: string | null
}

export interface TransportOffer {
  id: string
  transport_job_id: string
  provider_id: string
  price: number
  available_date: string | null
  note: string | null
  status: 'offered' | 'selected' | 'declined'
  provider_name?: string | null
  provider_state?: string | null
}

export interface OpenTransportJob {
  id: string
  rfq_id: string | null
  transaction_id: string | null
  /** 'purchase' or 'contract'. Lets a board say what kind of work this is. */
  job_kind: 'purchase' | 'contract'
  commodity: string | null
  quantity: number | null
  unit: string | null
  pickup_state: string | null
  dropoff_state: string | null
  pickup_location: string | null
  dropoff_location: string | null
  requested_date: string | null
  created_at: string
  already_offered: boolean
}

export interface WarehouseReservation {
  /** Set when the request came from a marketplace purchase, not an RFQ. */
  transaction_id: string | null
  transaction_ref: string | null
  reservation_kind: 'purchase' | 'contract'
  batch_id: string | null
  facility_id: string | null
  id: string
  award_id: string
  company_id: string
  warehouse_owner_id: string
  space_quantity: number | null
  unit: string | null
  start_date: string | null
  end_date: string | null
  rate_note: string | null
  status: 'requested' | 'confirmed' | 'declined' | 'cancelled'
  warehouse_name?: string | null
  commodity?: string | null
  buyer_company?: string | null
}

export interface DirectoryWarehouse {
  owner_id: string
  business_name: string
  state: string
  lga: string | null
  capacity_note: string | null
}

export const TRANSPORT_STEPS: TransportStatus[] = ['assigned', 'picked_up', 'in_transit', 'delivered', 'completed']
export const TRANSPORT_LABEL: Record<TransportStatus, string> = {
  broadcast: 'Broadcast', assigned: 'Assigned', picked_up: 'Picked up', in_transit: 'In transit',
  delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled',
}

// ---- Buyer side -------------------------------------------------------------
export async function fetchTransportForAward(awardId: string): Promise<TransportJob | null> {
  const { data, error } = await supabase.from('loamy_transport_jobs_v').select('*').eq('award_id', awardId).maybeSingle()
  if (error) throw error
  return (data as TransportJob) ?? null
}

export async function requestTransport(awardId: string, opts: {
  mode: 'loamy' | 'external'; pickup?: string; dropoff?: string; requestedDate?: string | null; externalProvider?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('loamy_request_transport', {
    p_award_id: awardId, p_mode: opts.mode, p_pickup: opts.pickup ?? null, p_dropoff: opts.dropoff ?? null,
    p_requested_date: opts.requestedDate ?? null, p_external_provider: opts.externalProvider ?? null,
  })
  if (error) throw error
  return data as string
}

export async function fetchOffersForJob(jobId: string): Promise<TransportOffer[]> {
  const { data, error } = await supabase.from('loamy_transport_offers_v').select('*').eq('transport_job_id', jobId)
    .order('price', { ascending: true }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as TransportOffer[]
}

export async function selectOffer(offerId: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_select_transport_offer', { p_offer_id: offerId })
  if (error) throw error
}

export async function updateTransportStatus(jobId: string, status: TransportStatus, podUrl?: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_update_transport_status', { p_job_id: jobId, p_status: status, p_pod_url: podUrl ?? null })
  if (error) throw error
}

export async function fetchDirectoryWarehouses(state?: string): Promise<DirectoryWarehouse[]> {
  let q = supabase.from('service_directory').select('owner_id, business_name, state, lga, capacity_note').eq('service_type', 'warehouse')
    .order('owner_id', { ascending: true }).limit(PROCUREMENT_LIST_LIMIT)
  if (state) q = q.eq('state', state)
  const { data, error } = await q.order('business_name')
  if (error) throw error
  return (data ?? []) as DirectoryWarehouse[]
}

export async function reserveWarehouse(awardId: string, ownerId: string, opts: {
  space?: number | null; unit?: string | null; start?: string | null; end?: string | null; rateNote?: string
}): Promise<void> {
  const { error } = await supabase.rpc('loamy_reserve_warehouse', {
    p_award_id: awardId, p_warehouse_owner_id: ownerId, p_space: opts.space ?? null, p_unit: opts.unit ?? null,
    p_start: opts.start ?? null, p_end: opts.end ?? null, p_rate_note: opts.rateNote ?? null,
  })
  if (error) throw error
}

export async function fetchReservationForAward(awardId: string): Promise<WarehouseReservation | null> {
  const { data, error } = await supabase.from('loamy_warehouse_reservations_v').select('*').eq('award_id', awardId).order('created_at', { ascending: false }).limit(1)
  if (error) throw error
  return (data?.[0] as WarehouseReservation) ?? null
}

// ---- Provider side ----------------------------------------------------------
export async function fetchOpenTransportJobs(): Promise<OpenTransportJob[]> {
  const { data, error } = await supabase.from('loamy_open_transport_jobs').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as OpenTransportJob[]
}

export async function submitTransportOffer(jobId: string, price: number, availableDate?: string | null, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc('loamy_submit_transport_offer', { p_job_id: jobId, p_price: price, p_available_date: availableDate ?? null, p_note: note ?? null })
  if (error) throw error
}

export async function fetchMyAssignedTransport(): Promise<TransportJob[]> {
  const { data: u } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('loamy_transport_jobs_v').select('*').eq('assigned_provider_id', u.user?.id ?? '').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TransportJob[]
}

// ---- Warehouse owner side ---------------------------------------------------
export async function fetchMyReservations(): Promise<WarehouseReservation[]> {
  const { data: u } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('loamy_warehouse_reservations_v').select('*').eq('warehouse_owner_id', u.user?.id ?? '').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as WarehouseReservation[]
}

export async function respondReservation(reservationId: string, confirm: boolean, note?: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_respond_reservation', { p_reservation_id: reservationId, p_confirm: confirm, p_note: note ?? null })
  if (error) throw error
}
