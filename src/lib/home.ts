import { supabase } from '@/lib/supabase'
import type { PlatformRole } from '@/lib/types'

/**
 * What Home needs to know, fetched from real tables under RLS.
 *
 * WHY THIS REPLACES THE STAT CARDS
 *   The old Home read four numbers out of `role_details.role_data` — the JSON
 *   blob a member filled in during onboarding. "Total farms" was whatever
 *   someone typed months ago, not how many farms they have. It could not go
 *   stale, because it was never live to begin with.
 *
 *   Everything here is a query against the authoritative table, scoped by
 *   RLS. A farmer with no farms gets an empty array and an empty state, not
 *   a zero that might be a stale self-report.
 *
 * WHY IT IS ROLE-AWARE
 *   §3: "Do not show irrelevant information merely to make a dashboard look
 *   full." A Growth Partner has no listings and no cart; querying for them
 *   costs a round trip and produces a section that can only ever be empty.
 *   `fetchHomeContext` asks only for what the role can actually have.
 *
 * COLUMNS ARE EXPLICIT
 *   §40: no `select('*')`. Home reads what it renders and nothing more —
 *   notably never a farm's coordinates, which it has no reason to know.
 */

export interface HomeFarm {
  id: string
  farm_name: string
  state: string | null
  lga: string | null
  size_hectares: number | null
  primary_crops: string[] | null
  verification_status: 'unverified' | 'pending' | 'verified' | 'rejected'
}

export interface HomeListing {
  id: string
  commodity: string
  quantity_kg: number
  unit: string
  price_per_unit: number
  status: string
  claim_basis: string | null
}

export interface HomeTransaction {
  id: string
  ref: string | null
  commodity: string
  quantity: number
  unit: string
  subtotal: number
  status: string
  payment_state: string | null
  fulfilment_state: string | null
  created_at: string
  /** Which side of this deal the signed-in member is on. */
  side: 'buying' | 'selling'
}

export interface HomeFinancing {
  id: string
  amount_requested: number
  status: string
  created_at: string
}

export interface HomeTask {
  task_id: string
  ref: string | null
  task_type: string
  status: string
  expected_state: string | null
  expected_lga: string | null
}

export interface HomeContext {
  farms: HomeFarm[]
  cropRecords: CropRecordRow[]
  listings: HomeListing[]
  transactions: HomeTransaction[]
  financing: HomeFinancing[]
  tasks: HomeTask[]
  unread: number
}

export const EMPTY_CONTEXT: HomeContext = {
  farms: [], cropRecords: [], listings: [], transactions: [], financing: [], tasks: [], unread: 0,
}

/** Roles that can hold farms, harvests and batches. */
const GROWS: PlatformRole[] = ['farmer']
/** Roles that publish listings. */
const SELLS: PlatformRole[] = ['farmer', 'trader', 'input_supplier', 'exporter', 'warehouse_owner']
/** Roles that buy on the marketplace. */
const BUYS: PlatformRole[] = ['buyer', 'trader', 'exporter', 'processor', 'farmer']
/** Roles that can apply for financing. */
const FINANCES: PlatformRole[] = ['farmer', 'trader', 'buyer', 'exporter', 'processor']

export function canGrow(role: PlatformRole | null | undefined): boolean {
  return !!role && GROWS.includes(role)
}
export function canSell(role: PlatformRole | null | undefined): boolean {
  return !!role && SELLS.includes(role)
}
export function canBuy(role: PlatformRole | null | undefined): boolean {
  return !!role && BUYS.includes(role)
}
export function canFinance(role: PlatformRole | null | undefined): boolean {
  return !!role && FINANCES.includes(role)
}

/**
 * Transaction statuses that mean "still in flight".
 *
 * Mirrors the authoritative lifecycle rather than guessing: anything not
 * concluded, cancelled or disputed is work the member still has to do
 * something about, and belongs on Home.
 */
const SETTLED = ['completed', 'concluded', 'cancelled', 'disputed', 'released', 'delivered']

export function isActiveTransaction(t: Pick<HomeTransaction, 'status'>): boolean {
  return !SETTLED.includes(t.status)
}

/** Financing states that are still open with a bank. */
const FINANCING_OPEN = ['draft', 'submitted', 'under_review', 'information_requested']

export function isOpenFinancing(f: Pick<HomeFinancing, 'status'>): boolean {
  return FINANCING_OPEN.includes(f.status)
}

/**
 * The one transaction Home should lead with.
 *
 * Most recent active deal, preferring one the member is BUYING — a buyer
 * waiting on settlement has money committed and is the more anxious party.
 * Falls back to the most recent of anything if nothing is active.
 */
export function leadTransaction(all: HomeTransaction[]): HomeTransaction | null {
  const active = all.filter(isActiveTransaction)
  const pool = active.length > 0 ? active : all
  if (pool.length === 0) return null
  const buying = pool.filter((t) => t.side === 'buying')
  return (buying[0] ?? pool[0]) ?? null
}

/** Greeting by local hour. Trivial, but it is the first word on the screen. */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ---------------------------------------------------------------------------
// Yield history
// ---------------------------------------------------------------------------

export interface CropRecordRow {
  crop: string
  season_year: number
  actual_yield_kg: number | null
}

export interface YieldChart {
  rows: { season: string; [crop: string]: string | number }[]
  series: { key: string; label: string; other?: boolean }[]
}

/**
 * Seasons on x, one series per crop — top four by volume, the rest folded
 * into "Other".
 *
 * Lifted out of FarmerOverview unchanged so Home can render the same chart
 * from the same rule. Only RECORDED yields are charted: a cycle with a null
 * actual_yield_kg is a season that has not been measured, and plotting it as
 * zero would draw a crop failure that did not happen.
 */
export function buildYieldChart(records: CropRecordRow[]): YieldChart {
  const crops = records.filter((c) => c.actual_yield_kg !== null)
  if (crops.length === 0) return { rows: [], series: [] }

  const totals = new Map<string, number>()
  for (const c of crops) totals.set(c.crop, (totals.get(c.crop) ?? 0) + Number(c.actual_yield_kg))
  const topCrops = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k)
  const hasOther = totals.size > topCrops.length
  const seasons = [...new Set(crops.map((c) => c.season_year))].sort()

  const rows = seasons.map((y) => {
    const row: { season: string; [crop: string]: string | number } = { season: String(y) }
    for (const crop of topCrops) row[crop] = 0
    if (hasOther) row.Other = 0
    for (const c of crops.filter((x) => x.season_year === y)) {
      const key = topCrops.includes(c.crop) ? c.crop : 'Other'
      row[key] = (Number(row[key]) || 0) + Number(c.actual_yield_kg)
    }
    return row
  })

  return {
    rows,
    series: [
      ...topCrops.map((c) => ({ key: c, label: c })),
      ...(hasOther ? [{ key: 'Other', label: 'Other', other: true }] : []),
    ],
  }
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function safe<T>(p: PromiseLike<{ data: T | null }>, fallback: T): Promise<T> {
  try {
    const { data } = await p
    // Array-shaped fallbacks must stay arrays. A function returning an object
    // where this expected a list is how Home went blank once already; the
    // fallback is cheaper than the crash.
    if (Array.isArray(fallback) && !Array.isArray(data)) return fallback
    return data ?? fallback
  } catch {
    // Home must render. One failed panel is a gap on the page, not a blank
    // screen — and the panel's own empty state says so.
    return fallback
  }
}

export async function fetchHomeContext(
  userId: string,
  role: PlatformRole | null,
): Promise<HomeContext> {
  const jobs: Promise<Partial<HomeContext>>[] = []

  // Unread needs the count, not the rows.
  const unreadPromise = supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('read', false)
    .then((r) => r.count ?? 0, () => 0)

  if (canGrow(role)) {
    jobs.push(
      safe<HomeFarm[]>(
        supabase
          .from('farms')
          .select('id, farm_name, state, lga, size_hectares, primary_crops, verification_status')
          .eq('owner_id', userId)
          .order('created_at', { ascending: false })
          .range(0, 9) as never,
        [],
      ).then((farms) => ({ farms })),
    )
    jobs.push(
      // RLS scopes crop_records to the caller's own farms — the same boundary
      // as every other read on this page.
      safe<CropRecordRow[]>(
        supabase
          .from('crop_records')
          .select('crop, season_year, actual_yield_kg')
          .range(0, 199) as never,
        [],
      ).then((cropRecords) => ({ cropRecords })),
    )
  }

  if (canSell(role)) {
    jobs.push(
      safe<HomeListing[]>(
        supabase
          .from('listings')
          .select('id, commodity, quantity_kg, unit, price_per_unit, status, claim_basis')
          .eq('seller_id', userId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .range(0, 9) as never,
        [],
      ).then((listings) => ({ listings })),
    )
  }

  if (canBuy(role) || canSell(role)) {
    // Both sides in one pass. RLS already limits rows to deals the member is
    // party to; `side` is derived here so the UI never has to compare ids.
    jobs.push(
      safe<Omit<HomeTransaction, 'side'>[] & { buyer_id: string }[]>(
        supabase
          .from('transactions')
          .select('id, ref, commodity, quantity, unit, subtotal, status, payment_state, fulfilment_state, created_at, buyer_id')
          .order('created_at', { ascending: false })
          .range(0, 19) as never,
        [] as never,
      ).then((rows) => ({
        transactions: (rows as unknown as (HomeTransaction & { buyer_id: string })[]).map((t) => ({
          ...t,
          side: t.buyer_id === userId ? ('buying' as const) : ('selling' as const),
        })),
      })),
    )
  }

  if (canFinance(role)) {
    jobs.push(
      safe<HomeFinancing[]>(
        supabase
          .from('financing_applications')
          .select('id, amount_requested, status, created_at')
          .eq('applicant_id', userId)
          .order('created_at', { ascending: false })
          .range(0, 4) as never,
        [],
      ).then((financing) => ({ financing })),
    )
  }

  if (role === 'growth_partner') {
    // The authoritative task list, which already hides what an agent may not
    // see (including who requested an inspection).
    jobs.push(
      (async () => {
        try {
          const { data } = await supabase.rpc('loamy_my_tasks')
          // loamy_my_tasks returns { items: [...] }, NOT a bare array. Reading
          // it as an array crashed the Growth Partner's Home outright --
          // `c.tasks.filter is not a function` with a blank page behind it.
          const items = (data as { items?: unknown } | null)?.items
          return { tasks: Array.isArray(items) ? (items as HomeTask[]) : [] }
        } catch {
          return { tasks: [] as HomeTask[] }
        }
      })(),
    )
  }

  const [parts, unread] = await Promise.all([Promise.all(jobs), unreadPromise])
  return parts.reduce<HomeContext>((acc, p) => ({ ...acc, ...p }), { ...EMPTY_CONTEXT, unread })
}
