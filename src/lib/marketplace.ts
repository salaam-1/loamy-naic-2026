import { supabase } from '@/lib/supabase'
import type { PlatformRole } from '@/lib/types'

/** Stage 3 domain types + metadata. NO payments/checkout/cart exists anywhere:
 * buyers express interest, sellers accept, contact is exchanged, and the deal
 * concludes off-platform on bank rails. */

// Verbatim copy required on acceptance surfaces (per brief).
export const BANK_RAILS_COPY =
  'Payment and delivery are arranged directly between you and the other party through your bank. Loamy does not process payments.'

export const MARKETPLACE_ROLES: PlatformRole[] = ['farmer', 'trader', 'exporter', 'buyer', 'input_supplier']
/** Sellers. `buyer` is the legacy half of the merged Trader & Buyer desk, so it
 *  sells on exactly the same terms as `trader`. */
export const SELLER_ROLES: PlatformRole[] = ['farmer', 'trader', 'buyer', 'input_supplier']
/** Roles that express interest. Farmers buy INPUTS only (from suppliers). */
export const INTEREST_ROLES: PlatformRole[] = ['buyer', 'trader', 'exporter', 'farmer']
export const DIRECTORY_OWNER_ROLES: PlatformRole[] = ['warehouse_owner', 'logistics_provider']

export const LISTING_UNITS = ['kg', 'bags', 'litres', 'units'] as const
export type ListingUnit = (typeof LISTING_UNITS)[number]

export type ListingStatus = 'active' | 'paused' | 'sold' | 'expired'

export const LISTING_STATUS_META: Record<ListingStatus, { label: string; chip: string }> = {
  active: { label: 'Active', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  paused: { label: 'Paused', chip: 'bg-emerald-950/5 text-emerald-900/60' },
  sold: { label: 'Sold', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  expired: { label: 'Expired', chip: 'bg-emerald-950/5 text-emerald-900/50' },
}

export interface Listing {
  id: string
  seller_id: string
  listing_type: 'commodity' | 'input'
  commodity: string
  quantity_kg: number
  unit: ListingUnit
  price_per_unit: number
  currency: string
  state: string
  lga: string | null
  description: string | null
  photos: string[]
  status: ListingStatus
  available_from: string | null
  created_at: string
  updated_at: string
}

export type InterestStatus = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'concluded_externally'

export const INTEREST_STATUS_META: Record<InterestStatus, { label: string; chip: string }> = {
  open: { label: 'Awaiting seller', chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  accepted: { label: 'Accepted - contact available', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  declined: { label: 'Declined', chip: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  withdrawn: { label: 'Withdrawn', chip: 'bg-emerald-950/5 text-emerald-900/50' },
  concluded_externally: { label: 'Concluded (off-platform)', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
}

export interface ListingInterest {
  id: string
  listing_id: string | null
  directory_id: string | null
  buyer_id: string
  quantity_wanted: number | null
  message: string | null
  status: InterestStatus
  seller_response: string | null
  created_at: string
  updated_at: string
  /** PostgREST embeds (nullable when the target is hidden or removed). */
  listing?: Listing | null
  directory?: DirectoryEntry | null
}

export interface DirectoryEntry {
  id: string
  owner_id: string
  service_type: 'warehouse' | 'logistics'
  business_name: string
  state: string
  lga: string | null
  /** Free-text street address of the facility (signed-in members only). */
  address: string | null
  capacity_note: string | null
  routes_note: string | null
  created_at: string
}

export interface MarketPrice {
  id: string
  commodity: string
  state: string | null
  price_per_kg: number
  recorded_date: string
  source_note: string | null
}

/** Limited public profile surface (loamy_public_profiles view) — the ONLY
 * seller identity shown on marketplace cards: name, category, state, badge. */
export interface PublicProfile {
  id: string
  full_name: string | null
  category: string | null
  state: string | null
  avatar_url: string | null
  verified_badge: boolean
}

/** Public suppliers directory row (loamy_public_suppliers view). */
export interface PublicSupplier {
  seller_id: string
  seller_display_name: string | null
  seller_category: string | null
  seller_state: string | null
  seller_verified: boolean
  listing_count: number
}

export interface InterestContact {
  party: 'buyer' | 'seller'
  full_name: string | null
  phone: string | null
}

export function listingPhotoUrl(path: string): string {
  return supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl
}

/**
 * How much a listing's claim is actually backed by (directive Part 15).
 *
 *   batch_backed    — a real, traceable CommodityBatch stands behind it
 *   seller_declared — the seller typed it; nothing verifies the stock exists
 *
 * This is data, not copy: it comes from the database and a seller cannot set it.
 */
export type ClaimBasis = 'batch_backed' | 'seller_declared'

export const CLAIM_BASIS_META: Record<ClaimBasis, { label: string; hint: string }> = {
  batch_backed: {
    label: 'Traceable stock',
    hint: 'A recorded batch stands behind this listing, with an origin you can trace.',
  },
  seller_declared: {
    label: 'Seller declared',
    hint: 'The seller stated these details. Loamy has not inspected this stock.',
  },
}

/** Public marketplace listing (from loamy_public_listings — safe columns only,
 * readable by the anon role). No seller_id / phone / email / coordinates. */
export interface PublicListing {
  id: string
  listing_ref: string | null
  commodity: string
  listing_type: 'commodity' | 'input'
  quantity: number
  unit: ListingUnit
  price_per_unit: number
  currency: string
  state: string
  lga: string | null
  photos: string[]
  created_at: string
  seller_display_name: string | null
  seller_category: string | null
  seller_verified: boolean
  /**
   * The seller's public handle, for /u/:username. NULL when their profile is
   * private — the view withholds it so the UI renders no link rather than one
   * that leads to a page which will correctly refuse to load. Never a user id.
   */
  seller_username: string | null
  quality_grade: string | null
  /** Backed by a real batch, or just declared. Never seller-editable. */
  claim_basis: ClaimBasis
  batch_ref: string | null
  /** The BATCH's verification status — distinct from the seller's badge. */
  verification_status: 'unverified' | 'pending' | 'verified' | 'rejected'
  origin_traced: boolean
  /** Origin at STATE granularity only. The farm is never exposed. */
  origin_state: string | null
}

// ---------------------------------------------------------------------------
// Reading the public storefront
// ---------------------------------------------------------------------------

/**
 * The columns `PublicProductCard` actually renders.
 *
 * `loamy_public_listings` is a wide view, and `select('*')` shipped every
 * column of it to an anonymous browser so that a card could use fifteen of
 * them. Nothing in the extra columns is private -- the view exists precisely
 * to withhold `seller_id`, phone, email and coordinates -- but there is no
 * reason to put a seller's category and handle on the wire for a card that
 * never shows them.
 */
export const PUBLIC_CARD_COLUMNS = [
  'id', 'commodity', 'listing_type', 'quantity', 'unit', 'price_per_unit',
  'state', 'photos', 'created_at', 'seller_display_name', 'seller_verified',
  'claim_basis', 'verification_status', 'origin_traced', 'origin_state',
].join(', ')

/**
 * The homepage preview: a shop window, not the shop.
 *
 * A visitor must reach the footer without scrolling past the catalogue, and
 * that has to hold whether the marketplace has fifty listings or fifty
 * thousand. Twelve fills the grid exactly -- four rows of three at `xl`, six of
 * two at `sm` -- and then the page moves on.
 */
export const HOMEPAGE_MARKETPLACE_LIMIT = 12

/** The full marketplace at /marketplace. Unchanged; this is where browsing happens. */
export const MARKETPLACE_BROWSE_LIMIT = 60

export type MarketplaceSort = 'newest' | 'price_asc' | 'price_desc'

export interface MarketplaceFilters {
  /** A commodity group key from COMMODITY_GROUPS. */
  commodities?: string[] | null
  state?: string
  query?: string
  sort?: MarketplaceSort
}

/**
 * One reader for both storefront surfaces, differing only in how many rows it
 * is allowed to return.
 *
 * ELIGIBILITY IS THE VIEW'S JOB, NOT THIS FUNCTION'S
 *   `loamy_public_listings` is defined `where l.status = 'active'` and selects
 *   only anon-safe columns. So "active and public only" is enforced in the
 *   database for every caller, including a future one that forgets. This
 *   function adds no eligibility rule of its own and must not: duplicating the
 *   rule here is how the two definitions drift apart.
 *
 * ORDERING IS A TOTAL ORDER, DELIBERATELY
 *   `created_at` alone is not one. Two listings written in the same
 *   transaction share a timestamp, and without a tiebreaker Postgres may
 *   return them in either order, so a bounded page can reshuffle between
 *   loads with no data having changed. `id` breaks the tie.
 */
async function fetchPublicListings(
  filters: MarketplaceFilters,
  limit: number,
): Promise<PublicListing[]> {
  let q = supabase.from('loamy_public_listings').select(PUBLIC_CARD_COLUMNS)
  if (filters.commodities?.length) q = q.in('commodity', filters.commodities)
  if (filters.state) q = q.eq('state', filters.state)
  if (filters.query) q = q.or(`commodity.ilike.%${filters.query}%`)

  q = filters.sort === 'price_asc' || filters.sort === 'price_desc'
    ? q.order('price_per_unit', { ascending: filters.sort === 'price_asc' })
    : q.order('created_at', { ascending: false })

  const { data, error } = await q.order('id', { ascending: false }).limit(limit)
  if (error) throw error
  return (data as unknown as PublicListing[]) ?? []
}

/**
 * The homepage storefront preview. Never more than twelve rows.
 *
 * Takes NO limit argument, which is the point: the bound is structural rather
 * than a number a caller passes and a later caller raises. The only way to
 * render a thirteenth listing on the homepage is to stop calling this.
 */
export async function getHomepageMarketplaceListings(
  filters: MarketplaceFilters = {},
): Promise<PublicListing[]> {
  return fetchPublicListings(filters, HOMEPAGE_MARKETPLACE_LIMIT)
}

/** The full marketplace. Same reader, the browse limit. */
export async function getMarketplaceListings(
  filters: MarketplaceFilters = {},
): Promise<PublicListing[]> {
  return fetchPublicListings(filters, MARKETPLACE_BROWSE_LIMIT)
}

/** Fetch the limited public profiles for a set of user ids, keyed by id. */
export async function fetchPublicProfiles(ids: string[]): Promise<Record<string, PublicProfile>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return {}
  const { data } = await supabase.from('loamy_public_profiles').select('*').in('id', unique)
  return Object.fromEntries(((data as PublicProfile[]) ?? []).map((p) => [p.id, p]))
}
