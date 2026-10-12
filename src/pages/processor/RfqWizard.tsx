import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { COMMODITIES, NIGERIA_STATES } from '@/lib/nigeria'
import { fetchVarieties, type CommodityVariety } from '@/lib/ambassador'
import { formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import {
  createRfqDraft, GRADES, INSPECTION_LABELS, PACKAGING_TYPES, PAYMENT_LABELS, publishRfq,
  saveTemplate, UNITS, UNIT_SLUG, updateRfqDraft, VISIBILITY_LABELS,
  GRADE_SLUG, PACKAGING_SLUG,
  type InspectionMode, type PaymentMode, type Rfq, type RfqDraft, type Visibility,
} from '@/lib/rfqs'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'

/**
 * The six steps, in order. `slug` keys the word; the ORDER is the contract,
 * because validation, the stepper and the publish button are all driven by the
 * index. Translating a step name must never be able to reorder the wizard.
 */
const STEPS = [
  { slug: 'commodity', en: 'Commodity' },
  { slug: 'delivery', en: 'Delivery' },
  { slug: 'pricing', en: 'Pricing' },
  { slug: 'visibility', en: 'Visibility' },
  { slug: 'inspection', en: 'Inspection' },
  { slug: 'payment', en: 'Payment' },
] as const

const selectCls =
  'flex h-10 min-h-touch w-full rounded border border-line bg-white px-3 text-sm text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-600/30'

function RadioCard({
  checked, onChange, label, help, disabled,
}: { checked: boolean; onChange: () => void; label: string; help: string; disabled?: boolean }) {
  const { t } = useT()
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onChange}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded border p-3 text-left transition-colors ${
        disabled ? 'cursor-not-allowed border-line bg-emerald-50/40 opacity-60'
        : checked ? 'border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600/30'
        : 'border-line bg-white hover:bg-emerald-50/40'
      }`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
        checked ? 'border-emerald-600 bg-emerald-600' : 'border-emerald-900/30'
      }`}>
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-emerald-950">{label}{disabled && t('processor.wizard.soonSuffix')}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-emerald-900/55">{help}</span>
      </span>
    </button>
  )
}

/**
 * Six-step buy-request wizard. A draft row is created on the first "Next" and
 * updated between steps, so progress is never lost. The final step publishes via
 * the server RPC (which also notifies matching suppliers). No livestock: the
 * commodity list is the platform's crop-only list.
 */
export default function RfqWizard({ initial, onDone, onCancel }: {
  initial: Rfq | null
  onDone: () => void
  onCancel: () => void
}) {
  const { t, tOr } = useT()
  const errorText = useErrorText()
  const unitLabel = (v: string) => tOr(`processor.unit.${UNIT_SLUG[v] ?? v}`, v)
  const [rfqId, setRfqId] = useState<string | null>(initial?.id ?? null)
  const [reference, setReference] = useState<string | null>(initial?.reference ?? null)
  const [step, setStep] = useState(0)
  const [varieties, setVarieties] = useState<CommodityVariety[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closesAt, setClosesAt] = useState('')
  const [tplOpen, setTplOpen] = useState(false)
  const [tplName, setTplName] = useState('')

  const [d, setD] = useState<RfqDraft>({
    commodity: initial?.commodity ?? '',
    variety_id: initial?.variety_id ?? null,
    grade: initial?.grade ?? '',
    moisture_content: initial?.moisture_content ?? null,
    quantity: initial?.quantity ?? undefined,
    unit: initial?.unit ?? '',
    packaging_type: initial?.packaging_type ?? '',
    delivery_state: initial?.delivery_state ?? '',
    delivery_address: initial?.delivery_address ?? '',
    delivery_deadline: initial?.delivery_deadline ?? null,
    delivery_schedule: initial?.delivery_schedule ?? '',
    pricing_mode: initial?.pricing_mode ?? 'open_bidding',
    max_price: initial?.max_price ?? null,
    visibility: initial?.visibility ?? 'open',
    inspection_mode: initial?.inspection_mode ?? 'loamy_partner',
    payment_mode: initial?.payment_mode ?? 'escrow',
  })

  useEffect(() => { fetchVarieties().then(setVarieties).catch(() => {}) }, [])

  const set = <K extends keyof RfqDraft>(k: K, v: RfqDraft[K]) => setD((p) => ({ ...p, [k]: v }))
  const commodityVarieties = useMemo(
    () => varieties.filter((v) => v.commodity === d.commodity),
    [varieties, d.commodity],
  )

  function validate(s: number): string | null {
    if (s === 0) {
      if (!d.commodity) return t('processor.wizard.chooseCommodity')
      if (!d.quantity || d.quantity <= 0) return t('processor.wizard.enterQuantity')
      if (!d.unit) return t('processor.wizard.chooseUnit')
    }
    if (s === 2 && d.pricing_mode === 'fixed' && (d.max_price == null || d.max_price <= 0)) {
      return t('processor.wizard.enterMaxPrice')
    }
    return null
  }

  // Persist the current draft (create on first save).
  async function persist(): Promise<string> {
    if (rfqId) { await updateRfqDraft(rfqId, d); return rfqId }
    const row = await createRfqDraft(d)
    setRfqId(row.id); setReference(row.reference)
    return row.id
  }

  async function next() {
    const v = validate(step)
    if (v) { setError(v); return }
    setError(null); setBusy(true)
    try {
      await persist()
      setStep((s) => Math.min(s + 1, STEPS.length - 1))
    } catch (e) {
      setError(errorText(e, 'processor.wizard.couldNotSaveRetry', 'Could not save. Please try again.'))
    } finally { setBusy(false) }
  }

  async function saveDraftAndExit() {
    setBusy(true); setError(null)
    try { await persist(); onDone() }
    catch (e) { setError(errorText(e, 'processor.wizard.couldNotSave', 'Could not save.')) }
    finally { setBusy(false) }
  }

  async function publish() {
    setBusy(true); setError(null)
    try {
      const id = await persist()
      await publishRfq(id, closesAt ? new Date(closesAt).toISOString() : null)
      onDone()
    } catch (e) {
      setError(errorText(e, 'processor.wizard.couldNotPublish', 'Could not publish. Please try again.'))
    } finally { setBusy(false) }
  }

  async function onSaveTemplate() {
    if (!tplName.trim()) return
    setBusy(true)
    try { await saveTemplate(tplName.trim(), d); setTplOpen(false); setTplName('') }
    catch (e) { setError(errorText(e, 'processor.wizard.couldNotSaveTemplate', 'Could not save template.')) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {/* Header + stepper */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button onClick={onCancel} className="inline-flex items-center gap-1 text-[13px] text-emerald-900/60 hover:text-emerald-900">
            <ChevronLeft className="h-4 w-4" aria-hidden /> {t('processor.wizard.backToRequests')}
          </button>
          <h2 className="mt-1 text-lg font-semibold text-emerald-950">
            {initial ? t('processor.wizard.editTitle') : t('processor.wizard.newTitle')}
            {reference && <span className="ml-2 font-mono text-[13px] font-normal text-emerald-900/50">{reference}</span>}
          </h2>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setTplOpen(true)}>{t('processor.wizard.saveAsTemplate')}</Button>
      </div>

      <ol className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((stp, i) => {
          const done = i < step, active = i === step
          return (
            <li key={stp.slug} className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => i <= step && setStep(i)}
                className={`flex items-center gap-2 rounded px-2 py-1 ${i <= step ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${
                  done ? 'bg-emerald-600 text-white' : active ? 'bg-emerald-950 text-white' : 'bg-emerald-50 text-emerald-900/50'
                }`}>
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                </span>
                <span className={`text-[13px] ${active ? 'font-semibold text-emerald-950' : 'text-emerald-900/55'}`}>{tOr(`processor.wizard.step.${stp.slug}`, stp.en)}</span>
              </button>
              {i < STEPS.length - 1 && <span className={`mx-1 h-px w-5 ${i < step ? 'bg-[#C8A045]' : 'bg-line'}`} />}
            </li>
          )
        })}
      </ol>

      <DashboardCard title={t('processor.wizard.stepTitle', {
        n: step + 1,
        name: tOr(`processor.wizard.step.${STEPS[step].slug}`, STEPS[step].en),
      })}>
        {/* STEP 1 — Commodity */}
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="commodity">{t('processor.wizard.commodityLabel')}</Label>
              <select id="commodity" className={selectCls} value={d.commodity ?? ''}
                onChange={(e) => { set('commodity', e.target.value); set('variety_id', null) }}>
                <option value="">{t('processor.wizard.selectCommodity')}</option>
                {COMMODITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="variety">{t('processor.wizard.variety')}</Label>
              <select id="variety" className={selectCls} value={d.variety_id ?? ''}
                onChange={(e) => set('variety_id', e.target.value || null)} disabled={!commodityVarieties.length}>
                <option value="">{commodityVarieties.length ? t('processor.wizard.anyVariety') : t('processor.wizard.noVarieties')}</option>
                {commodityVarieties.map((v) => <option key={v.id} value={v.id}>{v.variety_name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="quantity">{t('processor.wizard.quantityLabel')}</Label>
              <Input id="quantity" type="number" min="0" value={d.quantity ?? ''}
                onChange={(e) => set('quantity', e.target.value ? Number(e.target.value) : undefined)} placeholder={t('processor.wizard.quantityPlaceholder')} />
            </div>
            <div>
              <Label htmlFor="unit">{t('processor.wizard.unitLabel')}</Label>
              <select id="unit" className={selectCls} value={d.unit ?? ''} onChange={(e) => set('unit', e.target.value)}>
                <option value="">{t('processor.wizard.selectUnit')}</option>
                {UNITS.map((u) => <option key={u} value={u}>{tOr(`processor.unit.${UNIT_SLUG[u] ?? u}`, u)}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="grade">{t('processor.wizard.gradeLabel')}</Label>
              <select id="grade" className={selectCls} value={d.grade ?? ''} onChange={(e) => set('grade', e.target.value)}>
                <option value="">{t('processor.wizard.notSpecified')}</option>
                {GRADES.map((g) => <option key={g} value={g}>{tOr(`processor.grade.${GRADE_SLUG[g] ?? g}`, g)}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="moisture">{t('processor.wizard.moistureLabel')}</Label>
              <Input id="moisture" type="number" min="0" max="100" value={d.moisture_content ?? ''}
                onChange={(e) => set('moisture_content', e.target.value ? Number(e.target.value) : null)} placeholder={t('processor.wizard.moisturePlaceholder')} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="packaging">{t('processor.wizard.packagingLabel')}</Label>
              <select id="packaging" className={selectCls} value={d.packaging_type ?? ''} onChange={(e) => set('packaging_type', e.target.value)}>
                <option value="">{t('processor.wizard.notSpecified')}</option>
                {PACKAGING_TYPES.map((p) => <option key={p} value={p}>{tOr(`processor.packaging.${PACKAGING_SLUG[p] ?? p}`, p)}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* STEP 2 — Delivery */}
        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="dstate">{t('processor.wizard.deliveryState')}</Label>
              <select id="dstate" className={selectCls} value={d.delivery_state ?? ''} onChange={(e) => set('delivery_state', e.target.value)}>
                <option value="">{t('processor.wizard.selectState')}</option>
                {NIGERIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="ddeadline">{t('processor.wizard.deliveryDeadline')}</Label>
              <Input id="ddeadline" type="date" value={d.delivery_deadline ?? ''} onChange={(e) => set('delivery_deadline', e.target.value || null)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="daddr">{t('processor.wizard.deliveryAddress')}</Label>
              <Textarea id="daddr" rows={2} value={d.delivery_address ?? ''} onChange={(e) => set('delivery_address', e.target.value)}
                placeholder={t('processor.wizard.addressPlaceholder')} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="dsched">{t('processor.wizard.preferredSchedule')}</Label>
              <Input id="dsched" value={d.delivery_schedule ?? ''} onChange={(e) => set('delivery_schedule', e.target.value)}
                placeholder={t('processor.wizard.schedulePlaceholder')} />
              <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-900/45">
                <Info className="h-3 w-3" aria-hidden /> {t('processor.wizard.warehouseNote')}
              </p>
            </div>
          </div>
        )}

        {/* STEP 3 — Pricing */}
        {step === 2 && (
          <div className="space-y-3">
            <RadioCard checked={d.pricing_mode === 'open_bidding'} onChange={() => set('pricing_mode', 'open_bidding')}
              label={t('processor.wizard.openBidding')} help={t('processor.wizard.openBiddingHelp')} />
            <RadioCard checked={d.pricing_mode === 'fixed'} onChange={() => set('pricing_mode', 'fixed')}
              label={t('processor.wizard.fixedPrice')} help={t('processor.wizard.fixedPriceHelp')} />
            {d.pricing_mode === 'fixed' && (
              <div className="max-w-xs pl-1">
                <Label htmlFor="maxp">{t('processor.wizard.maxPriceLabel', {
                  unit: d.unit ? unitLabel(d.unit) : t('processor.wizard.unitWord'),
                })}</Label>
                <Input id="maxp" type="number" min="0" value={d.max_price ?? ''}
                  onChange={(e) => set('max_price', e.target.value ? Number(e.target.value) : null)} placeholder={t('processor.wizard.maxPricePlaceholder')} />
              </div>
            )}
          </div>
        )}

        {/* STEP 4 — Visibility */}
        {step === 3 && (
          <div className="space-y-3">
            {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((k) => (
              <RadioCard key={k} checked={d.visibility === k} onChange={() => set('visibility', k)}
                label={tOr(`processor.visibility.${k}.label`, VISIBILITY_LABELS[k].label)}
                help={tOr(`processor.visibility.${k}.help`, VISIBILITY_LABELS[k].help)} />
            ))}
          </div>
        )}

        {/* STEP 5 — Inspection */}
        {step === 4 && (
          <div className="space-y-3">
            {(Object.keys(INSPECTION_LABELS) as InspectionMode[]).map((k) => (
              <RadioCard key={k} checked={d.inspection_mode === k} onChange={() => set('inspection_mode', k)}
                label={tOr(`processor.inspectionMode.${k}.label`, INSPECTION_LABELS[k].label)}
                help={tOr(`processor.inspectionMode.${k}.help`, INSPECTION_LABELS[k].help)} />
            ))}
          </div>
        )}

        {/* STEP 6 — Payment + review */}
        {step === 5 && (
          <div className="space-y-4">
            <div className="space-y-3">
              {(['escrow', 'bank_transfer', 'letter_of_credit'] as const).map((k) => (
                <RadioCard key={k} checked={d.payment_mode === (k as PaymentMode)}
                  onChange={() => set('payment_mode', k as PaymentMode)}
                  label={tOr(`processor.paymentMode.${k}.label`, PAYMENT_LABELS[k].label)}
                  help={tOr(`processor.paymentMode.${k}.help`, PAYMENT_LABELS[k].help)}
                  disabled={PAYMENT_LABELS[k].disabled} />
              ))}
            </div>
            <div className="max-w-xs">
              <Label htmlFor="closes">{t('processor.wizard.closesOn')}</Label>
              <Input id="closes" type="date" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
              <p className="mt-1 text-[11px] text-emerald-900/45">{t('processor.wizard.closesHint')}</p>
            </div>
            <div className="rounded border border-line bg-emerald-50/40 p-3 text-[13px] text-emerald-900/70">
              <p className="font-medium text-emerald-950">{t('processor.wizard.readyToPublish')}</p>
              <p className="mt-1">
                {t(d.delivery_state ? 'processor.wizard.reviewWithState' : 'processor.wizard.reviewNoState', {
                  quantity: d.quantity ?? 0,
                  unit: d.unit ? unitLabel(d.unit) : t('processor.wizard.unitWord'),
                  commodity: d.commodity ?? '',
                  state: d.delivery_state ?? '',
                  pricing: d.pricing_mode === 'fixed'
                    ? t('processor.wizard.reviewMaxPrice', { amount: formatNaira(d.max_price ?? 0) })
                    : t('processor.wizard.reviewOpenBidding'),
                  visibility: tOr(
                    `processor.visibility.${d.visibility ?? 'open'}.labelLower`,
                    VISIBILITY_LABELS[d.visibility ?? 'open'].label.toLowerCase(),
                  ),
                })}
              </p>
            </div>
          </div>
        )}

        {error && <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> {t('processor.wizard.back')}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={saveDraftAndExit} disabled={busy}>{t('processor.wizard.saveDraft')}</Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next} disabled={busy}>
              {busy ? t('processor.wizard.saving') : t('processor.wizard.next')} <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button onClick={publish} disabled={busy}>{busy ? t('processor.wizard.publishing') : t('processor.wizard.publish')}</Button>
          )}
        </div>
      </DashboardCard>

      <Modal open={tplOpen} onClose={() => setTplOpen(false)} title={t('processor.wizard.saveAsTemplate')}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="tpl">{t('processor.wizard.templateName')}</Label>
            <Input id="tpl" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder={t('processor.wizard.templateNamePlaceholder')} autoFocus />
          </div>
          <p className="text-[12px] text-emerald-900/55">{t('processor.wizard.templateHint')}</p>
          <div className="flex gap-2">
            <Button onClick={onSaveTemplate} disabled={busy || !tplName.trim()}>{t('processor.wizard.saveTemplateAction')}</Button>
            <Button variant="ghost" onClick={() => setTplOpen(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
