import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { RISK_TIER_META, type CreditReport } from '@/lib/bank'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'

interface ReportRow extends CreditReport {
  applicant_name?: string
}

/** All generated reports (immutable snapshots), newest first. */
export default function BankReports() {
  const { t, tOr, dateShort } = useT()
  const [reports, setReports] = useState<ReportRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('credit_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (cancelled) return
        const rows = ((data as CreditReport[]) ?? []).map((r) => ({
          ...r,
          applicant_name: r.snapshot?.bundle?.identity?.full_name ?? undefined,
        }))
        setReports(rows)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <BankShell section="reports">
      <div className="space-y-3">
        <h1 className="text-base font-semibold text-emerald-950">
          {t('bank.reports.title')}{' '}
          <span className="font-mono text-sm font-normal text-emerald-900/50">{reports?.length ?? ''}</span>
        </h1>
        {reports === null ? (
          <div className="h-32 animate-pulse rounded bg-white" aria-label={t('bank.reports.loading')} />
        ) : reports.length === 0 ? (
          <Card className="flex items-center gap-2.5 px-4 py-4">
            <FileText className="h-5 w-5 text-emerald-700" aria-hidden />
            <p className="text-sm text-emerald-900/60">
              {t('bank.reports.noneYet')}
            </p>
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="px-4 py-2 font-medium">{t('bank.col.report')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.applicant')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.riskTier')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.generated')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5">
                      <Link to={`/bank/reports/${r.id}`} className="font-mono text-[12px] font-medium text-emerald-700 hover:text-emerald-800">
                        {r.id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-emerald-950">{r.applicant_name ?? '-'}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', RISK_TIER_META[r.risk_tier].chip)}>{r.risk_tier}</span>
                    </td>
                    <td className="px-4 py-2.5 text-emerald-900/70">{dateShort(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </BankShell>
  )
}
