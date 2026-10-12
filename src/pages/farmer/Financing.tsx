import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Landmark, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  APPLICATION_STATUS_META,
  type FinancingApplication,
} from '@/lib/farming'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DashboardCard } from '@/components/DashboardCard'
import { StatusStrip } from '@/components/charts/StatusStrip'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { statusMeta } from '@/lib/financingLifecycle'

/**
 * Financing home: the Input Financing product card + the farmer's own
 * applications. Loamy is the application channel only — every decision is
 * made and communicated by the partner bank.
 *
 * STATUS WORDING COMES FROM THE PACK, COLOUR FROM THE LIFECYCLE MAP.
 *   `APPLICATION_STATUS_META` still decides the chip and which actions are
 *   offered -- none of that is translated, because none of it is language.
 *   Only the words are looked up, and they are held equal to the map's
 *   English by tests/unit/financing-i18n.test.ts.
 */
export default function Financing() {
  const navigate = useNavigate()
  const { t, tOr } = useT()
  const [apps, setApps] = useState<FinancingApplication[] | null>(null)

  const [facilities, setFacilities] = useState<
    { id: string; principal: number; sector: string; status: string; opened_on: string }[]
  >([])

  const load = useCallback(async () => {
    const [{ data }, { data: facs }] = await Promise.all([
      supabase.from('financing_applications').select('*').order('created_at', { ascending: false }),
      // RLS returns only the borrower's own facilities (summary — no bank internals).
      supabase.from('facilities').select('id, principal, sector, status, opened_on').order('opened_on', { ascending: false }),
    ])
    setApps((data as FinancingApplication[]) ?? [])
    setFacilities((facs as typeof facilities) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function discardDraft(id: string) {
    await supabase.from('financing_applications').delete().eq('id', id).eq('status', 'draft')
    await load()
  }

  return (
    <div className="space-y-5">
      {/* Product card */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-emerald-800 text-gold-300">
              <Landmark className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold text-emerald-950">{t('financing.product.inputFinancing')}</h2>
              <p className="mt-0.5 text-sm font-medium text-emerald-700">
                {t('financing.product.murabahaLine')}
              </p>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-emerald-900/65">
                {t('financing.product.blurb')}
              </p>
            </div>
          </div>
          <Button className="shrink-0" onClick={() => navigate('/dashboard/farmer/financing/apply')}>
            {t('financing.applyShort')} <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </Card>

      {/* Status timeline for the most recent submitted application — built
          from real status_history transitions only. */}
      {(() => {
        const latest = (apps ?? []).find((a) => a.status !== 'draft') as
          | (FinancingApplication & { status_history?: { to: string; at: string }[] })
          | undefined
        if (!latest) return null
        // A transition the pack has no wording for renders as the raw value
        // rather than as a blank step: an unfamiliar state should look
        // unfamiliar, not invisible.
        const stageLabel = (to: string) =>
          to === 'decided_external'
            ? t('financing.stage.decisionCommunicated')
            : tOr(`financing.status.${to}`, statusMeta(to).label)
        const history = latest.status_history ?? []
        const stages = [t('financing.status.submitted'), ...history.map((h) => stageLabel(h.to))]
        const timestamps = [latest.created_at, ...history.map((h) => h.at)]
        return (
          <DashboardCard title={t('financing.latestProgress')}>
            <StatusStrip stages={stages} currentIndex={stages.length - 1} timestamps={timestamps} />
          </DashboardCard>
        )
      })()}

      {/* Active facilities — the borrower's own summary (RLS-scoped). */}
      {facilities.length > 0 && (
        <DashboardCard title={t('financing.myFacilities')}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="py-2 pr-4 font-medium">{t('financing.col.opened')}</th>
                <th className="py-2 pr-4 font-medium">{t('financing.col.principal')}</th>
                <th className="py-2 pr-4 font-medium">{t('financing.col.sector')}</th>
                <th className="py-2 font-medium">{t('financing.col.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {facilities.map((f) => (
                <tr key={f.id}>
                  <td className="py-2 pr-4 text-emerald-900/70">{formatDateShort(f.opened_on)}</td>
                  <td className="py-2 pr-4 font-mono text-[13px]">{formatNaira(Number(f.principal))}</td>
                  <td className="py-2 pr-4 text-emerald-900/70">{f.sector}</td>
                  <td className="py-2"><span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">{f.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-emerald-900/45">
            {t('financing.facilitiesNote')}
          </p>
        </DashboardCard>
      )}

      {/* Applications list */}
      <DashboardCard title={t('financing.myApplications')}>
        {apps === null ? (
          <div className="h-24 animate-pulse rounded-lg bg-emerald-50" aria-label={t('financing.loadingApplications')} />
        ) : apps.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Landmark className="h-7 w-7 text-emerald-900/20" aria-hidden />
            <p className="max-w-sm text-sm text-emerald-900/50">
              {t('financing.noApplicationsYet')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-2 pr-4 font-medium">{t('financing.col.product')}</th>
                  <th className="py-2 pr-4 font-medium">{t('financing.col.amount')}</th>
                  <th className="hidden py-2 pr-4 font-medium sm:table-cell">{t('financing.col.submitted')}</th>
                  <th className="py-2 pr-4 font-medium">{t('financing.col.status')}</th>
                  <th className="py-2 font-medium"><span className="sr-only">{t('financing.col.actions')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {apps.map((app) => {
                  const meta = APPLICATION_STATUS_META[app.status]
                  return (
                    <tr key={app.id}>
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-emerald-950">{t('financing.product.inputFinancing')}</p>
                        <p className="text-[11px] text-emerald-900/50">{t('financing.product.murabahaShort')}</p>
                        {app.status === 'decided_external' && app.decision_note && (
                          <p className="mt-1 text-[11px] text-emerald-800">{app.decision_note}</p>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-[13px] text-emerald-950">
                        {app.amount_requested > 0 ? formatNaira(Number(app.amount_requested)) : '-'}
                      </td>
                      <td className="hidden py-2.5 pr-4 text-emerald-900/70 sm:table-cell">
                        {formatDateShort(app.created_at)}
                      </td>
                      <td className="py-2.5 pr-4">
                        {/* chip and ordering from the lifecycle map; the words
                            from the pack, which is held equal to it in English. */}
                        <span
                          className={cn('rounded px-1.5 py-0.5 text-xs font-medium', meta.chip)}
                          // A status this build has not heard of renders as
                          // the lifecycle map's own fallback, never as a key.
                          title={tOr(`financing.statusHint.${app.status}`, statusMeta(app.status).applicant)}
                        >
                          {tOr(`financing.status.${app.status}`, statusMeta(app.status).label)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        {app.status === 'draft' && (
                          <span className="inline-flex items-center gap-1">
                            <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/farmer/financing/apply?draft=${app.id}`)}>
                              {t('financing.continueDraft')}
                            </Button>
                            <button
                              type="button"
                              onClick={() => discardDraft(app.id)}
                              className="flex min-h-touch min-w-touch items-center justify-center rounded text-emerald-900/35 transition-colors hover:bg-red-50 hover:text-red-600"
                              aria-label={t('financing.discardDraft')}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCard>
    </div>
  )
}
