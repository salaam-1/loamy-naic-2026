import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Boxes, MapPin, Package, Pencil, Plus, ShieldCheck, Sprout, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { COMMODITIES } from '@/lib/nigeria'
import {
  OWNERSHIP_LABELS,
  VERIFICATION_META,
  type CropRecord,
  type Farm,
} from '@/lib/farming'
import {
  HARVEST_UNITS, canBatch, createBatchFromHarvest, fetchHarvests, fetchMyBatches,
  recordHarvest, unbatchedQuantity,
  type CommodityBatch, type Harvest, type HarvestUnit,
} from '@/lib/stock'
import { formatDateShort } from '@/lib/utils'
import { FarmerShell } from '@/pages/farmer/FarmerShell'
import { FarmMap } from '@/components/FarmMap'
import { WeatherPanel } from '@/components/WeatherPanel'
import { VerificationBadge } from '@/components/VerificationBadge'
import { DashboardCard } from '@/components/DashboardCard'
import { useT } from '@/lib/i18n'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface RecordFormState {
  crop: string
  season_year: string
  planting_date: string
  expected_harvest_date: string
  actual_harvest_date: string
  expected_yield_kg: string
  actual_yield_kg: string
  notes: string
}

const BLANK_RECORD: RecordFormState = {
  crop: '',
  season_year: String(new Date().getFullYear()),
  planting_date: '',
  expected_harvest_date: '',
  actual_harvest_date: '',
  expected_yield_kg: '',
  actual_yield_kg: '',
  notes: '',
}

interface HarvestFormState {
  harvest_date: string
  quantity: string
  unit: HarvestUnit
  quality_grade: string
  location_note: string
}

function blankHarvest(): HarvestFormState {
  return {
    harvest_date: new Date().toISOString().slice(0, 10),
    quantity: '',
    unit: 'kg',
    quality_grade: '',
    location_note: '',
  }
}

interface VerificationProgress {
  id: string
  status: string
  created_at: string
  completed_at: string | null
}

/** Honest progress steps: requested → assigned → visit → review → decision. */
const PROGRESS_STEPS = ['Requested', 'Partner assigned', 'Field visit', 'Under review', 'Decision'] as const

function progressIndex(status: string): number {
  switch (status) {
    case 'pending': return 0
    case 'assigned': return 1
    case 'in_progress': return 2
    case 'resubmit_requested': return 2
    case 'submitted': return 3
    case 'approved': return 4
    case 'rejected': return 4
    default: return 0
  }
}

export default function FarmDetail() {
  const { t, tOr } = useT()
  const { farmId } = useParams()
  const navigate = useNavigate()
  const [farm, setFarm] = useState<Farm | null | 'missing'>(null)
  const [progress, setProgress] = useState<VerificationProgress | null>(null)
  const [records, setRecords] = useState<CropRecord[]>([])
  const [showRecordForm, setShowRecordForm] = useState(false)
  const [recordForm, setRecordForm] = useState<RecordFormState>(BLANK_RECORD)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [savingRecord, setSavingRecord] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  // Harvest -> batch. Until this screen existed, `harvests` and
  // `commodity_batches` had no writer anywhere in the product, so nothing
  // downstream of a batch -- trace, verified supply, financing against stock
  // -- could ever be reached.
  const [harvests, setHarvests] = useState<Harvest[]>([])
  const [batches, setBatches] = useState<CommodityBatch[]>([])
  const [harvestFor, setHarvestFor] = useState<string | null>(null)
  const [harvestForm, setHarvestForm] = useState<HarvestFormState>(blankHarvest)
  const [harvestError, setHarvestError] = useState<string | null>(null)
  const [savingHarvest, setSavingHarvest] = useState(false)
  const [batching, setBatching] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!farmId) return
    const [farmRes, recordsRes, progressRes] = await Promise.all([
      supabase.from('farms').select('*').eq('id', farmId).maybeSingle(),
      supabase
        .from('crop_records')
        .select('*')
        .eq('farm_id', farmId)
        .order('season_year', { ascending: false })
        .order('created_at', { ascending: false }),
      // Status-only progress view — evidence internals are never farmer-visible.
      supabase
        .from('loamy_verification_progress')
        .select('*')
        .eq('subject_farm_id', farmId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    setFarm((farmRes.data as Farm) ?? 'missing')
    setRecords((recordsRes.data as CropRecord[]) ?? [])
    setProgress((progressRes.data as VerificationProgress) ?? null)
    setHarvests(await fetchHarvests(farmId))
    // Batches are fetched whole rather than per-harvest: how much of a
    // harvest is left to batch depends on every batch already cut from it.
    setBatches(await fetchMyBatches())
  }, [farmId])

  useEffect(() => {
    void load()
  }, [load])

  async function requestVerification() {
    setRequestError(null)
    setRequesting(true)
    // The only path to 'pending': a security-definer function that checks
    // ownership server-side and notifies the admin team.
    const { error } = await supabase.rpc('loamy_request_farm_verification_guarded', { p_farm_id: farmId })
    setRequesting(false)
    if (error) {
      setRequestError(error.message)
      return
    }
    await load()
  }

  async function addRecord(e: FormEvent) {
    e.preventDefault()
    setRecordError(null)
    if (!recordForm.crop) return setRecordError('Select the crop.')
    const year = Number(recordForm.season_year)
    if (!Number.isInteger(year) || year < 1980 || year > 2100) {
      return setRecordError('Season year looks wrong.')
    }
    setSavingRecord(true)
    const num = (v: string) => (v === '' ? null : Number(v))
    const dat = (v: string) => (v === '' ? null : v)
    const { error } = await supabase.from('crop_records').insert({
      farm_id: farmId,
      crop: recordForm.crop,
      season_year: year,
      planting_date: dat(recordForm.planting_date),
      expected_harvest_date: dat(recordForm.expected_harvest_date),
      actual_harvest_date: dat(recordForm.actual_harvest_date),
      expected_yield_kg: num(recordForm.expected_yield_kg),
      actual_yield_kg: num(recordForm.actual_yield_kg),
      notes: recordForm.notes.trim() || null,
    })
    setSavingRecord(false)
    if (error) {
      setRecordError(error.message)
      return
    }
    setRecordForm(BLANK_RECORD)
    setShowRecordForm(false)
    await load()
  }

  async function addHarvest(e: FormEvent, rec: CropRecord) {
    e.preventDefault()
    setHarvestError(null)
    const qty = Number(harvestForm.quantity)
    if (!Number.isFinite(qty) || qty <= 0) return setHarvestError('Quantity must be greater than zero.')
    if (!harvestForm.harvest_date) return setHarvestError('Harvest date is required.')
    setSavingHarvest(true)
    const { error } = await recordHarvest({
      farmId: farmId!,
      productionCycleId: rec.id,
      // Taken from the cycle, never re-asked: a harvest of a different crop
      // from the one that was planted is a different cycle.
      commodity: rec.crop,
      harvestDate: harvestForm.harvest_date,
      quantity: qty,
      unit: harvestForm.unit,
      qualityGrade: harvestForm.quality_grade.trim() || null,
      locationState: farm !== 'missing' && farm ? farm.state : null,
      locationLga: farm !== 'missing' && farm ? farm.lga : null,
      locationNote: harvestForm.location_note.trim() || null,
    })
    setSavingHarvest(false)
    if (error) return setHarvestError(error)
    setHarvestForm(blankHarvest())
    setHarvestFor(null)
    await load()
  }

  async function makeBatch(h: Harvest) {
    setHarvestError(null)
    setBatching(h.id)
    // No quantity: batch whatever of this harvest is not already batched.
    const { error } = await createBatchFromHarvest(h.id)
    setBatching(null)
    if (error) return setHarvestError(error)
    await load()
  }

  async function deleteRecord(id: string) {
    await supabase.from('crop_records').delete().eq('id', id)
    await load()
  }

  if (farm === null) {
    return (
      <FarmerShell section="my-farm">
        <div className="h-40 animate-pulse rounded-card bg-white" aria-label={t('farm.loadingFarm')} />
      </FarmerShell>
    )
  }
  if (farm === 'missing') {
    return (
      <FarmerShell section="my-farm">
        <Card className="p-8 text-center text-sm text-emerald-900/60">
          {t('farm.notYours')}
        </Card>
      </FarmerShell>
    )
  }

  const cycleHarvests = (cycleId: string) => harvests.filter((h) => h.production_cycle_id === cycleId)
  const verification = VERIFICATION_META[farm.verification_status]
  const canRequest = farm.verification_status === 'unverified' || farm.verification_status === 'rejected'

  return (
    <FarmerShell section="my-farm">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              to="/dashboard/farmer/my-farm"
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('farm.allFarms')}
            </Link>
            <h1 className="flex items-center gap-3 text-lg font-semibold text-emerald-950">
              {farm.farm_name}
              <VerificationBadge status={farm.verification_status} />
            </h1>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-900/55">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {farm.lga}, {farm.state} · {Number(farm.size_hectares)} ha ·{' '}
              {OWNERSHIP_LABELS[farm.ownership_type]}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/farmer/my-farm/${farm.id}/edit`)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden /> {t('farm.editFarm')}
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <DashboardCard title="Location">
            {farm.latitude !== null && farm.longitude !== null ? (
              <>
                <FarmMap latitude={Number(farm.latitude)} longitude={Number(farm.longitude)} className="h-52 overflow-hidden rounded-lg" />
                <p className="mt-2 text-xs text-emerald-900/50">
                  {Number(farm.latitude)}, {Number(farm.longitude)}
                  {farm.address_description ? ` - ${farm.address_description}` : ''}
                </p>
              </>
            ) : (
              <div className="flex flex-col items-start gap-2 py-4">
                <p className="text-sm text-emerald-900/60">
                  {t('farm.noGpsYet')}
                </p>
                <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/farmer/my-farm/${farm.id}/edit`)}>
                  {t('farm.addLocation')}
                </Button>
              </div>
            )}
          </DashboardCard>

          <DashboardCard title="Verification">
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-emerald-900/70">{tOr(`farm.${farm.verification_status === 'unverified' ? 'notVerifiedYet' : farm.verification_status === 'pending' ? 'verificationRequested' : farm.verification_status === 'verified' ? 'verifiedByVisit' : 'verificationUnsuccessfulHint'}`, verification.description)}</p>
              {progress && farm.verification_status !== 'unverified' && (
                <ol className="space-y-1.5" aria-label={t('farm.verificationProgress')}>
                  {PROGRESS_STEPS.map((step, i) => {
                    const current = progressIndex(progress.status)
                    const done = i < current
                    const active = i === current
                    const decided = i === 4 && ['approved', 'rejected'].includes(progress.status)
                    return (
                      <li key={step} className="flex items-center gap-2 text-xs">
                        <span
                          className={
                            done || decided
                              ? 'flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white'
                              : active
                                ? 'h-4 w-4 rounded-full border-2 border-gold-400 bg-gold-100'
                                : 'h-4 w-4 rounded-full border border-emerald-950/15'
                          }
                          aria-hidden
                        >
                          {(done || decided) && '✓'}
                        </span>
                        <span className={active ? 'font-semibold text-emerald-950' : 'text-emerald-900/55'}>
                          {i === 4 && progress.status === 'rejected'
                            ? t('farm.decisionUnsuccessful')
                            : i === 2 && progress.status === 'resubmit_requested'
                              ? t('farm.anotherVisitRequested')
                              : step}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
              {canRequest && (
                <Button onClick={requestVerification} loading={requesting}>
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Request verification
                </Button>
              )}
              {requestError && <p className="text-xs text-red-700">{requestError}</p>}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {farm.primary_crops.map((crop) => (
                  <span key={crop} className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                    {crop}
                  </span>
                ))}
              </div>
            </div>
          </DashboardCard>
        </div>

        <WeatherPanel
          latitude={farm.latitude !== null ? Number(farm.latitude) : null}
          longitude={farm.longitude !== null ? Number(farm.longitude) : null}
        />

        <DashboardCard
          title={t('farm.cropRecords')}
          action={
            <Button variant="outline" size="sm" onClick={() => setShowRecordForm((v) => !v)}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> {t('farm.addRecord')}
            </Button>
          }
        >
          {showRecordForm && (
            <form onSubmit={addRecord} className="mb-5 space-y-4 rounded-lg border border-emerald-100 bg-emerald-50/40 p-4" noValidate>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="rec_crop">{t('farm.crop')}</Label>
                  <Select id="rec_crop" value={recordForm.crop} onChange={(e) => setRecordForm((p) => ({ ...p, crop: e.target.value }))}>
                    <option value="" disabled>{t('farm.selectPlaceholder')}</option>
                    {COMMODITIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rec_year">{t('farm.seasonYear')}</Label>
                  <Input id="rec_year" type="number" value={recordForm.season_year} onChange={(e) => setRecordForm((p) => ({ ...p, season_year: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="rec_planting">{t('farm.plantingDate')}</Label>
                  <Input id="rec_planting" type="date" value={recordForm.planting_date} onChange={(e) => setRecordForm((p) => ({ ...p, planting_date: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="rec_exp_date">{t('farm.expectedHarvest')}</Label>
                  <Input id="rec_exp_date" type="date" value={recordForm.expected_harvest_date} onChange={(e) => setRecordForm((p) => ({ ...p, expected_harvest_date: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="rec_act_date">{t('farm.actualHarvest')}</Label>
                  <Input id="rec_act_date" type="date" value={recordForm.actual_harvest_date} onChange={(e) => setRecordForm((p) => ({ ...p, actual_harvest_date: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="rec_exp_yield">{t('farm.expectedYieldKg')}</Label>
                  <Input id="rec_exp_yield" type="number" min={0} step="any" value={recordForm.expected_yield_kg} onChange={(e) => setRecordForm((p) => ({ ...p, expected_yield_kg: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="rec_act_yield">{t('farm.actualYieldKg')}</Label>
                  <Input id="rec_act_yield" type="number" min={0} step="any" value={recordForm.actual_yield_kg} onChange={(e) => setRecordForm((p) => ({ ...p, actual_yield_kg: e.target.value }))} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="rec_notes">{t('farm.notes')}</Label>
                  <Input id="rec_notes" value={recordForm.notes} onChange={(e) => setRecordForm((p) => ({ ...p, notes: e.target.value }))} placeholder={t('farm.notesPlaceholder')} />
                </div>
              </div>
              {recordError && <p className="text-xs text-red-700">{recordError}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={savingRecord}>{t('farm.saveRecord')}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowRecordForm(false)}>Cancel</Button>
              </div>
            </form>
          )}

          {records.length === 0 && !showRecordForm ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Sprout className="h-7 w-7 text-emerald-900/20" aria-hidden />
              <p className="max-w-sm text-sm text-emerald-900/50">
                {t('farm.noCropRecords')}
              </p>
            </div>
          ) : (
            <ol className="relative space-y-4 border-l border-emerald-100 pl-5">
              {records.map((rec) => (
                <li key={rec.id} className="relative">
                  <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-600" aria-hidden />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-emerald-950">
                        {rec.crop} · {rec.season_year}
                      </p>
                      <p className="mt-0.5 text-xs text-emerald-900/60">
                        {rec.planting_date && `Planted ${formatDateShort(rec.planting_date)}`}
                        {rec.actual_harvest_date
                          ? ` · Harvested ${formatDateShort(rec.actual_harvest_date)}`
                          : rec.expected_harvest_date
                            ? ` · Harvest expected ${formatDateShort(rec.expected_harvest_date)}`
                            : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-emerald-900/60">
                        {rec.expected_yield_kg !== null && `Expected ${Number(rec.expected_yield_kg)} kg`}
                        {rec.actual_yield_kg !== null &&
                          `${rec.expected_yield_kg !== null ? ' · ' : ''}Actual ${Number(rec.actual_yield_kg)} kg`}
                      </p>
                      {rec.notes && <p className="mt-1 text-xs italic text-emerald-900/50">{rec.notes}</p>}

                      {/* Harvests recorded against this cycle, and what each
                          one has become. A batch is what makes stock
                          traceable, verifiable and sellable as verified
                          supply -- before this screen there was no way to
                          create one. */}
                      {cycleHarvests(rec.id).map((h) => {
                        const left = unbatchedQuantity(h, batches)
                        const made = batches.filter((b) => b.harvest_id === h.id && b.status !== 'cancelled')
                        return (
                          <div key={h.id} className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                            <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-emerald-950">
                              <Package className="h-3.5 w-3.5" aria-hidden />
                              {Number(h.quantity)} {h.unit} harvested {formatDateShort(h.harvest_date)}
                              {h.quality_grade && <span className="text-emerald-900/60">· grade {h.quality_grade}</span>}
                              {h.ref && <span className="text-[11px] text-emerald-900/45">· {h.ref}</span>}
                            </p>
                            {made.length > 0 && (
                              <p className="mt-1 text-[11px] text-emerald-900/60">
                                Batched as {made.map((b) => b.ref ?? 'a batch').join(', ')}
                              </p>
                            )}
                            {canBatch(h, batches) ? (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  loading={batching === h.id}
                                  onClick={() => makeBatch(h)}
                                >
                                  <Boxes className="h-3.5 w-3.5" aria-hidden /> Create batch ({left} {h.unit})
                                </Button>
                                <span className="text-[11px] text-emerald-900/50">
                                  {t('farm.batchExplainer')}
                                </span>
                              </div>
                            ) : (
                              made.length > 0 && (
                                <Link
                                  to="/dashboard/farmer/my-stock"
                                  className="mt-1 inline-block text-[11px] font-medium text-emerald-700 hover:text-emerald-800"
                                >
                                  {t('farm.manageInMyStock')} →
                                </Link>
                              )
                            )}
                          </div>
                        )
                      })}

                      {harvestFor === rec.id ? (
                        <form onSubmit={(e) => addHarvest(e, rec)} className="mt-3 space-y-3 rounded-lg border border-emerald-100 bg-white p-3" noValidate>
                          <p className="text-xs font-semibold text-emerald-950">Record a {rec.crop} harvest</p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <Label htmlFor={`h_date_${rec.id}`}>{t('farm.harvestDate')}</Label>
                              <Input id={`h_date_${rec.id}`} type="date" value={harvestForm.harvest_date} onChange={(e) => setHarvestForm((p) => ({ ...p, harvest_date: e.target.value }))} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label htmlFor={`h_qty_${rec.id}`}>{t('farm.quantity')}</Label>
                                <Input id={`h_qty_${rec.id}`} type="number" min={0} step="any" value={harvestForm.quantity} onChange={(e) => setHarvestForm((p) => ({ ...p, quantity: e.target.value }))} />
                              </div>
                              <div>
                                <Label htmlFor={`h_unit_${rec.id}`}>{t('farm.unit')}</Label>
                                <Select id={`h_unit_${rec.id}`} value={harvestForm.unit} onChange={(e) => setHarvestForm((p) => ({ ...p, unit: e.target.value as HarvestUnit }))}>
                                  {HARVEST_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                                </Select>
                              </div>
                            </div>
                            <div>
                              <Label htmlFor={`h_grade_${rec.id}`}>{t('farm.qualityGrade')}</Label>
                              <Input id={`h_grade_${rec.id}`} value={harvestForm.quality_grade} onChange={(e) => setHarvestForm((p) => ({ ...p, quality_grade: e.target.value }))} placeholder={t('farm.qualityGradePlaceholder')} />
                            </div>
                            <div>
                              <Label htmlFor={`h_where_${rec.id}`}>{t('farm.whereStockHeld')}</Label>
                              <Input id={`h_where_${rec.id}`} value={harvestForm.location_note} onChange={(e) => setHarvestForm((p) => ({ ...p, location_note: e.target.value }))} placeholder={t('farm.storagePlaceholder')} />
                            </div>
                          </div>
                          {harvestError && <p className="text-xs text-red-700">{harvestError}</p>}
                          <div className="flex gap-2">
                            <Button type="submit" size="sm" loading={savingHarvest}>{t('farm.saveHarvest')}</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => { setHarvestFor(null); setHarvestError(null) }}>Cancel</Button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setHarvestFor(rec.id); setHarvestForm(blankHarvest()); setHarvestError(null) }}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden /> {t('farm.recordHarvest')}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteRecord(rec.id)}
                      className="rounded-md p-1.5 text-emerald-900/35 transition-colors hover:bg-red-50 hover:text-red-600"
                      aria-label={`Delete ${rec.crop} ${rec.season_year} record`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DashboardCard>
      </div>
    </FarmerShell>
  )
}
