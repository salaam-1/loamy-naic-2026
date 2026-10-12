import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { REPORT_FOOTER, RISK_METHOD_LABEL, RISK_TIER_META, type CreditReport } from '@/lib/bank'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { BarBreakdown } from '@/components/charts/BarBreakdown'
import { yieldBySeason } from '@/lib/charts'
import { cn, formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * Credit Intelligence Report — renders the IMMUTABLE snapshot only (never
 * live data), print-clean for A4 browser print-to-PDF. Five sections per the
 * Architecture Guide: Identity & Verification / Production Profile / Activity
 * Signals / Financing Context / Risk Classification (factor breakdown).
 */
export default function ReportView() {
  const { t, tOr, dateShort } = useT()
  /** A stored status from the report snapshot, in the reader's language. */
  const statusLabel = (st: string) => tOr(`financing.status.${st}`, st.replace(/_/g, ' '))
  const { reportId } = useParams()
  const [report, setReport] = useState<CreditReport | null | 'missing'>(null)

  useEffect(() => {
    if (!reportId) return
    let cancelled = false
    supabase
      .from('credit_reports')
      .select('*')
      .eq('id', reportId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setReport((data as CreditReport) ?? 'missing')
      })
    return () => {
      cancelled = true
    }
  }, [reportId])

  if (report === null) {
    return <div className="mx-auto mt-10 h-40 max-w-3xl animate-pulse rounded bg-white" aria-label={t('bank.report.loading')} />
  }
  if (report === 'missing') {
    return (
      <div className="mx-auto mt-10 max-w-3xl rounded border border-line bg-white p-6 text-sm text-emerald-900/60">
        {t('bank.report.notFound')}
      </div>
    )
  }

  const { bundle, risk, bank } = report.snapshot
  const id = bundle.identity
  const app = bundle.application

  const Section = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <section className="report-section mt-5">
      <h2 className="border-b border-line pb-1 text-[13px] font-semibold uppercase tracking-wide text-emerald-800">
        {n} · {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  )

  return (
    <div className="min-h-screen bg-surface print:bg-white">
      {/* Screen-only toolbar */}
      <div className="no-print sticky top-0 z-10 border-b border-line bg-white">
        <div className="mx-auto flex h-12 max-w-3xl items-center justify-between px-4">
          <Link to={`/bank/application/${report.application_id}`} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('bank.report.backToApplication')}
          </Link>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden /> {t('bank.report.print')}
          </Button>
        </div>
      </div>

      {/* A4 document */}
      <div className="report-page mx-auto my-6 max-w-3xl rounded border border-line bg-white p-8 text-[13px] leading-relaxed text-emerald-950 print:my-0 print:max-w-none print:rounded-none print:border-0 print:p-0">
        {/* Header */}
        <header className="flex items-start justify-between border-b-2 border-emerald-800 pb-3">
          <div>
            <Logo />
            <p className="mt-1 text-[11px] text-emerald-900/55">Credit Intelligence Report · prepared for {bank}</p>
          </div>
          <div className="text-right font-mono text-[11px] text-emerald-900/60">
            <p>{t('bank.report.reportId', { id: report.id.slice(0, 8).toUpperCase() })}</p>
            <p>{t('bank.report.generatedOn', { date: dateShort(report.created_at) })}</p>
            <p>{t('bank.report.applicationId', { id: app.id.slice(0, 8).toUpperCase() })}</p>
          </div>
        </header>

        <Section n={1} title={t('bank.report.identitySection')}>
          <table className="w-full text-left">
            <tbody>
              <tr>
                <td className="w-40 py-0.5 text-emerald-900/55">{t('bank.report.fullName')}</td>
                <td className="py-0.5 font-medium">{id?.full_name ?? '-'}</td>
                <td className="w-40 py-0.5 text-emerald-900/55">{t('bank.report.digitalId')}</td>
                <td className="py-0.5 font-mono">{id?.digital_id ?? '-'}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-emerald-900/55">{t('bank.report.state')}</td>
                <td className="py-0.5">{id?.state ?? '-'}</td>
                <td className="py-0.5 text-emerald-900/55">{t('bank.report.memberSince')}</td>
                <td className="py-0.5">{dateShort(id?.member_since)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-emerald-900/55">{t('bank.report.phone')}</td>
                <td className="py-0.5 font-mono">{id?.phone ?? '-'}</td>
                <td className="py-0.5 text-emerald-900/55">{t('bank.report.identityBadge')}</td>
                <td className="py-0.5">{id?.verified_badge ? t('bank.report.verifiedThroughField') : t('bank.report.notVerified')}</td>
              </tr>
            </tbody>
          </table>
          {bundle.farms.map((f) => (
            <p key={f.id} className="mt-1.5">
              <span className="font-medium">{f.farm_name}</span> - {f.lga}, {f.state} ·{' '}
              <span className="font-mono">
                {t('bank.report.hectares', { size: Number(f.size_hectares) })}
              </span> · {f.ownership_type} ·{' '}
              {/* Assembled from three keys rather than one sentence because the
                  date and the GPS clauses are each optional. `ownership_type`
                  stays as the database wrote it: it is a stored value. */}
              {f.verification_status === 'verified'
                ? `${t('bank.report.fieldVerified')}${
                  f.verified_at ? t('bank.report.verifiedOnDate', { date: dateShort(f.verified_at) }) : ''
                }${
                  f.latitude !== null
                    ? t('bank.report.atGps', { lat: Number(f.latitude), lng: Number(f.longitude) })
                    : ''
                }`
                : t('bank.report.verificationStatus', { status: f.verification_status })}
            </p>
          ))}
        </Section>

        <Section n={2} title={t('bank.report.productionSection')}>
          {/* Chart renders from the FROZEN snapshot records (fixed width so
              browser print lays it out reliably). */}
          {(() => {
            const y = yieldBySeason(bundle.farms.flatMap((f) => f.crop_records))
            if (y.rows.length === 0) return null
            return (
              <div className="mb-2">
                <BarBreakdown data={y.rows} xKey="season" series={y.series} height={150} width={620} />
              </div>
            )
          })()}
          {bundle.farms.every((f) => f.crop_records.length === 0) ? (
            <p className="text-emerald-900/55">{t('bank.report.noSeasonRecords')}</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-1 pr-3 font-medium">{t('bank.report.farm')}</th>
                  <th className="py-1 pr-3 font-medium">{t('bank.report.season')}</th>
                  <th className="py-1 pr-3 font-medium">{t('bank.report.crop')}</th>
                  <th className="py-1 pr-3 font-medium">{t('bank.report.expectedKg')}</th>
                  <th className="py-1 font-medium">{t('bank.report.actualKg')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bundle.farms.flatMap((f) =>
                  f.crop_records.map((c, i) => (
                    <tr key={f.id + i}>
                      <td className="py-1 pr-3">{f.farm_name}</td>
                      <td className="py-1 pr-3 font-mono">{c.season_year}</td>
                      <td className="py-1 pr-3">{c.crop}</td>
                      <td className="py-1 pr-3 font-mono">{c.expected_yield_kg ?? '-'}</td>
                      <td className="py-1 font-mono">{c.actual_yield_kg ?? '-'}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
        </Section>

        <Section n={3} title={t('bank.report.activitySection')}>
          <p>
            {t('bank.report.activeListings')} <span className="font-mono">{bundle.activity.active_listings}</span> ·
            Concluded marketplace connections: <span className="font-mono">{bundle.activity.concluded_deals}</span> ·
            Onboarded by a Loamy field partner: {bundle.activity.onboarded_by_partner ? 'yes' : 'no'}
          </p>
        </Section>

        <Section n={4} title={t('bank.report.financingSection')}>
          <p>
            {t('bank.report.requestedLabel')} <span className="font-mono font-semibold">{formatNaira(Number(app.amount_requested))}</span> ·
            {t('bank.report.productLine')}{' '}
            {app.disbursement_preference === 'supplier_payment'
              ? t('bank.report.supplierPayment')
              : app.disbursement_preference ?? '-'}
          </p>
          <p className="mt-1 text-emerald-900/70">{t('bank.report.purpose', { purpose: app.purpose })}</p>
          {app.intended_items.length > 0 && (
            <p className="mt-1 text-emerald-900/70">
              {t('bank.report.itemisedUse', {
                items: app.intended_items.map((it) => `${it.item} (${it.qty})`).join('; '),
              })}
            </p>
          )}
          {bundle.financing_context.prior_applications.length > 0 && (
            <p className="mt-1 text-emerald-900/70">
              {t('bank.report.priorApplications', {
                list: bundle.financing_context.prior_applications
                  .map((p) => `${formatNaira(Number(p.amount_requested))} (${statusLabel(p.status)}, ${dateShort(p.created_at)})`)
                  .join('; '),
              })}
            </p>
          )}
          {bundle.financing_context.milestones.length > 0 && (
            <p className="mt-1 text-emerald-900/70">
              {t('bank.report.monitoredMilestones', {
                met: bundle.financing_context.milestones.filter((m) => m.status === 'met').length,
                missed: bundle.financing_context.milestones.filter((m) => m.status === 'missed').length,
                upcoming: bundle.financing_context.milestones.filter((m) => m.status === 'upcoming').length,
              })}
            </p>
          )}
        </Section>

        <Section n={5} title={t('bank.report.riskSection')}>
          <p className="flex items-center gap-2">
            <span className={cn('rounded px-2 py-0.5 text-sm font-semibold', RISK_TIER_META[risk.tier].chip)}>{tOr(`bank.riskTier.${risk.tier}`, risk.tier)}</span>
            <span className="font-mono text-[12px] text-emerald-900/55">{t('bank.report.score', { score: risk.score })}</span>
          </p>
          <table className="mt-2 w-full text-left">
            <tbody className="divide-y divide-line">
              {risk.factors.map((f) => (
                <tr key={f.key}>
                  <td className="py-1 pr-3">
                    <span className="font-medium">{f.label}</span>
                    <span className="text-emerald-900/55"> - {f.detail}</span>
                  </td>
                  <td className={cn('py-1 text-right font-mono', f.points > 0 ? 'text-emerald-700' : f.points < 0 ? 'text-red-600' : 'text-emerald-900/40')}>
                    {f.points > 0 ? `+${f.points}` : f.points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-emerald-900/55">{tOr('bank.riskRuleBased', RISK_METHOD_LABEL)}</p>
        </Section>

        <footer className="mt-6 border-t-2 border-emerald-800 pt-2 text-center text-[11px] font-medium text-emerald-900/70">
          {tOr('bank.decisionSupportOnly', REPORT_FOOTER)}
        </footer>
      </div>
    </div>
  )
}
