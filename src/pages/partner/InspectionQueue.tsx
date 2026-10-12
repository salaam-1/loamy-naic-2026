import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Crosshair, ImagePlus, MapPin, PackageSearch } from 'lucide-react'
import {
  claimInspection, fetchAvailableInspections, fetchMyAssignedInspections, submitInspection,
  uploadInspectionPhoto, type AvailableInspection, type InspectionJob, type Recommendation,
} from '@/lib/inspections'
import { formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { useT } from '@/lib/i18n'

const selectCls = 'flex h-10 w-full rounded border border-line bg-white px-3 text-sm text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-600/30'

/**
 * Growth Partner inspection queue: claim jobs offered in your territory, then
 * file the on-site report — GPS capture, evidence photos, moisture, verified
 * quantity, and a pass/fail/conditional recommendation.
 */
export default function InspectionQueue() {
  const { t } = useT()
  const [pool, setPool] = useState<AvailableInspection[]>([])
  const [mine, setMine] = useState<InspectionJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<InspectionJob | null>(null)
  const [qty, setQty] = useState(''); const [moisture, setMoisture] = useState('')
  const [notes, setNotes] = useState(''); const [rec, setRec] = useState<Recommendation | ''>('')
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, m] = await Promise.all([fetchAvailableInspections(), fetchMyAssignedInspections()])
      setPool(p); setMine(m)
    } catch (e) { setError(e instanceof Error ? e.message : t('verification.inspection.couldNotLoad')) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function onClaim(id: string) {
    setError(null)
    try { await claimInspection(id); await load() }
    catch (e) { setError(e instanceof Error ? e.message : t('verification.inspection.couldNotClaim')) }
  }

  function openForm(job: InspectionJob) {
    setForm(job); setQty(job.quantity_verified?.toString() ?? String(job.awarded_quantity))
    setMoisture(''); setNotes(''); setRec(''); setGps(null); setPhotos([]); setModalError(null)
  }

  function captureGps() {
    if (!navigator.geolocation) { setModalError('Location is not available on this device.'); return }
    setGpsBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsBusy(false) },
      () => { setModalError('Could not capture GPS. Allow location access and retry.'); setGpsBusy(false) },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function onPhoto(file: File) {
    if (!form) return
    try { const path = await uploadInspectionPhoto(form.id, file); setPhotos((p) => [...p, path]) }
    catch (e) { setModalError(e instanceof Error ? e.message : t('verification.inspection.photoUploadFailed')) }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!rec) { setModalError('Choose a recommendation.'); return }
    setBusy(true); setModalError(null)
    try {
      await submitInspection(form.id, {
        photos, gps_lat: gps?.lat ?? null, gps_lng: gps?.lng ?? null,
        quantity_verified: qty ? Number(qty) : null, moisture_reading: moisture ? Number(moisture) : null,
        quality_notes: notes || null, recommendation: rec,
      })
      setForm(null); await load()
    } catch (e) { setModalError(e instanceof Error ? e.message : t('verification.inspection.couldNotSubmit')) }
    finally { setBusy(false) }
  }

  if (loading) return <div className="h-40 animate-pulse rounded bg-emerald-50" aria-label="Loading" />

  const active = mine.filter((j) => j.status === 'assigned' || j.status === 'in_progress')
  const done = mine.filter((j) => j.status === 'submitted' || j.status === 'accepted' || j.status === 'disputed')

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <DashboardCard title={`Available in your territory · ${pool.length}`}>
        {pool.length === 0 ? (
          <EmptyState icon={PackageSearch} title={t('verification.inspection.noneAvailable')}
            body={t('verification.inspection.noneAvailableHint')} />
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {pool.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium text-emerald-950">{j.commodity} · {j.awarded_quantity} {j.unit}</p>
                  <p className="text-[11px] text-emerald-900/50">
                    <MapPin className="mr-0.5 inline h-3 w-3" aria-hidden />{j.state}{j.location ? ` · ${j.location}` : ''} · {j.rfq_reference}
                    {j.scheduled_for && ` · scheduled ${formatDateShort(j.scheduled_for)}`}
                  </p>
                </div>
                <Button size="sm" onClick={() => onClaim(j.id)}>Claim</Button>
              </div>
            ))}
          </div>
        )}
      </DashboardCard>

      {active.length > 0 && (
        <DashboardCard title={`Assigned to you · ${active.length}`}>
          <div className="flex flex-col divide-y divide-line">
            {active.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium text-emerald-950">{j.commodity} · {j.awarded_quantity} {j.unit}</p>
                  <p className="text-[11px] text-emerald-900/50">{j.state} · {j.rfq_reference}</p>
                </div>
                <Button size="sm" onClick={() => openForm(j)}>{t('verification.inspection.fileReport')}</Button>
              </div>
            ))}
          </div>
        </DashboardCard>
      )}

      {done.length > 0 && (
        <DashboardCard title="Submitted">
          <div className="flex flex-col divide-y divide-line">
            {done.map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                <span className="text-emerald-950">{j.commodity} · {j.rfq_reference}</span>
                <span className="capitalize text-emerald-900/55">{j.status}</span>
              </div>
            ))}
          </div>
        </DashboardCard>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title="Inspection report">
        {form && (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="rounded bg-emerald-50/60 px-3 py-2 text-[12px] text-emerald-900/70">
              {form.commodity} · {form.awarded_quantity} {form.unit} · {form.rfq_reference}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="qv">Quantity verified ({form.unit})</Label>
                <Input id="qv" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="mo">{t('verification.inspection.moisture')}</Label>
                <Input id="mo" type="number" min="0" max="100" value={moisture} onChange={(e) => setMoisture(e.target.value)} placeholder="e.g. 13.2" />
              </div>
            </div>
            <div>
              <Label htmlFor="rec">{t('verification.inspection.recommendation')}</Label>
              <select id="rec" className={selectCls} value={rec} onChange={(e) => setRec(e.target.value as Recommendation)}>
                <option value="">Select…</option>
                <option value="pass">{t('verification.inspection.pass')}</option>
                <option value="conditional">{t('verification.inspection.conditional')}</option>
                <option value="fail">{t('verification.inspection.fail')}</option>
              </select>
            </div>
            <div>
              <Label htmlFor="qn">{t('verification.inspection.qualityNotes')}</Label>
              <Textarea id="qn" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('verification.inspection.notesPlaceholder')} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={captureGps} disabled={gpsBusy}>
                <Crosshair className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {gpsBusy ? t('verification.inspection.locating') : gps ? t('verification.inspection.gpsCaptured') : t('verification.inspection.captureGps')}
              </Button>
              {gps && <span className="text-[12px] text-emerald-900/60">{gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</span>}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-line bg-white px-3 py-1.5 text-[13px] text-emerald-900 hover:bg-emerald-50">
                <ImagePlus className="h-3.5 w-3.5" aria-hidden /> {t('verification.inspection.addPhoto')}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f); e.target.value = '' }} />
              </label>
              {photos.length > 0 && <span className="text-[12px] text-emerald-900/60">{photos.length} photo{photos.length === 1 ? '' : 's'}</span>}
            </div>
            {modalError && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{modalError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? t('verification.inspection.submitting') : t('verification.inspection.submitReport')}</Button>
              <Button type="button" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
