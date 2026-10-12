/**
 * Intelligence — the presentation contract.
 *
 * Four rules, each of which is a way a dashboard lies while showing true
 * numbers:
 *
 *   · an inference is always labelled as one, never shown as an observation
 *   · a withheld result says "insufficient data", never a rounded band
 *   · every figure carries its population, period and place
 *   · a stale observation is dated, never presented as the current price
 *
 * There is also a deliberate absence: no function here produces the phrase
 * "AI has discovered". The system calculates statistics, and saying otherwise
 * dresses arithmetic up as insight.
 */

export type Classification = 'observed' | 'user_generated' | 'model_inference'

export const CLASSIFICATION_META: Record<Classification, {
  label: string
  tone: 'fact' | 'reported' | 'computed'
  help: string
}> = {
  observed: {
    label: 'Observed',
    tone: 'fact',
    help: 'Counted from records that exist on Loamy.',
  },
  user_generated: {
    label: 'Reported',
    tone: 'reported',
    help: 'Reported by a member and not independently verified.',
  },
  model_inference: {
    label: 'Calculated',
    tone: 'computed',
    help: 'Computed from observations. Not itself an observation, and not a forecast.',
  },
}

/**
 * The badge every intelligence surface must show.
 *
 * Returns null only when the payload has no classification at all, which is
 * itself a bug — the column is NOT NULL server-side.
 */
export function classificationBadge(c: string | undefined): {
  label: string
  tone: string
  help: string
} | null {
  const meta = CLASSIFICATION_META[c as Classification]
  return meta ? { label: meta.label, tone: meta.tone, help: meta.help } : null
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export interface SignalEnvelope {
  available: boolean
  reason?: string
  message?: string
  classification?: Classification
  commodity?: string
  state?: string
  period_days?: number
  period_start?: string
  period_end?: string
  population?: Record<string, number>
  limitations?: string
  evidence_note?: string
}

export interface DemandSignal extends SignalEnvelope {
  band?: 'low' | 'medium' | 'high'
  weighted_score?: number
  breakdown?: { signal: string; events: number; weight: number; contribution: number }[]
}

/**
 * What to show when a signal is unavailable.
 *
 * "Insufficient data" and nothing else. A range or an "approximately" still
 * narrows the field when only two people are in it, which is exactly what the
 * floor exists to prevent.
 */
export function unavailableMessage(s: SignalEnvelope | null | undefined): string {
  switch (s?.reason) {
    case 'insufficient_data':
      return s.message ?? 'Not enough activity in this period to report without identifying people.'
    case 'no_commodity':
      return 'Choose a commodity. There is no overall demand figure.'
    case 'no_market_specified':
      return 'Choose a market. Loamy has no national price series.'
    case 'no_observations':
      return 'No prices have been recorded for that market yet.'
    case 'insufficient_history':
      return 'Not enough recorded observations to describe a pattern.'
    case 'not_signed_in':
      return 'Sign in to see market intelligence.'
    default:
      return 'Not available yet.'
  }
}

/** True when a band may be shown at all. */
export function canShowBand(s: DemandSignal | null | undefined): boolean {
  return Boolean(s?.available && s.band)
}

/**
 * The sentence that must accompany any band.
 *
 * A band with no population is a mood. This builds the evidence line from the
 * server's own numbers, and returns null rather than inventing one.
 */
export function evidenceLine(s: SignalEnvelope | null | undefined): string | null {
  if (!s?.available) return null
  if (s.evidence_note) return s.evidence_note

  const pop = s.population ?? {}
  const parts: string[] = []
  if (pop.participants != null) parts.push(`${pop.participants} participants`)
  if (pop.events != null) parts.push(`${pop.events} events`)
  if (pop.completed_transactions != null) {
    parts.push(`${pop.completed_transactions} completed transactions`)
  }
  if (parts.length === 0) return null

  const where = s.state ?? 'all states'
  const when = s.period_days ? `over ${s.period_days} days` : ''
  return `Based on ${parts.join(', ')} in ${where} ${when}`.trim()
}

/** Ordered strongest-first, so a card shows what actually matters. */
export function strongestEvidence(
  s: DemandSignal | null | undefined,
  max = 3,
): { signal: string; events: number; contribution: number }[] {
  return [...(s?.breakdown ?? [])]
    .sort((a, b) => Number(b.contribution) - Number(a.contribution))
    .slice(0, max)
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export type Freshness = 'current' | 'recent' | 'stale' | 'unknown'

/**
 * How old an observation is, and whether it may be described as current.
 *
 * The failure this prevents: a price recorded in March rendered identically
 * to one recorded this morning.
 */
export function freshness(iso: string | null | undefined, staleDays = 30): {
  state: Freshness
  label: string
  days: number | null
} {
  if (!iso) return { state: 'unknown', label: 'Date not recorded', days: null }
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return { state: 'unknown', label: 'Date not recorded', days: null }

  const days = Math.floor((Date.now() - t) / 86_400_000)
  const when = new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })

  if (days <= 2) return { state: 'current', label: `Observed ${when}`, days }
  if (days <= staleDays) return { state: 'recent', label: `Observed ${when}`, days }
  return { state: 'stale', label: `Observed ${when} - ${days} days old`, days }
}

/** A stale figure must never be captioned as the current price. */
export function priceCaption(iso: string | null | undefined, market: string | undefined): string {
  const f = freshness(iso)
  const where = market ? `${market} reference` : 'reference'
  if (f.state === 'stale') return `${where} · ${f.label} · may be out of date`
  if (f.state === 'unknown') return `${where} · date not recorded`
  return `${where} · ${f.label}`
}

// ---------------------------------------------------------------------------
// Supply
// ---------------------------------------------------------------------------

export interface SupplySignal extends SignalEnvelope {
  listed?: { listings: number; quantity_kg: number; means: string }
  verified?: { batches: number; quantity_kg: number; means: string }
  transacted?: { transactions: number; quantity_kg: number; means: string }
}

/**
 * Three rows, never a total.
 *
 * Summing claimed, inspected and sold stock produces a number that describes
 * nothing, and it is the number a marketplace is most tempted to print.
 */
export function supplyRows(s: SupplySignal | null | undefined): {
  key: string
  label: string
  count: number
  quantityKg: number
  means: string
}[] {
  if (!s?.available) return []
  return [
    { key: 'verified', label: 'Verified', count: s.verified?.batches ?? 0,
      quantityKg: s.verified?.quantity_kg ?? 0, means: s.verified?.means ?? '' },
    { key: 'transacted', label: 'Sold in period', count: s.transacted?.transactions ?? 0,
      quantityKg: s.transacted?.quantity_kg ?? 0, means: s.transacted?.means ?? '' },
    { key: 'listed', label: 'Listed', count: s.listed?.listings ?? 0,
      quantityKg: s.listed?.quantity_kg ?? 0, means: s.listed?.means ?? '' },
  ]
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

const OVERCLAIM = [
  /\bAI (has )?(discovered|found|determined|predicts?)\b/i,
  /\bwill (definitely|certainly) (rise|fall|increase|drop)\b/i,
  /\bguaranteed\b/i,
  /\bbest (price|seller|buyer|farmer|trader|deal)\b/i,
  /\bhottest\b/i,
]

/**
 * Catches the phrasings that turn a statistic into a promise.
 *
 * Used by the unit tests over every string this module can produce, so the
 * rule is enforced rather than merely intended.
 */
export function isOverclaim(text: string): boolean {
  return OVERCLAIM.some((re) => re.test(text))
}
