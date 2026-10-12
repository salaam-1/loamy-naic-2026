import type { MarketPriceHistory } from '@/lib/copilot/types'

/**
 * Deterministic analysis over uploaded price rows. Everything here describes
 * OBSERVED history — latest values, the change between two recorded points, and
 * the repeating seasonal pattern. Nothing here forecasts: there is no function
 * that returns a future price, and the seasonal pattern is always framed as
 * "over the last N years", never "next month will be".
 */

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const monthName = (m: number) => MONTH_NAMES[m - 1] ?? String(m)

/** 'YYYY-MM' key from a date string. */
const ym = (date: string) => date.slice(0, 7)

/** Human label for a 'YYYY-MM' key, e.g. "March 2026". */
export function ymLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${monthName(Number(m))} ${y}`
}

export interface MonthlyAverage {
  month: number // 1–12
  avg: number
  n: number
}

/** Average price per calendar month, pooled across all years in the rows. */
export function monthlyAverages(rows: MarketPriceHistory[]): MonthlyAverage[] {
  const sum = new Array(12).fill(0)
  const cnt = new Array(12).fill(0)
  for (const r of rows) {
    const m = Number(r.date.slice(5, 7)) - 1
    if (m < 0 || m > 11) continue
    sum[m] += Number(r.price_ngn_per_kg)
    cnt[m] += 1
  }
  const out: MonthlyAverage[] = []
  for (let i = 0; i < 12; i++) {
    if (cnt[i] > 0) out.push({ month: i + 1, avg: sum[i] / cnt[i], n: cnt[i] })
  }
  return out
}

export interface SeasonalPattern {
  lowMonth: number
  highMonth: number
  lowAvg: number
  highAvg: number
  swingPct: number
  yearsCovered: number
  monthly: MonthlyAverage[]
}

/**
 * The repeating seasonal pattern: which calendar month is cheapest, which is
 * dearest, and the swing between them. Returns null when coverage is too thin
 * to state a pattern honestly (needs ≥ 3 distinct years and ≥ 6 months present).
 */
export function seasonalPattern(rows: MarketPriceHistory[]): SeasonalPattern | null {
  const monthly = monthlyAverages(rows)
  if (monthly.length < 6) return null
  const years = new Set(rows.map((r) => r.date.slice(0, 4)))
  if (years.size < 3) return null

  let low = monthly[0]
  let high = monthly[0]
  for (const m of monthly) {
    if (m.avg < low.avg) low = m
    if (m.avg > high.avg) high = m
  }
  if (low.avg <= 0) return null
  return {
    lowMonth: low.month,
    highMonth: high.month,
    lowAvg: low.avg,
    highAvg: high.avg,
    swingPct: ((high.avg - low.avg) / low.avg) * 100,
    yearsCovered: years.size,
    monthly,
  }
}

export interface MonthlyPoint { key: string; avg: number }

/** Monthly average series (oldest→newest), capped to the most recent `lastN`
 * months so a chat-panel chart stays legible. Observed history only. */
export function monthlySeries(rows: MarketPriceHistory[], lastN = 60): MonthlyPoint[] {
  const acc = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    const k = ym(r.date)
    const cur = acc.get(k) ?? { sum: 0, n: 0 }
    cur.sum += Number(r.price_ngn_per_kg)
    cur.n += 1
    acc.set(k, cur)
  }
  return [...acc.entries()]
    .map(([k, v]) => ({ key: k, avg: Math.round(v.sum / v.n) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-lastN)
}

export interface RecentDirection {
  fromKey: string
  toKey: string
  fromPrice: number
  toPrice: number
  changePct: number
}

/**
 * Direction of the most recent recorded movement — the latest monthly average
 * vs one roughly three recorded months earlier (or the earliest available if
 * the series is shorter). Strictly a comparison of two OBSERVED points.
 */
export function recentDirection(rows: MarketPriceHistory[]): RecentDirection | null {
  const acc = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    const k = ym(r.date)
    const cur = acc.get(k) ?? { sum: 0, n: 0 }
    cur.sum += Number(r.price_ngn_per_kg)
    cur.n += 1
    acc.set(k, cur)
  }
  const series = [...acc.entries()]
    .map(([k, v]) => ({ key: k, avg: v.sum / v.n }))
    .sort((a, b) => a.key.localeCompare(b.key))
  if (series.length < 2) return null

  const to = series[series.length - 1]
  const from = series[Math.max(0, series.length - 4)]
  if (from.key === to.key || from.avg <= 0) return null
  return {
    fromKey: from.key,
    toKey: to.key,
    fromPrice: from.avg,
    toPrice: to.avg,
    changePct: ((to.avg - from.avg) / from.avg) * 100,
  }
}

export interface DateCoverage {
  min: string
  max: string
  years: number
}

/** Real recorded date range for this slice — used to state coverage honestly
 * per commodity (never a blanket "22 years"). */
export function dateCoverage(rows: MarketPriceHistory[]): DateCoverage | null {
  if (rows.length === 0) return null
  let min = rows[0].date
  let max = rows[0].date
  for (const r of rows) {
    if (r.date < min) min = r.date
    if (r.date > max) max = r.date
  }
  const years = (new Date(max).getTime() - new Date(min).getTime()) / (365.25 * 864e5)
  return { min, max, years: Math.round(years * 10) / 10 }
}

/** The single most recent record in the slice. */
export function latestRecord(rows: MarketPriceHistory[]): MarketPriceHistory | null {
  if (rows.length === 0) return null
  return rows.reduce((a, b) => (b.date > a.date ? b : a))
}

/** All records on the most recent recorded date (may span several markets). */
export function latestRecordsOnMaxDate(rows: MarketPriceHistory[]): MarketPriceHistory[] {
  const latest = latestRecord(rows)
  if (!latest) return []
  return rows.filter((r) => r.date === latest.date)
}

/** Distinct source labels present in the slice (for provenance display). */
export function distinctSources(rows: MarketPriceHistory[]): string[] {
  return [...new Set(rows.map((r) => r.source).filter((s): s is string => Boolean(s)))]
}

/** Distinct upload batch ids present in the slice. */
export function distinctBatchIds(rows: MarketPriceHistory[]): string[] {
  return [...new Set(rows.map((r) => r.upload_batch_id).filter((s): s is string => Boolean(s)))]
}
