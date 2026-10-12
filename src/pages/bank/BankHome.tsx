import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, BadgeCheck, Banknote, Coins, FileText, Inbox, Landmark, TriangleAlert, Users, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_AGGREGATE_CEILING } from '@/lib/limits'
import { RISK_TIER_META, type BankPortfolio, type PipelineRow } from '@/lib/bank'
import { statusMeta } from '@/lib/financingLifecycle'
import { cn, formatNaira } from '@/lib/utils'
import { BankShell } from '@/pages/bank/BankShell'
import { StatCard } from '@/components/StatCard'
import { DashboardCard } from '@/components/DashboardCard'
import { DonutSplit } from '@/components/charts/DonutSplit'
import { TrendLine } from '@/components/charts/TrendLine'
import { BarBreakdown } from '@/components/charts/BarBreakdown'
import { bucketWeekly } from '@/lib/charts'
import { useT } from '@/lib/i18n'

/** Bank overview — every tile is a live query; zeros are honest. */
export default function BankHome() {
  const { t, tOr, tPlural, dateShort } = useT()
  const statusLabel = (s: string) => tOr(`financing.status.${s}`, statusMeta(s).label)
  const riskLabel = (tier: string) => tOr(`bank.riskTier.${tier}`, tier)
  const navigate = useNavigate()
  const [rows, setRows] = useState<PipelineRow[] | null>(null)
  const [reportCount, setReportCount] = useState(0)
  const [monitored, setMonitored] = useState(0)
  const [portfolio, setPortfolio] = useState<BankPortfolio | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      await supabase.rpc('loamy_mark_overdue_repayments')
      const [{ data: pipeline }, reportsRes, milestonesRes, { data: pf }] = await Promise.all([
        supabase.rpc('loamy_bank_pipeline'),
        supabase.from('credit_reports').select('id', { count: 'exact', head: true }),
        supabase.from('repayment_milestones').select('application_id')
          .order('application_id', { ascending: true }).limit(BANK_AGGREGATE_CEILING),
        supabase.rpc('loamy_bank_portfolio'),
      ])
      if (cancelled) return
      setRows((pipeline as PipelineRow[]) ?? [])
      setReportCount(reportsRes.count ?? 0)
      setMonitored(new Set((milestonesRes.data ?? []).map((m) => m.application_id)).size)
      setPortfolio((pf as BankPortfolio) ?? null)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const submitted = (rows ?? []).filter((r) => r.status === 'submitted').length
  const underReview = (rows ?? []).filter((r) => ['under_review', 'info_requested'].includes(r.status)).length
  const recent = (rows ?? []).slice(0, 8)

  // Built from the statuses actually present, not a fixed list of four. A
  // bank whose queue is entirely decided used to see an empty chart.
  const donutData = [...new Set((rows ?? []).map((r) => r.status))].map((s) => ({
    name: statusLabel(s),
    value: (rows ?? []).filter((r) => r.status === s).length,
  }))
  const appsTrend = bucketWeekly(rows ?? [], [{ key: 'applications', date: (r) => r.created_at }])
  // The x-axis reads the localized label; the FILTER still matches the
  // stored tier, so translating a tier name cannot change which row it counts.
  const tierData = (['Low', 'Medium', 'High', 'Very High'] as const).map((tier) => ({
    tier: riskLabel(tier),
    applications: (rows ?? []).filter((r) => r.risk_tier === tier).length,
  }))

  // Application figures only — what applicants have REQUESTED across the live
  // pipeline. This is not a held balance or a disbursed portfolio: Loamy never
  // holds funds; the bank disburses off-platform.
  const openRows = (rows ?? []).filter((r) => r.status !== 'decided_external')
  const requestedPipeline = openRows.reduce((s, r) => s + Number(r.amount_requested), 0)
  const topApplicants = [...(rows ?? [])]
    .sort((a, b) => Number(b.amount_requested) - Number(a.amount_requested))
    .slice(0, 5)

  return (
    <BankShell section="overview">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard icon={Inbox} label={t('bank.home.submitted')} value={submitted} sub={t('bank.home.submittedSub')} loading={rows === null} />
          <StatCard icon={Landmark} label={t('bank.home.inReview')} value={underReview} sub={t('bank.home.inReviewSub')} loading={rows === null} />
          <StatCard icon={Coins} label={t('bank.home.requestedPipeline')} value={formatNaira(requestedPipeline)} sub={t('bank.home.requestedPipelineSub')} loading={rows === null} />
          <StatCard icon={FileText} label={t('bank.home.reportsGenerated')} value={reportCount} sub={t('bank.home.reportsGeneratedSub')} loading={rows === null} />
          <StatCard icon={Activity} label={t('bank.home.facilitiesMonitored')} value={monitored} sub={t('bank.home.facilitiesMonitoredSub')} loading={rows === null} />
        </div>

        {/* Loan portfolio — REAL serviced-facility figures (bank-confirmed,
            mirrored from the bank of record). Empty until facilities are opened. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Wallet} label={t('bank.home.loanPortfolio')} value={formatNaira(portfolio?.total_principal ?? 0)}
            sub={tPlural('bank.home.activeFacilities', portfolio?.active_facilities ?? 0, { count: portfolio?.active_facilities ?? 0 })} loading={portfolio === null} />
          <StatCard icon={Banknote} label={t('bank.home.disbursedMtd')} value={formatNaira(portfolio?.disbursed_mtd ?? 0)} sub={t('bank.home.disbursedMtdSub')} loading={portfolio === null} />
          <StatCard icon={Users} label={t('bank.home.borrowers')} value={portfolio?.borrowers ?? 0} sub={t('bank.home.borrowersSub')} loading={portfolio === null} />
          <StatCard icon={TriangleAlert} label={t('bank.home.par30')} value={formatNaira(portfolio?.par30_amount ?? 0)} sub={t('bank.home.par30Sub')} loading={portfolio === null} />
        </div>

        {portfolio && (portfolio.top_borrowers.length > 0 || Object.keys(portfolio.by_sector).length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2">
            <DashboardCard title={t('bank.home.portfolioBySector')}>
              <DonutSplit data={Object.entries(portfolio.by_sector).map(([name, value]) => ({ name, value: Math.round(Number(value)) }))} />
            </DashboardCard>
            <DashboardCard title={t('bank.home.topBorrowers')}>
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-line">
                  {portfolio.top_borrowers.map((b) => (
                    <tr key={b.digital_id ?? b.full_name ?? Math.random()}>
                      <td className="py-1.5 text-emerald-950">{b.full_name ?? '-'} <span className="font-mono text-[11px] text-emerald-900/45">{b.digital_id}</span></td>
                      <td className="py-1.5 text-right font-mono text-[13px]">{formatNaira(Number(b.outstanding))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DashboardCard>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <DashboardCard title={t('bank.home.pipelineByStatus')}>
            <DonutSplit data={donutData} />
          </DashboardCard>
          <DashboardCard title={t('bank.home.applicationsWeekly')}>
            <TrendLine data={appsTrend} series={[{ key: 'applications', label: t('bank.home.applications') }]} height={170} />
          </DashboardCard>
          <DashboardCard title={t('bank.home.riskTierDistribution')}>
            <BarBreakdown data={tierData} xKey="tier" series={[{ key: 'applications', label: t('bank.home.applications') }]} height={170} />
          </DashboardCard>
        </div>

        <DashboardCard title={t('bank.home.recentPipeline')}>
          {recent.length === 0 ? (
            <p className="py-3 text-sm text-emerald-900/55">
              {t('bank.home.noApplications')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                    <th className="py-2 pr-4 font-medium">{t('bank.col.applicant')}</th>
                    <th className="py-2 pr-4 font-medium">{t('bank.col.amount')}</th>
                    <th className="hidden py-2 pr-4 font-medium sm:table-cell">{t('bank.col.risk')}</th>
                    <th className="py-2 font-medium">{t('bank.col.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {recent.map((r) => (
                    <tr key={r.id} className="cursor-pointer transition-colors hover:bg-emerald-50/60" onClick={() => navigate(`/bank/application/${r.id}`)}>
                      <td className="py-2 pr-4">
                        <p className="flex items-center gap-1 font-medium text-emerald-950">
                          {r.applicant_name ?? '-'}
                          {r.verified_badge && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label={t('financing.bank.verifiedAria')} />}
                        </p>
                        <p className="font-mono text-[11px] text-emerald-900/50">{r.digital_id} · {dateShort(r.created_at)}</p>
                      </td>
                      <td className="py-2 pr-4 font-mono text-[13px]">{formatNaira(Number(r.amount_requested))}</td>
                      <td className="hidden py-2 pr-4 sm:table-cell">
                        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', RISK_TIER_META[r.risk_tier].chip)}>{riskLabel(r.risk_tier)}</span>
                      </td>
                      <td className="py-2">
                        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', statusMeta(r.status).chip)}>{statusLabel(r.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCard>

        {topApplicants.length > 0 && (
          <DashboardCard title={t('bank.home.topApplicants')}>
            <p className="mb-2 text-[11px] text-emerald-900/45">
              {t('bank.home.requestedNotOutstanding')}
            </p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-2 pr-4 font-medium">{t('bank.col.applicant')}</th>
                  <th className="py-2 pr-4 font-medium">{t('bank.col.requested')}</th>
                  <th className="py-2 font-medium">{t('bank.col.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {topApplicants.map((r) => (
                  <tr key={r.id} className="cursor-pointer transition-colors hover:bg-emerald-50/60" onClick={() => navigate(`/bank/application/${r.id}`)}>
                    <td className="py-2 pr-4 font-medium text-emerald-950">{r.applicant_name ?? '-'}</td>
                    <td className="py-2 pr-4 font-mono text-[13px]">{formatNaira(Number(r.amount_requested))}</td>
                    <td className="py-2">
                      <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', statusMeta(r.status).chip)}>{statusLabel(r.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashboardCard>
        )}
      </div>
    </BankShell>
  )
}
