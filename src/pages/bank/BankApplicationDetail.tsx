import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, FileText, MapPin, Package, ShieldAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_LIST_LIMIT } from '@/lib/limits'
import {
  RISK_METHOD_LABEL, RISK_TIER_META,
  type ApplicationBundle, type CreditReport, type RiskAssessment,
} from '@/lib/bank'
import { provenanceLabel, statusMeta } from '@/lib/financingLifecycle'
import { errorMessage } from '@/lib/errors'
import { DecisionPanel } from '@/pages/bank/DecisionPanel'
import { SettlementPanel } from '@/pages/bank/SettlementPanel'
import { cn, formatNaira } from '@/lib/utils'
import { BankShell } from '@/pages/bank/BankShell'
import { FarmMap } from '@/components/FarmMap'
import { BarBreakdown } from '@/components/charts/BarBreakdown'
import { yieldBySeason } from '@/lib/charts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DashboardCard } from '@/components/DashboardCard'
import { useT } from '@/lib/i18n'

/**
 * The full application bundle — served exclusively by the security-definer
 * bundle function; the bank has no raw table access to applicant data.
 *
 * Phase 4 slice 3 connected the decision. The old comment here read "Status
 * controls are LIMITED to: Under review / Request info / Mark decision
 * communicated. There is deliberately no approve and no decline." That was
 * the Stage 5 design, and it stopped matching the backend at Phase 6, which
 * added loamy_financing_decision with amount, tenor, pricing, bank reference
 * and provenance -- and no caller. An officer now decides here. Loamy still
 * makes no credit decision and owns no credit policy; it records the
 * institution's, and refuses to let anyone else write it.
 */
export default function BankApplicationDetail() {
  const { appId } = useParams()
  const navigate = useNavigate()
  const { t, tOr, num, dateShort } = useT()
  const [bundle, setBundle] = useState<ApplicationBundle | null>(null)
  const [risk, setRisk] = useState<RiskAssessment | null>(null)
  const [reports, setReports] = useState<CreditReport[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!appId) return
    const [bundleRes, riskRes, reportsRes] = await Promise.all([
      supabase.rpc('loamy_application_bundle', { p_app: appId }),
      supabase.rpc('loamy_risk_assessment', { p_app: appId }),
      supabase.from('credit_reports').select('id, risk_tier, created_at').eq('application_id', appId)
        .order('created_at', { ascending: false }).order('id', { ascending: true })
        .limit(BANK_LIST_LIMIT),
    ])
    if (bundleRes.error) {
      setError(errorMessage(bundleRes.error, t('bank.detail.couldNotLoad')))
      return
    }
    setBundle(bundleRes.data as ApplicationBundle)
    setRisk(riskRes.data as RiskAssessment)
    setReports((reportsRes.data as CreditReport[]) ?? [])
  }, [appId])

  useEffect(() => {
    void load()
  }, [load])

  async function generateReport() {
    setError(null)
    setBusy('report')
    const { data, error: rpcErr } = await supabase.rpc('loamy_generate_credit_report', { p_app: appId })
    setBusy(null)
    if (rpcErr) {
      setError(errorMessage(rpcErr, t('bank.detail.reportFailed')))
      return
    }
    navigate(`/bank/reports/${data}`)
  }

  if (!bundle) {
    return (
      <BankShell section="pipeline">
        {error ? (
          <Card className="px-4 py-4 text-sm text-red-700">{error}</Card>
        ) : (
          <div className="h-32 animate-pulse rounded bg-white" aria-label={t('financing.bank.loadingApplication')} />
        )}
      </BankShell>
    )
  }

  const app = bundle.application
  const id = bundle.identity
  const meta = statusMeta(app.status)
  const txn = bundle.transaction

  return (
    <BankShell section="pipeline">
      <div className="space-y-4">
        <Link to="/bank/pipeline" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('financing.bank.backToPipeline')}
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-emerald-950">
              {id?.full_name ?? t('financing.bank.applicant')}
              {id?.verified_badge && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label={t('financing.bank.verifiedAria')} />}
              {/* chip from the lifecycle map, wording from the pack */}
              <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', meta.chip)}>
                {tOr(`financing.status.${app.status}`, meta.label)}
              </span>
              {app.is_sandbox && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                  {t('financing.bank.sandbox')}
                </span>
              )}
            </h1>
            <p className="font-mono text-[11px] text-emerald-900/50">
              {/* ref, digital ID, state and phone are the record itself. */}
              {app.ref ?? ''}{app.ref ? ' · ' : ''}{id?.digital_id} · {t('financing.bank.memberSince')}{' '}
              {dateShort(id?.member_since)} · {id?.state ?? '-'} · {id?.phone ?? t('financing.bank.noPhone')}
            </p>
          </div>
          <Button size="sm" variant="gold" loading={busy === 'report'} onClick={generateReport}>
            <FileText className="h-4 w-4" aria-hidden /> {t('financing.bank.generateReport')}
          </Button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            {/* What the money is for. A transaction-linked application is
                financing THIS purchase -- this batch, this seller, this
                price -- so the bank can see exactly what it is funding. Null
                on the older farmer input-financing path, which is not
                transaction-linked, and then simply not rendered. */}
            {txn && (
              <DashboardCard title={t('financing.bank.purchaseFinanced')}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.transaction')}</dt>
                    <dd className="font-mono text-[13px] font-semibold">{txn.ref}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.commodity')}</dt>
                    <dd className="flex items-center gap-1">
                      <Package className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
                      {txn.commodity}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.quantity')}</dt>
                    <dd className="font-mono text-[13px]">
                      {num(Number(txn.quantity))} {txn.unit}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.purchaseTotal')}</dt>
                    <dd className="font-mono text-[13px] font-semibold">{formatNaira(Number(txn.subtotal))}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.seller')}</dt>
                    <dd>{txn.seller_name ?? '-'}{txn.seller_state ? ` · ${txn.seller_state}` : ''}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.agreement')}</dt>
                    <dd>{txn.status.replace(/_/g, ' ')}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.payment')}</dt>
                    <dd>{txn.payment_state.replace(/_/g, ' ')}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.stock')}</dt>
                    {/* A batch reference means traceable stock behind the
                        purchase. No batch means a seller declaration, and
                        saying so is more useful than leaving it blank. */}
                    <dd className="font-mono text-[13px]">
                      {txn.batch_ref ?? <span className="font-sans text-emerald-900/55">{t('financing.bank.sellerDeclaration')}</span>}
                    </dd>
                  </div>
                </dl>
              </DashboardCard>
            )}

            {/* Requested facility */}
            <DashboardCard title={t('financing.bank.requestedFacility')}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.amount')}</dt>
                  <dd className="font-mono text-[13px] font-semibold">{formatNaira(Number(app.amount_requested))}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.product')}</dt>
                  <dd>{t('financing.bank.productLine')}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.disbursement')}</dt>
                  <dd className={app.disbursement_preference === 'supplier_payment' ? 'font-medium text-emerald-800' : ''}>
                    {app.disbursement_preference === 'supplier_payment'
                      ? t('financing.bank.supplierPaymentLong')
                      : app.disbursement_preference === 'cash' ? t('financing.bank.cash') : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-emerald-900/50">{t('financing.bank.submitted')}</dt>
                  <dd>{dateShort(app.submitted_at)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-emerald-900/70">{app.purpose}</p>
              {app.intended_items.length > 0 && (
                <table className="mt-3 w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                      <th className="py-1.5 pr-4 font-medium">{t('financing.bank.intendedItem')}</th>
                      <th className="py-1.5 font-medium">{t('financing.bank.qty')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {app.intended_items.map((it, i) => (
                      <tr key={i}>
                        <td className="py-1.5 pr-4">{it.item}</td>
                        <td className="py-1.5 font-mono text-[13px]">{it.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {app.decision_note && (
                <p className="mt-3 rounded bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">{app.decision_note}</p>
              )}
            </DashboardCard>

            {/* Yield history across all the applicant's farms */}
            {(() => {
              const y = yieldBySeason(bundle.farms.flatMap((f) => f.crop_records))
              if (y.rows.length === 0) return null
              return (
                <DashboardCard title={t('financing.bank.yieldHistory')}>
                  <BarBreakdown data={y.rows} xKey="season" series={y.series} height={170} />
                </DashboardCard>
              )
            })()}

            {/* Farms & records */}
            <DashboardCard title={t('financing.bank.farmsAndProduction')}>
              {bundle.farms.length === 0 ? (
                <p className="py-2 text-sm text-emerald-900/55">{t('financing.bank.noFarms')}</p>
              ) : (
                <div className="space-y-4">
                  {bundle.farms.map((f) => (
                    <div key={f.id} className="rounded border border-line p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-emerald-950">
                          {f.farm_name}
                          <span className="ml-2 text-xs text-emerald-900/55">
                            {f.lga}, {f.state} · <span className="font-mono">{Number(f.size_hectares)} ha</span> · {f.ownership_type}
                          </span>
                        </p>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-xs font-medium',
                            f.verification_status === 'verified'
                              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                              : 'bg-emerald-950/5 text-emerald-900/60',
                          )}
                        >
                          {/* An unrecognised verification status renders as
                              itself rather than as a blank chip. */}
                          {f.verification_status === 'verified'
                            ? t('financing.bank.verifiedOn', {
                                date: f.verified_at ? dateShort(f.verified_at) : '',
                              })
                            : f.verification_status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-emerald-900/60">{t('financing.bank.crops', { crops: f.primary_crops.join(', ') })}</p>
                      {f.latitude !== null && f.longitude !== null && (
                        <>
                          <FarmMap latitude={Number(f.latitude)} longitude={Number(f.longitude)} className="mt-2 h-36 overflow-hidden rounded" />
                          <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-emerald-900/50">
                            <MapPin className="h-3 w-3" aria-hidden /> {Number(f.latitude)}, {Number(f.longitude)}
                            {f.verification_status === 'verified' && ` · ${t('financing.bank.gpsConfirmed')}`}
                          </p>
                        </>
                      )}
                      {f.crop_records.length > 0 && (
                        <table className="mt-2 w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-emerald-900/50">
                              <th className="py-1 pr-3 font-medium">{t('financing.bank.season')}</th>
                              <th className="py-1 pr-3 font-medium">{t('financing.bank.crop')}</th>
                              <th className="py-1 pr-3 font-medium">{t('financing.bank.expectedKg')}</th>
                              <th className="py-1 font-medium">{t('financing.bank.actualKg')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {f.crop_records.map((c, i) => (
                              <tr key={i}>
                                <td className="py-1 pr-3 font-mono">{c.season_year}</td>
                                <td className="py-1 pr-3">{c.crop}</td>
                                <td className="py-1 pr-3 font-mono">{c.expected_yield_kg ?? '-'}</td>
                                <td className="py-1 font-mono">{c.actual_yield_kg ?? '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </DashboardCard>

            {/* Activity + prior financing */}
            <div className="grid gap-4 sm:grid-cols-2">
              <DashboardCard title={t('financing.bank.marketplaceActivity')}>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-emerald-900/60">{t('financing.bank.activeListings')}</dt><dd className="font-mono">{bundle.activity.active_listings}</dd></div>
                  <div className="flex justify-between"><dt className="text-emerald-900/60">{t('financing.bank.concludedConnections')}</dt><dd className="font-mono">{bundle.activity.concluded_deals}</dd></div>
                  <div className="flex justify-between"><dt className="text-emerald-900/60">{t('financing.bank.onboardedByPartner')}</dt><dd>{bundle.activity.onboarded_by_partner ? t('common.yes') : t('common.no')}</dd></div>
                </dl>
              </DashboardCard>
              <DashboardCard title={t('financing.bank.priorApplications')}>
                {bundle.financing_context.prior_applications.length === 0 ? (
                  <p className="text-sm text-emerald-900/55">{t('financing.bank.noneOnRecord')}</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {bundle.financing_context.prior_applications.map((p) => (
                      <li key={p.id} className="flex justify-between gap-2">
                        <span className="text-emerald-900/70">{dateShort(p.created_at)} · {p.status}</span>
                        <span className="font-mono">{formatNaira(Number(p.amount_requested))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </DashboardCard>
            </div>
          </div>

          <div className="space-y-4">
            {/* Risk */}
            {risk && (
              <DashboardCard title={t('financing.bank.riskClassification')}>
                <div className="flex items-center justify-between">
                  <span className={cn('rounded px-2 py-0.5 text-sm font-semibold', RISK_TIER_META[risk.tier].chip)}>{risk.tier}</span>
                  <span className="font-mono text-xs text-emerald-900/50">{t('financing.bank.score', { score: risk.score })}</span>
                </div>
                <table className="mt-3 w-full text-left text-xs">
                  <tbody className="divide-y divide-line">
                    {risk.factors.map((f) => (
                      <tr key={f.key}>
                        <td className="py-1.5 pr-2">
                          <p className="font-medium text-emerald-950">{f.label}</p>
                          <p className="text-[11px] text-emerald-900/55">{f.detail}</p>
                        </td>
                        <td className={cn('py-1.5 text-right font-mono text-[13px]', f.points > 0 ? 'text-emerald-700' : f.points < 0 ? 'text-red-600' : 'text-emerald-900/40')}>
                          {f.points > 0 ? `+${f.points}` : f.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-emerald-900/50">{RISK_METHOD_LABEL}</p>
              </DashboardCard>
            )}

            {/* The decision itself. Actions come from the server's
                permitted_decisions, so Approve cannot appear on an
                application that is already decided. */}
            <DecisionPanel bundle={bundle} onDecided={load} />

            {/* What the institution actually decided, read back to it. */}
            {(app.approved_amount != null || app.decided_at || app.bank_reference) && (
              <DashboardCard title={t('financing.bank.recordedDecision')}>
                <dl className="space-y-1.5 text-sm">
                  {app.approved_amount != null && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-emerald-900/60">{t('financing.bank.approved')}</dt>
                      <dd className="font-mono text-[13px] font-semibold">
                        {formatNaira(Number(app.approved_amount))}
                      </dd>
                    </div>
                  )}
                  {/* Three distinct numbers, never merged into one. */}
                  <div className="flex justify-between gap-2">
                    <dt className="text-emerald-900/60">{t('financing.bank.requested')}</dt>
                    <dd className="font-mono text-[13px]">{formatNaira(Number(app.amount_requested))}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-emerald-900/60">{t('financing.bank.disbursed')}</dt>
                    <dd className="font-mono text-[13px]">{formatNaira(Number(app.disbursed_amount))}</dd>
                  </div>
                  {app.tenor_days != null && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-emerald-900/60">{t('financing.bank.tenor')}</dt>
                      <dd className="font-mono text-[13px]">{t('financing.bank.tenorDays', { days: app.tenor_days })}</dd>
                    </div>
                  )}
                  {app.pricing_note && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-emerald-900/60">{t('financing.bank.pricing')}</dt>
                      <dd className="text-right">{app.pricing_note}</dd>
                    </div>
                  )}
                  {app.bank_reference && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-emerald-900/60">{t('financing.bank.yourReference')}</dt>
                      <dd className="font-mono text-[13px]">{app.bank_reference}</dd>
                    </div>
                  )}
                  {app.decided_at && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-emerald-900/60">{t('financing.bank.decided')}</dt>
                      <dd>{dateShort(app.decided_at)}</dd>
                    </div>
                  )}
                </dl>
                {app.conditions && (
                  <p className="mt-2 rounded bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
                    {app.conditions}
                  </p>
                )}
                {/* Provenance, said plainly. A sandbox result carries the
                    words "not a real credit decision" every time. */}
                <p className={cn(
                  'mt-2 flex items-start gap-1.5 border-t border-line pt-2 text-[11px] leading-relaxed',
                  app.is_sandbox ? 'text-amber-800' : 'text-emerald-900/55',
                )}>
                  {app.is_sandbox && <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
                  {provenanceLabel(app.decision_source, app.is_sandbox)}
                </p>
              </DashboardCard>
            )}

            {/* Settlement — only meaningful once the institution approved.
                The gate itself lives in loamy_record_supplier_settlement,
                which re-runs readiness before writing anything. */}
            {['approved', 'partially_approved', 'disbursed'].includes(app.status) && (
              <SettlementPanel
                applicationId={app.id}
                approvedAmount={app.approved_amount}
                disbursedAmount={Number(app.disbursed_amount ?? 0)}
                isSandbox={app.is_sandbox}
                bankName={bundle.bank?.name ?? null}
                onSettled={load}
              />
            )}

            {/* The append-only trail. The portal is not the only record of
                who did what, and this makes that visible. */}
            {(bundle.events ?? []).length > 0 && (
              <DashboardCard title={t('financing.bank.decisionTrail')}>
                <ul className="divide-y divide-line text-sm">
                  {(bundle.events ?? []).map((e, i) => (
                    <li key={i} className="py-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-emerald-950">
                          {tOr(
                            `financing.status.${e.new_status ?? e.event_type}`,
                            statusMeta(e.new_status ?? e.event_type).label,
                          )}
                        </span>
                        <span className="font-mono text-[11px] text-emerald-900/50">
                          {dateShort(e.occurred_at)}
                        </span>
                      </div>
                      <p className="text-[11px] text-emerald-900/55">
                        {e.actor_kind === 'bank' ? t('financing.bank.actor.bank')
                          : e.actor_kind === 'applicant' ? t('financing.bank.actor.applicant')
                          : e.actor_kind === 'platform' ? t('financing.bank.actor.platform')
                          : t('financing.bank.actor.system')}
                        {e.amount != null ? ` · ${formatNaira(Number(e.amount))}` : ''}
                      </p>
                      {e.note && <p className="mt-0.5 text-xs text-emerald-900/70">{e.note}</p>}
                    </li>
                  ))}
                </ul>
              </DashboardCard>
            )}

            {/* Reports */}
            <DashboardCard title={t('financing.bank.generatedReports')}>
              {reports.length === 0 ? (
                <p className="text-sm text-emerald-900/55">{t('financing.bank.noReports')}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {reports.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                      <Link to={`/bank/reports/${r.id}`} className="font-mono text-[12px] text-emerald-700 hover:text-emerald-800">
                        {r.id.slice(0, 8)} · {dateShort(r.created_at)}
                      </Link>
                      <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', RISK_TIER_META[r.risk_tier].chip)}>{r.risk_tier}</span>
                    </li>
                  ))}
                </ul>
              )}
            </DashboardCard>
          </div>
        </div>
      </div>
    </BankShell>
  )
}
