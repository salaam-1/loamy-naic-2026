import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_AGGREGATE_CEILING } from '@/lib/limits'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import type { BankPortfolio, Facility } from '@/lib/bank'
import { formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { StatCard } from '@/components/StatCard'
import { DashboardCard } from '@/components/DashboardCard'
import { Card } from '@/components/ui/card'

/** Risk & compliance: PAR, exposure, and borrower verification standing —
 * real figures from serviced facilities. */
export default function BankRiskCompliance() {
  const { t } = useT()
  const [portfolio, setPortfolio] = useState<BankPortfolio | null>(null)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [borrowers, setBorrowers] = useState<Record<string, PublicProfile>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      await supabase.rpc('loamy_mark_overdue_repayments')
      const [{ data: pf }, { data: facs }] = await Promise.all([
        supabase.rpc('loamy_bank_portfolio'),
        supabase.from('facilities').select('*').eq('status', 'active')
          .order('id', { ascending: true }).limit(BANK_AGGREGATE_CEILING),
      ])
      if (cancelled) return
      const f = (facs as Facility[]) ?? []
      setPortfolio(pf as BankPortfolio)
      setFacilities(f)
      setBorrowers(await fetchPublicProfiles(f.map((x) => x.borrower_id)))
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const parRatio = portfolio && portfolio.total_principal > 0
    ? ((portfolio.par30_amount / portfolio.total_principal) * 100).toFixed(2)
    : '0.00'
  const unverified = facilities.filter((f) => !borrowers[f.borrower_id]?.verified_badge)

  return (
    <BankShell section="risk">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={ShieldCheck} label={t('bank.risk.portfolioAtRisk')} value={`${parRatio}%`} sub={t('bank.risk.portfolioAtRiskSub')} loading={!portfolio} />
          <StatCard icon={ShieldCheck} label={t('bank.risk.par30')} value={formatNaira(portfolio?.par30_amount ?? 0)} sub={t('bank.risk.par30Sub')} loading={!portfolio} />
          <StatCard icon={ShieldCheck} label={t('bank.risk.activePrincipal')} value={formatNaira(portfolio?.total_principal ?? 0)} sub={t('bank.risk.activePrincipalSub')} loading={!portfolio} />
          <StatCard icon={ShieldCheck} label={t('bank.risk.unverifiedBorrowers')} value={unverified.length} sub={t('bank.risk.unverifiedBorrowersSub')} loading={!portfolio} />
        </div>

        <DashboardCard title={t('bank.risk.complianceTitle')}>
          {facilities.length === 0 ? (
            <p className="py-2 text-sm text-emerald-900/55">{t('bank.risk.noActiveFacilities')}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-2 pr-4 font-medium">{t('bank.col.customer')}</th>
                  <th className="py-2 pr-4 font-medium">{t('bank.col.principal')}</th>
                  <th className="py-2 font-medium">{t('bank.col.identityVerified')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {facilities.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2 pr-4 text-emerald-950">{borrowers[f.borrower_id]?.full_name ?? '-'}</td>
                    <td className="py-2 pr-4 font-mono text-[13px]">{formatNaira(Number(f.principal))}</td>
                    <td className="py-2">
                      {borrowers[f.borrower_id]?.verified_badge
                        ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">{t('bank.risk.verified')}</span>
                        : <span className="rounded bg-gold-100 px-1.5 py-0.5 text-xs font-medium text-gold-700">{t('bank.risk.notVerified')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DashboardCard>

        <Card className="px-4 py-3 text-[12px] text-emerald-900/60">
          Figures are real, from serviced facilities. Loamy is the origination and monitoring
          layer - fund custody and settlement remain at the bank of record.
        </Card>
      </div>
    </BankShell>
  )
}
