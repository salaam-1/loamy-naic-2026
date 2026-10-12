import { useEffect, useState } from 'react'
import { LineChart } from 'lucide-react'
import { fetchValidatedPrices, type ValidatedPrice, perUnitLabel} from '@/lib/ambassador'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'

/**
 * Today's market prices as LOW–HIGH ranges, from VALIDATED ambassador
 * submissions (loamy_validated_prices — no submitter identity). Honest empty
 * state when none exist; ranges are never invented.
 */
export function DailyPricesPanel({ limit = 8 }: { limit?: number }) {
  const [rows, setRows] = useState<ValidatedPrice[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchValidatedPrices().then((r) => { if (!cancelled) setRows(r) })
    return () => { cancelled = true }
  }, [])

  return (
    <DashboardCard title="Today's market prices">
      {rows === null ? (
        <div className="h-16 animate-pulse rounded bg-emerald-50" aria-label="Loading prices" />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <LineChart className="h-6 w-6 text-emerald-900/20" aria-hidden />
          <p className="max-w-xs text-xs leading-relaxed text-emerald-900/50">
            No verified prices yet. Loamy ambassadors post daily market ranges from their local markets as they gather them.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-emerald-950/5">
          {rows.slice(0, limit).map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-emerald-950">
                  {u.commodity}{u.variety_name ? <span className="font-normal text-emerald-900/55"> · {u.variety_name}</span> : ''}
                </p>
                <p className="text-[11px] text-emerald-900/45">
                  {u.market_name}{u.state ? `, ${u.state}` : ''} · {formatDateShort(u.observed_date)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[13px] font-semibold text-emerald-800">
                  {formatNaira(Number(u.price_low))}–{formatNaira(Number(u.price_high))}
                </p>
                <p className="text-[10px] text-emerald-900/45">per {perUnitLabel(u.quantity, u.unit)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  )
}
