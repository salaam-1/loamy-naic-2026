import { useEffect, useState } from 'react'
import { BarChart3, Download } from 'lucide-react'
import { analyticsCsv, downloadCsv, fetchAnalytics, type ProcurementAnalytics } from '@/lib/procurement'
import { formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { StatCard } from '@/components/StatCard'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'

// Sparse-data rule: only draw a breakdown once there is enough to be meaningful.
const MIN_ROWS = 2

function Bars({ rows, max, fmt }: { rows: { label: string; value: number }[]; max: number; fmt: (n: number) => string }) {
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="text-[13px]">
          <div className="flex justify-between"><span className="truncate text-emerald-950">{r.label}</span><span className="font-mono text-emerald-900/70">{fmt(r.value)}</span></div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-emerald-100">
            <div className="h-full bg-emerald-500" style={{ width: `${max ? Math.max(3, (r.value / max) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Analytics() {
  const { t, tPlural, num } = useT()
  const errorText = useErrorText()
  const [a, setA] = useState<ProcurementAnalytics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchAnalytics().then(setA).catch((e) => setError(errorText(e, 'processor.analytics.couldNotLoad', 'Could not load analytics.'))) }, [])

  if (error) return <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  if (!a) return <div className="h-40 animate-pulse rounded bg-emerald-50" aria-label={t('processor.analytics.loading')} />

  if (a.awardCount === 0) {
    return <EmptyState icon={BarChart3} title={t('processor.analytics.noneYet')}
      body={t('processor.analytics.noneYetBody')} />
  }

  const sparse = a.awardCount < MIN_ROWS
  const commodityMax = Math.max(0, ...a.byCommodity.map((c) => c.spend))
  const supplierMax = Math.max(0, ...a.topSuppliers.map((s) => s.quantity))
  const stateMax = Math.max(0, ...a.byState.map((s) => s.spend))
  const monthMax = Math.max(0, ...a.monthly.map((m) => m.spend))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-emerald-900/55">{t('processor.analytics.liveFigures')}</p>
        <Button size="sm" variant="outline" onClick={() => downloadCsv(`loamy-procurement-${new Date().toISOString().slice(0, 10)}.csv`, analyticsCsv(a))}>
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {t('processor.analytics.exportCsv')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={BarChart3} label={t('processor.analytics.totalSpend')} sub={t('processor.analytics.totalSpendSub')} value={formatNaira(a.totalSpend)} />
        <StatCard icon={BarChart3} label={t('processor.analytics.savings')} sub={t('processor.analytics.savingsSub')} value={formatNaira(Math.round(a.savingsVsHighest))} />
        <StatCard icon={BarChart3} label={t('processor.analytics.deliveryRate')} sub={t('processor.analytics.deliveryRateSub')} value={a.deliveryRate == null ? '-' : `${Math.round(a.deliveryRate * 100)}%`} />
        <StatCard icon={BarChart3} label={t('processor.analytics.inspectionPassRate')} sub={t('processor.analytics.inspectionPassRateSub')} value={a.inspectionPassRate == null ? t('processor.analytics.noDataValue') : `${Math.round(a.inspectionPassRate * 100)}%`} />
      </div>

      {sparse ? (
        <DashboardCard title={t('processor.analytics.breakdowns')}>
          <p className="py-4 text-center text-[13px] text-emerald-900/55">
            {t('processor.analytics.sparse', { min: MIN_ROWS, have: a.awardCount })}
          </p>
        </DashboardCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <DashboardCard title={t('processor.analytics.spendByCommodity')}>
            <Bars rows={a.byCommodity.map((c) => ({ label: t('processor.analytics.commodityRow', { commodity: c.commodity, price: formatNaira(Math.round(c.avgPrice)) }), value: c.spend }))} max={commodityMax} fmt={formatNaira} />
          </DashboardCard>
          <DashboardCard title={t('processor.analytics.topSuppliers')}>
            <Bars rows={a.topSuppliers.slice(0, 8).map((s) => ({ label: tPlural('processor.analytics.supplierRow', s.awards, { supplier: s.supplier, count: s.awards }), value: s.quantity }))} max={supplierMax} fmt={num} />
          </DashboardCard>
          <DashboardCard title={t('processor.analytics.spendByState')}>
            <Bars rows={a.byState.map((s) => ({ label: s.state, value: s.spend }))} max={stateMax} fmt={formatNaira} />
          </DashboardCard>
          <DashboardCard title={t('processor.analytics.monthlySpend')}>
            <Bars rows={a.monthly.map((m) => ({ label: m.month, value: m.spend }))} max={monthMax} fmt={formatNaira} />
          </DashboardCard>
        </div>
      )}
    </div>
  )
}
