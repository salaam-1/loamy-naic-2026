import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Activity, AlertTriangle, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_AGGREGATE_CEILING } from '@/lib/limits'
import { statusMeta } from '@/lib/financingLifecycle'
import { useAuth } from '@/context/AuthContext'
import { earlyWarningCounts, type PipelineRow, type RepaymentMilestone } from '@/lib/bank'
import { cn, formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

const MILESTONE_CHIP: Record<RepaymentMilestone['status'], string> = {
  upcoming: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  met: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  missed: 'bg-red-50 text-red-700 ring-1 ring-red-200',
}

/**
 * Post-decision monitoring: milestone STATUS only — no payment recording of
 * any kind exists here. Early-warning flags are computed live from milestone
 * state, never stored.
 */
export default function BankMonitoring() {
  const { t, tOr, tPlural, dateShort } = useT()
  const { profile } = useAuth()
  const [decided, setDecided] = useState<PipelineRow[] | null>(null)
  const [milestones, setMilestones] = useState<RepaymentMilestone[]>([])
  const [formApp, setFormApp] = useState<string | null>(null)
  const [mType, setMType] = useState<'instalment' | 'delivery'>('instalment')
  const [mDue, setMDue] = useState('')
  const [mNote, setMNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: pipeline }, { data: ms }] = await Promise.all([
      supabase.rpc('loamy_bank_pipeline'),
      supabase.from('repayment_milestones').select('*')
        .order('due_date').order('id', { ascending: true }).limit(BANK_AGGREGATE_CEILING),
    ])
    // "Decided" now means any answered application, not only the legacy
    // decided_external. Before slice 3 an approval could not be recorded in
    // Loamy at all, so this filter was complete; it no longer is.
    setDecided(((pipeline as PipelineRow[]) ?? []).filter((r) => statusMeta(r.status).decided))
    setMilestones((ms as RepaymentMilestone[]) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function addMilestone(e: FormEvent, appId: string) {
    e.preventDefault()
    setError(null)
    if (!mDue) return setError(t('bank.monitoring.dueRequired'))
    setBusy(appId)
    const { error: insErr } = await supabase.from('repayment_milestones').insert({
      application_id: appId,
      milestone_type: mType,
      due_date: mDue,
      note: mNote.trim() || null,
      created_by: profile?.id,
    })
    setBusy(null)
    if (insErr) return setError(insErr.message)
    setFormApp(null)
    setMDue('')
    setMNote('')
    await load()
  }

  async function setStatus(m: RepaymentMilestone, status: RepaymentMilestone['status']) {
    setBusy(m.id)
    await supabase.from('repayment_milestones').update({ status }).eq('id', m.id)
    setBusy(null)
    await load()
  }

  return (
    <BankShell section="monitoring">
      <div className="space-y-3">
        <h1 className="text-base font-semibold text-emerald-950">
          {t('bank.monitoring.title')}{' '}
          <span className="font-mono text-sm font-normal text-emerald-900/50">{decided?.length ?? ''}</span>
        </h1>
        <p className="text-[13px] text-emerald-900/55">
          Facilities the Bank marked as decided. Milestone status only - payments are handled
          entirely on bank rails, outside Loamy.
        </p>

        {decided === null ? (
          <div className="h-32 animate-pulse rounded bg-white" aria-label={t('bank.monitoring.loading')} />
        ) : decided.length === 0 ? (
          <Card className="flex items-center gap-2.5 px-4 py-4">
            <Activity className="h-5 w-5 text-emerald-700" aria-hidden />
            <p className="text-sm text-emerald-900/60">
              {t('bank.monitoring.noDecided')}
            </p>
          </Card>
        ) : (
          decided.map((app) => {
            const appMilestones = milestones.filter((m) => m.application_id === app.id)
            const warnings = earlyWarningCounts(appMilestones)
            return (
              <Card key={app.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-emerald-950">
                      {app.applicant_name ?? '-'}
                      <span className="ml-2 font-mono text-[12px] text-emerald-900/50">
                        {app.digital_id} · {formatNaira(Number(app.amount_requested))}
                      </span>
                    </p>
                    {warnings.length > 0 && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-red-600">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                        {t('bank.monitoring.earlyWarning', {
                          // Each warning is pluralised in the reader's own language;
                          // `tPlural` knows Igbo and Yoruba do not split at one.
                          warnings: warnings
                            .map((w) => tPlural(w.key, w.count, { count: w.count }))
                            .join(' · '),
                        })}
                      </p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setFormApp(formApp === app.id ? null : app.id)}>
                    <Plus className="h-3.5 w-3.5" aria-hidden /> Milestone
                  </Button>
                </div>

                {formApp === app.id && (
                  <form onSubmit={(e) => addMilestone(e, app.id)} className="mt-3 grid gap-2 rounded border border-line bg-emerald-50/40 p-3 sm:grid-cols-[10rem_10rem_1fr_auto]" noValidate>
                    <div>
                      <Label htmlFor={`mt-${app.id}`}>{t('bank.monitoring.type')}</Label>
                      <Select id={`mt-${app.id}`} value={mType} onChange={(e) => setMType(e.target.value as 'instalment' | 'delivery')}>
                        <option value="instalment">{t('bank.monitoring.instalmentMurabaha')}</option>
                        <option value="delivery">{t('bank.monitoring.deliverySalam')}</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`md-${app.id}`}>{t('bank.monitoring.dueDate')}</Label>
                      <Input id={`md-${app.id}`} type="date" value={mDue} onChange={(e) => setMDue(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor={`mn-${app.id}`}>{t('bank.monitoring.note')}</Label>
                      <Input id={`mn-${app.id}`} value={mNote} onChange={(e) => setMNote(e.target.value)} placeholder={t('bank.monitoring.optionalPlaceholder')} />
                    </div>
                    <div className="flex items-end">
                      <Button type="submit" size="sm" loading={busy === app.id}>{t('bank.monitoring.add')}</Button>
                    </div>
                    {error && <p className="text-xs text-red-700 sm:col-span-4">{error}</p>}
                  </form>
                )}

                {appMilestones.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                        <th className="py-1.5 pr-4 font-medium">{t('bank.col.type')}</th>
                        <th className="py-1.5 pr-4 font-medium">{t('bank.col.due')}</th>
                        <th className="py-1.5 pr-4 font-medium">{t('bank.col.status')}</th>
                        <th className="py-1.5 pr-4 font-medium">{t('bank.col.note')}</th>
                        <th className="py-1.5 font-medium"><span className="sr-only">{t('bank.col.actions')}</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {appMilestones.map((m) => (
                        <tr key={m.id}>
                          <td className="py-1.5 pr-4 capitalize text-emerald-900/70">{m.milestone_type}</td>
                          <td className="py-1.5 pr-4 font-mono text-[13px]">{dateShort(m.due_date)}</td>
                          <td className="py-1.5 pr-4">
                            <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', MILESTONE_CHIP[m.status])}>{tOr(`bank.milestoneStatus.${m.status}`, m.status)}</span>
                          </td>
                          <td className="py-1.5 pr-4 text-emerald-900/60">{m.note ?? '-'}</td>
                          <td className="py-1.5 text-right">
                            {m.status === 'upcoming' && (
                              <span className="inline-flex gap-1">
                                <Button size="sm" variant="outline" disabled={busy === m.id} onClick={() => setStatus(m, 'met')}>{t('bank.monitoring.markMet')}</Button>
                                <Button size="sm" variant="ghost" disabled={busy === m.id} onClick={() => setStatus(m, 'missed')}>{t('bank.monitoring.markMissed')}</Button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>
    </BankShell>
  )
}
