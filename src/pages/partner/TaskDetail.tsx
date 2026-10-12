import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Camera, CheckCircle2, CloudOff, Crosshair, Info,
  LocateFixed, MapPin, RefreshCw, Send, Trash2, UploadCloud,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { MIN_EVIDENCE_PHOTOS, TASK_STATUS_META, type TaskFarmInfo, type TaskStatus } from '@/lib/partner'
import { captureFeedback, checkFile, evidenceTypeFor } from '@/lib/evidence'
import { useEvidenceQueue } from '@/lib/useEvidenceQueue'
import { signedEvidenceUrl } from '@/lib/evidenceUpload'
import { FLAG_DISCLAIMER, flagLabel } from '@/lib/fieldops'
import { cn, formatDateShort } from '@/lib/utils'
import { RoleShell } from '@/pages/shared/RoleShell'
import { FarmMap } from '@/components/FarmMap'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/lib/i18n'

/**
 * Mobile-first evidence capture — this screen is used standing on a farm,
 * often with no signal.
 *
 * REWRITTEN for the production directive, §5 and §6. What changed and why:
 *
 *   - Capture now goes through `loamy_submit_evidence`, not `loamy_gps_check`.
 *     The old call wrote a distance into a JSON blob on the task row and
 *     nothing else. The new one creates a real `verification_evidence` row
 *     with a business ref, a content hash, the device/server clock gap, and
 *     the duplicate, repeated-coordinate and impossible-travel checks. Field
 *     work that does not go through it leaves a reviewer nothing to rely on.
 *
 *   - Capture is OFFLINE-FIRST. Photographs and fixes are written to a local
 *     queue and uploaded when there is signal. The screen says plainly which
 *     state each capture is in: "saved on this device" is not "sent".
 *
 *   - The checklist is the SERVER's, read from `checklist_definition` and
 *     versioned. The screen previously rendered four hardcoded booleans while
 *     the authoritative farm checklist has ten items across three kinds, so
 *     the answers the agent gave could never satisfy `loamy_submit_checklist`.
 *
 *   - Submitted evidence cannot be deleted from this screen. Directive 13:
 *     evidence is superseded, never overwritten. Only a capture still sitting
 *     in the local queue can be discarded, because that one never existed as
 *     far as Loamy is concerned.
 */

interface ChecklistDefItem {
  key: string
  label: string
  kind: 'boolean' | 'text' | 'number'
  required?: boolean
}

interface ServerEvidence {
  id: string
  ref: string | null
  type: string
  storage_path: string | null
  captured_at: string
  received_at: string
  clock_skew_seconds: number | null
  lat: number | null
  lng: number | null
  accuracy_m: number | null
  quantity: number | null
  unit: string | null
  note: string | null
  flags: string[] | null
  status: string
}

interface TaskDetailPayload {
  found: boolean
  task_id: string
  ref: string | null
  task_type: string
  status: TaskStatus
  subject_farm_id: string | null
  subject_user_id: string
  expected_lat: number | null
  expected_lng: number | null
  checklist: { key: string | null; version: number | null }
  checklist_definition: { available: boolean; items?: ChecklistDefItem[]; version?: number }
  answers: { answers?: Record<string, unknown>; version?: number } | null
  flags: string[] | null
  reviewer_note: string | null
  evidence: ServerEvidence[]
  created_at: string
  completed_at: string | null
  note: string | null
}

type AnswerValue = boolean | string | number | null

/** Exactly the set loamy_submit_evidence and loamy_submit_checklist accept. */
const WORKING_STATUSES: TaskStatus[] = [
  'assigned', 'accepted', 'in_progress', 'resubmit_requested', 'needs_more_information',
]

export default function TaskDetail() {
  const { t } = useT()
  const { taskId } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<TaskDetailPayload | null | 'missing'>(null)
  const [info, setInfo] = useState<TaskFarmInfo | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [partnerNote, setPartnerNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Last device fix, attached to photographs so a picture carries a place. */
  const [fix, setFix] = useState<{ lat: number; lng: number; accuracyM: number | null } | null>(null)

  const load = useCallback(async () => {
    if (!taskId) return
    // The agent never reads the raw task row: loamy_task_detail deliberately
    // omits who requested the inspection, because that is a buyer's sourcing
    // intention and not the field's business.
    const { data } = await supabase.rpc('loamy_task_detail', { p_task_id: taskId })
    const d = data as TaskDetailPayload | null
    if (!d?.found) {
      setDetail('missing')
      return
    }
    setDetail(d)
    setAnswers((prev) =>
      Object.keys(prev).length > 0 ? prev : ((d.answers?.answers as Record<string, AnswerValue>) ?? {}))

    const { data: infoRows } = await supabase.rpc('loamy_task_farm_info', { p_task: taskId })
    setInfo((infoRows?.[0] as TaskFarmInfo) ?? null)

    // Signed URLs, one per stored object. The bucket is private and the
    // farmer has no read path into it at all.
    const next: Record<string, string> = {}
    for (const e of d.evidence ?? []) {
      if (!e.storage_path) continue
      const url = await signedEvidenceUrl(e.storage_path)
      if (url) next[e.id] = url
    }
    setUrls(next)
  }, [taskId])

  const queue = useEvidenceQueue(load)

  useEffect(() => {
    void load()
  }, [load])

  // Surface the server's verdict on the most recent send, in the agent's
  // language: a flag routes the case to review, it never accuses anyone.
  useEffect(() => {
    const last = queue.lastResults[queue.lastResults.length - 1]
    if (last) setNotice(captureFeedback(last.flags).message)
  }, [queue.lastResults])

  if (detail === null) {
    return (
      <RoleShell section="verification-tasks">
        <div className="h-40 animate-pulse rounded-card bg-white" aria-label={t('verification.task.loadingTask')} />
      </RoleShell>
    )
  }
  if (detail === 'missing') {
    return (
      <RoleShell section="verification-tasks">
        <Card className="p-8 text-center text-sm text-emerald-900/60">
          {t('verification.task.notYours')}
        </Card>
      </RoleShell>
    )
  }

  const editable = WORKING_STATUSES.includes(detail.status)
  const meta = TASK_STATUS_META[detail.status] ?? { label: detail.status, chip: 'bg-emerald-50 text-emerald-800' }
  const items = detail.checklist_definition?.items ?? []
  const serverEvidence = detail.evidence ?? []
  const photoCount = serverEvidence.filter((e) => e.type === 'photo' || e.type === 'video').length
  const hasFix = serverEvidence.some((e) => e.lat !== null && e.lng !== null)
  const unsent = queue.pending + queue.failed

  const missing = items
    .filter((i) => i.required)
    .filter((i) => {
      const v = answers[i.key]
      if (i.kind === 'boolean') return v !== true && v !== false
      if (i.kind === 'number') return v === null || v === undefined || v === '' || Number.isNaN(Number(v))
      return typeof v !== 'string' || v.trim() === ''
    })

  // Everything the server will insist on, checked here so the agent is told
  // before they press the button rather than after.
  const blockers: string[] = []
  if (!hasFix) blockers.push('a GPS capture at the location')
  if (photoCount < MIN_EVIDENCE_PHOTOS) {
    blockers.push(`${MIN_EVIDENCE_PHOTOS - photoCount} more photograph${MIN_EVIDENCE_PHOTOS - photoCount === 1 ? '' : 's'}`)
  }
  if (missing.length > 0) blockers.push(`${missing.length} checklist answer${missing.length === 1 ? '' : 's'}`)
  // The decisive one: submitting while captures sit on the handset would send
  // a case whose evidence Loamy does not have.
  if (unsent > 0) blockers.push(`${unsent} capture${unsent === 1 ? '' : 's'} still to upload`)
  const canSubmit = editable && blockers.length === 0

  /**
   * Accepting is a separate commitment from claiming.
   *
   * `loamy_claim_task` reserves a task so two agents cannot work the same
   * one. `loamy_accept_task` is the agent saying they will actually do it,
   * and `loamy_decline_task` releases it back to the pool. Both had no
   * caller, so an agent who claimed a task could neither commit to it nor
   * give it back -- it simply sat with them until it expired.
   */
  const awaitingAcceptance = detail.status === 'assigned'

  async function respondToAssignment(accept: boolean) {
    setError(null)
    setBusy(accept ? 'accept' : 'decline')
    const { error: rpcErr } = await supabase.rpc(
      accept ? 'loamy_accept_task' : 'loamy_decline_task',
      { p_task_id: taskId },
    )
    setBusy(null)
    if (rpcErr) {
      setError(errorMessage(rpcErr, accept
        ? t('verification.task.couldNotAccept')
        : t('verification.task.couldNotDecline')))
      return
    }
    if (accept) { await load(); return }
    // Declined: it is no longer this agent's task, so there is nothing here
    // to show them.
    navigate('/dashboard/growth_partner/verification-tasks')
  }

  function readPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is unavailable on this device.'))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20_000,
        maximumAge: 0,
      })
    })
  }

  async function captureGps() {
    if (!taskId) return
    setError(null)
    setNotice(null)
    setBusy('gps')
    try {
      const pos = await readPosition()
      const next = {
        lat: Number(pos.coords.latitude.toFixed(6)),
        lng: Number(pos.coords.longitude.toFixed(6)),
        accuracyM: pos.coords.accuracy ?? null,
      }
      setFix(next)
      await queue.capture({
        caseId: taskId,
        evidenceType: 'gps_point',
        // The device's own clock. The server keeps the difference between
        // this and its receipt time rather than quietly correcting it.
        capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
        ...next,
      })
    } catch (err) {
      const code = (err as GeolocationPositionError)?.code
      setError(
        code === 1 ? t('verification.task.locationDenied')
          : code === 3 ? t('verification.task.noFixInTime')
            : err instanceof Error ? err.message : t('verification.task.couldNotGetLocation'),
      )
    } finally {
      setBusy(null)
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files || !taskId) return
    setError(null)
    setNotice(null)
    setBusy('photos')
    try {
      // A fresh fix per batch, so a photograph carries where it was taken.
      // Failing to get one is not fatal: the capture is still worth keeping
      // and the server will flag `no_gps` for the reviewer.
      let here = fix
      try {
        const pos = await readPosition()
        here = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracyM: pos.coords.accuracy ?? null,
        }
        setFix(here)
      } catch {
        /* keep the last known fix, or none */
      }

      for (const file of [...files]) {
        const gate = checkFile(file)
        if (!gate.ok) {
          setError(gate.message)
          continue
        }
        await queue.capture({
          caseId: taskId,
          evidenceType: evidenceTypeFor(file.type),
          capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
          blob: file,
          mime: file.type,
          lat: here?.lat ?? null,
          lng: here?.lng ?? null,
          accuracyM: here?.accuracyM ?? null,
        })
      }
    } finally {
      setBusy(null)
    }
  }

  async function saveChecklist(submit: boolean) {
    if (!taskId) return
    setError(null)
    setNotice(null)
    setBusy(submit ? 'submit' : 'save')
    try {
      // Flat scalars, which is what loamy_submit_checklist stores against the
      // checklist VERSION. The screen used to send {value,note} objects, so
      // the stored answers did not match the definition they were answering.
      const payload: Record<string, unknown> = {}
      for (const i of items) {
        const v = answers[i.key]
        if (v === null || v === undefined || v === '') continue
        payload[i.key] = i.kind === 'number' ? Number(v) : v
      }
      const { data: clData, error: clErr } = await supabase.rpc('loamy_submit_checklist', {
        p_case_id: taskId,
        p_answers: payload,
      })
      if (clErr) throw new Error(clErr.message)
      const cl = clData as { saved?: boolean; message?: string; reason?: string } | null
      if (cl && cl.saved === false) {
        throw new Error(cl.message ?? `Checklist not saved (${cl.reason ?? 'unknown reason'}).`)
      }

      const { data: prData, error: prErr } = await supabase.rpc('loamy_update_task_progress', {
        p_task_id: taskId,
        p_note: partnerNote.trim() || null,
        p_submit: submit,
      })
      if (prErr) throw new Error(prErr.message)
      const pr = prData as { saved?: boolean; status?: string } | null
      if (pr && pr.saved === false) {
        throw new Error(`This case is ${pr.status} and can no longer be edited.`)
      }
      setNotice(submit ? t('verification.task.submittedForReview') : t('verification.task.progressSaved'))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('verification.task.couldNotSave'))
    } finally {
      setBusy(null)
    }
  }

  const SyncIcon = queue.sync.state === 'failed' ? AlertTriangle
    : queue.sync.state === 'offline' ? CloudOff
      : queue.sync.state === 'uploading' ? UploadCloud
        : CheckCircle2

  return (
    <RoleShell section="verification-tasks">
      <div className="mx-auto max-w-xl space-y-4">
        <Link
          to="/dashboard/growth_partner/verification-tasks"
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('verification.task.allTasks')}
        </Link>

        <Card className="space-y-2 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold text-emerald-950">{info?.farm_name ?? t('verification.task.fieldVerification')}</h1>
              {detail.ref && <p className="text-[11px] font-medium text-emerald-900/45">{detail.ref}</p>}
            </div>
            <span className={cn('rounded px-2.5 py-1 text-xs font-medium', meta.chip)}>{meta.label}</span>
          </div>
          {info && (
            <>
              <p className="flex items-center gap-1 text-xs text-emerald-900/55">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {info.lga}, {info.state} · {Number(info.size_hectares)} ha · declared crops: {info.primary_crops.join(', ')}
              </p>
              {info.owner_name && (
                <p className="text-xs text-emerald-900/55">
                  {t('verification.task.farmerToConfirm')}{' '}
                  <span className="font-semibold">{info.owner_name}</span>
                </p>
              )}
              {info.latitude !== null && info.longitude !== null && (
                <FarmMap latitude={Number(info.latitude)} longitude={Number(info.longitude)} className="h-44 overflow-hidden rounded-lg" />
              )}
            </>
          )}
          {detail.reviewer_note && (
            <p className="rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-800">
              Review team: {detail.reviewer_note}
            </p>
          )}
          {detail.note && (
            <p className="flex items-start gap-1.5 text-[11px] text-emerald-900/45">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {detail.note}
            </p>
          )}
        </Card>

        {/* Sync state. "Saved" and "sent" are different words on purpose. */}
        <Card
          className={cn(
            'flex items-start gap-2.5 p-4',
            queue.sync.state === 'failed' ? 'bg-red-50' : queue.sync.state === 'synced' ? 'bg-white' : 'bg-amber-50',
          )}
        >
          <SyncIcon
            className={cn('mt-0.5 h-4 w-4 shrink-0',
              queue.sync.state === 'failed' ? 'text-red-600'
                : queue.sync.state === 'synced' ? 'text-emerald-600' : 'text-amber-600')}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-emerald-950">{queue.sync.label}</p>
            <p className="text-[11px] text-emerald-900/60">{queue.sync.detail}</p>
          </div>
          {queue.online && unsent > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void queue.flush()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
            </Button>
          )}
        </Card>

        {/* 1 · GPS */}
        <Card className="space-y-3 p-5">
          <p className="text-sm font-semibold text-emerald-950">{t('verification.task.gpsHeading')}</p>
          {hasFix ? (
            <p className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
              <Crosshair className="h-3.5 w-3.5" aria-hidden /> Position recorded and checked against the
              registered pin server-side.
            </p>
          ) : (
            <p className="text-xs text-emerald-900/55">
              {t('verification.task.gpsExplainer')}
            </p>
          )}
          {awaitingAcceptance && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-emerald-950">{t('verification.task.takeThisJob')}</h2>
              <p className="mt-1 text-[13px] text-emerald-900/70">
                {t('verification.task.reservedExplainer')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" loading={busy === 'accept'} onClick={() => respondToAssignment(true)}>
                  {t('verification.task.acceptThisTask')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy === 'accept'}
                  loading={busy === 'decline'} onClick={() => respondToAssignment(false)}>
                  Decline
                </Button>
              </div>
            </Card>
          )}

          {editable && (
            <Button size="sm" variant={hasFix ? 'outline' : 'primary'} onClick={captureGps} loading={busy === 'gps'}>
              <LocateFixed className="h-4 w-4" aria-hidden /> {hasFix ? t('verification.task.captureAnotherFix') : t('verification.task.captureGpsNow')}
            </Button>
          )}
        </Card>

        {/* 2 · Photographs */}
        <Card className="space-y-3 p-5">
          <p className="text-sm font-semibold text-emerald-950">
            {t('verification.task.photosHeading', { sent: photoCount, min: MIN_EVIDENCE_PHOTOS })}
          </p>

          {queue.items.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">{t('verification.task.onThisDevice')}</p>
              <ul className="space-y-1.5">
                {queue.items.map((q) => (
                  <li key={q.id} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="flex-1 truncate">
                      {q.evidenceType === 'gps_point' ? t('verification.task.gpsFix') : t('verification.task.photograph')} · {t('verification.task.capturedAt')} {formatDateShort(q.capturedAt)}
                      {q.lastError && <span className="block text-[11px] text-red-700">{q.lastError}</span>}
                    </span>
                    {q.attempts >= 5 ? (
                      <Button size="sm" variant="ghost" onClick={() => void queue.retry(q.id)}>{t('verification.task.retry')}</Button>
                    ) : (
                      <span className="text-[11px]">waiting</span>
                    )}
                    <button
                      type="button"
                      onClick={() => void queue.discard(q.id)}
                      className="rounded p-1 text-amber-700 hover:bg-amber-100"
                      aria-label={t('verification.task.discardCapture')}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-800">
                {t('verification.task.discardExplainer')}
              </p>
            </div>
          )}

          {serverEvidence.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-800/70">{t('verification.task.receivedByLoamy')}</p>
              <div className="flex flex-wrap gap-2">
                {serverEvidence.filter((e) => urls[e.id]).map((e) => (
                  <a
                    key={e.id}
                    href={urls[e.id]}
                    target="_blank"
                    rel="noreferrer"
                    className="block h-24 w-24 overflow-hidden rounded-lg ring-1 ring-emerald-100"
                  >
                    <img src={urls[e.id]} alt="Evidence" className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
              <ul className="space-y-1">
                {serverEvidence.filter((e) => (e.flags?.length ?? 0) > 0).map((e) => (
                  <li key={e.id} className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                    {e.ref ?? e.type}: {(e.flags ?? []).map(flagLabel).join(' · ')}
                  </li>
                ))}
              </ul>
              {serverEvidence.some((e) => (e.flags?.length ?? 0) > 0) && (
                <p className="text-[11px] text-emerald-900/50">{FLAG_DISCLAIMER}</p>
              )}
            </div>
          )}

          {editable && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50">
              <Camera className="h-4 w-4" aria-hidden /> {busy === 'photos' ? t('common.saving') : t('verification.task.takeAddPhotographs')}
              <input
                type="file"
                accept="image/*,video/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => { void addPhotos(e.target.files); e.target.value = '' }}
              />
            </label>
          )}
          <p className="text-[11px] text-emerald-900/45">
            {t('verification.task.privateStore')}
          </p>
        </Card>

        {/* 3 · Checklist, as the server defines it */}
        <Card className="space-y-4 p-5">
          <div>
            <p className="text-sm font-semibold text-emerald-950">{t('verification.task.checklistHeading')}</p>
            {detail.checklist_definition?.version && (
              <p className="text-[11px] text-emerald-900/45">
                Version {detail.checklist_definition.version} · your answers are stored against this version
              </p>
            )}
          </div>

          {!detail.checklist_definition?.available || items.length === 0 ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('verification.task.noChecklist')}
            </p>
          ) : (
            items.map((item) => {
              const v = answers[item.key]
              return (
                <div key={item.key} className="space-y-1.5">
                  <p className="text-xs font-medium text-emerald-950">
                    {item.label}
                    {item.required && <span className="text-red-500"> *</span>}
                  </p>
                  {item.kind === 'boolean' ? (
                    <div className="flex gap-2">
                      {([true, false] as const).map((b) => (
                        <button
                          key={String(b)}
                          type="button"
                          disabled={!editable}
                          onClick={() => setAnswers((p) => ({ ...p, [item.key]: b }))}
                          className={cn(
                            'flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
                            v === b
                              ? b
                                ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
                                : 'border-red-400 bg-red-50 text-red-700'
                              : 'border-emerald-100 bg-white text-emerald-900/60 hover:bg-emerald-50',
                          )}
                        >
                          {b ? 'Yes' : 'No'}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Input
                      type={item.kind === 'number' ? 'number' : 'text'}
                      inputMode={item.kind === 'number' ? 'decimal' : undefined}
                      value={v === null || v === undefined ? '' : String(v)}
                      disabled={!editable}
                      onChange={(e) => setAnswers((p) => ({ ...p, [item.key]: e.target.value }))}
                      placeholder={item.required ? 'Required' : 'Optional'}
                    />
                  )}
                </div>
              )
            })
          )}

          <div>
            <p className="mb-1 text-xs font-medium text-emerald-950">{t('verification.task.overallFieldNote')}</p>
            <Textarea
              value={partnerNote}
              disabled={!editable}
              onChange={(e) => setPartnerNote(e.target.value)}
              placeholder={t('verification.task.notePlaceholder')}
            />
          </div>
        </Card>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && !error && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
        )}

        {editable && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="flex-1" loading={busy === 'save'} onClick={() => saveChecklist(false)}>
                {t('verification.task.saveProgress')}
              </Button>
              <Button className="flex-1" variant="gold" disabled={!canSubmit} loading={busy === 'submit'} onClick={() => saveChecklist(true)}>
                <Send className="h-4 w-4" aria-hidden /> {t('verification.task.submitForReview')}
              </Button>
            </div>
            {blockers.length > 0 && (
              <p className="text-center text-[11px] text-emerald-900/50">
                Still needed: {blockers.join(', ')}.
              </p>
            )}
          </>
        )}

        {detail.status === 'submitted' && (
          <p className="rounded-lg bg-orange-50 px-3 py-2 text-center text-xs text-orange-800">
            {t('verification.task.awaitingReview')}
          </p>
        )}
      </div>
    </RoleShell>
  )
}
