import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, ChevronUp, Clock, Crosshair, MapPin,
  RotateCcw, ShieldCheck, X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { TASK_STATUS_META, type TaskEvidence, type TaskFarmInfo, type VerificationTask } from '@/lib/partner'
import { FLAG_DISCLAIMER, flagLabel } from '@/lib/fieldops'
import { signedEvidenceUrl } from '@/lib/evidenceUpload'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import { cn, formatDateShort } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DashboardCard } from '@/components/DashboardCard'

interface ChecklistDefItem {
  key: string
  label: string
  kind: 'boolean' | 'text' | 'number'
  required?: boolean
}

interface CaseEvidence {
  id: string
  ref: string | null
  type: string
  storage_path: string | null
  captured_at: string
  received_at: string
  clock_skew_seconds: number | null
  distance_m: number | null
  lat: number | null
  lng: number | null
  accuracy_m: number | null
  quantity: number | null
  unit: string | null
  note: string | null
  flags: string[] | null
  status: string
}

interface CaseDetail {
  found: boolean
  ref: string | null
  task_type: string
  checklist_definition: { available: boolean; items?: ChecklistDefItem[]; version?: number }
  answers: { answers?: Record<string, unknown>; version?: number; answered_at?: string } | null
  flags: string[] | null
  evidence: CaseEvidence[]
}

interface TaskBundle {
  task: VerificationTask
  info?: TaskFarmInfo
  detail?: CaseDetail
  urls: Record<string, string>
}

/**
 * The second integrity layer: field partners gather, ADMINS confirm.
 *
 * Two repoints live here.
 *
 *   P0-2 — approval calls `loamy_review_verification_case`. The older
 *   `loamy_review_verification_task` is admin-gated but carries NO
 *   separation-of-duties check: it would let an administrator who had also
 *   collected the evidence approve their own work.
 *
 *   P0-3 — the panel reads `loamy_task_detail` instead of listing the storage
 *   bucket and unpacking the task's JSON blob. Capture no longer writes
 *   `evidence.gps_check`; it writes real `verification_evidence` rows, and
 *   those carry what a reviewer actually needs: distance from the registered
 *   pin, GPS accuracy, the gap between the device clock and server receipt,
 *   and the anti-fraud flags. Reading the old blob would have shown an empty
 *   panel for every case captured after the rewrite.
 */
export default function AdminVerificationQueue() {
  const [submitted, setSubmitted] = useState<VerificationTask[] | null>(null)
  const [recent, setRecent] = useState<VerificationTask[]>([])
  const [people, setPeople] = useState<Record<string, PublicProfile>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [bundle, setBundle] = useState<TaskBundle | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('verification_tasks')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100)
    const tasks = (data as VerificationTask[]) ?? []
    setSubmitted(tasks.filter((t) => t.status === 'submitted'))
    setRecent(tasks.filter((t) => ['approved', 'rejected', 'resubmit_requested', 'needs_more_information'].includes(t.status)).slice(0, 10))
    setPeople(
      await fetchPublicProfiles(
        tasks.flatMap((t) => [t.subject_user_id, t.assigned_to].filter(Boolean) as string[]),
      ),
    )
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function openTask(task: VerificationTask) {
    if (open === task.id) {
      setOpen(null)
      setBundle(null)
      return
    }
    setOpen(task.id)
    setNote('')
    setBundle({ task, urls: {} })
    const [{ data: detailData }, { data: infoRows }] = await Promise.all([
      supabase.rpc('loamy_task_detail', { p_task_id: task.id }),
      supabase.rpc('loamy_task_farm_info', { p_task: task.id }),
    ])
    const detail = detailData as CaseDetail | null
    const urls: Record<string, string> = {}
    for (const e of detail?.evidence ?? []) {
      if (!e.storage_path) continue
      const url = await signedEvidenceUrl(e.storage_path, 1800)
      if (url) urls[e.id] = url
    }
    setBundle({
      task,
      info: (infoRows?.[0] as TaskFarmInfo) ?? undefined,
      detail: detail?.found ? detail : undefined,
      urls,
    })
  }

  async function decide(taskId: string, decision: 'approved' | 'rejected' | 'more_evidence_required') {
    setError(null)
    setBusy(decision)
    // P0-2: the AUTHORITATIVE review path (loamy_review_verification_case,
    // last defined in 20260920130008). It records the reviewer, refuses an
    // approval from whoever collected the evidence, applies the outcome
    // through the batch's own controlled path, and writes the audit event.
    const { error: rpcErr } = await supabase.rpc('loamy_review_verification_case', {
      p_case_id: taskId,
      p_decision: decision,
      p_note: note.trim() || null,
    })
    setBusy(null)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setOpen(null)
    setBundle(null)
    await load()
  }

  if (submitted === null) {
    return <div className="h-40 animate-pulse rounded-card bg-white" aria-label="Loading queue" />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <DashboardCard title={`Awaiting review (${submitted.length})`}>
        {submitted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ShieldCheck className="h-7 w-7 text-emerald-900/20" aria-hidden />
            <p className="text-sm text-emerald-900/50">No submissions waiting. Field submissions land here for your decision.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {submitted.map((t) => {
              const isOpen = open === t.id
              const partnerNote = (t.evidence as TaskEvidence | null)?.partner_note
              const d = isOpen && bundle?.task.id === t.id ? bundle.detail : undefined
              const items = d?.checklist_definition?.items ?? []
              const given = (d?.answers?.answers ?? {}) as Record<string, unknown>
              return (
                <Card key={t.id} className="border border-emerald-100 p-4 shadow-none">
                  <button type="button" onClick={() => openTask(t)} className="flex w-full items-center justify-between gap-3 text-left">
                    <div>
                      <p className="text-sm font-semibold text-emerald-950">
                        {people[t.subject_user_id]?.full_name ?? 'Farmer'} · {t.task_type.replace(/_/g, ' ')}
                      </p>
                      <p className="mt-0.5 text-xs text-emerald-900/55">
                        Field partner: {t.assigned_to ? people[t.assigned_to]?.full_name ?? '-' : '-'} · submitted {formatDateShort(t.updated_at)}
                      </p>
                    </div>
                    {isOpen ? <ChevronUp className="h-4 w-4 text-emerald-900/40" aria-hidden /> : <ChevronDown className="h-4 w-4 text-emerald-900/40" aria-hidden />}
                  </button>

                  {isOpen && bundle?.task.id === t.id && (
                    <div className="mt-4 space-y-4 border-t border-emerald-950/5 pt-4">
                      {bundle.info && (
                        <p className="flex items-center gap-1 text-xs text-emerald-900/60">
                          <MapPin className="h-3.5 w-3.5" aria-hidden />
                          {bundle.info.farm_name} · {bundle.info.lga}, {bundle.info.state} · {Number(bundle.info.size_hectares)} ha ·{' '}
                          declared: {bundle.info.primary_crops.join(', ')}
                        </p>
                      )}

                      {/* Case-level flags first: they are why this needs a human. */}
                      {(d?.flags?.length ?? 0) > 0 && (
                        <div className="rounded-md bg-amber-50 px-3 py-2">
                          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                            {(d?.flags ?? []).map(flagLabel).join(' · ')}
                          </p>
                          <p className="mt-1 text-[11px] text-amber-800">{FLAG_DISCLAIMER}</p>
                        </div>
                      )}

                      {/* Photographs, from the private bucket via signed URLs. */}
                      {Object.keys(bundle.urls).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {(d?.evidence ?? []).filter((e) => bundle.urls[e.id]).map((e) => (
                            <a key={e.id} href={bundle.urls[e.id]} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded-lg ring-1 ring-emerald-100">
                              <img src={bundle.urls[e.id]} alt="Evidence" className="h-full w-full object-cover" />
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Every capture, with the numbers a reviewer judges on. */}
                      {(d?.evidence?.length ?? 0) === 0 ? (
                        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          No evidence has been recorded against this case.
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {(d?.evidence ?? []).map((e) => (
                            <li key={e.id} className="rounded-md bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-900/75">
                              <span className="font-semibold text-emerald-950">{e.ref ?? e.type}</span> · {e.type}
                              {e.lat !== null && e.lng !== null && (
                                <span className="ml-1 inline-flex items-center gap-1">
                                  <Crosshair className="h-3 w-3" aria-hidden /> {e.lat}, {e.lng}
                                  {e.accuracy_m !== null && ` ±${Math.round(Number(e.accuracy_m))} m`}
                                </span>
                              )}
                              {e.distance_m !== null && (
                                <span className="ml-1">· {Math.round(Number(e.distance_m))} m from the registered pin</span>
                              )}
                              {e.quantity !== null && <span className="ml-1">· {e.quantity} {e.unit ?? ''}</span>}
                              <span className="ml-1 inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" aria-hidden /> captured {formatDateShort(e.captured_at)}, received {formatDateShort(e.received_at)}
                                {e.clock_skew_seconds !== null && Math.abs(Number(e.clock_skew_seconds)) > 60 && (
                                  <span className="text-amber-700">
                                    (device clock off by {Math.round(Math.abs(Number(e.clock_skew_seconds)) / 60)} min)
                                  </span>
                                )}
                              </span>
                              {(e.flags?.length ?? 0) > 0 && (
                                <span className="mt-0.5 block text-amber-800">{(e.flags ?? []).map(flagLabel).join(' · ')}</span>
                              )}
                              {e.note && <span className="mt-0.5 block italic">{e.note}</span>}
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Checklist, against the version the agent answered. */}
                      {items.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-emerald-800/70">
                            Checklist{d?.answers?.version ? ` · version ${d.answers.version}` : ''}
                          </p>
                          <ul className="space-y-1.5">
                            {items.map((item) => {
                              const v = given[item.key]
                              const answered = v !== undefined && v !== null && v !== ''
                              return (
                                <li key={item.key} className="flex items-start gap-2 text-xs">
                                  {v === true ? (
                                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                                  ) : v === false ? (
                                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
                                  ) : (
                                    <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-950/10" aria-hidden />
                                  )}
                                  <span className="text-emerald-900/70">
                                    {item.label}
                                    {typeof v !== 'boolean' && answered && (
                                      <span className="font-medium text-emerald-950"> - {String(v)}</span>
                                    )}
                                    {!answered && <span className="italic text-emerald-900/40"> - not answered</span>}
                                  </span>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )}

                      {partnerNote && (
                        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs italic text-emerald-800">
                          Partner note: {partnerNote}
                        </p>
                      )}

                      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note (sent to the field partner)" />
                      {error && <p className="text-xs text-red-700">{error}</p>}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" loading={busy === 'approved'} onClick={() => decide(t.id, 'approved')}>
                          <Check className="h-3.5 w-3.5" aria-hidden /> Approve
                        </Button>
                        <Button size="sm" variant="outline" loading={busy === 'rejected'} onClick={() => decide(t.id, 'rejected')}>
                          <X className="h-3.5 w-3.5" aria-hidden /> Reject
                        </Button>
                        <Button size="sm" variant="ghost" loading={busy === 'more_evidence_required'} onClick={() => decide(t.id, 'more_evidence_required')}>
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Ask for more evidence
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </DashboardCard>

      {recent.length > 0 && (
        <DashboardCard title="Recent decisions">
          <ul className="divide-y divide-emerald-950/5">
            {recent.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm text-emerald-950">{people[t.subject_user_id]?.full_name ?? 'Farmer'}</p>
                  <p className="text-[11px] text-emerald-900/45">
                    {formatDateShort(t.completed_at ?? t.updated_at)}
                    {t.reviewer_note ? ` · ${t.reviewer_note}` : ''}
                  </p>
                </div>
                <span className={cn('rounded px-2.5 py-1 text-xs font-medium', TASK_STATUS_META[t.status]?.chip ?? 'bg-emerald-50 text-emerald-800')}>
                  {TASK_STATUS_META[t.status]?.label ?? t.status}
                </span>
              </li>
            ))}
          </ul>
        </DashboardCard>
      )}
    </div>
  )
}
