import { supabase } from '@/lib/supabase'
import type {
  CopilotLanguage,
  CopilotQaOverride,
  MarketEvent,
  MarketPriceHistory,
} from '@/lib/copilot/types'

/**
 * Retrieval layer. Reads ONLY the active-batch views (loamy_copilot_*), so a
 * deactivated upload batch immediately disappears from what the Co-pilot can
 * say. If a query returns nothing, the caller must fall back to the "no data"
 * path and log the question — never guess.
 *
 * SECURITY-REVIEW: never aggregate across price_type. retail (WFP monthly),
 * wholesale (WFP monthly) and farmgate (FAOSTAT ANNUAL, national) are NOT
 * comparable — pooling them produces nonsense (e.g. impossible month-on-month
 * swings). Every price query below PINS exactly one price_type (default retail);
 * there is no code path that returns a mixed-type set.
 */

/**
 * The Postgrest client these readers run against.
 *
 * Defaults to the browser singleton, which is what every existing caller
 * passes implicitly. Loam's orchestrator runs server-side and supplies a client
 * built from the CALLER'S jwt instead, so the same query is scoped by the same
 * RLS policies without this layer needing to know which host it is on. There is
 * deliberately no service-role path: Loam reads exactly what the signed-in
 * member could read for themselves.
 */
export type RetrievalClient = typeof supabase

export type PriceType = 'retail' | 'wholesale' | 'farmgate'
export const DEFAULT_PRICE_TYPE: PriceType = 'retail'

/** Price history for one commodity + ONE price_type (default retail), optional
 * state. The price_type filter is mandatory — the layer cannot mix bases. */
export async function retrievePriceHistory(
  commodity: string,
  state?: string,
  priceType: PriceType = DEFAULT_PRICE_TYPE,
  client: RetrievalClient = supabase,
): Promise<MarketPriceHistory[]> {
  let q = client
    .from('loamy_copilot_prices')
    .select('*')
    .ilike('commodity', commodity)
    .eq('price_type', priceType)
  if (state) q = q.ilike('state', state)
  // MOST-RECENT first: PostgREST caps a request at 1000 rows, so ascending order
  // returned only the OLDEST rows (why the chart showed 2011–2015 and "latest"
  // was stale). Descending gives the true latest record + recent chart window.
  const { data } = await q.order('date', { ascending: false }).limit(1000)
  return (data as MarketPriceHistory[]) ?? []
}

/** Recent price rows across commodities for the Market Updates summary — pinned
 * to ONE price_type (default retail). */
export async function retrieveRecentPrices(sinceDays = 120, priceType: PriceType = DEFAULT_PRICE_TYPE): Promise<MarketPriceHistory[]> {
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 10)
  const { data } = await supabase
    .from('loamy_copilot_prices')
    .select('*')
    .eq('price_type', priceType)
    .gte('date', since)
    .order('date', { ascending: true })
    .limit(6000)
  return (data as MarketPriceHistory[]) ?? []
}

/** Events active as of today (started, and not yet ended). */
export async function retrieveActiveEvents(): Promise<MarketEvent[]> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('loamy_copilot_events')
    .select('*')
    .lte('start_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('start_date', { ascending: false })
  return (data as MarketEvent[]) ?? []
}

/** Events overlapping a date window — used to annotate a price chart. */
export async function retrieveEventsInRange(from: string, to: string): Promise<MarketEvent[]> {
  const { data } = await supabase
    .from('loamy_copilot_events')
    .select('*')
    .lte('start_date', to)
    .or(`end_date.is.null,end_date.gte.${from}`)
    .order('start_date', { ascending: true })
  return (data as MarketEvent[]) ?? []
}

export interface PriceContext {
  row_count: number
  latest_date: string
  latest_per_kg: number
  years_from: number
  years_to: number
  /** Normal range = min/max of monthly averages over the LAST 24 MONTHS. */
  recent_low: number | null
  recent_high: number | null
  recent_avg: number | null
  recent_months: number
  cheapest_month: number | null
  dearest_month: number | null
  /** Devaluation-proof seasonal index: month average ÷ that year's average. */
  seasonal: { month: number; index: number }[]
}

/** Full-history aggregates for one commodity + price_type (server-side, no
 * 1000-row cap). Backbone of the "is this a good price?" comparison. */
export async function retrievePriceContext(commodity: string, state?: string, priceType: PriceType = DEFAULT_PRICE_TYPE, client: RetrievalClient = supabase): Promise<PriceContext | null> {
  const { data } = await client.rpc('loamy_copilot_price_context', { p_commodity: commodity, p_state: state ?? null, p_price_type: priceType })
  return (data as PriceContext) ?? null
}

/** An admin-authored concept explanation matching the user's text (EN/HA). */
export async function retrieveConcept(text: string, language: CopilotLanguage, client: RetrievalClient = supabase): Promise<{ title: string; body: string } | null> {
  const { data } = await client.from('copilot_concepts').select('topic,aliases,body_en,body_ha').eq('active', true)
  const t = ` ${text.toLowerCase()} `
  for (const c of (data as { topic: string; aliases: string[]; body_en: string; body_ha: string | null }[]) ?? []) {
    if ((c.aliases ?? []).some((a) => t.includes(a.toLowerCase()))) {
      return { title: c.topic, body: language === 'ha' && c.body_ha ? c.body_ha : c.body_en }
    }
  }
  return null
}

export interface CrossMarketRow { market: string; state: string | null; low_per_kg: number; high_per_kg: number; observed_date: string }
/** Latest validated price per market for a commodity, cheapest first. */
export async function retrieveCrossMarket(commodity: string, state?: string, client: RetrievalClient = supabase): Promise<CrossMarketRow[]> {
  let q = client.from('loamy_validated_prices').select('market_name,state,price_low_per_kg,price_high_per_kg,observed_date').ilike('commodity', commodity)
  if (state) q = q.ilike('state', state)
  const { data } = await q.order('observed_date', { ascending: false }).limit(200)
  const seen = new Set<string>()
  const rows: CrossMarketRow[] = []
  for (const r of (data as { market_name: string; state: string | null; price_low_per_kg: number; price_high_per_kg: number; observed_date: string }[]) ?? []) {
    if (seen.has(r.market_name)) continue
    seen.add(r.market_name)
    rows.push({ market: r.market_name, state: r.state, low_per_kg: Number(r.price_low_per_kg), high_per_kg: Number(r.price_high_per_kg), observed_date: r.observed_date })
  }
  return rows.sort((a, b) => a.low_per_kg - b.low_per_kg)
}

/**
 * Admin overrides take precedence over generated answers. Returns the first
 * ACTIVE override whose pattern matches the user's text (regex first, then
 * plain substring), in the requested language.
 */
export async function findOverride(
  text: string,
  language: CopilotLanguage,
): Promise<CopilotQaOverride | null> {
  const { data } = await supabase
    .from('copilot_qa_overrides')
    .select('*')
    .eq('active', true)
    .eq('language', language)
  const overrides = (data as CopilotQaOverride[]) ?? []
  const lower = text.toLowerCase()
  for (const o of overrides) {
    const pattern = o.question_pattern.trim()
    if (!pattern) continue
    try {
      if (new RegExp(pattern, 'i').test(text)) return o
    } catch {
      /* not a valid regex — fall through to substring */
    }
    if (lower.includes(pattern.toLowerCase())) return o
  }
  return null
}
