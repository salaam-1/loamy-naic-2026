import { supabase } from '@/lib/supabase'

/**
 * Daily market price updates — low–high ranges in a flexible unit (default
 * 100kg), posted by growth partners (field agents) and admins. This is the LIVE
 * current price feed for the marketplace panel and the Co-pilot; the uploaded
 * WFP/FAOSTAT history remains the long-run/seasonal source.
 */

export const PRICE_UNITS = ['100kg', '50kg (bag)', '25kg', 'kg', 'tonne', 'bag', 'crate', 'unit'] as const

export interface PriceUpdate {
  id: string
  commodity: string
  state: string | null
  unit: string
  price_min: number
  price_max: number
  recorded_date: string
  source_note: string | null
  recorded_by?: string | null
  created_at?: string
}

export interface NewPriceUpdate {
  commodity: string
  state: string | null
  unit: string
  price_min: number
  price_max: number
  recorded_date: string
  source_note: string | null
}

export async function submitPriceUpdate(u: NewPriceUpdate): Promise<void> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('You need to be signed in.')
  const { error } = await supabase.from('market_price_updates').insert({ ...u, recorded_by: auth.user.id })
  if (error) throw new Error(error.message)
}

export async function deletePriceUpdate(id: string): Promise<void> {
  const { error } = await supabase.from('market_price_updates').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Latest update per commodity from the anon-safe view (marketplace panel). */
export async function fetchLatestPublicPrices(): Promise<PriceUpdate[]> {
  const { data } = await supabase
    .from('loamy_public_price_updates')
    .select('*')
    .order('recorded_date', { ascending: false })
    .limit(1000)
  const rows = (data as PriceUpdate[]) ?? []
  const seen = new Set<string>()
  const out: PriceUpdate[] = []
  for (const r of rows) {
    const key = `${r.commodity}|${r.state ?? ''}`
    if (!seen.has(key)) { seen.add(key); out.push(r) }
  }
  return out
}

/** Recent updates I reported (growth partner / admin dashboard). */
export async function fetchMyPriceUpdates(): Promise<PriceUpdate[]> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return []
  const { data } = await supabase
    .from('market_price_updates')
    .select('*')
    .eq('recorded_by', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(60)
  return (data as PriceUpdate[]) ?? []
}

/** The most recent update(s) for a commodity — used by the Co-pilot Price Check. */
export async function fetchLatestUpdateFor(commodity: string, state?: string | null): Promise<PriceUpdate | null> {
  let q = supabase.from('market_price_updates').select('*').ilike('commodity', commodity)
  if (state) q = q.ilike('state', state)
  const { data } = await q.order('recorded_date', { ascending: false }).limit(1)
  return ((data as PriceUpdate[]) ?? [])[0] ?? null
}
