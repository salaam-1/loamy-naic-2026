/**
 * The fulfilment spine, client side.
 *
 * WHAT THIS CONNECTS
 *   Everything after checkout already existed in the database and none of it
 *   was reachable: loading, transport offers, exclusive award, logistics
 *   transitions, storage requests, warehouse receipts. Three of those had
 *   zero callers; `loamy_suggest_warehouses` had one caller and had never
 *   once executed successfully.
 *
 * WHAT IT DOES NOT DO
 *   It asserts nothing and it computes no state. Every stage below is read
 *   back from `loamy_transaction_fulfilment`, which reads authoritative
 *   tables. A stage that has not happened is absent, never rendered as
 *   "pending" on a guess. The server owns every transition; this module
 *   carries the request and reports the refusal.
 *
 * ERRORS
 *   Every call returns a result rather than throwing, and every failure goes
 *   through `errorMessage` so a PostgrestError's real wording survives.
 *   Phase 4 slice 2 established what a swallowed write costs; a fulfilment
 *   step that silently fails is worse, because the next actor waits forever
 *   for something that never happened.
 */
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'

// ---------------------------------------------------------------------------
// Shapes returned by loamy_transaction_fulfilment
// ---------------------------------------------------------------------------

/** Stages `loamy_record_loading` accepts. Nothing else is valid. */
export type LoadingStage =
  | 'requested' | 'scheduled' | 'started' | 'completed' | 'failed' | 'cancelled'

export interface LoadingConfirmation {
  id: string
  stage: LoadingStage
  quantity_confirmed: number | null
  unit: string | null
  waybill_ref: string | null
  vehicle_registration: string | null
  photo_count: number
  /** Evidence gaps the server noticed. Shown, never hidden. */
  flags: string[]
  note: string | null
  recorded_at: string
}

export interface TransportOffer {
  offer_id: string
  price: number
  status: string
  available_date: string | null
  note: string | null
  provider_name: string | null
  provider_state: string | null
}

export interface ShipmentEvent {
  event_type: string
  new_status: string | null
  note: string | null
  occurred_at: string
}

export interface TransportState {
  job_id: string
  status: string
  mode: 'loamy' | 'external' | string
  pickup_location: string | null
  dropoff_location: string | null
  agreed_price: number | null
  external_provider_name: string | null
  assigned_provider: string | null
  offers: TransportOffer[]
  events: ShipmentEvent[]
}

export interface StorageReservation {
  reservation_id: string
  status: string
  space_quantity: number
  unit: string | null
  start_date: string | null
  end_date: string | null
  facility: string | null
  facility_state: string | null
  facility_lga: string | null
  requested_at: string
}

/** The movements `loamy_record_warehouse_receipt` accepts. */
export type WarehouseMovement = 'arrival' | 'release' | 'adjustment'

export const MOVEMENT_LABEL: Record<WarehouseMovement, string> = {
  arrival: 'Goods in',
  release: 'Goods out',
  adjustment: 'Adjustment',
}

export interface WarehouseReceipt {
  ref: string | null
  movement: WarehouseMovement | string
  quantity: number
  condition: string | null
  recorded_at: string
}

export interface Fulfilment {
  available: boolean
  reason?: string
  transaction: {
    ref: string
    commodity: string
    quantity: number
    unit: string
    status: string
    payment_state: string
    fulfilment_state: string
    delivery_state: string | null
    delivery_lga: string | null
    /** Server-derived. The UI never decides which side the viewer is on. */
    viewer_role: 'buyer' | 'seller' | 'admin'
  }
  loading: LoadingConfirmation[]
  transport: TransportState | null
  storage: StorageReservation[]
  receipts: WarehouseReceipt[]
  financing: {
    application_id: string
    ref: string | null
    status: string
    approved_amount: number | null
    disbursed_amount: number
    is_sandbox: boolean
  } | null
}

export interface WarehouseSuggestion {
  facility_id: string
  ref: string | null
  business_name: string
  state: string | null
  lga: string | null
  verification_status: string
  verified: boolean
  capacity_tonnes: number | null
  capacity_note: string | null
  storage_types: string[] | null
  same_state: boolean
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function call<T>(fn: string, args: Record<string, unknown>, fallback: string): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { ok: false, error: errorMessage(error, fallback) }
  return { ok: true, value: data as T }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function fetchFulfilment(transactionId: string): Promise<Result<Fulfilment>> {
  return call<Fulfilment>('loamy_transaction_fulfilment',
    { p_transaction_id: transactionId },
    'The fulfilment status could not be loaded.')
}

export async function suggestWarehouses(transactionId: string): Promise<Result<{
  available: boolean
  reason?: string
  message?: string
  searched_state?: string
  origin_state?: string | null
  delivery_state?: string | null
  items?: WarehouseSuggestion[]
  note?: string
}>> {
  return call('loamy_suggest_warehouses',
    { p_transaction_id: transactionId },
    'Storage options could not be loaded.')
}

// ---------------------------------------------------------------------------
// Loading — the seller's move
// ---------------------------------------------------------------------------

export interface LoadingInput {
  transactionId: string
  stage: LoadingStage
  quantity?: number | null
  unit?: string | null
  waybill?: string | null
  vehicle?: string | null
  photos?: string[]
  lat?: number | null
  lng?: number | null
  note?: string | null
}

/**
 * Record a loading stage.
 *
 * The server raises evidence FLAGS rather than refusing: a completed loading
 * with no photo, no waybill, no GPS or a quantity that does not match the
 * purchase is recorded and marked. That is deliberate — refusing would push
 * people to record nothing at all, and a flagged record is far more useful
 * than an absent one. The flags come back and must be shown.
 *
 * `state_moved: false` means the confirmation was stored but the fulfilment
 * state machine refused the transition. That is NOT a success, and the caller
 * must surface `state_error`.
 */
export async function recordLoading(input: LoadingInput): Promise<Result<{
  recorded: boolean
  confirmation_id: string
  flags: string[]
  state_moved: boolean
  state_error?: string
}>> {
  return call('loamy_record_loading', {
    p_transaction_id: input.transactionId,
    p_stage: input.stage,
    p_quantity: input.quantity ?? null,
    p_unit: input.unit ?? null,
    p_waybill: input.waybill?.trim() || null,
    p_vehicle: input.vehicle?.trim() || null,
    p_photos: input.photos ?? [],
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
    p_note: input.note?.trim() || null,
  }, 'The loading record could not be saved.')
}

/** Plain-language reading of an evidence flag. Never softened. */
export const LOADING_FLAG_LABEL: Record<string, string> = {
  no_quantity_confirmed: 'No quantity was confirmed at loading.',
  quantity_mismatch: 'The quantity loaded does not match the purchase.',
  no_loading_photo: 'No photograph was taken at loading.',
  no_waybill: 'No waybill reference was recorded.',
  no_gps: 'No location was captured at loading.',
}

export function loadingFlagLabel(flag: string): string {
  return LOADING_FLAG_LABEL[flag] ?? flag.replace(/_/g, ' ')
}

// ---------------------------------------------------------------------------
// Transport — the buyer arranges, a carrier quotes, the buyer selects
// ---------------------------------------------------------------------------

export async function requestTransportForTransaction(
  transactionId: string,
  opts: {
    mode: 'loamy' | 'external'
    pickup?: string | null
    dropoff?: string | null
    requestedDate?: string | null
    externalProvider?: string | null
  },
): Promise<Result<{ created: boolean; job_id?: string; reason?: string; message?: string; mode?: string }>> {
  return call('loamy_request_transport_for_transaction', {
    p_transaction_id: transactionId,
    p_mode: opts.mode,
    p_pickup: opts.pickup?.trim() || null,
    p_dropoff: opts.dropoff?.trim() || null,
    p_requested_date: opts.requestedDate || null,
    p_external_provider: opts.externalProvider?.trim() || null,
  }, 'Transport could not be requested.')
}

/**
 * Award the job to one carrier.
 *
 * The server does this exclusively: it assigns the winner and declines every
 * other offer in the same call, so there is no window in which two carriers
 * both believe they have the work.
 */
export async function selectTransportOffer(offerId: string): Promise<Result<void>> {
  return call<void>('loamy_select_transport_offer', { p_offer_id: offerId },
    'That offer could not be accepted.')
}

export async function submitTransportOffer(
  jobId: string,
  price: number,
  availableDate?: string | null,
  note?: string | null,
): Promise<Result<string>> {
  return call<string>('loamy_submit_transport_offer', {
    p_job_id: jobId, p_price: price,
    p_available_date: availableDate || null,
    p_note: note?.trim() || null,
  }, 'Your offer could not be submitted.')
}

/** Events a carrier drives, in the order the transition rules allow. */
export type LogisticsEvent =
  | 'loading' | 'loaded' | 'departed' | 'position' | 'arrived' | 'delivered'
  | 'failed' | 'cancelled' | 'disputed' | 'note'

export const LOGISTICS_EVENT_LABEL: Record<string, string> = {
  loading: 'Loading', loaded: 'Loaded', departed: 'Departed',
  position: 'Position update', arrived: 'Arrived', delivered: 'Delivered',
  failed: 'Failed', cancelled: 'Cancelled', disputed: 'Disputed', note: 'Note',
}

/**
 * The carrier's next step, from the job's CURRENT status.
 *
 * Mirrors `logistics_transition_rules.allowed_from`. Narrower than the server
 * is, never wider — the server stays authoritative and its refusals are
 * shown. Offering a step the rules forbid would be telling the carrier
 * something false.
 */
export function nextLogisticsEvents(status: string): LogisticsEvent[] {
  switch (status) {
    case 'booked':
    case 'assigned': return ['loading', 'loaded', 'failed']
    case 'loading': return ['loaded', 'failed']
    case 'loaded':
    case 'picked_up': return ['departed', 'failed']
    case 'in_transit': return ['position', 'arrived', 'delivered', 'failed']
    case 'arrived': return ['delivered', 'failed']
    default: return []
  }
}

export async function logisticsTransition(
  jobId: string,
  event: LogisticsEvent,
  opts: { lat?: number | null; lng?: number | null; locationNote?: string | null; note?: string | null } = {},
): Promise<Result<string>> {
  return call<string>('loamy_logistics_transition', {
    p_job_id: jobId,
    p_event_type: event,
    p_latitude: opts.lat ?? null,
    p_longitude: opts.lng ?? null,
    p_location_note: opts.locationNote?.trim() || null,
    p_note: opts.note?.trim() || null,
  }, 'That update could not be recorded.')
}

// ---------------------------------------------------------------------------
// Warehouse — requested explicitly, accepted explicitly
// ---------------------------------------------------------------------------

/**
 * Ask a facility for space.
 *
 * Storage is never booked as a side effect of anything. This creates a
 * REQUEST; the facility owner accepts or declines it through
 * `loamy_respond_storage`, and only an accepted reservation is a booking.
 */
export async function requestStorage(input: {
  transactionId: string
  facilityId: string
  quantity: number
  startDate?: string | null
  endDate?: string | null
  note?: string | null
}): Promise<Result<string>> {
  return call<string>('loamy_request_storage', {
    p_transaction_id: input.transactionId,
    p_facility_id: input.facilityId,
    p_quantity: input.quantity,
    p_start_date: input.startDate || null,
    p_end_date: input.endDate || null,
    p_note: input.note?.trim() || null,
  }, 'The storage request could not be sent.')
}

/** The facility owner's answer. Only they may give it. */
export async function respondStorage(
  reservationId: string,
  accept: boolean,
  note?: string | null,
): Promise<Result<void>> {
  return call<void>('loamy_respond_storage', {
    p_reservation_id: reservationId,
    p_accept: accept,
    p_note: note?.trim() || null,
  }, 'That response could not be saved.')
}

/**
 * Record goods physically in or out of a facility.
 *
 * A receipt is a warehouse's own statement about stock it is holding, and it
 * writes a batch event, so it belongs in the trace. A facility cannot
 * self-verify: the receipt records custody, not quality or authenticity.
 */
export async function recordWarehouseReceipt(input: {
  facilityId: string
  batchId: string
  movement: WarehouseMovement
  quantity: number
  condition?: string | null
  reservationId?: string | null
  transactionId?: string | null
  note?: string | null
}): Promise<Result<string>> {
  return call<string>('loamy_record_warehouse_receipt', {
    p_facility_id: input.facilityId,
    p_batch_id: input.batchId,
    p_movement: input.movement,
    p_quantity: input.quantity,
    p_condition: input.condition?.trim() || null,
    p_reservation_id: input.reservationId || null,
    p_transaction_id: input.transactionId || null,
    p_note: input.note?.trim() || null,
  }, 'The receipt could not be recorded.')
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** Fulfilment state in words a member reads, never a raw enum. */
export const FULFILMENT_LABEL: Record<string, string> = {
  not_started: 'Not started',
  loading_requested: 'Loading requested',
  loading_scheduled: 'Loading scheduled',
  loading: 'Loading',
  loaded: 'Loaded',
  in_transit: 'In transit',
  at_warehouse: 'At warehouse',
  arrived: 'Arrived',
  delivered: 'Delivered',
  received: 'Received',
  failed: 'Stopped',
  cancelled: 'Cancelled',
}

export function fulfilmentLabel(state: string | null | undefined): string {
  if (!state) return 'Not started'
  return FULFILMENT_LABEL[state] ?? state.replace(/_/g, ' ')
}

/**
 * Whose move it is.
 *
 * The single most useful thing a fulfilment page can say, and the one most
 * often missing: a member staring at "in transit" wants to know whether they
 * are waiting or being waited on.
 */
export interface WhoseMove {
  actor: string
  action: string
  /**
   * The same two sentences as translation keys, plus whatever they
   * interpolate.
   *
   * WHY BOTH
   *   This function decides WHOSE MOVE IT IS -- a rule about the state
   *   machine, which belongs here and is unit-tested here. It also happened
   *   to be the only place that sentence existed in English, which made it
   *   untranslatable without moving the rule into a component.
   *
   *   So the rule stays and the words become addressable. `actor`/`action`
   *   remain the English, unchanged, so nothing that reads them breaks; a
   *   localised surface renders `actorKey`/`actionKey` instead and falls
   *   back to the English when a pack has not reached them.
   */
  actorKey: string
  actionKey: string
  vars?: Record<string, string | number>
}

export function whoseMove(f: Fulfilment): WhoseMove | null {
  const state = f.transaction.fulfilment_state
  const role = f.transaction.viewer_role
  const t = f.transport

  if (state === 'not_started') {
    return role === 'seller'
      ? { actor: 'You', action: 'Schedule loading when the goods are ready.',
          actorKey: 'logistics.move.you', actionKey: 'logistics.move.scheduleLoading' }
      : { actor: 'The seller', action: 'is yet to schedule loading.',
          actorKey: 'logistics.move.theSeller', actionKey: 'logistics.move.sellerYetToSchedule' }
  }
  if (!t) {
    return role === 'buyer'
      ? { actor: 'You', action: 'Arrange transport for this purchase.',
          actorKey: 'logistics.move.you', actionKey: 'logistics.move.arrangeTransport' }
      : { actor: 'The buyer', action: 'is yet to arrange transport.',
          actorKey: 'logistics.move.theBuyer', actionKey: 'logistics.move.buyerYetToArrange' }
  }
  if (t.status === 'broadcast') {
    return t.offers.length > 0
      ? (role === 'buyer'
          ? { actor: 'You', action: `Choose one of ${t.offers.length} carrier offers.`,
              actorKey: 'logistics.move.you', actionKey: 'logistics.move.chooseOffers',
              vars: { count: t.offers.length } }
          : { actor: 'The buyer', action: 'is choosing a carrier.',
              actorKey: 'logistics.move.theBuyer', actionKey: 'logistics.move.buyerChoosing' })
      : { actor: 'Carriers', action: 'are being invited to quote.',
          actorKey: 'logistics.move.carriers', actionKey: 'logistics.move.carriersInvited' }
  }
  if (['assigned', 'booked'].includes(t.status)) {
    return { actor: 'The carrier', action: 'is due to collect the goods.',
      actorKey: 'logistics.move.theCarrier', actionKey: 'logistics.move.dueToCollect' }
  }
  if (['loading', 'loaded', 'in_transit', 'arrived'].includes(t.status)) {
    return { actor: 'The carrier', action: 'is moving the goods.',
      actorKey: 'logistics.move.theCarrier', actionKey: 'logistics.move.movingGoods' }
  }
  if (t.status === 'delivered') {
    return { actor: 'Delivered', action: 'This purchase has been delivered.',
      actorKey: 'logistics.move.delivered', actionKey: 'logistics.move.hasBeenDelivered' }
  }
  return null
}
