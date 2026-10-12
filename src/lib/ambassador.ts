import { supabase } from '@/lib/supabase'

/** Ambassador Price Network data access. Submissions are written only through
 * the server RPC (normalisation + anomaly validation always run). End users read
 * the identity-safe `loamy_validated_prices` view. */

export interface CommodityVariety {
  id: string
  commodity: string
  variety_name: string
  local_name_hausa: string | null
}

export interface CommodityUnit {
  id: string
  commodity: string | null
  unit_name: string
  kg_equivalent: number
  region: string | null
}

export interface AmbassadorSubmission {
  id: string
  state: string
  lga: string | null
  market_name: string
  commodity: string
  variety_id: string | null
  price_low: number
  price_high: number
  unit: string
  /** How many units the quoted range covers (per-kg divides by quantity x unit). */
  quantity: number
  price_low_per_kg: number
  price_high_per_kg: number
  observed_date: string
  note: string | null
  status: 'pending' | 'validated' | 'flagged' | 'rejected'
  flags: string[]
  validation_note: string | null
  submitted_at: string
  ambassador_id?: string
}

export interface ValidatedPrice {
  id: string
  commodity: string
  variety_name: string | null
  local_name_hausa: string | null
  state: string | null
  lga: string | null
  market_name: string
  price_low: number
  price_high: number
  unit: string
  quantity: number
  price_low_per_kg: number
  price_high_per_kg: number
  observed_date: string
  note: string | null
}

export interface SubmitResult { id: string; status: string; flags: string[]; per_kg_low: number; per_kg_high: number; kg_equivalent: number; quantity: number }

export interface NewSubmission {
  state: string
  lga: string | null
  market_name: string
  commodity: string
  variety_id: string | null
  price_low: number
  price_high: number
  unit: string
  /** Units the range covers — e.g. 2 x 'tonne'. Defaults to 1. */
  quantity: number
  observed_date: string
  note: string | null
}

/**
 * How a quoted price range should be labelled: "bag", or "2 x tonne" for a lot.
 * Defaults to a single unit when quantity is missing or unparseable — rows
 * recorded before the quantity column existed have no value for it.
 */
export function perUnitLabel(quantity: unknown, unit: string): string {
  const q = Number(quantity)
  return Number.isFinite(q) && q > 0 && q !== 1 ? `${q} × ${unit}` : unit
}

export async function fetchVarieties(): Promise<CommodityVariety[]> {
  const { data } = await supabase.from('commodity_varieties').select('id,commodity,variety_name,local_name_hausa').eq('active', true).order('commodity')
  return (data as CommodityVariety[]) ?? []
}

export async function fetchUnits(): Promise<CommodityUnit[]> {
  const { data } = await supabase.from('commodity_units').select('id,commodity,unit_name,kg_equivalent,region').eq('active', true)
  return (data as CommodityUnit[]) ?? []
}

export async function submitAmbassadorPrice(s: NewSubmission): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc('loamy_submit_ambassador_price', {
    p_state: s.state, p_lga: s.lga, p_market: s.market_name, p_commodity: s.commodity,
    p_variety: s.variety_id, p_price_low: s.price_low, p_price_high: s.price_high,
    p_unit: s.unit, p_quantity: s.quantity, p_observed_date: s.observed_date,
    p_note: s.note, p_photo_url: null,
  })
  if (error) throw new Error(error.message)
  const r = data as { flags?: string[] | string }
  return { ...(data as SubmitResult), flags: Array.isArray(r.flags) ? r.flags : [] }
}

export async function fetchMySubmissions(): Promise<AmbassadorSubmission[]> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return []
  const { data } = await supabase.from('ambassador_price_submissions').select('*').eq('ambassador_id', auth.user.id).order('submitted_at', { ascending: false }).limit(60)
  return (data as AmbassadorSubmission[]) ?? []
}

/** The ambassador's most recent prior submission for a commodity at a market —
 * shown beside the input so they can see the change. */
export async function fetchLastFor(commodity: string, market: string): Promise<AmbassadorSubmission | null> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user || !commodity || !market) return null
  const { data } = await supabase.from('ambassador_price_submissions').select('*')
    .eq('ambassador_id', auth.user.id).eq('commodity', commodity).ilike('market_name', market)
    .order('observed_date', { ascending: false }).limit(1)
  return ((data as AmbassadorSubmission[]) ?? [])[0] ?? null
}

/** Latest VALIDATED price per commodity (+ market) — marketplace panel + Co-pilot. */
export async function fetchValidatedPrices(): Promise<ValidatedPrice[]> {
  const { data } = await supabase.from('loamy_validated_prices').select('*').order('observed_date', { ascending: false }).limit(1000)
  const rows = (data as ValidatedPrice[]) ?? []
  const seen = new Set<string>(); const out: ValidatedPrice[] = []
  for (const r of rows) { const k = `${r.commodity}|${r.market_name}`; if (!seen.has(k)) { seen.add(k); out.push(r) } }
  return out
}

/** Latest validated price for one commodity (optionally a state) — Co-pilot. */
export async function fetchValidatedFor(commodity: string, state?: string | null): Promise<ValidatedPrice | null> {
  let q = supabase.from('loamy_validated_prices').select('*').ilike('commodity', commodity)
  if (state) q = q.ilike('state', state)
  const { data } = await q.order('observed_date', { ascending: false }).limit(1)
  return ((data as ValidatedPrice[]) ?? [])[0] ?? null
}

// --- Admin -----------------------------------------------------------------

export async function fetchFlaggedQueue(): Promise<AmbassadorSubmission[]> {
  const { data } = await supabase.from('ambassador_price_submissions').select('*').eq('status', 'flagged').order('submitted_at', { ascending: false }).limit(100)
  return (data as AmbassadorSubmission[]) ?? []
}

export async function reviewSubmission(id: string, action: 'approve' | 'reject', note: string | null): Promise<void> {
  const { error } = await supabase.rpc('loamy_review_ambassador_price', { p_id: id, p_action: action, p_note: note })
  if (error) throw new Error(error.message)
}

export interface LeaderRow { ambassador_id: string; total: number; validated: number }
/** This-month leaderboard: submissions + validated count per ambassador. */
export async function fetchLeaderboard(): Promise<LeaderRow[]> {
  const monthStart = new Date(); monthStart.setDate(1)
  const { data } = await supabase.from('ambassador_price_submissions').select('ambassador_id,status').gte('submitted_at', monthStart.toISOString().slice(0, 10)).limit(5000)
  const rows = (data as { ambassador_id: string; status: string }[]) ?? []
  const map = new Map<string, LeaderRow>()
  for (const r of rows) {
    const e = map.get(r.ambassador_id) ?? { ambassador_id: r.ambassador_id, total: 0, validated: 0 }
    e.total += 1
    if (r.status === 'validated') e.validated += 1
    map.set(r.ambassador_id, e)
  }
  return [...map.values()].sort((a, b) => b.validated - a.validated || b.total - a.total)
}

export interface ValidationConfig { market_dev_pct: number; state_dev_pct: number; submission_rate: number }
export async function fetchValidationConfig(): Promise<ValidationConfig | null> {
  const { data } = await supabase.from('price_validation_config').select('market_dev_pct,state_dev_pct,submission_rate').eq('id', 1).maybeSingle()
  return (data as ValidationConfig) ?? null
}
export async function updateValidationConfig(c: ValidationConfig): Promise<void> {
  const { error } = await supabase.from('price_validation_config').update({ ...c, updated_at: new Date().toISOString() }).eq('id', 1)
  if (error) throw new Error(error.message)
}
