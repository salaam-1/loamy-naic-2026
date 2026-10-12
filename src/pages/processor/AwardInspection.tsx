import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { fetchInspectionForAward, requestInspection, type InspectionJob } from '@/lib/inspections'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import InspectionReport from '@/pages/processor/InspectionReport'

const STATUS_LABEL: Record<InspectionJob['status'], string> = {
  requested: 'Awaiting a partner', assigned: 'Partner assigned', in_progress: 'In progress',
  submitted: 'Report submitted - review', accepted: 'Passed', disputed: 'Disputed', cancelled: 'Cancelled',
}

/**
 * Inspection control for a single award: request one (procurement), then track
 * status and review the submitted report. Wired into the award list.
 */
export default function AwardInspection({ awardId, canProcure }: { awardId: string; canProcure: boolean }) {
  const { t, tOr } = useT()
  const errorText = useErrorText()
  const statusLabel = (st: InspectionJob['status']) =>
    tOr(`processor.awardInspection.${st}`, STATUS_LABEL[st])
  const [job, setJob] = useState<InspectionJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [scheduledFor, setScheduledFor] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expand, setExpand] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setJob(await fetchInspectionForAward(awardId)) }
    catch (e) { setError(errorText(e, 'processor.awardInspection.couldNotLoad', 'Could not load inspection.')) }
    finally { setLoading(false) }
  }, [awardId])

  useEffect(() => { void load() }, [load])

  async function onRequest() {
    setBusy(true); setError(null)
    try { await requestInspection(awardId, null, scheduledFor ? new Date(scheduledFor).toISOString() : null); await load() }
    catch (e) { setError(errorText(e, 'processor.awardInspection.couldNotRequest', 'Could not request inspection.')) }
    finally { setBusy(false) }
  }

  if (loading) return <p className="flex items-center gap-1 text-[12px] text-emerald-900/45"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {t('processor.awardInspection.loading')}</p>

  if (!job) {
    if (!canProcure) return null
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
        <span className="text-[12px] text-emerald-900/60"><ClipboardCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />{t('processor.awardInspection.label')}</span>
        <Input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className="h-8 min-h-touch w-40 text-[13px]" />
        <Button size="sm" variant="outline" onClick={onRequest} disabled={busy}>{busy ? t('processor.awardInspection.requesting') : t('processor.awardInspection.request')}</Button>
        {error && <span className="text-[12px] text-red-700">{error}</span>}
      </div>
    )
  }

  return (
    <div className="border-t border-line pt-2.5">
      <button onClick={() => setExpand((e) => !e)} className="flex w-full items-center justify-between text-left">
        <span className="text-[12px] font-medium text-emerald-900/70"><ClipboardCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />{t('processor.awardInspection.labelWithStatus', { status: statusLabel(job.status) })}</span>
        <span className="text-[12px] text-emerald-700">{expand
          ? t('processor.awardInspection.hide')
          : job.status === 'submitted'
            ? t('processor.awardInspection.review')
            : t('processor.awardInspection.view')}</span>
      </button>
      {error && <p className="mt-1 text-[12px] text-red-700">{error}</p>}
      {expand && (
        <div className="mt-2">
          {job.status === 'requested' || job.status === 'assigned' || job.status === 'in_progress' ? (
            <p className="text-[12px] text-emerald-900/55">
              {job.mode === 'loamy_partner'
                ? (job.assigned_partner_id
                  ? t('processor.awardInspection.partnerInspecting')
                  : t('processor.awardInspection.offeredToPartners'))
                : t('processor.awardInspection.awaitingReport')}
            </p>
          ) : (
            <InspectionReport job={job} canReview={canProcure} onReviewed={load} />
          )}
        </div>
      )}
    </div>
  )
}
