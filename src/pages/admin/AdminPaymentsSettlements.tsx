import { useEffect, useState } from 'react'
import { Coins, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { TXN_TYPE_META, type PlatformMetrics, type PlatformTransaction } from '@/lib/ledger'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { StatCard } from '@/components/StatCard'
import { DashboardCard } from '@/components/DashboardCard'
import { Card } from '@/components/ui/card'

/** Payments & settlements: marketplace settlements + platform fees (revenue),
 * from the record-only ledger. Loamy holds no funds. */
export default function AdminPaymentsSettlements() {
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null)
  const [settlements, setSettlements] = useState<PlatformTransaction[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: m }, { data: s }] = await Promise.all([
        supabase.rpc('loamy_platform_metrics'),
        supabase.from('platform_transactions').select('*').eq('txn_type', 'marketplace_settlement').order('occurred_on', { ascending: false }).limit(300),
      ])
      if (cancelled) return
      setMetrics(m as PlatformMetrics)
      setSettlements((s as PlatformTransaction[]) ?? [])
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Coins} label="GMV (MTD)" value={formatNaira(metrics?.gmv_mtd ?? 0)} sub="settlements this month" loading={!metrics} />
        <StatCard icon={Coins} label="GMV (all-time)" value={formatNaira(metrics?.gmv_total ?? 0)} sub="all settlements" loading={!metrics} />
        <StatCard icon={TrendingUp} label="Revenue (MTD)" value={formatNaira(metrics?.revenue_mtd ?? 0)} sub="platform fees" loading={!metrics} />
        <StatCard icon={TrendingUp} label="Revenue (all-time)" value={formatNaira(metrics?.revenue_total ?? 0)} sub="recorded fees" loading={!metrics} />
      </div>

      <DashboardCard title="Settlements">
        {settlements.length === 0 ? (
          <Card className="px-4 py-3 text-sm text-emerald-900/55">
            No settlements recorded yet. Parties record a deal's settled value when a marketplace deal concludes.
          </Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Gross (GMV)</th>
                  <th className="py-2 pr-4 font-medium">Fee (revenue)</th>
                  <th className="hidden py-2 font-medium sm:table-cell">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 pr-4 font-mono text-[12px] text-emerald-900/70">{formatDateShort(s.occurred_on)}</td>
                    <td className="py-2 pr-4"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TXN_TYPE_META[s.txn_type].chip}`}>{TXN_TYPE_META[s.txn_type].label}</span></td>
                    <td className="py-2 pr-4 font-mono text-[13px]">{formatNaira(Number(s.gross_amount))}</td>
                    <td className="py-2 pr-4 font-mono text-[13px] text-emerald-900/70">{Number(s.fee_amount) > 0 ? formatNaira(Number(s.fee_amount)) : '-'}</td>
                    <td className="hidden py-2 font-mono text-[11px] text-emerald-900/50 sm:table-cell">{s.external_reference ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCard>
    </div>
  )
}
