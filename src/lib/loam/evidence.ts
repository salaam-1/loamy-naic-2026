/**
 * Evidence retrieval — Level 1 (Loamy data) and Level 2 (knowledge pack).
 *
 * AUTHORIZATION
 *   Every Level 1 read goes through a client built from the CALLER's JWT, so
 *   Postgres RLS decides what comes back. There is no service-role path here
 *   and no user id is ever taken from the request body: the orchestrator passes
 *   the id it got from verifying the token. The practical effect is that Loam
 *   can only ever tell a member what they could already read themselves.
 *
 * THE COLUMN ALLOWLIST IS A SECURITY BOUNDARY, NOT A PERFORMANCE ONE
 *   farms.latitude/longitude are precise GPS coordinates of private farmland,
 *   flagged SECURITY-REVIEW in the Stage 2 migration and restricted to the
 *   owner. They must never enter a prompt: a prompt is text that leaves this
 *   process and, on a hosted inference path, this machine. So the farm reader
 *   names its columns and a test asserts the coordinate columns are absent.
 *   `select('*')` is forbidden here for the same reason.
 *
 * SCOPE
 *   Phase 1 connects a deliberately small allowlist: the member's farms, the
 *   crop records on those farms, and market price context. Weather, harvests,
 *   listings and orders are Phase 5 work; adding one means adding a reader and
 *   a test, not loosening anything here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { retrieveConcept, retrievePriceContext } from '@/lib/copilot/retrieval'
import { monthName } from '@/lib/copilot/analysis'
import { ZONE_SOURCE, findKnowledge, sourceFor, zoneFor } from '@/lib/loam/knowledge'
import type { EvidenceItem, LoamLanguage } from '@/lib/loam/types'
import type { Classification } from '@/lib/loam/classify'
import { publicSite } from '@/lib/i18n/packs/en/publicSite'

/** Columns the farm reader may select. NO latitude, NO longitude, NO address. */
export const FARM_COLUMNS = ['id', 'farm_name', 'state', 'lga', 'size_hectares', 'primary_crops'] as const

/**
 * Columns the market-price reader may select.
 *
 * These are every column `loamy_public_price_updates` has. The view is the
 * sanctioned public projection of `market_price_updates`: it drops
 * `recorded_by` -- the only person-identifying column on the table -- and
 * bounds itself to the last 150 days. Reading the view rather than the table
 * means Loam cannot see who reported a price even by accident.
 */
export const PRICE_UPDATE_COLUMNS = [
  'commodity', 'state', 'unit', 'price_min', 'price_max', 'recorded_date', 'source_note',
] as const

/**
 * How recent an observation has to be before Loam calls it current.
 *
 * The view already cuts off at 150 days, which is far too old to present as
 * today's price. Past this threshold the claim states the age explicitly, so
 * the model has to describe a stale figure as stale rather than as the price.
 */
export const PRICE_FRESH_DAYS = 21

/** Columns the crop-record reader may select. */
export const CROP_RECORD_COLUMNS = [
  'id', 'farm_id', 'crop', 'season_year', 'planting_date',
  'expected_harvest_date', 'actual_harvest_date', 'expected_yield_kg', 'actual_yield_kg',
] as const

/** A tolerant client type: the browser singleton and a server client both fit. */
export type EvidenceClient = Pick<SupabaseClient, 'from' | 'rpc'>

const iso = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null)

/**
 * The member's own farms, without coordinates.
 *
 * Filtered on owner_id as well as relying on RLS. Belt and braces: RLS is the
 * boundary, but a reader that also states its intent cannot silently widen if a
 * policy is ever edited.
 */
async function farmEvidence(client: EvidenceClient, userId: string): Promise<EvidenceItem[]> {
  const { data, error } = await client
    .from('farms')
    .select(FARM_COLUMNS.join(', '))
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error || !data?.length) return []

  const rows = data as unknown as {
    id: string; farm_name: string; state: string; lga: string
    size_hectares: number; primary_crops: string[]
  }[]
  /**
   * Written in the second person, because this is the member's own record and
   * Loam is speaking to them. A live demo produced "The member has a farm
   * called ..." -- accurate, grounded, and oddly distant for an assistant
   * addressing the person whose farm it is.
   *
   * Only the framing changes. Every fact in the sentence still comes from the
   * row, and "your" is a stopword, so grounding scores exactly as before.
   */
  return rows.map((f) => ({
    level: 1 as const,
    claim:
      `Your farm "${f.farm_name}" is in ${f.lga}, ${f.state}. It is ${f.size_hectares} hectares, `
      + `and the crops recorded on it are ${(f.primary_crops ?? []).join(', ') || 'not recorded'}.`,
    source: 'Loamy farm records',
    numbers: [Number(f.size_hectares)],
  }))
}

/** Crop records on the member's farms. */
async function cropRecordEvidence(
  client: EvidenceClient,
  farmIds: string[],
): Promise<EvidenceItem[]> {
  if (!farmIds.length) return []
  const { data, error } = await client
    .from('crop_records')
    .select(CROP_RECORD_COLUMNS.join(', '))
    .in('farm_id', farmIds)
    .order('season_year', { ascending: false })
    .limit(20)
  if (error || !data?.length) return []

  const rows = data as unknown as {
    crop: string; season_year: number; planting_date: string | null
    expected_harvest_date: string | null; actual_harvest_date: string | null
    expected_yield_kg: number | null; actual_yield_kg: number | null
  }[]
  return rows.map((r) => {
    const parts = [`${r.crop}, ${r.season_year} season`]
    if (r.planting_date) parts.push(`planted ${iso(r.planting_date)}`)
    if (r.actual_harvest_date) parts.push(`harvested ${iso(r.actual_harvest_date)}`)
    else if (r.expected_harvest_date) parts.push(`harvest expected ${iso(r.expected_harvest_date)}`)
    if (r.actual_yield_kg != null) parts.push(`${r.actual_yield_kg} kg harvested`)
    else if (r.expected_yield_kg != null) parts.push(`${r.expected_yield_kg} kg expected`)

    const numbers = [r.season_year]
    if (r.actual_yield_kg != null) numbers.push(Number(r.actual_yield_kg))
    if (r.expected_yield_kg != null) numbers.push(Number(r.expected_yield_kg))
    const periods = [r.planting_date, r.expected_harvest_date, r.actual_harvest_date]
      .filter(Boolean).map((d) => iso(d)!)

    return {
      level: 1 as const,
      claim: `Your crop record shows ${parts.join('; ')}.`,
      source: 'Loamy crop records',
      asOf: iso(r.planting_date),
      numbers,
      periods,
    }
  })
}

/**
 * Observed market price context for a commodity.
 *
 * Reuses the existing `loamy_copilot_price_context` RPC — the seasonal
 * normalisation (each month measured against its own year's average, so naira
 * devaluation does not distort the pattern) is real work already done in SQL
 * and is not reimplemented here. Note what this evidence says and does not
 * say: it reports the OBSERVED range, never a prediction.
 */
async function priceEvidence(
  client: EvidenceClient,
  commodity: string,
  state: string | null,
): Promise<EvidenceItem[]> {
  let ctx: Awaited<ReturnType<typeof retrievePriceContext>> = null
  try {
    ctx = await retrievePriceContext(commodity, state ?? undefined, 'retail', client as never)
  } catch {
    return []
  }
  if (!ctx || !ctx.row_count) return []

  const out: EvidenceItem[] = [{
    level: 1,
    claim:
      `Observed retail price for ${commodity}: the most recent recorded figure is `
      + `₦${Math.round(ctx.latest_per_kg)} per kg on ${iso(ctx.latest_date)}, from `
      + `${ctx.row_count} records spanning ${ctx.years_from} to ${ctx.years_to}.`,
    source: 'Loamy market price records (WFP/FEWS NET)',
    asOf: iso(ctx.latest_date),
    numbers: [Math.round(ctx.latest_per_kg), ctx.years_from, ctx.years_to],
    periods: [iso(ctx.latest_date)!],
  }]

  if (ctx.recent_low != null && ctx.recent_high != null) {
    out.push({
      level: 1,
      claim:
        `Over the last ${ctx.recent_months} months the recorded retail price for ${commodity} `
        + `ranged from ₦${Math.round(ctx.recent_low)} to ₦${Math.round(ctx.recent_high)} per kg`
        + (ctx.recent_avg != null ? `, averaging ₦${Math.round(ctx.recent_avg)}` : '') + '.',
      source: 'Loamy market price records (WFP/FEWS NET)',
      asOf: iso(ctx.latest_date),
      numbers: [
        Math.round(ctx.recent_low), Math.round(ctx.recent_high), ctx.recent_months,
        ...(ctx.recent_avg != null ? [Math.round(ctx.recent_avg)] : []),
      ],
    })
  }
  if (ctx.cheapest_month && ctx.dearest_month) {
    out.push({
      level: 1,
      claim:
        `Seasonally, recorded ${commodity} prices have been lowest in `
        + `${monthName(ctx.cheapest_month)} and highest in ${monthName(ctx.dearest_month)}. `
        + 'This is an observed historical pattern, not a prediction.',
      source: 'Loamy market price records, seasonal index',
      periods: [monthName(ctx.cheapest_month), monthName(ctx.dearest_month)],
    })
  }
  return out
}

/** Level 2 entries matching the question, plus the agro-ecological zone. */
/**
 * What Loamy is, for questions about the platform itself.
 *
 * WHY THIS EXISTS
 *   "What is Loamy?" was declined. The nine-input trace showed why: no reader
 *   covered the product, `content_entries` holds zero rows, and the social
 *   router's capability phrase is `what is loam` -- whose word-boundary match
 *   fails against "loamy". So the single most obvious question a new member can
 *   ask reached the gate with no evidence and was refused.
 *
 * WHY IT READS THE PUBLIC SITE PACK
 *   These claims are not written here. They are the strings already published
 *   on Loamy's own public pages, imported from the one place they are authored,
 *   so the answer cannot drift from what the site says. Inventing a second
 *   description of the product would be exactly the fabrication the evidence
 *   architecture exists to prevent.
 *
 * WHY LEVEL 2
 *   Team-authored and already published, so it is approved platform knowledge
 *   rather than verified per-member data. It carries no PENDING AGRONOMIST
 *   REVIEW label because no agronomist is needed to say what the product does.
 */
const PLATFORM_SOURCE = 'Loamy platform description (loamy.ng public pages)'

/**
 * The product's name, spelled either way.
 *
 * `\bloamy\b` alone was too literal. A live session asked "what is loam all
 * about?" and "loamy", and both were declined -- the first because it says
 * "loam" rather than "loamy", the second because the pattern demanded a
 * question word next to the name. Both are ordinary ways to ask what the
 * product is, and declining them makes the whole assistant look broken rather
 * than merely narrow.
 */
const PLATFORM_NAME = /\bloamy?\b/i

/** Words that make a mention of the name into a question about it. */
const ASKING =
  /\b(what|whats|who|how|why|tell|explain|about|describe|does|do|is|are|work|works|working|help|offer|offers|for|use|using|mean|means)\b/i

/**
 * "loamy soil" is agronomy, not the product.
 *
 * The standalone benchmark showed N-ATLaS answers "What is Loamy?" with a
 * description of loam SOIL, which is why the product question needs controlled
 * evidence. The converse matters too: a genuine soil question must NOT be
 * answered with the four pillars of a software platform.
 */
const SOIL_SENSE = /\bloamy?\b[^.?!]{0,20}\b(soil|soils|earth|loam texture|sand|silt|clay)\b|\b(soil|soils|sandy|silty|clayey)\b[^.?!]{0,20}\bloamy?\b/i

export function platformEvidence(
  message: string,
  commodity?: string | null,
): EvidenceItem[] {
  if (!PLATFORM_NAME.test(message)) return []
  if (SOIL_SENSE.test(message)) return []

  const words = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

  /** "loamy" on its own is a request to be told what it is. */
  const bareName = words.length > 0 && words.every((w) => w === 'loam' || w === 'loamy')

  if (!bareName) {
    if (!ASKING.test(message)) return []
    /**
     * A commodity IN THIS SENTENCE means a trading question that merely
     * mentions where it is being asked -- "what is the maize price on Loamy?".
     * Answering that with the four pillars would bury the price it asked for.
     *
     * The mention has to be in the message, not merely in `commodity`. The
     * panel carries `lastCommodity` between turns and `classify` honours it,
     * so asking about rice and then "what is Loamy?" arrived here with
     * commodity='Rice' inherited from context and the product question was
     * silently declined. Only a live browser session surfaced that: every
     * unit test asks one question with no history.
     */
    const named = commodity
      ? commodity.toLowerCase().split(/\s+/).every((w) => words.includes(w))
      : false
    if (named) return []
  }

  const p = publicSite
  return [
    {
      level: 2,
      claim:
        `Loamy is ${p['public.heroTitle'].toLowerCase()} for Nigeria. `
        + p['public.heroSubtitle'],
      source: PLATFORM_SOURCE,
    },
    /**
     * The four names alone, in their own claim.
     *
     * The first version put each title and its body in one run of prose. The
     * financing body ends "Non-interest structures: Murabaha and Salam", which
     * reads exactly like a fifth title -- and the model duly answered "built
     * on four parts" and then listed five. Separating the enumeration from the
     * descriptions removes the ambiguity rather than asking the model to
     * resolve it.
     */
    {
      level: 2,
      claim:
        'Loamy has four parts: '
        + [
          p['public.pillar.identity.title'],
          p['public.pillar.financing.title'],
          p['public.pillar.marketplace.title'],
          p['public.pillar.intelligence.title'],
        ].join(', ')
        + '.',
      source: PLATFORM_SOURCE,
    },
    {
      level: 2,
      claim:
        `${p['public.pillar.identity.title']} means: ${p['public.pillar.identity.body']} `
        + `${p['public.pillar.financing.title']} means: ${p['public.pillar.financing.body']} `
        + `${p['public.pillar.marketplace.title']} means: ${p['public.pillar.marketplace.body']} `
        + `${p['public.pillar.intelligence.title']} means: ${p['public.pillar.intelligence.body']}`,
      source: PLATFORM_SOURCE,
    },
    {
      level: 2,
      claim:
        `Using Loamy runs in steps. Register: ${p['public.step.register.body']} `
        + `Verify: ${p['public.step.verify.body']} Finance: ${p['public.step.finance.body']} `
        + `Sell: ${p['public.step.sell.body']} Store and move: ${p['public.step.store.body']} `
        + `Build history: ${p['public.step.history.body']}`,
      source: PLATFORM_SOURCE,
    },
    {
      /**
       * Carried on every platform answer on purpose. "Loamy lends money" is
       * the single most consequential thing the model could get wrong here,
       * and the disclaimer is the published correction.
       */
      level: 2,
      claim: p['public.disclaimer'],
      source: PLATFORM_SOURCE,
    },
  ]
}

export function knowledgeEvidence(c: Classification, message: string): EvidenceItem[] {
  const out: EvidenceItem[] = []
  const zone = zoneFor(c.state)
  if (zone && c.state) {
    out.push({
      level: 2,
      claim: `${c.state} lies in Nigeria's ${zone} agro-ecological zone.`,
      source: ZONE_SOURCE,
      // Context, never an answer: knowing the zone does not tell you when to
      // sow anything. Without this flag the gate let a pineapple question
      // through on the strength of "Sokoto is in the Sudan Savanna".
      contextOnly: true,
    })
  }
  for (const e of findKnowledge({ text: message, crop: c.commodity, state: c.state })) {
    out.push({
      // Derived from the review status, never typed by hand: see sourceFor().
      level: 2, claim: e.claim, source: sourceFor(e),
      numbers: e.numbers, periods: e.periods,
    })
  }
  return out
}

/** One row of `loamy_public_price_updates`. */
interface PriceUpdateRow {
  commodity: string
  state: string | null
  unit: string
  price_min: number
  price_max: number
  recorded_date: string
  source_note: string | null
}

const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`

/**
 * Observed market price updates, as evidence.
 *
 * WHAT THIS IS AND IS NOT
 *   These are price RANGES a growth partner or admin recorded on a date, for a
 *   commodity in a state. They are observations, not valuations and certainly
 *   not predictions. Every claim below says when it was recorded and what unit
 *   it is in, because a price without those is not interpretable.
 *
 * WHY ONE ITEM PER STATE, NEWEST ONLY
 *   Staging holds 317 rows, many of them repeated observations of the same
 *   commodity and state on the same day. Putting them all in the prompt would
 *   blow the context budget and tell the model nothing extra. The reader keeps
 *   the most recent observation per state and nothing else.
 *
 * WHY A NEGATIVE FINDING IS ALSO EVIDENCE
 *   If the member asked about Kaduna and the records only cover Benue and
 *   Kano, "there is no recorded price for Kaduna" is a true, retrieved fact
 *   and the single most useful thing Loam can say. Without it the model sees
 *   Benue prices next to a question about Kaduna and the obvious mistake is
 *   available to it. The state named in the question is an authorised anchor
 *   either way, so the guard alone would not catch that one.
 */
async function marketPriceEvidence(
  client: EvidenceClient,
  commodity: string,
  state: string | null,
): Promise<EvidenceItem[]> {
  let q = client
    .from('loamy_public_price_updates')
    .select(PRICE_UPDATE_COLUMNS.join(', '))
    .ilike('commodity', commodity)
  if (state) q = q.ilike('state', state)

  // Enough to cover several states at the newest date, not the whole table.
  const { data, error } = await q.order('recorded_date', { ascending: false }).limit(40)
  if (error) return []
  const rows = (data as unknown as PriceUpdateRow[]) ?? []

  if (!rows.length) {
    if (!state) return []
    /**
     * Asked about a state we hold nothing for. Check whether the commodity is
     * covered anywhere before saying so, because "no price for Maize in
     * Kaduna" and "no price for Maize at all" are different answers.
     */
    const { data: elsewhere } = await client
      .from('loamy_public_price_updates')
      .select('state, recorded_date')
      .ilike('commodity', commodity)
      .order('recorded_date', { ascending: false })
      .limit(40)
    const states = [...new Set(((elsewhere as unknown as PriceUpdateRow[]) ?? [])
      .map((r) => r.state).filter((x): x is string => Boolean(x)))]
    if (!states.length) return []
    return [{
      level: 1,
      claim:
        `There is no recorded price update for ${commodity} in ${state}. `
        + `The states with recorded ${commodity} prices are ${states.join(', ')}.`,
      source: 'Loamy market price updates',
    }]
  }

  // Newest observation per state.
  const newestByState = new Map<string, PriceUpdateRow>()
  for (const r of rows) {
    const key = r.state ?? 'Nigeria'
    const seen = newestByState.get(key)
    if (!seen || r.recorded_date > seen.recorded_date) newestByState.set(key, r)
  }

  const today = Date.now()
  return [...newestByState.values()].slice(0, 4).map((r) => {
    const date = String(r.recorded_date).slice(0, 10)
    const ageDays = Math.max(0, Math.round((today - Date.parse(date)) / 864e5))
    const stale = ageDays > PRICE_FRESH_DAYS
    const where = r.state ? ` in ${r.state}` : ''
    const note = r.source_note ? ` Recorded note: "${r.source_note}".` : ''
    return {
      level: 1 as const,
      claim:
        `Recorded price update for ${r.commodity}${where} on ${date}: `
        + `${naira(r.price_min)} to ${naira(r.price_max)} per ${r.unit}.`
        + (stale
          ? ` This observation is ${ageDays} days old and may not reflect today's market.`
          : '')
        + ' This is an observed record, not a prediction.'
        + note,
      source: 'Loamy market price updates',
      asOf: date,
      numbers: [Math.round(r.price_min), Math.round(r.price_max), ...(stale ? [ageDays] : [])],
      periods: [date],
    }
  })
}

/**
 * MIGRATED CAPABILITY: concept explanations.
 *
 * `copilot_concepts` holds admin-authored explanations of platform terms --
 * Murabaha, Escrow, verification -- in English and Hausa, with alias lists for
 * matching. Four rows on staging and every one of them human-written and
 * reviewed, which makes this a BETTER Level 2 source than the knowledge pack:
 * the pack is marked PENDING AGRONOMIST REVIEW, this is not.
 *
 * The legacy engine reached these through `answerConcept`, which also wrote
 * the prose around them. Loam takes only the row and lets N-ATLaS phrase it.
 */
async function conceptEvidence(
  client: EvidenceClient,
  message: string,
  language: LoamLanguage,
): Promise<EvidenceItem[]> {
  let hit: { title: string; body: string } | null = null
  try {
    // Reuses the legacy reader, which is a query and nothing else. Hausa falls
    // back to the English body inside it when no translation exists.
    hit = await retrieveConcept(message, language === 'ha' ? 'ha' : 'en', client as never)
  } catch {
    return []
  }
  if (!hit) return []
  return [{
    level: 2,
    claim: `${hit.title}: ${hit.body}`,
    // No PENDING AGRONOMIST REVIEW: this content was written and reviewed by
    // the Loamy team, not seeded by me.
    source: 'Loamy platform guide',
  }]
}

/**
 * MIGRATED CAPABILITY: local measurement units.
 *
 * `commodity_units` maps mudu, tiya, bag and the rest to a kilogram
 * equivalent, optionally per commodity and per region. 27 rows on staging.
 *
 * This matters more than it looks. A farmer asking about a price "per mudu"
 * is using a unit N-ATLaS has no reliable knowledge of, and a model guessing
 * at a conversion factor produces a number that looks authoritative and is
 * wrong. Supplying the row makes the figure checkable by the anchor guard.
 */
async function unitEvidence(
  client: EvidenceClient,
  message: string,
  commodity: string | null,
): Promise<EvidenceItem[]> {
  /**
   * ONLY WHEN A CONVERSION IS ACTUALLY BEING ASKED FOR.
   *
   * Without this gate the reader fired on any message containing a unit word,
   * and "I want to sell 20 bags of maize" came back as "One bag of maize is
   * recorded as 100 kg on Loamy" -- a true statement, answering a question
   * nobody asked, in place of the honest decline that request deserves. The
   * legacy engine gated the same capability behind an explicit `convert`
   * intent; this is that gate, rebuilt.
   */
  const asksConversion = /how many|how much is|convert|equivalent|in kg|per kg|kilo|nawa a kilo|nauyi/i
    .test(message)
  if (!asksConversion) return []

  const { data, error } = await client
    .from('commodity_units')
    .select('commodity, unit_name, kg_equivalent, region')
    .eq('active', true)
    .limit(200)
  if (error || !data?.length) return []

  const rows = data as unknown as {
    commodity: string | null; unit_name: string; kg_equivalent: number; region: string | null
  }[]
  const text = ` ${message.toLowerCase()} `
  const named = rows.filter((r) => text.includes(` ${r.unit_name.toLowerCase()}`))
  if (!named.length) return []

  /**
   * Keyed by what the row MEANS, not by how it is spelled.
   *
   * "bag" and "bags" are separate rows with the same kilogram equivalent, and
   * keying on the name produced two near-identical claims -- one of them
   * reading "One bags is recorded as 100 kg", which is both duplicated and
   * ungrammatical. Collapsing on commodity plus weight keeps one.
   */
  const best = new Map<string, typeof named[number]>()
  for (const r of named) {
    const key = `${r.commodity?.toLowerCase() ?? ''}|${r.kg_equivalent}`
    const current = best.get(key)
    const better = !current
      || (commodity && r.commodity?.toLowerCase() === commodity.toLowerCase()
          && current.commodity?.toLowerCase() !== commodity.toLowerCase())
    if (better) best.set(key, r)
  }

  return [...best.values()].slice(0, 3).map((r) => ({
    level: 1 as const,
    claim:
      `One ${r.unit_name}${r.commodity ? ` of ${r.commodity}` : ''}`
      + `${r.region ? ` in ${r.region}` : ''} is recorded as ${r.kg_equivalent} kg on Loamy.`,
    source: 'Loamy commodity units',
    numbers: [Number(r.kg_equivalent)],
  }))
}

export interface GatherOptions {
  client: EvidenceClient
  userId: string | null
  classification: Classification
  message: string
}

/* ---------------------------------------------------------------------------
 * Marketplace listings
 * ------------------------------------------------------------------------ */

/**
 * What sellers currently have on offer.
 *
 * WHY A SEPARATE READER FROM THE PRICE ONE
 *   A listing price is what ONE seller is asking. A market price update is a
 *   recorded observation of what a commodity trades at. Presenting the first
 *   as the second would make Loamy the source of a benchmark it never
 *   measured, which is the most consequential mistake available on this
 *   surface. The two readers, their claim wording and their attributions stay
 *   separate, and tests assert the wording rather than trusting it.
 *
 * WHY THE VIEW AND NOT THE TABLE
 *   `loamy_public_listings` is the surface the marketplace UI already reads.
 *   It joins only the seller's PUBLIC profile columns -- display name,
 *   category, verified badge -- and filters `status = 'active'` itself, so
 *   "active only" is a property of the source rather than a filter this reader
 *   could forget to apply. The listings migration carries an explicit security
 *   note that seller identity must come from the public view and never from
 *   `profiles`; reading the view is how that note is honoured. No contact
 *   column exists on it, so there is none to leak.
 */
const LISTING_SOURCE = 'Loamy marketplace listings (seller asking prices)'

/** Public columns only, named explicitly so a widened view cannot widen this. */
const LISTING_COLUMNS = [
  'commodity', 'quantity', 'unit', 'price_per_unit', 'currency',
  'state', 'lga', 'created_at', 'seller_display_name', 'seller_verified',
].join(', ')

/** Rows pulled to describe the offer. The exact total comes from `count`. */
const LISTING_SAMPLE = 12
/** How many individual listings are ever described to the model. */
const LISTING_IN_PROMPT = 3

/** Words that make a message a question about what is on offer. */
const LISTING_INTENT =
  /\b(listing|listings|listed|available|availability|in stock|stock|for sale|on sale|selling|sells|seller|sellers|supplier|suppliers|vendor|vendors|who has|offer|offers|offering|asking)\b/i

/**
 * Price questions that belong to the price reader.
 *
 * "what is the official maize market price?" must never be answered with what
 * two sellers happen to be asking today.
 */
const OFFICIAL_PRICE =
  /\b(official|benchmark|verified|recorded|reference|historical|market price|market rate|going rate)\b|\bprice (of|for)\b/i

/**
 * Moving goods, which is a different question from buying them.
 *
 * WHY THIS GUARD EXISTS
 *   "Are there transport offers for maize?" and "what transport is available?"
 *   both reached the listings reader, because LISTING_INTENT matches `offers`
 *   and `available`. A live turn logged as `"transport offers"` was duly
 *   answered with six Level 1 marketplace claims -- seller asking prices
 *   presented as the answer to a haulage question. That is one reader's
 *   evidence masquerading as another's, and it is worse than declining.
 *
 * WHY IT DECLINES RATHER THAN ANSWERING
 *   There is no logistics evidence to answer from. `transport_jobs` and
 *   `transport_offers` are private procurement records -- RLS is participant
 *   only, and a farmer, a buyer and a logistics provider each see zero rows --
 *   and `service_directory` holds 23 warehouses and no logistics providers at
 *   all. So the honest outcome is no evidence, not a reader over data that
 *   cannot support the question.
 */
const TRANSPORT_INTENT =
  /\b(transport|transporter|haulage|haul|freight|logistics|truck|trucks|lorry|trailer|delivery|deliver|deliveries|shipping|ship|move|moving|carry|carrier|convey|pickup|drop-?off|route|routes)\b/i

/** Carries no topic, so "maize in Kaduna" still reads as a browse. */
const LISTING_FILLER = new Set([
  'in', 'at', 'on', 'from', 'near', 'around', 'the', 'a', 'an', 'any', 'all',
  'some', 'me', 'my', 'show', 'find', 'get', 'is', 'are', 'there', 'please',
  'state', 'available',
])

/**
 * Whether a message is asking what is on offer.
 *
 * Deliberately NOT broad. "what is rice?" is definitional and must keep
 * reaching the knowledge pack. A bare commodity -- "rice", "maize in Kaduna"
 * -- has no other plausible reading than "what is there", so it routes here
 * instead of being declined, which is what a live session did to it.
 */
export function wantsListings(
  message: string,
  commodity?: string | null,
  state?: string | null,
): boolean {
  if (OFFICIAL_PRICE.test(message)) return false
  // Checked BEFORE listing intent: "transport offers" contains `offers`, and
  // whichever test runs first decides the answer.
  if (TRANSPORT_INTENT.test(message)) return false
  if (LISTING_INTENT.test(message)) return true
  if (!commodity) return false

  const allowed = new Set(LISTING_FILLER)
  for (const w of commodity.toLowerCase().split(/\s+/)) allowed.add(w)
  if (state) for (const w of state.toLowerCase().split(/\s+/)) allowed.add(w)

  const words = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return words.length > 0 && words.every((w) => allowed.has(w))
}

interface ListingRow {
  commodity: string
  quantity: number | null
  unit: string | null
  price_per_unit: number | null
  state: string | null
  lga: string | null
  created_at: string | null
  seller_display_name: string | null
  seller_verified: boolean | null
}

/** The standing sentence that keeps an asking price from reading as a rate. */
const ASKING_NOT_MARKET =
  'These are prices individual sellers are asking, not a verified Loamy market price.'

/** `1 listing` / `2 listings`. Evidence is paraphrased, so it has to read well. */
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

export async function listingEvidence(
  client: EvidenceClient,
  commodity: string | null,
  state: string | null,
): Promise<EvidenceItem[]> {
  let q = client
    .from('loamy_public_listings')
    .select(LISTING_COLUMNS, { count: 'exact' })
  if (commodity) q = q.ilike('commodity', commodity)
  // State only. `lga` is populated on 370 of 418 live rows, so filtering on it
  // would silently hide the rest; it is carried as context, never as a filter.
  if (state) q = q.ilike('state', state)

  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .limit(LISTING_SAMPLE)
  if (error) return []

  const rows = (data as unknown as ListingRow[]) ?? []
  const total = typeof count === 'number' ? count : rows.length
  const subject = commodity ?? 'commodity'
  const where = state ? ` in ${state}` : ''

  if (!total) {
    /**
     * "No maize in Kaduna" and "no maize at all" are different answers, so
     * when a state narrowed the search, establish which one is true.
     */
    if (commodity && state) {
      const { count: anywhere } = await client
        .from('loamy_public_listings')
        .select('commodity', { count: 'exact', head: true })
        .ilike('commodity', commodity)
      if (typeof anywhere === 'number' && anywhere > 0) {
        return [{
          level: 1,
          claim:
            `Loamy has no active ${subject} listings in ${state} at the moment. `
            + `It has ${anywhere} active ${subject} ${plural(anywhere, 'listing')} `
            + 'in other states.',
          source: LISTING_SOURCE,
          numbers: [anywhere],
        }]
      }
    }
    return [{
      level: 1,
      claim: `Loamy has no active ${subject} listings${where} at the moment.`,
      source: LISTING_SOURCE,
    }]
  }

  const out: EvidenceItem[] = [{
    level: 1,
    claim:
      `Loamy currently has ${total} active ${subject} `
      + `${plural(total, 'listing')}${where}.`,
    source: LISTING_SOURCE,
    numbers: [total],
  }]

  /**
   * Asking prices, grouped BY UNIT.
   *
   * The live data mixes tonne, kg and bags. A price per tonne and a price per
   * kg inside one range would be arithmetic nonsense, so grouping here is
   * correctness rather than presentation.
   */
  const byUnit = new Map<string, number[]>()
  for (const r of rows) {
    if (typeof r.price_per_unit !== 'number' || !r.unit) continue
    const seen = byUnit.get(r.unit) ?? []
    seen.push(r.price_per_unit)
    byUnit.set(r.unit, seen)
  }
  for (const [unit, prices] of [...byUnit.entries()].slice(0, 3)) {
    const lo = Math.min(...prices)
    const hi = Math.max(...prices)
    out.push({
      level: 1,
      claim:
        (rows.length === 1
          ? `The most recent ${subject} listing${where} is asking `
          : `Among the ${rows.length} most recent ${subject} listings${where}, sellers are asking `)
        + (lo === hi
          ? `${naira(lo)} per ${unit}`
          : `between ${naira(lo)} and ${naira(hi)} per ${unit}`)
        + `. ${ASKING_NOT_MARKET}`,
      source: LISTING_SOURCE,
      numbers: lo === hi ? [lo] : [lo, hi],
    })
  }

  /** Who is offering. Display name and badge only; this view has no contact. */
  const sellers = [...new Set(
    rows.map((r) => r.seller_display_name).filter((n): n is string => Boolean(n)),
  )]
  if (sellers.length) {
    const verified = rows.filter((r) => r.seller_verified === true).length
    out.push({
      level: 1,
      claim:
        `${sellers.length} ${plural(sellers.length, 'seller')} `
        + `${plural(sellers.length, 'has', 'have')} ${subject} among those `
        + `${plural(rows.length, 'listing')}${where}: ${sellers.slice(0, 5).join(', ')}. `
        + (verified === 0
          ? 'None of those listings is from a seller with a Loamy verified badge.'
          : `${verified} of those listings ${plural(verified, 'is', 'are')} `
            + 'from a seller with a Loamy verified badge.'),
      source: LISTING_SOURCE,
      numbers: [sellers.length],
    })
  }

  /**
   * A few concrete examples, never the whole set, and never the same one
   * twice.
   *
   * The six newest Rice rows on staging are identical in every field a user
   * sees -- Rice, 100 kg, NGN 900, Benue, no LGA -- differing only by id and
   * timestamp. Taking the first three produced three claims that read the
   * same, and the model duly repeated itself. Deduplicating on the VISIBLE
   * tuple is the fix; asking the model to notice the repetition is not.
   */
  const seen = new Set<string>()
  const distinct = rows.filter((r) => {
    const key = [r.commodity, r.quantity, r.unit, r.price_per_unit, r.state, r.lga].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  for (const r of distinct.slice(0, LISTING_IN_PROMPT)) {
    const parts: string[] = [r.commodity]
    if (r.quantity && r.unit) parts.push(`${r.quantity} ${r.unit}`)
    if (typeof r.price_per_unit === 'number' && r.unit) {
      parts.push(`asking ${naira(r.price_per_unit)} per ${r.unit}`)
    }
    if (r.state) parts.push(r.lga ? `${r.lga}, ${r.state}` : r.state)
    out.push({
      level: 1,
      claim: `One active listing: ${parts.join(', ')}.`,
      source: LISTING_SOURCE,
      asOf: iso(r.created_at),
      numbers: typeof r.price_per_unit === 'number' ? [r.price_per_unit] : undefined,
    })
  }

  return out
}

/**
 * The catalogue, for "what is currently listed?" with no commodity named.
 *
 * Aggregated HERE. The breakdown reaches the model as one sentence; the rows
 * behind it never do.
 */
export async function listingCatalogueEvidence(
  client: EvidenceClient,
): Promise<EvidenceItem[]> {
  const { data, count, error } = await client
    .from('loamy_public_listings')
    .select('commodity', { count: 'exact' })
    .limit(500)
  if (error) return []

  const rows = (data as unknown as { commodity: string }[]) ?? []
  if (!rows.length) {
    return [{
      level: 1,
      claim: 'Loamy has no active listings at the moment.',
      source: LISTING_SOURCE,
    }]
  }

  const tally = new Map<string, number>()
  for (const r of rows) tally.set(r.commodity, (tally.get(r.commodity) ?? 0) + 1)
  const breakdown = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} (${n})`)
    .join(', ')

  return [{
    level: 1,
    claim:
      `Loamy currently has ${typeof count === 'number' ? count : rows.length} active listings. `
      + `By commodity: ${breakdown}. Loamy does not list livestock.`,
    source: LISTING_SOURCE,
    numbers: [typeof count === 'number' ? count : rows.length],
  }]
}

/**
 * Whether answering needs a fact only Loamy can supply.
 *
 * WHY THIS IS NOT AN INTENT ROUTER
 *   The old design asked "does a reader match this phrasing?" and refused
 *   when none did, so "when should I plant maize in Kaduna?" was answered and
 *   "when should I plant in Kaduna" was declined -- one word apart. This asks
 *   a different and much smaller question: does the honest answer depend on
 *   something CURRENT, PRIVATE, TRANSACTIONAL or LOAMY-SPECIFIC? Everything
 *   else is ordinary knowledge and needs no permission from a reader.
 *
 *   It is deliberately a handful of data-dependency signals, not a phrase
 *   table. Getting it wrong in the `null` direction costs a general answer
 *   where a record existed; getting it wrong the other way costs a decline.
 *   Neither can produce an invented record, because the readers are still the
 *   only thing that can state one.
 */
export type ControlledNeed = 'private' | 'current_price' | 'marketplace' | 'platform'

/** Possessive or first-person framing about the reader's own records. */
const PRIVATE_SENSE =
  /\b(my|mine|i have|i've|i posted|i listed|i uploaded|i added|i own|on my|for me)\b/i

/** Asks what something costs, or costs right now. */
const PRICE_SENSE =
  /\b(price|prices|pricing|cost|costs|costing|rate|rates|worth|selling for|going for|farashi|nawa|kud[ie])\b/i

export function needsControlledData(
  message: string,
  c: Pick<Classification, 'demand' | 'namedCommodity' | 'state'>,
): ControlledNeed | null {
  // The reader's own records. `demand === 'personal'` already encodes the
  // classifier's view; the possessive test catches phrasings it misses.
  if (c.demand === 'personal' || PRIVATE_SENSE.test(message)) return 'private'

  // The platform itself -- required because the model answers "Loamy" with
  // soil science when left to its own knowledge. Soil questions excluded.
  if (PLATFORM_NAME.test(message) && !SOIL_SENSE.test(message) && ASKING.test(message)) {
    return 'platform'
  }

  // What something costs. A price question is always a current-data question;
  // model knowledge must never stand in for a recorded figure.
  if (PRICE_SENSE.test(message)) return 'current_price'

  // What is on offer, who is selling, what is available.
  if (wantsListings(message, c.namedCommodity, c.state)) return 'marketplace'

  return null
}

/**
 * Collect everything that could back an answer, cheapest first.
 *
 * Only reads what the question needs: a personal question does not fetch price
 * history, and a general question touches the database not at all. That keeps
 * the prompt inside its budget and keeps Loam off tables it has no reason to
 * open for this turn.
 */
export async function gatherEvidence(opts: GatherOptions): Promise<EvidenceItem[]> {
  const { client, userId, classification: c, message } = opts
  const evidence: EvidenceItem[] = knowledgeEvidence(c, message)

  /**
   * What Loamy is, gathered before the `personal` early-return so a product
   * question carries it whatever the demand. Whether it can JUSTIFY an answer
   * stays the gate's decision via REQUIRED_LEVEL -- a personal question still
   * needs Level 1, and this is Level 2.
   */
  evidence.push(...platformEvidence(message, c.namedCommodity))

  // A forecast is refused upstream, but the OBSERVED record is still gathered:
  // "Loamy does not predict prices" is far more useful delivered alongside what
  // the prices have actually been.
  if (c.demand === 'personal') {
    if (!userId) return evidence
    const farms = await farmEvidence(client, userId)
    evidence.push(...farms)
    // Farm ids are needed to scope crop records and are not themselves shown.
    const { data } = await client.from('farms').select('id').eq('owner_id', userId).limit(10)
    const ids = ((data as { id: string }[] | null) ?? []).map((r) => r.id)
    evidence.push(...(await cropRecordEvidence(client, ids)))
    return evidence
  }

  /**
   * Triggered by THIS message asking about price; the subject may then be the
   * inherited one, so "and what about in Kano?" still works as a follow-up.
   * An inherited commodity alone can never trigger it.
   */
  if (PRICE_SENSE.test(message) && c.commodity) {
    /**
     * Two price sources, deliberately ordered.
     *
     * `market_price_updates` is what members actually record today, and on
     * staging it is the only one with rows. `market_prices_history` is the
     * uploaded reference dataset behind the Co-pilot's seasonal analysis; its
     * provenance, span and licence are NOT established by this repository (see
     * docs/loam-architecture.md section 12), and it is empty on staging. Both
     * are read, both fail closed, and neither is described as more than it is.
     */
    evidence.push(...(await marketPriceEvidence(client, c.commodity, c.state)))
    evidence.push(...(await priceEvidence(client, c.commodity, c.state)))
  }

  /**
   * Migrated capabilities, read for every non-personal question because both
   * are cheap and both fail closed when nothing matches.
   */
  evidence.push(...(await conceptEvidence(client, message, c.language)))
  evidence.push(...(await unitEvidence(client, message, c.commodity)))

  /**
   * What is actually on offer.
   *
   * Reached only when the message asks about availability. A definitional
   * question ("what is rice?") and a market-price question keep their own
   * readers, because a seller's asking price is not an answer to either.
   */
  if (wantsListings(message, c.namedCommodity, c.state)) {
    evidence.push(...(c.commodity
      ? await listingEvidence(client, c.commodity, c.state)
      : await listingCatalogueEvidence(client)))
  }

  return evidence
}
