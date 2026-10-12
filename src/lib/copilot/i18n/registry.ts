import { formatDateShort, formatNaira } from '@/lib/utils'
import { monthName, ymLabel, type DateCoverage, type RecentDirection, type SeasonalPattern } from '@/lib/copilot/analysis'
import type { CopilotLanguage } from '@/lib/copilot/types'

/**
 * Co-pilot phrase library, keyed by dialect. Adding a new dialect = add one
 * Dialect object to DIALECTS and (optionally) record its voice clips — no caller
 * changes. v1 ships English and Hausa in the Kananci (Kano) dialect, Boko script.
 *
 * `fixed` phrases are fully static (no interpolation) and are therefore the
 * candidates for pre-recorded voice clips (see i18n/voice.ts). Everything built
 * from data (prices, no-data-with-commodity) is dynamic and stays text-only.
 */

export const FIXED_PHRASE_KEYS = ['welcome', 'clarify_commodity', 'capabilities', 'market_update_none'] as const
export type FixedPhraseKey = (typeof FIXED_PHRASE_KEYS)[number]

export interface PriceCheckFacts {
  commodity: string
  state?: string
  latestPrice: number
  latestMarket?: string | null
  latestDate: string
  priceType: string
  direction?: RecentDirection | null
  seasonal?: SeasonalPattern | null
  coverage?: DateCoverage | null
}

export interface Dialect {
  /** BCP-47-ish code used for voice-clip folders, e.g. 'en', 'ha-KAN'. */
  code: string
  label: string
  fixed: Record<FixedPhraseKey, string>
  commodityLabel: (canonical: string) => string
  priceCheck: (f: PriceCheckFacts) => string
  noData: (commodity: string | null, state: string | undefined) => string
}

const pct = (n: number) => `${Math.abs(n).toFixed(n > -1 && n < 1 ? 1 : 0)}%`

// --- English -----------------------------------------------------------------

const EN: Dialect = {
  code: 'en',
  label: 'English',
  fixed: {
    welcome: 'Ask about a commodity price, request a market update, or start a listing or logistics draft.',
    clarify_commodity: 'Which commodity would you like the price for? For example: maize, rice, sorghum, cowpea…',
    capabilities:
      "I can help with commodity prices, drafting a listing, market updates, or a logistics request. I've logged your question for the Loamy team.",
    market_update_none: "There are no recent market records uploaded yet. I've logged your question.",
  },
  commodityLabel: (c) => c,
  priceCheck: (f) => {
    const where = f.state ? ` in ${f.state}` : ''
    const market = f.latestMarket ? `${f.latestMarket}, ` : ''
    const parts = [`Latest recorded ${f.commodity} price${where}: ${formatNaira(f.latestPrice)}/kg - ${market}${formatDateShort(f.latestDate)} (${f.priceType}).`]
    if (f.direction) parts.push(`That's ${f.direction.changePct >= 0 ? 'up' : 'down'} ${pct(f.direction.changePct)} since ${ymLabel(f.direction.fromKey)}.`)
    if (f.seasonal) parts.push(`Over the last ${f.seasonal.yearsCovered} years, ${f.commodity} has averaged about ${pct(f.seasonal.swingPct)} higher in ${monthName(f.seasonal.highMonth)} than in ${monthName(f.seasonal.lowMonth)}.`)
    return parts.join(' ')
  },
  noData: (commodity, state) => {
    const name = commodity ?? 'that commodity'
    const where = state ? ` in ${state}` : ''
    return `I don't have recorded price data for ${name}${where} in the uploaded dataset yet. I've logged your question so the Loamy team can add it.`
  },
}

// --- Hausa (Kananci / Kano dialect, Boko) ------------------------------------

const HAUSA_COMMODITY: Record<string, string> = {
  Maize: 'masara', Rice: 'shinkafa', Sorghum: 'dawa', Millet: 'gero',
  Cowpea: 'wake', Soybeans: 'waken soya', Groundnut: 'gyada', Sesame: 'ridi',
  Cassava: 'rogo', Yam: 'doya', Cocoa: 'koko', Ginger: 'citta',
  'Chili Pepper': 'barkono', Hibiscus: 'zobo', Onion: 'albasa', Tomato: 'tumatir',
}

const KANANCI: Dialect = {
  code: 'ha-KAN',
  label: 'Hausa (Kananci)',
  fixed: {
    welcome: 'Ka tambaya kan farashin kaya, ko labarin kasuwa, ko ka fara tsara talla ko buƙatar jigila.',
    clarify_commodity: 'Wanne kaya kake son sanin farashinsa? Misali: masara, shinkafa, dawa, wake…',
    capabilities:
      'Zan iya taimaka da farashin kaya, tsara talla, labaran kasuwa, ko buƙatar jigila. Na adana tambayarka domin ƙungiyar Loamy.',
    market_update_none: 'Babu sabbin bayanan kasuwa da aka loda tukuna. Na adana tambayarka.',
  },
  commodityLabel: (c) => HAUSA_COMMODITY[c] ?? c,
  priceCheck: (f) => {
    const name = HAUSA_COMMODITY[f.commodity] ?? f.commodity
    const where = f.state ? ` a ${f.state}` : ''
    const market = f.latestMarket ? `kasuwar ${f.latestMarket}, ` : ''
    const parts = [`Farashin ${name}${where} da aka rubuta na baya-bayan nan: ${formatNaira(f.latestPrice)} kowace kilo - ${market}${formatDateShort(f.latestDate)}.`]
    if (f.direction) parts.push(`Wannan ya ${f.direction.changePct >= 0 ? 'tashi' : 'sauka'} da ${pct(f.direction.changePct)} tun ${ymLabel(f.direction.fromKey)}.`)
    if (f.seasonal) parts.push(`A cikin shekaru ${f.seasonal.yearsCovered} da suka gabata, ${name} ya kai kusan ${pct(f.seasonal.swingPct)} sama a watan ${monthName(f.seasonal.highMonth)} fiye da watan ${monthName(f.seasonal.lowMonth)}.`)
    return parts.join(' ')
  },
  noData: (commodity, state) => {
    const name = commodity ? HAUSA_COMMODITY[commodity] ?? commodity : 'wannan kaya'
    const where = state ? ` a ${state}` : ''
    return `Ba ni da bayanan farashin ${name}${where} a cikin bayanan da aka loda ba tukuna. Na adana tambayarka domin ƙungiyar Loamy ta duba.`
  },
}

export const DIALECTS: Record<CopilotLanguage, Dialect> = { en: EN, ha: KANANCI }

export function getDialect(lang: CopilotLanguage): Dialect {
  return DIALECTS[lang] ?? EN
}
