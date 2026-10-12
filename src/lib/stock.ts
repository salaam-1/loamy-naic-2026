/**
 * Harvest → batch → listing: the spine the product was missing.
 *
 * The forensic audit's sharpest finding was that NO file under src/ touched
 * `harvests` or `commodity_batches`. Everything that makes Loamy more than a
 * classifieds board hangs off a batch:
 *
 *   - Trace (`loamy_trace_batch_for_ref`) walks `batch_events`.
 *   - A listing is only `batch_backed` if it was created by `loamy_list_batch`.
 *   - Verified supply is `commodity_batches.verification_status`.
 *   - Financing commitments attach to a batch.
 *   - Escrow and fulfilment move batch quantity through `loamy_batch_transition`.
 *
 * Without a way to create a batch, every one of those was unreachable from the
 * product no matter how complete the backend was.
 *
 * WHAT THIS LAYER WILL NOT DO
 *
 *   `commodity_batches` has a SELECT policy and NO insert/update/delete policy
 *   at all -- every write is a SECURITY DEFINER function, so quantity and
 *   status can never move without an event recorded beside them. This module
 *   therefore never writes to the table; it calls the functions. The one
 *   direct insert here is `harvests`, which does have an owner-scoped insert
 *   policy and is the farmer's own record of their own season.
 *
 *   There is also no path for a trader to create a batch from aggregated
 *   stock. `loamy_create_batch_from_harvest` is the only creation function and
 *   it requires a farm the caller owns. That is a real gap, and it is left
 *   visible rather than papered over with a client-side workaround.
 */

import { supabase } from '@/lib/supabase'

export type HarvestUnit = 'kg' | 'tonne' | 'bag' | 'crate' | 'unit'

export const HARVEST_UNITS: HarvestUnit[] = ['kg', 'tonne', 'bag', 'crate', 'unit']

export type HarvestStatus = 'recorded' | 'verified' | 'batched' | 'disputed' | 'cancelled'

export interface Harvest {
  id: string
  ref: string | null
  production_cycle_id: string
  farm_id: string
  commodity: string
  harvest_date: string
  quantity: number
  unit: HarvestUnit
  quality_grade: string | null
  condition: string | null
  location_state: string | null
  location_lga: string | null
  location_note: string | null
  status: HarvestStatus
  created_at: string
}

export type BatchStatus =
  | 'created' | 'verified' | 'listed' | 'reserved' | 'partially_sold' | 'sold'
  | 'loaded' | 'in_transit' | 'warehouse_received' | 'delivered' | 'released'
  | 'disputed' | 'cancelled'

export type BatchVerification = 'unverified' | 'pending' | 'verified' | 'rejected'

export interface CommodityBatch {
  id: string
  ref: string | null
  commodity: string
  farm_id: string | null
  harvest_id: string | null
  origin_traced: boolean
  origin_owner_id: string
  owner_id: string
  quantity: number
  available_quantity: number
  unit: HarvestUnit
  quality_grade: string | null
  packaging: string | null
  condition: string | null
  origin_state: string | null
  origin_lga: string | null
  current_location: string | null
  current_state: string | null
  status: BatchStatus
  verification_status: BatchVerification
  created_at: string
  updated_at: string
}

/**
 * Batch status in the farmer's words.
 *
 * `status` is commercial position and `verification_status` is an independent
 * axis -- a batch can be listed and unverified, or verified and unsold. The UI
 * shows both rather than collapsing them into one badge that would have to
 * lie about one of them.
 */
export const BATCH_STATUS_META: Record<BatchStatus, { label: string; chip: string }> = {
  created: { label: 'In store', chip: 'bg-emerald-950/5 text-emerald-900/60' },
  verified: { label: 'Verified', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  listed: { label: 'Listed', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  reserved: { label: 'Reserved', chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  partially_sold: { label: 'Partly sold', chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  sold: { label: 'Sold', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  loaded: { label: 'Loaded', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  in_transit: { label: 'In transit', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  warehouse_received: { label: 'At warehouse', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  delivered: { label: 'Delivered', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  released: { label: 'Released', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  disputed: { label: 'Disputed', chip: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  cancelled: { label: 'Cancelled', chip: 'bg-emerald-950/5 text-emerald-900/45' },
}

export const BATCH_VERIFICATION_META: Record<BatchVerification, { label: string; chip: string }> = {
  unverified: { label: 'Not verified', chip: 'bg-emerald-950/5 text-emerald-900/55' },
  pending: { label: 'Verification requested', chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  verified: { label: 'Loamy verified', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  rejected: { label: 'Verification declined', chip: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
}

// ---------------------------------------------------------------------------
// Pure rules. Tested without a database, because these are what the screens
// use to decide what an action WILL do before the server is asked.
// ---------------------------------------------------------------------------

/**
 * How much of a harvest has not yet been turned into a batch.
 *
 * Mirrors `loamy_create_batch_from_harvest`: cancelled batches do not count
 * against the harvest, so cancelling frees the quantity back up. The server
 * decides; this exists so the form can pre-fill and refuse early instead of
 * bouncing the farmer off a database error.
 */
export function unbatchedQuantity(harvest: Harvest, batches: CommodityBatch[]): number {
  const used = batches
    .filter((b) => b.harvest_id === harvest.id && b.status !== 'cancelled')
    .reduce((sum, b) => sum + Number(b.quantity), 0)
  return Math.max(0, Number(harvest.quantity) - used)
}

/** Whether any of this harvest is still free to batch. */
export function canBatch(harvest: Harvest, batches: CommodityBatch[]): boolean {
  if (harvest.status === 'cancelled' || harvest.status === 'disputed') return false
  return unbatchedQuantity(harvest, batches) > 0
}

/**
 * How much of a batch may still be put on the market.
 *
 * `available_quantity` is the uncommitted remainder the batch itself tracks;
 * active listings against the batch are already spoken for. Both must be
 * subtracted or a farmer can list the same tonne twice.
 */
export function listableQuantity(batch: CommodityBatch, activeListedQty: number): number {
  return Math.max(0, Number(batch.available_quantity) - activeListedQty)
}

const UNLISTABLE: BatchStatus[] = ['sold', 'cancelled', 'disputed', 'delivered', 'released']

/** Mirrors the refusal inside `loamy_list_batch`, so the button can explain. */
export function listingBlocker(batch: CommodityBatch, activeListedQty: number): string | null {
  if (UNLISTABLE.includes(batch.status)) {
    return `A batch that is ${BATCH_STATUS_META[batch.status].label.toLowerCase()} cannot be listed.`
  }
  if (listableQuantity(batch, activeListedQty) <= 0) {
    return 'Every unit of this batch is already listed or committed.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchHarvests(farmId: string): Promise<Harvest[]> {
  const { data } = await supabase
    .from('harvests')
    .select('*')
    .eq('farm_id', farmId)
    .order('harvest_date', { ascending: false })
  return (data as Harvest[]) ?? []
}

/** Every batch the signed-in member holds or originated. */
export async function fetchMyBatches(): Promise<CommodityBatch[]> {
  // RLS restricts this to owner_id / origin_owner_id / admin, so no filter is
  // needed here -- and adding one would quietly hide a batch that had been
  // sold on but still originates with this farmer.
  const { data } = await supabase
    .from('commodity_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .range(0, 499)
  return (data as CommodityBatch[]) ?? []
}

/** Active listed quantity per batch, so the UI can show what is left. */
export async function fetchListedQuantities(batchIds: string[]): Promise<Record<string, number>> {
  if (batchIds.length === 0) return {}
  const { data } = await supabase
    .from('listings')
    .select('batch_id, quantity_kg, status')
    .in('batch_id', batchIds)
    .eq('status', 'active')
  const out: Record<string, number> = {}
  for (const row of (data ?? []) as { batch_id: string; quantity_kg: number }[]) {
    out[row.batch_id] = (out[row.batch_id] ?? 0) + Number(row.quantity_kg)
  }
  return out
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RecordHarvestInput {
  farmId: string
  productionCycleId: string
  commodity: string
  harvestDate: string
  quantity: number
  unit: HarvestUnit
  qualityGrade?: string | null
  condition?: string | null
  locationState?: string | null
  locationLga?: string | null
  locationNote?: string | null
}

/**
 * Records a harvest against a production cycle.
 *
 * A direct insert, and deliberately so: the RLS policy already requires the
 * farm to be the caller's AND the cycle to belong to that same farm, which is
 * the whole of the rule. Wrapping it in a definer function would add a
 * privilege boundary without adding a check.
 */
export async function recordHarvest(input: RecordHarvestInput): Promise<{ error: string | null }> {
  const { error } = await supabase.from('harvests').insert({
    farm_id: input.farmId,
    production_cycle_id: input.productionCycleId,
    commodity: input.commodity,
    harvest_date: input.harvestDate,
    quantity: input.quantity,
    unit: input.unit,
    quality_grade: input.qualityGrade ?? null,
    condition: input.condition ?? null,
    location_state: input.locationState ?? null,
    location_lga: input.locationLga ?? null,
    location_note: input.locationNote ?? null,
  })
  return { error: error?.message ?? null }
}

/**
 * Turns part or all of a harvest into a tradeable batch.
 *
 * This is the moment a season's work becomes something with a BATCH- ref that
 * can be traced, verified, financed and sold. Passing no quantity batches
 * whatever of the harvest remains.
 */
export async function createBatchFromHarvest(
  harvestId: string,
  quantity?: number | null,
  grade?: string | null,
  packaging?: string | null,
): Promise<{ batchId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvestId,
    p_quantity: quantity ?? null,
    p_grade: grade ?? null,
    p_packaging: packaging ?? null,
  })
  return { batchId: (data as string) ?? null, error: error?.message ?? null }
}

export interface ListBatchInput {
  batchId: string
  quantity: number
  pricePerUnit: number
  state?: string | null
  lga?: string | null
  description?: string | null
  availableFrom?: string | null
}

/**
 * Puts batch stock on the marketplace.
 *
 * The ONLY way to produce a `batch_backed` listing: a trigger refuses any
 * client attempt to set `batch_id` or `claim_basis` directly, so a seller
 * cannot decorate a declared listing with someone else's provenance.
 */
export async function listBatch(input: ListBatchInput): Promise<{ listingId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('loamy_list_batch', {
    p_batch_id: input.batchId,
    p_quantity: input.quantity,
    p_price_per_unit: input.pricePerUnit,
    p_state: input.state ?? null,
    p_lga: input.lga ?? null,
    p_description: input.description ?? null,
    p_available_from: input.availableFrom ?? null,
  })
  return { listingId: (data as string) ?? null, error: error?.message ?? null }
}

export async function unlistBatch(listingId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('loamy_unlist_batch', { p_listing_id: listingId })
  return { error: error?.message ?? null }
}
