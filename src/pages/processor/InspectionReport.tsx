import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, MapPin, ShieldAlert, XCircle } from 'lucide-react'
import { inspectionPhotoUrl, reviewInspection, type InspectionJob, type Recommendation } from '@/lib/inspections'
import { formatDateShort } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const REC: Record<Recommendation, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  pass: { label: 'Pass', cls: 'text-emerald-700', Icon: CheckCircle2 },
  conditional: { label: 'Conditional', cls: 'text-amber-700', Icon: ShieldAlert },
  fail: { label: 'Fail', cls: 'text-red-600', Icon: XCircle },
}

function Photo({ path }: { path: string }) {
  const { t } = useT()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { inspectionPhotoUrl(path).then(setUrl) }, [path])
  if (!url) return <div className="h-16 w-16 shrink-0 animate-pulse rounded bg-emerald-50" />
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
      <img src={url} alt={t('processor.report.evidenceAlt')} className="h-16 w-16 rounded border border-line object-cover" />
    </a>
  )
}

/**
 * Read-only inspection report. Buyers (procurement) can accept or dispute a
 * submitted report. Evidence photos load via short-lived signed URLs from the
 * private bucket — never public.
 */
export default function InspectionReport({ job, canReview, onReviewed }: {
  job: InspectionJob
  canReview: boolean
  onReviewed: () => void
}) {
  const { t, tOr } = useT()
  const errorText = useErrorText()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = job.recommendation ? REC[job.recommendation] : null

  async function review(accept: boolean) {
    setBusy(true); setError(null)
    try { await reviewInspection(job.id, accept, note || undefined); onReviewed() }
    catch (e) { setError(errorText(e, 'processor.report.couldNotSubmit', 'Could not submit review.')) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-3 text-[13px]">
      <div className="grid gap-2 sm:grid-cols-2">
        <div><span className="text-emerald-900/50">{t('processor.report.quantityVerified')}</span><p className="text-emerald-950">{job.quantity_verified != null ? `${job.quantity_verified} ${job.unit}` : '-'}</p></div>
        <div><span className="text-emerald-900/50">{t('processor.report.moistureReading')}</span><p className="text-emerald-950">{job.moisture_reading != null ? `${job.moisture_reading}%` : '-'}</p></div>
        <div>
          <span className="text-emerald-900/50">{t('processor.report.recommendation')}</span>
          <p className={`font-medium ${rec?.cls ?? 'text-emerald-900/50'}`}>
            {rec ? (<span className="inline-flex items-center gap-1"><rec.Icon className="h-4 w-4" aria-hidden /> {tOr(`processor.report.${job.recommendation}`, rec.label)}</span>) : '-'}
          </p>
        </div>
        <div>
          <span className="text-emerald-900/50">{t('processor.report.locationGps')}</span>
          <p className="text-emerald-950">
            {job.gps_lat != null && job.gps_lng != null ? (
              <a className="inline-flex items-center gap-1 text-emerald-700 hover:underline" target="_blank" rel="noopener noreferrer"
                href={`https://www.google.com/maps?q=${job.gps_lat},${job.gps_lng}`}>
                <MapPin className="h-3.5 w-3.5" aria-hidden /> {job.gps_lat.toFixed(4)}, {job.gps_lng.toFixed(4)}
              </a>
            ) : '-'}
          </p>
        </div>
      </div>

      {job.quality_notes && (
        <div><span className="text-emerald-900/50">{t('processor.report.qualityNotes')}</span><p className="text-emerald-950">{job.quality_notes}</p></div>
      )}

      {job.photos.length > 0 && (
        <div>
          <span className="text-emerald-900/50">{t('processor.report.evidencePhotos')}</span>
          <div className="mt-1 flex flex-wrap gap-2">{job.photos.map((p) => <Photo key={p} path={p} />)}</div>
        </div>
      )}

      <p className="text-[11px] text-emerald-900/45">
        {job.partner_name
          ? t('processor.report.inspectedBy', { partner: job.partner_name })
          : t('processor.report.companyInspection')}
        {job.submitted_at && t('processor.report.submittedOn', { date: formatDateShort(job.submitted_at) })}
      </p>

      {job.status === 'submitted' && canReview && (
        <div className="space-y-2 border-t border-line pt-3">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('processor.report.notePlaceholder')} />
          {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => review(true)} disabled={busy}>{t('processor.report.accept')}</Button>
            <Button size="sm" variant="outline" className="!text-red-700 !border-red-200 hover:!bg-red-50" onClick={() => review(false)} disabled={busy}>{t('processor.report.dispute')}</Button>
          </div>
        </div>
      )}
      {job.status === 'accepted' && <p className="inline-flex items-center gap-1 font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden /> {t('processor.report.accepted')}</p>}
      {job.status === 'disputed' && <p className="inline-flex items-center gap-1 font-medium text-red-600"><XCircle className="h-4 w-4" aria-hidden /> {job.review_note
        ? t('processor.report.disputedWithNote', { note: job.review_note })
        : t('processor.report.disputed')}</p>}
    </div>
  )
}
