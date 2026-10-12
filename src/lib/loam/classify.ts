/**
 * How much backing does this question demand?
 *
 * This is the gate that decides whether N-ATLaS is allowed to answer with
 * authority, so it is deliberately pessimistic: an unrecognised question is
 * treated as `specific`, which requires evidence, rather than `general`, which
 * does not. Getting this wrong in the lenient direction reproduces the Phase 0
 * failure; getting it wrong in the strict direction produces an unnecessary
 * "I don't have evidence for that", which is recoverable.
 *
 * It reuses the existing Co-pilot extractors rather than growing a second
 * vocabulary: `extractCommodity` already knows that masara is Maize and
 * `extractState` already knows Nigeria's states.
 */
import { detectLanguage, extractCommodity, extractState } from '@/lib/copilot/language'
import { cropsIn, fold } from '@/lib/loam/anchors'
import type { ClaimDemand, LoamLanguage } from '@/lib/loam/types'

/**
 * Igbo and Yoruba detection, layered on the Co-pilot's Hausa detector.
 *
 * `detectLanguage` in src/lib/copilot/language.ts only distinguishes Hausa from
 * English, because that is all the deterministic Co-pilot ships. Extending it
 * there would change which messages that engine routes to a price answer, so
 * the extra two languages are detected here instead.
 *
 * Markers are distinctive function words and question openers, chosen to avoid
 * the short ambiguous particles ('ni', 'ti', 'na') that appear across these
 * languages and in English. A missed detection costs a worse answer, never a
 * wrong one: the message is treated as English and the guard still protects it.
 */
const IGBO_MARKERS = [
  'kedu', 'olee', 'gini', 'kwesiri', 'ndumodu', 'nwere ike', 'ugbo', 'ahia',
  'mgbe', 'ihe', 'oge', 'maka', 'ikpa', 'ego',
]
const YORUBA_MARKERS = [
  'nigba wo', 'bawo', 'kini', 'imoran', 'ipinle', 'agbe', 'elo ni', 'gbin',
  'oja', 'owo', 'nigbati', 'bi o', 'wulo',
]

/**
 * Hausa greetings and thanks.
 *
 * The Co-pilot's detector keys off trading vocabulary -- farashi, masara,
 * kasuwa -- so a bare "Sannu" reads as English and gets an English welcome.
 * Adding them there would change which messages the legacy engine routes to a
 * price answer, so the extra markers live here, in Loam's own detector.
 */
const HAUSA_SOCIAL_MARKERS = [
  'sannu', 'barka', 'na gode', 'nagode', 'ina kwana', 'ina wuni', 'ina yini',
  'sai an jima', 'sai anjima',
]

function detectLoamLanguage(text: string, fallback: LoamLanguage): LoamLanguage {
  // Hausa first: the existing detector is the most exercised of the three.
  const ha = detectLanguage(text, 'en')
  if (ha === 'ha') return 'ha'
  const t = ` ${fold(text)} `
  if (HAUSA_SOCIAL_MARKERS.some((m) => t.includes(` ${m}`))) return 'ha'
  const hits = (markers: string[]) => markers.filter((m) => t.includes(` ${m}`)).length
  const ig = hits(IGBO_MARKERS)
  const yo = hits(YORUBA_MARKERS)
  if (ig > yo && ig > 0) return 'ig'
  if (yo > ig && yo > 0) return 'yo'
  return fallback
}

const any = (t: string, words: string[]) => words.some((w) => t.includes(w))

/**
 * Asking for a future price. Refused before the model is called.
 *
 * Loamy's institutional position (see DEFAULT_FLAGS in src/lib/types.ts) is
 * that it does not predict prices: the naive baseline beat every model tried.
 * A generative model will happily produce a number anyway, so the only safe
 * place to stop it is before it is asked.
 */
const FORECAST = [
  'will cost', 'will be', 'will price', 'next month', 'next week', 'next year',
  'in march', 'in april', 'in may', 'in june', 'in july', 'in august',
  'in september', 'in october', 'in november', 'in december', 'in january', 'in february',
  'forecast', 'predict', 'prediction', 'projection', 'expect the price',
  'future price', 'price next', 'going to cost', 'how much will',
  'zai kai', 'zai zama', 'nan gaba',
]

/** First person about platform records — only Level 1 can answer these. */
const PERSONAL = [
  'my farm', 'my farms', 'my crop', 'my crops', 'my harvest', 'my listing',
  'my listings', 'my order', 'my orders', 'my batch', 'my batches',
  'my application', 'my financing', 'my wallet', 'my account', 'my records',
  "what's on my", 'whats on my', 'what do i have', 'do i have',
  'gonakina', 'gonata', 'amfanin gonata',
]

/**
 * Stable agronomy with no place, date or person in it. Kept narrow on purpose:
 * this is the only route by which the model may answer without Level 1 data,
 * so membership is explicit rather than inferred.
 */
const GENERAL_TOPIC = [
  'why', 'what is', 'what are', 'how does', 'how do', 'how to', 'explain', 'difference between',
  'benefit', 'benefits', 'advantage', 'purpose of', 'meaning of',
  'me ya sa', 'menene', 'yaya ake',
]

/** Markers that a question wants a date, a place or a current figure. */
const SPECIFIC_MARKERS = [
  'when', 'what time', 'which month', 'how much', 'price', 'cost', 'rate',
  'where', 'which market', 'how many', 'best time', 'should i',
  'yaushe', 'nawa', 'farashi', 'ina', 'wanne',
]

export interface Classification {
  demand: ClaimDemand
  language: LoamLanguage
  /**
   * The subject of the turn, which MAY have been inherited from the previous
   * one so a follow-up like "and in Kaduna?" keeps its topic.
   */
  commodity: string | null
  /**
   * The commodity THIS message actually names, or null.
   *
   * WHY THE TWO ARE SEPARATE
   *   `commodity` falls back to `lastCommodity`, which is right for continuing
   *   a conversation and wrong for choosing a tool. A live session typed
   *   "rice", then "transport offers", and the second turn inherited Rice and
   *   was answered with rice listings. The same inheritance declined "What is
   *   Loamy?" after a rice query. Tool selection reads `namedCommodity`;
   *   only phrasing and continuity read `commodity`.
   */
  namedCommodity: string | null
  state: string | null
  /** Why this demand was chosen — surfaced in tests and the dev response. */
  because: string
}

export function classify(
  message: string,
  appLanguage: LoamLanguage = 'en',
  lastCommodity?: string | null,
): Classification {
  const t = ` ${message.toLowerCase()} `
  const language = detectLoamLanguage(message, appLanguage)
  /**
   * The Co-pilot's extractor knows English and Hausa; the anchor table knows
   * all four. Without the fallback, "Kedu mgbe m kwesiri iku oka na Kaduna?"
   * resolved no commodity, so no knowledge entry matched, so the gate declined
   * -- Loam answered two of its four demo languages with nothing at all.
   */
  const namedCommodity = extractCommodity(message)
    ?? [...cropsIn(message)][0]
    ?? null
  const commodity = namedCommodity ?? lastCommodity ?? null
  const state = extractState(message) ?? null

  // Order matters. Forecast is checked first because "how much will maize cost
  // in March" also matches the price and specific markers, and a forecast must
  // never fall through to a path that reaches the model.
  if (any(t, FORECAST) && (any(t, ['price', 'cost', 'rate', 'farashi', 'nawa', 'worth']) || any(t, ['forecast', 'predict']))) {
    return { demand: 'forecast', language, commodity, namedCommodity, state, because: 'asks for a future price' }
  }
  if (any(t, PERSONAL)) {
    return { demand: 'personal', language, commodity, namedCommodity, state, because: 'asks about this user\'s own records' }
  }
  // A place or a date-seeking question is specific even when phrased as "why",
  // because the answer carries a checkable, consequential particular.
  if (state || any(t, SPECIFIC_MARKERS)) {
    return {
      demand: 'specific', language, commodity, namedCommodity, state,
      because: state ? 'names a place, so the answer is location-specific' : 'asks for a date, place or figure',
    }
  }
  if (any(t, GENERAL_TOPIC)) {
    return { demand: 'general', language, commodity, namedCommodity, state, because: 'asks for stable agricultural knowledge' }
  }
  // Unrecognised: treat as specific so it needs evidence. Being too strict
  // costs a decline; being too lenient costs a confident wrong answer.
  return {
    demand: 'specific', language, commodity, namedCommodity, state,
    because: 'unrecognised shape, treated as specific',
  }
}
