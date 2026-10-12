/**
 * Chart tokens + data helpers. Palette validated with the dataviz six-checks
 * script (light surface #FFFFFF): categorical order is FIXED, never cycled —
 * chart-emerald, gold, deep chart-emerald; gray is reserved for "Other".
 * The validator's WARNs (gold contrast, CVD floor band) are satisfied by
 * standing secondary encoding: legends on every multi-series chart, mono
 * tooltips, direct labels, and 2px surface gaps.
 */

/**
 * How far back a weekly trend chart reads, and the row ceiling that goes with
 * it.
 *
 * WHY THESE EXIST
 *   The admin trend charts used to select whole tables with no window, no
 *   order and no limit, then bucket the result in the browser. That is
 *   unbounded by construction, and it had already broken: PostgREST caps an
 *   unbounded select at 1000 rows, profiles passed 1000, and with no ORDER BY
 *   the 1000 that came back were an arbitrary slice, so the charts were
 *   plotting a non-deterministic sample of history and calling it a trend.
 *
 *   26 weeks is what a weekly chart can legibly show. The ceiling is a second
 *   belt: if a window ever returns more than this the query is bounded anyway,
 *   and the chart degrades to "the most recent ANALYTICS_MAX_ROWS in the
 *   window" rather than to silence.
 */
export const ANALYTICS_WEEKS = 26
export const ANALYTICS_MAX_ROWS = 5000

/** ISO timestamp marking the start of the analytics window. */
export function analyticsSince(weeks = ANALYTICS_WEEKS): string {
  return new Date(Date.now() - weeks * 7 * 86400000).toISOString()
}

/** Fixed categorical series order. Never generate hues past these. */
export const SERIES = ['#00A070', '#C8A045', '#007A55'] as const
/** Reserved for "Other" folds only — never a named series. */
export const SERIES_OTHER = '#64748B'
/** Sequential single-hue ramp (brand emerald, light → dark) for ordered data. */
export const SEQUENTIAL = ['#B5DACD', '#4C9F85', '#0E6B54', '#014D40'] as const

export const GRID_STROKE = '#E2E8F0'
export const AXIS_INK = '#5B6B66'

/** SPARSE-DATA RULE: minimum real points before a chart renders. Below it,
 * the honest state shows raw numbers + "Chart appears as data accumulates."
 * Never interpolate, duplicate, or fabricate points. */
export const MIN_TREND_POINTS = 3
export const MIN_SPARK_POINTS = 3
export const MIN_BAR_GROUPS = 1

export interface WeekBucket {
  week: string // e.g. "07 Jul"
  [series: string]: string | number
}

function weekStart(d: Date): Date {
  const out = new Date(d)
  const day = (out.getDay() + 6) % 7 // Monday = 0
  out.setDate(out.getDate() - day)
  out.setHours(0, 0, 0, 0)
  return out
}

function weekLabel(d: Date): string {
  return d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })
}

/**
 * Bucket timestamped rows into contiguous Monday-start weeks. Weeks between
 * first and last data point render as true zeros (a zero is real data — the
 * absence of activity — not fabrication). Series values are COUNTS unless a
 * `value` extractor is given (then sums).
 */
export function bucketWeekly<T>(
  rows: T[],
  series: { key: string; date: (row: T) => string | null; value?: (row: T) => number }[],
): WeekBucket[] {
  const stamps: number[] = []
  for (const s of series) {
    for (const r of rows) {
      const d = s.date(r)
      if (d) stamps.push(weekStart(new Date(d)).getTime())
    }
  }
  if (stamps.length === 0) return []
  const min = Math.min(...stamps)
  const max = Math.max(...stamps)
  const buckets: WeekBucket[] = []
  const index = new Map<number, WeekBucket>()
  for (let t = min; t <= max; t += 7 * 86400000) {
    const b: WeekBucket = { week: weekLabel(new Date(t)) }
    for (const s of series) b[s.key] = 0
    buckets.push(b)
    index.set(t, b)
  }
  for (const s of series) {
    for (const r of rows) {
      const d = s.date(r)
      if (!d) continue
      const b = index.get(weekStart(new Date(d)).getTime())
      if (b) b[s.key] = (b[s.key] as number) + (s.value ? s.value(r) : 1)
    }
  }
  return buckets
}

/** Count of rows carrying at least one real (non-null-date) point. */
export function realPointCount(buckets: WeekBucket[], keys: string[]): number {
  return buckets.filter((b) => keys.some((k) => (b[k] as number) > 0)).length
}

export interface YieldChart {
  rows: { season: string; [crop: string]: string | number }[]
  series: { key: string; label: string; other?: boolean }[]
}

/**
 * Yield-history shape shared by the farmer dashboard, the bank application
 * detail, and the printed report: seasons on x, one series per crop (top 4 by
 * recorded volume; the rest fold into gray "Other"). Only rows with a REAL
 * actual_yield_kg chart — expectations never render as data.
 */
export function yieldBySeason(
  records: { crop: string; season_year: number; actual_yield_kg: number | null }[],
): YieldChart {
  const real = records.filter((r) => r.actual_yield_kg !== null)
  const totals = new Map<string, number>()
  for (const r of real) totals.set(r.crop, (totals.get(r.crop) ?? 0) + Number(r.actual_yield_kg))
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k)
  const hasOther = totals.size > top.length
  const seasons = [...new Set(real.map((r) => r.season_year))].sort()
  const rows = seasons.map((y) => {
    const row: YieldChart['rows'][number] = { season: String(y) }
    for (const c of top) row[c] = 0
    if (hasOther) row.Other = 0
    for (const r of real.filter((r) => r.season_year === y)) {
      const key = top.includes(r.crop) ? r.crop : 'Other'
      row[key] = (Number(row[key]) || 0) + Number(r.actual_yield_kg)
    }
    return row
  })
  return {
    rows,
    series: [
      ...top.map((c) => ({ key: c, label: c })),
      ...(hasOther ? [{ key: 'Other', label: 'Other', other: true }] : []),
    ],
  }
}
