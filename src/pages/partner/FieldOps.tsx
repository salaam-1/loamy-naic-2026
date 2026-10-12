import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, BadgeCheck, Ban, ClipboardCheck, Clock, Compass, Info,
  MapPin, Wallet,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { RoleShell } from '@/pages/shared/RoleShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import {
  COMMISSION_STATE, FLAG_DISCLAIMER, TASK_STATE,
  completionRate, earningsBreakdown, eligibilityReasons, flagLabel, taskTypeLabel,
  type CommissionStatus, type CommissionSummary, type Performance, type TaskStatus,
} from '@/lib/fieldops'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

interface OpenTask {
  task_id: string
  ref: string
  task_type: string
  priority: string
  state: string | null
  lga: string | null
  expires_at: string | null
  eligibility: { allowed: boolean; reasons: string[] }
}

interface MyTask {
  task_id: string
  ref: string
  task_type: string
  status: TaskStatus
  state: string | null
  lga: string | null
  expires_at: string | null
  flags: string[]
  reviewer_note: string | null
  evidence_count: number
  commission: { ref: string; amount: number; status: CommissionStatus } | null
  updated_at: string
}

const TONE = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  busy: 'border-emerald-300 bg-white text-emerald-800',
  warn: 'border-amber-300 bg-amber-50 text-amber-800',
  bad: 'border-rose-200 bg-rose-50 text-rose-800',
  idle: 'border-line bg-emerald-900/[0.03] text-emerald-900/45',
}

/**
 * Growth Partner operations (route: /dashboard/growth_partner/field-ops).
 *
 * Everything here is read from server functions that already enforce who may
 * see what: loamy_available_tasks hides coordinates before a task is claimed,
 * loamy_my_tasks returns only this agent's work, loamy_gp_performance refuses
 * anyone else's record.
 */
export default function FieldOps() {
  const [open, setOpen] = useState<OpenTask[] | null>(null)
  const [mine, setMine] = useState<MyTask[] | null>(null)
  const { t, tOr, tPlural } = useT()
  /**
   * The field-ops vocabulary lives in src/lib/fieldops.ts, which other code
   * reads. The pack translates it key by key; `tOr` renders the lib's own
   * English for anything the pack has not reached, so an agent never sees a
   * key name on a case they are standing in front of.
   */
  const taskState = (status: string) =>
    tOr(`verification.taskState.${status}`, (TASK_STATE[status as TaskStatus] ?? TASK_STATE.pending).label)
  const taskType = (type: string) => tOr(`verification.taskType.${type}`, taskTypeLabel(type))
  const flag = (code: string) => tOr(`verification.flag.${code}`, flagLabel(code))
  const flagDisclaimer = tOr('verification.flagDisclaimer', FLAG_DISCLAIMER)
  const eligibility = (reasons: string[] | undefined) =>
    (reasons ?? []).map((r, i) => tOr(`verification.eligibility.${r}`, eligibilityReasons([r])[i] ?? r))
  const commissionLabel = (status: CommissionStatus) =>
    tOr(`verification.commission.${status}`, COMMISSION_STATE[status]?.label ?? status)

  const [perf, setPerf] = useState<Performance | null>(null)
  const [earnings, setEarnings] = useState<CommissionSummary | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const [a, m, p, e] = await Promise.all([
      supabase.rpc('loamy_available_tasks'),
      supabase.rpc('loamy_my_tasks'),
      supabase.rpc('loamy_gp_performance', {}),
      supabase.rpc('loamy_my_commission_summary'),
    ])
    const av = a.data as { available: boolean; items: OpenTask[] } | null
    setOpen(av?.available ? av.items : [])
    setMine(((m.data as { items: MyTask[] } | null)?.items) ?? [])
    setPerf((p.data as Performance) ?? null)
    setEarnings((e.data as CommissionSummary) ?? null)
  }, [])

  useEffect(() => { void load() }, [load])

  async function claim(taskId: string) {
    setBusy(taskId); setMessage(null)
    const { data, error } = await supabase.rpc('loamy_claim_task', { p_task_id: taskId })
    setBusy(null)
    if (error) { setMessage({ ok: false, text: error.message }); return }
    const r = data as { claimed: boolean; reason?: string; reasons?: string[] }
    if (!r.claimed) {
      setMessage({
        ok: false,
        // The server decides WHETHER the claim succeeded; these are the
        // words for a decision already made, never the decision itself.
        text: r.reason === 'already_taken'
          ? t('verification.fieldOps.alreadyTaken')
          : eligibility(r.reasons).join(' ') || t('verification.fieldOps.cannotTake'),
      })
      await load()
      return
    }
    setMessage({ ok: true, text: t('verification.fieldOps.claimed') })
    await load()
  }

  async function setAvailability(value: string) {
    await supabase.rpc('loamy_gp_set_availability', { p_availability: value })
    await load()
  }

  const rate = completionRate(perf)
  const money = earningsBreakdown(earnings)
  const inProgress = (mine ?? []).filter((t) =>
    ['assigned', 'accepted', 'in_progress'].includes(t.status))
  const awaiting = (mine ?? []).filter((t) =>
    ['submitted', 'under_review'].includes(t.status))
  const needsAction = (mine ?? []).filter((t) =>
    ['needs_more_information', 'resubmit_requested', 'rejected'].includes(t.status))

  return (
    <RoleShell section="field-ops" allowedRoles={['growth_partner']}>
      <div className="mx-auto max-w-5xl space-y-5">
        {perf?.suspended && (
          <Card className="flex items-start gap-2.5 border-rose-200 bg-rose-50/60 p-4">
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" strokeWidth={1.5} aria-hidden />
            <div>
              <p className="text-sm font-medium text-rose-900">{t('verification.fieldOps.suspendedBanner')}</p>
              <p className="mt-0.5 text-xs text-rose-900/80">
                {t('verification.fieldOps.suspendedBody')}
              </p>
            </div>
          </Card>
        )}

        {/* TODAY */}
        <section>
          <h2 className="text-sm font-semibold text-emerald-950">{t('verification.fieldOps.today')}</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-4">
            <Stat icon={ClipboardCheck} label={t('verification.fieldOps.inProgress')} value={inProgress.length} />
            <Stat icon={Clock} label={t('verification.fieldOps.withLoamy')} value={awaiting.length} />
            <Stat icon={AlertTriangle} label={t('verification.fieldOps.needsYourAction')} value={needsAction.length}
                  tone={needsAction.length > 0 ? 'warn' : undefined} />
            <Stat icon={Compass} label={t('verification.fieldOps.openNearby')} value={open?.length ?? 0} />
          </div>
        </section>

        {message && (
          <Card className={cn('p-3 text-sm',
            message.ok ? 'text-emerald-800' : 'border-amber-300 bg-amber-50/60 text-amber-900')}>
            {message.text}
          </Card>
        )}

        {/* AVAILABILITY */}
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="text-sm font-semibold text-emerald-950">{t('verification.fieldOps.availability')}</h2>
            <p className="mt-0.5 text-xs text-emerald-900/60">
              {/* The training status itself is a server value and is shown
                  as it is; only the word in front of it is wording. */}
              {t('verification.fieldOps.training')}{' '}
              <strong className="font-medium">{perf?.training_status?.replace(/_/g, ' ') ?? '-'}</strong>
            </p>
          </div>
          <Select
            value={perf?.availability ?? 'available'}
            onChange={(e) => void setAvailability(e.target.value)}
            className="w-44"
            aria-label={t('verification.fieldOps.availability')}
            disabled={perf?.suspended}
          >
            <option value="available">{t('verification.fieldOps.available')}</option>
            <option value="busy">{t('verification.fieldOps.busy')}</option>
            <option value="unavailable">{t('verification.fieldOps.unavailable')}</option>
          </Select>
        </Card>

        {/* OPEN WORK */}
        <section>
          <h2 className="text-sm font-semibold text-emerald-950">{t('verification.fieldOps.openInYourArea')}</h2>
          <p className="mt-0.5 text-xs text-emerald-900/55">
            {t('verification.fieldOps.detailsOnClaim')}
          </p>
          <div className="mt-2 space-y-2">
            {open === null ? (
              <div className="h-16 animate-pulse rounded border border-line bg-white" aria-hidden />
            ) : open.length === 0 ? (
              <Card className="p-4 text-sm text-emerald-900/55">
                {t('verification.fieldOps.noOpenTasks')}
              </Card>
            ) : (
              open.map((task) => {
                const reasons = eligibility(task.eligibility?.reasons)
                return (
                  <Card key={task.task_id} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-emerald-950">
                          {taskType(task.task_type)}
                        </span>
                        <span className="font-mono text-[11px] text-emerald-900/40">{task.ref}</span>
                        {task.priority === 'high' && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                            {t('verification.fieldOps.highPriority')}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-emerald-900/60">
                        <MapPin className="h-3 w-3" strokeWidth={1.5} aria-hidden />
                        {task.lga ? `${task.lga}, ` : ''}{task.state ?? 'Location on assignment'}
                      </p>
                      {reasons.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {reasons.map((r) => (
                            <li key={r} className="text-[11px] text-amber-800">· {r}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={!task.eligibility?.allowed || busy === task.task_id}
                      loading={busy === task.task_id}
                      onClick={() => claim(task.task_id)}
                    >
                      {t('verification.fieldOps.claim')}
                    </Button>
                  </Card>
                )
              })
            )}
          </div>
        </section>

        {/* MY WORK */}
        <section>
          <h2 className="text-sm font-semibold text-emerald-950">{t('verification.fieldOps.myWork')}</h2>
          <div className="mt-2 space-y-2">
            {mine === null ? (
              <div className="h-16 animate-pulse rounded border border-line bg-white" aria-hidden />
            ) : mine.length === 0 ? (
              <Card className="p-4 text-sm text-emerald-900/55">
                {t('verification.fieldOps.nothingAssigned')}
              </Card>
            ) : (
              mine.map((task) => {
                const meta = TASK_STATE[task.status] ?? TASK_STATE.pending
                return (
                  <Card key={task.task_id} className="p-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-emerald-950">
                            {taskTypeLabel(task.task_type)}
                          </span>
                          <span className={cn('rounded border px-1.5 py-0.5 text-[11px] font-medium',
                            TONE[meta.tone])}>
                            {taskState(task.status)}
                          </span>
                          <span className="font-mono text-[11px] text-emerald-900/40">{task.ref}</span>
                        </div>

                        <p className="mt-0.5 text-xs text-emerald-900/60">
                          {task.lga ? `${task.lga}, ` : ''}{task.state} ·{' '}
                          {tPlural('verification.fieldOps.evidenceCount', task.evidence_count, {
                            count: task.evidence_count,
                          })}
                        </p>

                        {task.reviewer_note && (
                          <p className="mt-1 text-xs text-amber-800">
                            {/* the note itself is the reviewer's own words */}
                            {t('verification.fieldOps.reviewer', { note: task.reviewer_note })}
                          </p>
                        )}

                        {task.flags?.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {task.flags.map((f) => (
                              <li key={f} className="text-[11px] text-amber-800">
                                · {flag(f)}
                              </li>
                            ))}
                          </ul>
                        )}

                        {task.commission && (
                          <p className="mt-1 text-[11px] text-emerald-900/60">
                            {t('verification.fieldOps.commissionLine', {
                              amount: `₦${Number(task.commission.amount).toLocaleString('en-NG')}`,
                              status: commissionLabel(task.commission.status),
                            })}
                          </p>
                        )}
                      </div>

                      <Link to={`/dashboard/growth_partner/verification-tasks/${task.task_id}`}>
                        <Button size="sm" variant="outline">{t('common.view')}</Button>
                      </Link>
                    </div>
                  </Card>
                )
              })
            )}
          </div>
          {(mine ?? []).some((t) => t.flags?.length > 0) && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-emerald-900/55">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
              {flagDisclaimer}
            </p>
          )}
        </section>

        {/* EARNINGS */}
        <section>
          <h2 className="text-sm font-semibold text-emerald-950">{t('verification.fieldOps.earnings')}</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <p className="text-xs text-emerald-900/55">{t('verification.fieldOps.owedToYou')}</p>
              <p className="mt-0.5 font-mono text-xl font-semibold text-emerald-950">
                {money.owedLabel}
              </p>
              <dl className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
                {(['pending', 'approved', 'payable'] as const).map((k) => (
                  <div key={k} className="flex items-baseline justify-between gap-2">
                    <dt className="text-emerald-900/55">{COMMISSION_STATE[k].label}</dt>
                    <dd className="font-mono text-emerald-900/85">
                      ₦{Number(earnings?.[k] ?? 0).toLocaleString('en-NG')}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-emerald-900/55">{t('verification.fieldOps.paid')}</p>
              <p className="mt-0.5 font-mono text-xl font-semibold text-emerald-950">
                {money.paidLabel}
              </p>
              <p className="mt-2 flex items-start gap-1.5 border-t border-line pt-2 text-xs text-emerald-900/55">
                <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                {tOr('verification.earnings.owedVsPaid', money.note)}{' '}
                {t('verification.earnings.noBalance')}
              </p>
            </Card>
          </div>
        </section>

        {/* PERFORMANCE */}
        <section>
          <h2 className="text-sm font-semibold text-emerald-950">{t('verification.fieldOps.performance')}</h2>
          <Card className="mt-2 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-emerald-900/55">{t('verification.fieldOps.approvedWork')}</p>
                <p className="mt-0.5 font-mono text-lg font-semibold text-emerald-950">
                  {perf?.tasks?.approved ?? 0}
                </p>
                <p className="mt-0.5 text-[11px] text-emerald-900/50">{rate.caption}</p>
              </div>
              <div>
                <p className="text-xs text-emerald-900/55">{t('verification.fieldOps.completionRate')}</p>
                <p className="mt-0.5 font-mono text-lg font-semibold text-emerald-950">
                  {rate.shown ? `${rate.percent}%` : '-'}
                </p>
                {!rate.shown && (
                  <p className="mt-0.5 text-[11px] text-emerald-900/50">
                    {t('verification.fieldOps.shownOnceDecided')}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-emerald-900/55">{t('verification.fieldOps.averageTurnaround')}</p>
                <p className="mt-0.5 font-mono text-lg font-semibold text-emerald-950">
                  {perf?.average_turnaround_hours ?? 0}h
                </p>
              </div>
            </div>

            {perf?.flags_by_kind && Object.keys(perf.flags_by_kind).length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-xs font-medium text-emerald-900/70">{t('verification.fieldOps.flagsRaised')}</p>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(perf.flags_by_kind).map(([k, n]) => (
                    <li key={k} className="text-xs text-emerald-900/65">
                      {flag(k)} - {n}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-emerald-900/45">{flagDisclaimer}</p>
              </div>
            )}
          </Card>
        </section>

        {/* SERVICE AREA */}
        {perf?.service_areas && perf.service_areas.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-emerald-950">{t('verification.fieldOps.serviceArea')}</h2>
            <Card className="mt-2 divide-y divide-line">
              {perf.service_areas.map((a) => (
                <div key={a.state} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="inline-flex items-center gap-1.5 text-sm text-emerald-950">
                    <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.5} aria-hidden />
                    {a.state}
                  </span>
                  <span className="text-xs text-emerald-900/55">
                    {a.lgas?.length ? a.lgas.join(', ') : t('verification.fieldOps.allLgas')}
                    {a.commodities?.length ? ` · ${a.commodities.join(', ')}` : ''}
                  </span>
                </div>
              ))}
            </Card>
          </section>
        )}
      </div>
    </RoleShell>
  )
}

function Stat({
  icon: Icon, label, value, tone,
}: {
  icon: typeof Clock; label: string; value: number; tone?: 'warn'
}) {
  return (
    <Card className={cn('flex items-center gap-2.5 p-3', tone === 'warn' && 'border-amber-300 bg-amber-50/50')}>
      <Icon className={cn('h-4 w-4 shrink-0', tone === 'warn' ? 'text-amber-700' : 'text-emerald-700')}
            strokeWidth={1.5} aria-hidden />
      <div>
        <p className="font-mono text-lg font-semibold text-emerald-950">{value}</p>
        <p className="text-[11px] text-emerald-900/55">{label}</p>
      </div>
    </Card>
  )
}
