import type { CopilotChart, CopilotLanguage, DataSourceRef } from '@/lib/copilot/types'
import {
  distinctBatchIds,
  latestRecord,
  monthName,
  recentDirection,
} from '@/lib/copilot/analysis'
import {
  detectLanguage,
  extractCommodity,
  extractState,
  phraseClarifyCommodity,
  phraseFixed,
  phraseNoData,
  type FixedPhraseKey,
} from '@/lib/copilot/language'
import {
  findOverride,
  retrieveActiveEvents,
  retrieveConcept,
  retrieveCrossMarket,
  retrievePriceContext,
  retrieveRecentPrices,
} from '@/lib/copilot/retrieval'
import { fetchValidatedFor, fetchUnits, perUnitLabel} from '@/lib/ambassador'

export type CopilotIntent =
  | 'price_check' | 'advice' | 'compare' | 'convert' | 'concept' | 'navigation'
  | 'rfq' | 'buy_request' | 'logistics' | 'market_update' | 'unknown'

export interface AssistantResult {
  intent: CopilotIntent
  /** 'answer' = data answer; 'clarify' = need more input; 'unanswered' = no data
   * (log to flagged_questions); 'draft' = an action draft awaiting confirmation. */
  kind: 'answer' | 'clarify' | 'unanswered' | 'draft'
  language: CopilotLanguage
  content: string
  dataSources: DataSourceRef[]
  dataAsOf: string | null
  wasAnswered: boolean
  /** For rfq / logistics: the collected slots the UI turns into a draft. */
  slots?: Record<string, string | number | null>
  /** Set when the whole answer is a FIXED phrase — enables a voice clip if one
   * has been recorded for (language, phraseKey). Dynamic answers leave it unset. */
  phraseKey?: FixedPhraseKey
  /** Observed price-history chart (Price Check only), annotated with real events. */
  chart?: CopilotChart
  /** The commodity this answer was about — lets the UI carry context for
   * follow-ups like "and sorghum?". */
  commodity?: string
  /** A dashboard path the UI can deep-link to (navigation help). */
  deepLink?: string
}

const has = (t: string, words: string[]) => words.some((w) => t.includes(w))

export function parseIntent(text: string): CopilotIntent {
  const t = ` ${text.toLowerCase()} `
  // Concept / explain ("what is Murabaha", "menene digital ID")
  if (has(t, ['what is', 'what does', 'explain', 'why do i need', 'why do i have to', 'menene', 'me ake nufi', 'mene ne'])) return 'concept'
  // Navigation / how-to
  if (has(t, ['how do i', 'how can i', 'how to ', 'where do i', 'yaya zan', 'ina zan'])) return 'navigation'
  // Unit conversion ("how many mudu in a bag", "₦33,000 per bag in naira per kg")
  if (has(t, ['how many', 'convert', 'per kg', 'in kg', 'in naira per', 'nawa a kilo']) && has(t, ['mudu', 'tiya', 'bag', 'basket', 'kg', 'crate', 'kilo'])) return 'convert'
  // Advice / "is this a good price" → COMPARISON, never instruction
  if (has(t, ['should i sell', 'should i buy', 'good price', 'fair price', 'is this a good', 'am i being cheated', 'worth it', 'ya kamata', 'zan sayar', 'kyakkyawan farashi'])) return 'advice'
  // Cross-market comparison
  if (has(t, ['cheapest', 'cheaper', 'where is', 'which market', 'compare', 'mafi arha', 'ina ne'])) return 'compare'
  if (has(t, ['transport', 'deliver', 'delivery', 'haulage', 'truck', 'logistics', 'pickup', 'jigila', 'kai '])) return 'logistics'
  if (has(t, ['sell', 'list', 'listing', 'rfq', 'i want to sell', 'post ', 'sayar', 'ina son sayar'])) return 'rfq'
  if (has(t, ['want to buy', 'looking to buy', 'buy request', 'need to buy', 'sourcing', 'source ', 'ina son saya', 'neman saya'])) return 'buy_request'
  if (has(t, ['update', 'latest news', "what's happening", 'whats happening', 'market news', 'labarai'])) return 'market_update'
  if (has(t, ['price', 'cost', 'how much', 'rate', 'worth', 'farashi', 'nawa', 'kudin', 'wetin be'])) return 'price_check'
  return 'unknown'
}

const num = (s: string) => Number(s.replace(/,/g, ''))

function extractTradeSlots(text: string): Record<string, string | number | null> {
  const qty = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(kg|kilos?|bags?|tonnes?|tons?|litres?|liters?|units?)/i)
  const price = text.match(/₦\s?(\d[\d,]*)|(\d[\d,]*)\s*(?:naira|ngn)/i)
  return {
    commodity: extractCommodity(text),
    quantity: qty ? num(qty[1]) : null,
    unit: qty ? qty[2].toLowerCase() : null,
    price_expectation: price ? num(price[1] ?? price[2]) : null,
    state: extractState(text) ?? null,
  }
}

const MONTHS_HA = ['Janairu', 'Faburairu', 'Maris', 'Afrilu', 'Mayu', 'Yuni', 'Yuli', 'Agusta', 'Satumba', 'Oktoba', 'Nuwamba', 'Disamba']
const mName = (m: number, lang: CopilotLanguage) => (lang === 'ha' ? MONTHS_HA[m - 1] ?? String(m) : monthName(m))

function positionWord(mid: number, lo: number, hi: number, lang: CopilotLanguage): string {
  if (mid < lo) return lang === 'ha' ? 'ƙasa da matsakaicin farashi' : 'below the normal range'
  if (mid > hi) return lang === 'ha' ? 'sama da matsakaicin farashi' : 'above the normal range'
  return lang === 'ha' ? 'a tsakiyar matsakaicin farashi' : 'in the middle of the normal range'
}

/**
 * FLAGSHIP: "is this a good price?" — a COMPARISON, never a forecast or advice.
 * Presents the current local (ambassador) price and the historical normal range
 * for this month as separate labelled facts, states where the price sits, and
 * the seasonal pattern. With opts.advice it ends by handing the decision back.
 */
async function answerPriceCheck(
  text: string,
  language: CopilotLanguage,
  opts: { advice?: boolean; commodity?: string } = {},
): Promise<AssistantResult> {
  const commodity = opts.commodity ?? extractCommodity(text)
  const state = extractState(text) ?? undefined
  if (!commodity) {
    return { intent: 'price_check', kind: 'clarify', language, content: phraseClarifyCommodity(language), dataSources: [], dataAsOf: null, wasAnswered: true, phraseKey: 'clarify_commodity' }
  }

  const [amb, ctx] = await Promise.all([fetchValidatedFor(commodity, state), retrievePriceContext(commodity, state)])
  if (!amb && (!ctx || ctx.row_count === 0)) {
    return { intent: 'price_check', kind: 'unanswered', language, content: phraseNoData(commodity, state, language), dataSources: [], dataAsOf: null, wasAnswered: false, commodity }
  }

  const lines: string[] = []
  const dataSources: DataSourceRef[] = []
  let dataAsOf: string | null = null
  let ambMid: number | null = null

  // 1) Current LOCAL price (ambassador) — a labelled fact.
  if (amb) {
    const lo = Number(amb.price_low).toLocaleString('en-NG'), hi = Number(amb.price_high).toLocaleString('en-NG')
    const kglo = Number(amb.price_low_per_kg).toFixed(0), kghi = Number(amb.price_high_per_kg).toFixed(0)
    ambMid = (Number(amb.price_low_per_kg) + Number(amb.price_high_per_kg)) / 2
    const variety = amb.variety_name ? `${amb.variety_name} ` : ''
    const where = `${amb.market_name}${amb.state ? `, ${amb.state}` : ''}`
    // A quoted lot may cover several units (e.g. 2 tonnes) — say so, or the
    // per-unit figure reads as a single-unit price.
    const per = perUnitLabel(amb.quantity, amb.unit)
    lines.push(language === 'ha'
      ? `${variety}${commodity} a ${where} yana ₦${lo}–₦${hi} kowace ${per} yau (₦${kglo}–₦${kghi}/kg), a cewar jakadan Loamy a ${amb.observed_date}.`
      : `${variety}${commodity} in ${where} is ₦${lo}–₦${hi} per ${per} today (₦${kglo}–₦${kghi}/kg), reported by a Loamy ambassador on ${amb.observed_date}.`)
    dataSources.push({ table: 'market_price_updates', source: 'Loamy ambassador', row_count: 1 })
    dataAsOf = amb.observed_date
  }

  // 2) HISTORICAL position — over the LAST 24 MONTHS, with a sanity guard.
  // SECURITY-REVIEW: range sanity guard — prevents devaluation-inflated ranges
  // being presented as normal (a >2.5x spread is treated as insufficient data).
  let rangeShown = false
  if (ctx && ctx.row_count > 0) {
    const lo = ctx.recent_low != null ? Number(ctx.recent_low) : null
    const hi = ctx.recent_high != null ? Number(ctx.recent_high) : null
    const enough = ctx.recent_months >= 6 && lo != null && hi != null && lo > 0
    const sane = enough && (hi as number) / (lo as number) <= 2.5
    const scope = state ? (language === 'ha' ? 'a wannan yanki' : 'in this area') : (language === 'ha' ? 'a faɗin ƙasa' : 'nationally')

    // Seasonal sentence (devaluation-proof ratios) — safe in every case.
    const hasSeasonal = ctx.cheapest_month && ctx.dearest_month && ctx.cheapest_month !== ctx.dearest_month
    const seasonalSentence = hasSeasonal
      ? (language === 'ha'
          ? `bisa yanayi, ${commodity} yakan yi arha kusa da ${mName(ctx.cheapest_month as number, language)} kuma ya fi tsada kusa da ${mName(ctx.dearest_month as number, language)}`
          : `seasonally, ${commodity} is usually cheapest around ${mName(ctx.cheapest_month as number, language)} and dearest around ${mName(ctx.dearest_month as number, language)}`)
      : null

    if (sane) {
      const ref = ambMid ?? Number(ctx.recent_avg)
      const pos = positionWord(ref, lo as number, hi as number, language)
      lines.push(language === 'ha'
        ? `A cikin watanni 24 da suka gabata ${scope}, ${commodity} (retail) ya kai ₦${lo}–₦${hi}/kg. Da ₦${ref.toFixed(0)}/kg, ${amb ? 'kana' : 'farashin yana'} ${pos}.`
        : `Over the last 24 months ${scope}, ${commodity} retail has traded ₦${lo}–₦${hi}/kg. At ₦${ref.toFixed(0)}/kg ${amb ? "you're" : "it's"} ${pos}.`)
      rangeShown = true
      if (seasonalSentence) {
        lines.push(language === 'ha' ? `${seasonalSentence[0].toUpperCase()}${seasonalSentence.slice(1)}.` : `${seasonalSentence[0].toUpperCase()}${seasonalSentence.slice(1)}.`)
      }
    } else {
      // Blocked by the guard — name WHY, give what we DO have, and what fixes it.
      const reason = enough // enough months but spread too wide → devaluation
        ? (language === 'ha'
            ? `Farashin ${commodity} ya yi ta canzawa da yawa kwanan nan, don haka ba zan iya ba da matsakaicin farashi mai aminci ba - faɗuwar Naira ta 2024–2026 ta sa tsofaffin farashi ba su dace da kwatanci ba.`
            : `${commodity} prices have moved too much recently to give a reliable normal range - the naira devaluation of 2024–2026 makes older prices non-comparable.`)
        : (language === 'ha'
            ? `Ba ni da isassun sabbin rubuce-rubucen farashin ${commodity}${state ? ` a ${state}` : ''} - rubuce-rubucen sun kai ${ctx.latest_date} kaɗai.`
            : `I don't have recent enough recorded ${commodity} prices${state ? ` in ${state}` : ''} - the recorded series only runs to ${ctx.latest_date}.`)
      const have = seasonalSentence
        ? (language === 'ha' ? ` Abin da zan iya faɗa: ${seasonalSentence}.` : ` What I can tell you: ${seasonalSentence}.`)
        : ''
      // Point at what fixes it (only when there's no local price yet).
      const fix = !amb
        ? (language === 'ha'
            ? ` Da zarar jakadu sun fara ba da farashin gida, zan iya gaya maka ko farashin yau na yau da kullum ne a kasuwarka.`
            : ` Once ambassadors are reporting local prices, I'll be able to tell you whether today's price is normal for your market.`)
        : ''
      lines.push(`${reason}${have}${fix}`)
    }
    dataSources.push({ table: 'market_prices_history', source: 'WFP/FEWS NET', row_count: ctx.row_count })
    if (!dataAsOf) dataAsOf = ctx.latest_date
  }

  if (opts.advice) {
    lines.push(language === 'ha' ? 'Wannan shi ne hoton. Shawarar tana hannunka.' : "That's the picture. The decision is yours.")
  }

  if (ctx && ctx.row_count > 0) {
    lines.push(language === 'ha'
      ? `- Tarihi: WFP/FEWS NET, ${ctx.years_from}–${ctx.years_to}.${amb ? ` Farashin gida: jakadan Loamy, ${amb.observed_date}.` : ''}`
      : `- Historical: WFP/FEWS NET, ${ctx.years_from}–${ctx.years_to}.${amb ? ` Local: Loamy ambassador, ${amb.observed_date}.` : ''}`)
  }

  // Seasonal-shape chart, scaled to current price level (index × recent avg).
  let chart: CopilotChart | undefined
  if (ctx && ctx.seasonal && ctx.seasonal.length >= 6 && ctx.recent_avg) {
    const avg = Number(ctx.recent_avg)
    chart = { points: ctx.seasonal.map((s) => ({ key: monthName(s.month).slice(0, 3), price: Math.round(Number(s.index) * avg) })), events: [], unit: '/kg (typical)' }
  }

  // A price with an ambassador reading is answered; if we could only say "not
  // enough recent data", mark it unanswered so it is logged for review.
  const wasAnswered = amb ? true : rangeShown
  return { intent: opts.advice ? 'advice' : 'price_check', kind: 'answer', language, content: lines.join('\n\n'), dataSources, dataAsOf, wasAnswered, chart, commodity }
}

// --- Additional capabilities -------------------------------------------------

async function answerConcept(text: string, language: CopilotLanguage): Promise<AssistantResult> {
  const c = await retrieveConcept(text, language)
  if (!c) {
    return { intent: 'concept', kind: 'unanswered', language, content: language === 'ha' ? 'Ba ni da bayani a kan hakan tukuna. Na ajiye tambayarka domin ƙungiyar Loamy.' : "I don't have an explanation for that yet - I've logged it for the Loamy team.", dataSources: [], dataAsOf: null, wasAnswered: false }
  }
  return { intent: 'concept', kind: 'answer', language, content: `${c.title}\n\n${c.body}`, dataSources: [], dataAsOf: null, wasAnswered: true }
}

function kgForUnit(units: { unit_name: string; commodity: string | null; kg_equivalent: number }[], unitName: string, commodity?: string): number | null {
  const cands = units.filter((u) => u.unit_name.toLowerCase() === unitName.toLowerCase())
  const specific = commodity ? cands.find((u) => u.commodity && u.commodity.toLowerCase() === commodity.toLowerCase()) : undefined
  const generic = cands.find((u) => !u.commodity)
  return (specific ?? generic ?? cands[0])?.kg_equivalent ?? null
}

async function answerConvert(text: string, language: CopilotLanguage): Promise<AssistantResult> {
  const units = await fetchUnits()
  const commodity = extractCommodity(text) ?? undefined
  const t = text.toLowerCase()
  const mentioned = [...new Set(units.map((u) => u.unit_name.toLowerCase()))].filter((u) => t.includes(u))
  const money = text.match(/₦\s?([\d,]+)|([\d,]+)\s*(?:naira|ngn)/i)
  const na = (s: string) => Number(s.replace(/,/g, ''))
  const fmt = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`

  // "₦N per <unit> in ₦/kg"
  if (money && mentioned.length >= 1) {
    const unit = mentioned.find((u) => u !== 'kg') ?? mentioned[0]
    const kg = kgForUnit(units, unit, commodity)
    if (kg) {
      const amount = na(money[1] ?? money[2])
      const perKg = amount / kg
      return { intent: 'convert', kind: 'answer', language, content:
        language === 'ha' ? `${fmt(amount)} kowace ${unit}${commodity ? ` na ${commodity}` : ''} (≈${kg}kg) = ${fmt(perKg)}/kg.`
                          : `${fmt(amount)} per ${unit}${commodity ? ` of ${commodity}` : ''} (≈${kg}kg) = ${fmt(perKg)}/kg.`,
        dataSources: [], dataAsOf: null, wasAnswered: true }
    }
  }
  // "how many <A> in a <B>"
  if (mentioned.length >= 2) {
    const [a, b] = mentioned
    const kgA = kgForUnit(units, a, commodity), kgB = kgForUnit(units, b, commodity)
    if (kgA && kgB) {
      const count = kgB / kgA
      return { intent: 'convert', kind: 'answer', language, content:
        language === 'ha' ? `${b}${commodity ? ` na ${commodity}` : ''} (≈${kgB}kg) yana kusan ${count.toFixed(count < 10 ? 1 : 0)} ${a} (≈${kgA}kg kowanne).`
                          : `A ${b}${commodity ? ` of ${commodity}` : ''} (≈${kgB}kg) is about ${count.toFixed(count < 10 ? 1 : 0)} ${a} (≈${kgA}kg each).`,
        dataSources: [], dataAsOf: null, wasAnswered: true }
    }
  }
  return { intent: 'convert', kind: 'unanswered', language, content: language === 'ha' ? 'Faɗa mini ma’auni biyu (misali "mudu nawa a buhu na masara").' : 'Tell me two units to convert (e.g. "how many mudu in a bag of maize").', dataSources: [], dataAsOf: null, wasAnswered: false }
}

async function answerCompare(text: string, language: CopilotLanguage): Promise<AssistantResult> {
  const commodity = extractCommodity(text)
  const state = extractState(text) ?? undefined
  if (!commodity) {
    return { intent: 'compare', kind: 'clarify', language, content: phraseClarifyCommodity(language), dataSources: [], dataAsOf: null, wasAnswered: true, phraseKey: 'clarify_commodity' }
  }
  const rows = await retrieveCrossMarket(commodity, state)
  if (rows.length === 0) {
    return { intent: 'compare', kind: 'unanswered', language, content: language === 'ha' ? `Babu farashin ${commodity} da aka tabbatar daga jakadu tukuna.` : `No verified ambassador prices for ${commodity} yet.`, dataSources: [], dataAsOf: null, wasAnswered: false, commodity }
  }
  const c = rows[0]
  const list = rows.slice(0, 4).map((r) => `• ${r.market}${r.state ? `, ${r.state}` : ''}: ₦${r.low_per_kg.toFixed(0)}–₦${r.high_per_kg.toFixed(0)}/kg (${r.observed_date})`)
  const head = language === 'ha'
    ? `${commodity} mafi arha yanzu: ${c.market}${c.state ? `, ${c.state}` : ''} a ₦${c.low_per_kg.toFixed(0)}–₦${c.high_per_kg.toFixed(0)}/kg.`
    : `Cheapest ${commodity} right now: ${c.market}${c.state ? `, ${c.state}` : ''} at ₦${c.low_per_kg.toFixed(0)}–₦${c.high_per_kg.toFixed(0)}/kg.`
  return { intent: 'compare', kind: 'answer', language, content: `${head}\n\n${list.join('\n')}`, dataSources: [{ table: 'market_price_updates', source: 'Loamy ambassadors', row_count: rows.length }], dataAsOf: c.observed_date, wasAnswered: true, commodity }
}

function answerNavigation(text: string, language: CopilotLanguage): AssistantResult {
  const t = ` ${text.toLowerCase()} `
  const nav = (section: string, en: string, ha: string): AssistantResult =>
    ({ intent: 'navigation', kind: 'answer', language, content: language === 'ha' ? ha : en, dataSources: [], dataAsOf: null, wasAnswered: true, deepLink: section })
  if (has(t, ['financing', 'loan', 'murabaha', 'finance', 'apply'])) return nav('financing', 'To apply for financing, open Financing in your dashboard and start an application. Banks make all decisions - Loamy never lends.', 'Domin neman tallafi, buɗe Financing a dashboard ɗinka ka fara buƙata. Bankuna ne ke yanke shawara - Loamy ba ya ba da rance.')
  if (has(t, ['list', 'sell my', 'listing', 'post my'])) return nav('my-listings/new', 'To list produce, open My Listings and tap “New listing”. Add the commodity, quantity, price and photos.', 'Domin lissafa kaya, buɗe My Listings ka danna “New listing”.')
  if (has(t, ['verify', 'verification', 'verified'])) return nav('overview', 'Verification is done by a Growth Partner on the ground; once verified you get a badge buyers and banks trust.', 'Ana tabbatarwa ta hannun abokin haɓaka; bayan an tabbatar kana samun alama.')
  if (has(t, ['farm', 'my farm'])) return nav('my-farm', 'Add and manage your farms under My Farm - location, crops and verification status.', 'Ƙara da sarrafa gonakinka a ƙarƙashin My Farm.')
  return { intent: 'navigation', kind: 'unanswered', language, content: phraseFixed('capabilities', language), dataSources: [], dataAsOf: null, wasAnswered: false, phraseKey: 'capabilities' }
}

async function answerMarketUpdate(language: CopilotLanguage): Promise<AssistantResult> {
  const [rows, events] = await Promise.all([retrieveRecentPrices(150), retrieveActiveEvents()])
  if (rows.length === 0 && events.length === 0) {
    return { intent: 'market_update', kind: 'unanswered', language, content: phraseFixed('market_update_none', language), dataSources: [], dataAsOf: null, wasAnswered: false, phraseKey: 'market_update_none' }
  }

  const byCommodity = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byCommodity.get(r.commodity) ?? []
    list.push(r)
    byCommodity.set(r.commodity, list)
  }
  const movers = [...byCommodity.entries()]
    .map(([c, list]) => ({ c, dir: recentDirection(list), latest: latestRecord(list)! }))
    .filter((m) => m.dir)
    .sort((a, b) => Math.abs(b.dir!.changePct) - Math.abs(a.dir!.changePct))
    .slice(0, 5)

  const lines: string[] = []
  lines.push(language === 'ha' ? 'Sauye-sauyen farashi na baya-bayan nan:' : 'Recent recorded price movements:')
  for (const m of movers) {
    const arrow = m.dir!.changePct >= 0 ? '▲' : '▼'
    lines.push(`• ${m.c}: ${'₦'}${Number(m.latest.price_ngn_per_kg).toLocaleString('en-NG')}/kg ${arrow} ${Math.abs(m.dir!.changePct).toFixed(0)}%`)
  }
  if (events.length > 0) {
    lines.push(language === 'ha' ? 'Al’amuran kasuwa masu gudana:' : 'Active market events:')
    for (const e of events.slice(0, 4)) lines.push(`• ${e.event}${e.region ? ` (${e.region})` : ''}`)
  }

  const dataAsOf = latestRecord(rows)?.date ?? null
  const dataSources: DataSourceRef[] = [
    { table: 'market_prices_history', row_count: rows.length, batch_ids: distinctBatchIds(rows) },
  ]
  if (events.length) dataSources.push({ table: 'market_events', row_count: events.length })
  return { intent: 'market_update', kind: 'answer', language, content: lines.join('\n'), dataSources, dataAsOf, wasAnswered: true }
}

const DRAFT_COPY: Record<'rfq' | 'buy_request' | 'logistics', Record<CopilotLanguage, string>> = {
  rfq: {
    en: 'I can assemble this into a draft listing. Review the details below - nothing is published until you confirm.',
    ha: 'Zan iya tsara wannan talla. Tabbatar da bayanan sannan ka amince kafin a wallafa.',
  },
  buy_request: {
    en: 'I can post this as a buy request so sellers can respond. Review the details below - nothing is posted until you confirm.',
    ha: 'Zan iya tsara wannan a matsayin buƙatar saya domin masu sayarwa su amsa. Tabbatar da bayanan sannan ka amince.',
  },
  logistics: {
    en: 'I can prepare a logistics request. Review the details below - nothing is sent until you confirm.',
    ha: 'Zan iya tsara buƙatar jigila. Tabbatar da bayanan sannan ka amince.',
  },
}

function draftResult(intent: 'rfq' | 'buy_request' | 'logistics', text: string, language: CopilotLanguage): AssistantResult {
  const slots = extractTradeSlots(text)
  return { intent, kind: 'draft', language, content: DRAFT_COPY[intent][language], dataSources: [], dataAsOf: null, wasAnswered: true, slots }
}

// Planned-but-unbuilt capabilities: answer specifically + log (never the menu).
const UNBUILT: { keys: string[]; en: string; ha: string }[] = [
  { keys: ['weather', 'forecast'], en: 'Weather', ha: 'Yanayi' },
  { keys: [' rain', 'rainfall', 'rainy'], en: 'Rainfall', ha: 'Ruwan sama' },
  { keys: ['alert', 'notify me', 'notify when'], en: 'Price alerts', ha: 'Faɗakarwar farashi' },
  { keys: ['application status', 'my application', 'financing status', 'loan status'], en: 'Application status', ha: 'Matsayin buƙata' },
  { keys: ['my farm', 'farm summary', 'my farms'], en: 'Your farm summary', ha: 'Takaitaccen gonarka' },
]

function notYetBuilt(text: string, language: CopilotLanguage): AssistantResult {
  const t = ` ${text.toLowerCase()} `
  const cap = UNBUILT.find((c) => c.keys.some((k) => t.includes(k)))
  const name = language === 'ha' ? cap?.ha ?? 'Wannan' : cap?.en ?? 'That'
  const content = language === 'ha'
    ? `${name} bai samu tukuna ba - yana zuwa. A yanzu zan iya taimaka da farashin kaya, kwatanta kasuwanni, sauya ma’auni, da bayanin yadda Loamy ke aiki.`
    : `${name} isn't available yet - it's coming. Right now I can help with commodity prices, market comparisons, unit conversions and explaining how Loamy works.`
  return { intent: 'unknown', kind: 'unanswered', language, content, dataSources: [], dataAsOf: null, wasAnswered: false }
}

function explainReasoning(commodity: string, language: CopilotLanguage): AssistantResult {
  const content = language === 'ha'
    ? `Don ${commodity}, na kwatanta farashin yau da rubuce-rubucen watanni 24 da suka gabata (WFP/FEWS NET), sannan da tsarin yanayi - ana auna kowane wata da matsakaicin shekararsa, don haka faɗuwar Naira ba ta ɓata shi ba. Farashi yakan yi ƙasa bayan girbi ya yi tsayi kafin girbi.`
    : `For ${commodity} I compared the current price to the last 24 months of recorded retail prices (WFP/FEWS NET), and to the seasonal pattern - each month is measured against its own year's average, so naira devaluation doesn't distort it. Prices tend to be lowest after harvest and highest before the next one.`
  return { intent: 'price_check', kind: 'answer', language, content, dataSources: [{ table: 'market_prices_history', source: 'WFP/FEWS NET' }], dataAsOf: null, wasAnswered: true, commodity }
}

function oneClarify(language: CopilotLanguage): AssistantResult {
  return {
    intent: 'unknown', kind: 'clarify', language, wasAnswered: false, dataSources: [], dataAsOf: null,
    content: language === 'ha'
      ? 'Ban gane ba - kana tambaya ne game da farashin kaya, kwatancin kasuwa, ko yadda wani abu ke aiki a Loamy?'
      : "I'm not sure what you mean - are you asking about a commodity price, a market comparison, or how something on Loamy works?",
  }
}

/**
 * Main entry: turn a user message into an assistant result, ONLY from data.
 * Understands the whole message (BUG-3 fix): any known commodity routes to the
 * price flow regardless of surrounding words; follow-ups ("why", "and sorghum?",
 * "in Kano") carry session context; unbuilt capabilities are named honestly; the
 * capability menu is NEVER a fallback. Callers log when wasAnswered is false.
 */
export async function answer(text: string, appLanguage: CopilotLanguage = 'en', opts: { lastCommodity?: string } = {}): Promise<AssistantResult> {
  const language = detectLanguage(text, appLanguage)

  const override = await findOverride(text, language)
  if (override) {
    return { intent: 'unknown', kind: 'answer', language, content: override.answer, dataSources: [{ table: 'copilot_qa_overrides' }], dataAsOf: null, wasAnswered: true }
  }

  const t = ` ${text.toLowerCase()} `
  const explicit = extractCommodity(text)
  const carried = explicit ?? opts.lastCommodity
  const intent = parseIntent(text)

  // (3c) Planned-but-unbuilt capability → honest specific reply, not the menu.
  if (UNBUILT.some((c) => c.keys.some((k) => t.includes(k)))) return notYetBuilt(text, language)

  // (3b) "why / explain" with no new commodity → explain the last answer's reasoning.
  if (!explicit && has(t, ['why', 'how come', 'me ya sa'])) {
    if (opts.lastCommodity) return explainReasoning(opts.lastCommodity, language)
  }

  // Unit conversion works with or without a commodity.
  if (intent === 'convert') return answerConvert(text, language)

  // (3a) ANY commodity in the message → the price flow, regardless of wording.
  if (explicit) {
    if (intent === 'advice') return answerPriceCheck(text, language, { advice: true, commodity: explicit })
    if (intent === 'compare') return answerCompare(text, language)
    return answerPriceCheck(text, language, { commodity: explicit })
  }

  // No commodity in THIS message — resolve by intent, carrying context.
  if (intent === 'concept') return answerConcept(text, language)
  if (intent === 'navigation') return answerNavigation(text, language)
  if (intent === 'market_update') return answerMarketUpdate(language)
  if (intent === 'rfq' || intent === 'buy_request' || intent === 'logistics') return draftResult(intent, text, language)
  if (intent === 'advice' && carried) return answerPriceCheck(text, language, { advice: true, commodity: carried })
  if (intent === 'compare' && carried) return answerCompare(`${carried} ${text}`, language)

  // Follow-up like "and it?" / "in Kano" → reuse the last commodity (state, if
  // any, is picked up from the message inside answerPriceCheck).
  if (carried) return answerPriceCheck(text, language, { commodity: carried })

  // (3d) Nothing resolved → ONE clarifying question, never the capability menu.
  return oneClarify(language)
}
