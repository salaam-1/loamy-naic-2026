/**
 * Trace Explorer — the shape of a chain, and how to render a gap in it.
 *
 * The single rule this file exists to enforce in the UI:
 *
 *   "this did not happen" and "you may not see this" must never look the same.
 *
 * The server returns `available: false` with a `reason` for both. Collapsing
 * them into one grey "—" would tell a buyer that a batch was never verified
 * when in fact they simply lack the scope to see that it was.
 */

export type TraceScope = 'none' | 'public' | 'party' | 'origin' | 'admin'

export interface TraceNodeState {
  available: boolean
  reason?: string
  items?: unknown[]
}

/** The chain, in the order a person reads it. */
export const TRACE_ORDER = [
  'farm',
  'production_cycle',
  'harvest',
  'batch',
  'verifications',
  'listings',
  'transactions',
  'financing',
  'warehouse',
  'logistics',
] as const

export type TraceNodeKey = (typeof TRACE_ORDER)[number]

export const TRACE_LABELS: Record<TraceNodeKey, string> = {
  farm: 'Farm',
  production_cycle: 'Crop cycle',
  harvest: 'Harvest',
  batch: 'Commodity batch',
  verifications: 'Verification',
  listings: 'Listed',
  transactions: 'Sold',
  financing: 'Financing',
  warehouse: 'Storage',
  logistics: 'Transport',
}

/**
 * Two different kinds of absence, kept apart.
 *
 *  'absent'    — the step genuinely did not happen
 *  'withheld'  — it may have happened; this viewer is not entitled to see
 */
export type GapKind = 'absent' | 'withheld'

export function gapKind(reason: string | undefined): GapKind {
  return reason === 'not_permitted' ? 'withheld' : 'absent'
}

const ABSENT_COPY: Record<string, string> = {
  not_recorded: 'Not recorded',
  record_missing: 'Record missing',
  never_verified: 'Never verified',
  never_listed: 'Never listed',
  never_sold: 'Never sold',
  never_financed: 'No financing used',
  never_warehoused: 'Never stored',
  no_transport_recorded: 'No transport recorded',
}

export function gapMessage(reason: string | undefined): string {
  if (reason === 'not_permitted') return 'Not visible at your access level'
  return ABSENT_COPY[reason ?? ''] ?? 'Not recorded'
}

/** What each scope means, said plainly, for the banner on the explorer. */
export const SCOPE_COPY: Record<TraceScope, string> = {
  none: 'You have no access to this chain.',
  public: 'Public view - commodity, origin state and verification status. No identities, quantities or prices.',
  party: 'Party view - you transacted on, carried or stored this batch.',
  origin: 'Origin view - you grew or currently hold this batch.',
  admin: 'Administrator view - the complete chain.',
}

/**
 * Entry refs the explorer accepts, for the placeholder and the error copy.
 * Mirrors loamy_trace_batch_for_ref; anything else resolves but is reported
 * as not part of a commodity chain.
 */
export const TRACEABLE_PREFIXES = [
  'BATCH', 'TXN', 'LIST', 'HARV', 'WRC', 'LOG', 'FIN', 'VER',
] as const

/** Is this worth sending to the server at all? */
export function looksLikeRef(input: string): boolean {
  const s = input.trim().toUpperCase()
  if (/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(s)) return true
  return /^[A-Z]{2,6}-\d{4,}$/.test(s)
}

/** Normalise what a person typed or pasted into a ref the server will match. */
export function normaliseRef(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '')
}

export function traceRefusal(reason: string | undefined): string {
  switch (reason) {
    case 'no_such_reference':
      return 'No record matches that reference - or you do not have access to it.'
    case 'no_batch_attached':
      return 'That reference is real, but nothing traceable is attached to it yet.'
    case 'not_traceable':
      return 'That reference is not part of a commodity chain.'
    case 'not_signed_in':
      return 'Sign in to trace a reference.'
    default:
      return 'That reference could not be traced.'
  }
}
