import { NIGERIA_STATES } from '@/lib/nigeria'
import type { CopilotLanguage } from '@/lib/copilot/types'
import { getDialect, type FixedPhraseKey, type PriceCheckFacts } from '@/lib/copilot/i18n/registry'

/**
 * Language layer: detection + entity extraction (here) and phrasing (delegated
 * to the per-dialect registry in i18n/registry.ts). Script: Latin (Boko) only.
 *
 * NOTE: the source spec mislabelled the dialect "Sakkwatanci" (that is the
 * SOKOTO dialect). This targets KANANCI (Kano) and is labelled correctly.
 */

export type { PriceCheckFacts }
export type { FixedPhraseKey }

// --- Detection ---------------------------------------------------------------

const HAUSA_MARKERS = [
  'nawa', 'farashi', 'kasuwa', 'masara', 'shinkafa', 'gyada', 'dawa', 'gero',
  'wake', 'sayar', 'saya', 'albasa', 'rogo', 'doya', 'ridi', 'citta', 'barkono',
  'yaya', 'kaya', 'kudi', 'ina son', 'me ya sa', 'labari', 'jigila', 'zobo',
]

/** Detect Hausa from the text itself, so a Hausa message overrides an English
 * app setting for that turn. Defaults to the caller's fallback. */
export function detectLanguage(text: string, fallback: CopilotLanguage = 'en'): CopilotLanguage {
  const t = ` ${text.toLowerCase()} `
  return HAUSA_MARKERS.some((m) => t.includes(` ${m} `) || t.includes(` ${m}`)) ? 'ha' : fallback
}

// --- Commodity & state extraction -------------------------------------------

/** Canonical (English) commodity → recognised aliases incl. Hausa (Boko). */
const COMMODITY_ALIASES: Record<string, string[]> = {
  Maize: ['maize', 'corn', 'masara'],
  Rice: ['rice', 'shinkafa'],
  Sorghum: ['sorghum', 'guinea corn', 'dawa'],
  Millet: ['millet', 'gero', 'maiwa'],
  Cowpea: ['cowpea', 'beans', 'wake'],
  Soybeans: ['soybean', 'soybeans', 'waken soya'],
  Groundnut: ['groundnut', 'groundnuts', 'peanut', 'gyada'],
  Sesame: ['sesame', 'beniseed', 'ridi'],
  Cassava: ['cassava', 'rogo'],
  Yam: ['yam', 'doya'],
  Cocoa: ['cocoa', 'koko'],
  Cashew: ['cashew'],
  Ginger: ['ginger', 'citta'],
  'Chili Pepper': ['chili', 'chilli', 'pepper', 'barkono', 'tattasai'],
  Hibiscus: ['hibiscus', 'zobo', 'yakuwa', 'roselle'],
  Onion: ['onion', 'albasa'],
  Tomato: ['tomato', 'tumatir', 'tumatur'],
}

export function extractCommodity(text: string): string | null {
  const t = ` ${text.toLowerCase()} `
  for (const [canonical, aliases] of Object.entries(COMMODITY_ALIASES)) {
    if (aliases.some((a) => t.includes(` ${a} `) || t.includes(` ${a}s `) || t.includes(` ${a}`))) {
      return canonical
    }
  }
  return null
}

export function extractState(text: string): string | undefined {
  const t = text.toLowerCase()
  if (/\babuja\b/.test(t)) return 'FCT'
  return NIGERIA_STATES.find((s) => t.includes(s.toLowerCase()))
}

// --- Phrasing (delegated to the dialect registry) ---------------------------

export function phrasePriceCheck(f: PriceCheckFacts, lang: CopilotLanguage): string {
  return getDialect(lang).priceCheck(f)
}
export function phraseNoData(commodity: string | null, state: string | undefined, lang: CopilotLanguage): string {
  return getDialect(lang).noData(commodity, state)
}
export function phraseFixed(key: FixedPhraseKey, lang: CopilotLanguage): string {
  return getDialect(lang).fixed[key]
}
export function phraseClarifyCommodity(lang: CopilotLanguage): string {
  return phraseFixed('clarify_commodity', lang)
}
