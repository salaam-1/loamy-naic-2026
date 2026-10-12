import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, LineChart, Minus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { MarketPrice } from '@/lib/marketplace'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Sparkline } from '@/components/charts/Sparkline'

interface PriceRow {
  commodity: string
  latest: MarketPrice
  previous?: MarketPrice
  /** Full history oldest→newest for the sparkline (≥3 entries or no line). */
  history: { label: string; value: number }[]
}

/**
 * Admin-entered reference prices with a trend arrow vs the previous entry.
 * HONEST pilot-period market intelligence: when no prices exist, this shows
 * an empty state — prices are never invented. The field-agent price network
 * is a labeled future enhancement.
 */
export function MarketPricesPanel({
  commodity,
  source = 'market_prices',
}: {
  commodity?: string
  /** Table/view to read from. Use 'loamy_public_market_prices' on anon surfaces. */
  source?: 'market_prices' | 'loamy_public_market_prices'
}) {
  const [rows, setRows] = useState<PriceRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    let query = supabase
      .from(source)
      .select('*')
      .order('recorded_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(300)
    if (commodity) query = query.eq('commodity', commodity)
    query.then(({ data }) => {
      if (cancelled) return
      const prices = (data as MarketPrice[]) ?? []
      const byCommodity = new Map<string, MarketPrice[]>()
      for (const p of prices) {
        const list = byCommodity.get(p.commodity) ?? []
        list.push(p)
        byCommodity.set(p.commodity, list)
      }
      setRows(
        [...byCommodity.entries()]
          .map(([c, list]) => ({
            commodity: c,
            latest: list[0],
            previous: list[1],
            history: [...list]
              .reverse()
              .map((p) => ({ label: formatDateShort(p.recorded_date), value: Number(p.price_per_kg) })),
          }))
          .sort((a, b) => a.commodity.localeCompare(b.commodity)),
      )
    })
    return () => {
      cancelled = true
    }
  }, [commodity, source])

  return (
    <DashboardCard title={commodity ? `Market price - ${commodity}` : 'Market prices'}>
      {rows === null ? (
        <div className="h-16 animate-pulse rounded-lg bg-emerald-50" aria-label="Loading prices" />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <LineChart className="h-6 w-6 text-emerald-900/20" aria-hidden />
          <p className="max-w-xs text-xs leading-relaxed text-emerald-900/50">
            No reference prices entered yet. The Loamy team publishes prices as they are gathered -
            a field-agent price network is a planned enhancement.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-emerald-950/5">
          {rows.map(({ commodity: c, latest, previous, history }) => {
            const delta = previous ? Number(latest.price_per_kg) - Number(previous.price_per_kg) : null
            return (
              <li key={c + (latest.state ?? '')} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-emerald-950">{c}</p>
                  <p className="text-[11px] text-emerald-900/45">
                    {latest.state ?? 'National'} · {formatDateShort(latest.recorded_date)}
                    {latest.source_note ? ` · ${latest.source_note}` : ''}
                  </p>
                </div>
                <Sparkline data={history} />
                <div className="text-right">
                  <p className="text-sm font-semibold text-emerald-950">
                    {formatNaira(Number(latest.price_per_kg))}/kg
                  </p>
                  {delta !== null && (
                    <p
                      className={
                        delta > 0
                          ? 'flex items-center justify-end gap-0.5 text-[11px] font-medium text-emerald-600'
                          : delta < 0
                            ? 'flex items-center justify-end gap-0.5 text-[11px] font-medium text-red-600'
                            : 'flex items-center justify-end gap-0.5 text-[11px] text-emerald-900/40'
                      }
                    >
                      {delta > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : delta < 0 ? <ArrowDownRight className="h-3 w-3" aria-hidden /> : <Minus className="h-3 w-3" aria-hidden />}
                      {delta === 0 ? 'unchanged' : `${formatNaira(Math.abs(delta))} vs previous`}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardCard>
  )
}
