import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  type Farm,
  type FinancingApplication,
  type IntendedItem,
} from '@/lib/farming'
import { cn, formatNaira } from '@/lib/utils'
import { FarmerShell } from '@/pages/farmer/FarmerShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/lib/i18n'

/* The steps are KEYS, not words. Holding the labels here as English would
   put a second copy of the vocabulary outside the pack, which is how the
   financing lifecycle ended up with three disagreeing status maps. */
const STEP_KEYS = [
  'financing.apply.step.farm',
  'financing.apply.step.amountPurpose',
  'financing.apply.step.items',
  'financing.apply.step.disbursement',
  'financing.apply.step.review',
] as const

interface WizardState {
  farm_id: string
  amount: string
  purpose: string
  items: IntendedItem[]
  disbursement: '' | 'supplier_payment' | 'cash'
}

const BLANK: WizardState = { farm_id: '', amount: '', purpose: '', items: [], disbursement: '' }

/**
 * Multi-step Input Financing application (Murabaha, non-interest).
 * Saves as a draft between steps so the farmer can leave and continue later.
 * Submitting sets status='submitted' — from there the partner bank owns the
 * process; Loamy has no approve/decline controls anywhere.
 */
export default function FinancingApply() {
  const navigate = useNavigate()
  const { t } = useT()
  const [params, setParams] = useSearchParams()
  const draftParam = params.get('draft')

  const [step, setStep] = useState(0)
  const [state, setState] = useState<WizardState>(BLANK)
  const [draftId, setDraftId] = useState<string | null>(draftParam)
  const [farms, setFarms] = useState<Farm[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const farmsReq = supabase.from('farms').select('*').order('created_at')
      const draftReq = draftParam
        ? supabase
            .from('financing_applications')
            .select('*')
            .eq('id', draftParam)
            .eq('status', 'draft')
            .maybeSingle()
        : Promise.resolve({ data: null })
      const [farmsRes, draftRes] = await Promise.all([farmsReq, draftReq])
      if (cancelled) return
      setFarms((farmsRes.data as Farm[]) ?? [])
      const draft = draftRes.data as FinancingApplication | null
      if (draft) {
        setState({
          farm_id: draft.farm_id ?? '',
          amount: draft.amount_requested > 0 ? String(Number(draft.amount_requested)) : '',
          purpose: draft.purpose ?? '',
          items: Array.isArray(draft.intended_items) ? draft.intended_items : [],
          disbursement: draft.disbursement_preference ?? '',
        })
      } else if (draftParam) {
        // Stale/foreign draft id — RLS returned nothing; start fresh.
        setDraftId(null)
        setParams({}, { replace: true })
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftParam])

  const amountNum = Number(state.amount)
  const amountValid = Number.isFinite(amountNum) && amountNum > 0

  const stepValid = useMemo(() => {
    switch (step) {
      case 0: return true // farm optional but encouraged
      case 1: return amountValid && state.purpose.trim().length > 0
      case 2: return true // items optional
      case 3: return state.disbursement !== ''
      default: return true
    }
  }, [step, amountValid, state.purpose, state.disbursement])

  function payload(status: 'draft' | 'submitted') {
    return {
      farm_id: state.farm_id || null,
      product_type: 'input_financing',
      structure: 'murabaha',
      amount_requested: state.amount === '' ? 0 : amountNum,
      purpose: state.purpose.trim(),
      intended_items: state.items.filter((i) => i.item.trim() !== ''),
      disbursement_preference: state.disbursement || null,
      status,
    }
  }

  /** Persist current progress as a draft (called on every step advance). */
  async function saveDraft(): Promise<string | null> {
    if (draftId) {
      const { error: updErr } = await supabase
        .from('financing_applications')
        .update(payload('draft'))
        .eq('id', draftId)
      if (updErr) {
        setError(updErr.message)
        return null
      }
      return draftId
    }
    const { data: userData } = await supabase.auth.getUser()
    const { data, error: insErr } = await supabase
      .from('financing_applications')
      .insert({ ...payload('draft'), applicant_id: userData.user?.id })
      .select('id')
      .maybeSingle()
    if (insErr || !data) {
      setError(insErr?.message ?? 'Could not save draft.')
      return null
    }
    setDraftId(data.id)
    setParams({ draft: data.id }, { replace: true })
    return data.id
  }

  async function next() {
    setError(null)
    if (!stepValid) return
    setSaving(true)
    const id = await saveDraft()
    setSaving(false)
    if (id) setStep((s) => Math.min(s + 1, STEP_KEYS.length - 1))
  }

  async function submit() {
    setError(null)
    if (!amountValid || !state.purpose.trim() || !state.disbursement) {
      setError('Please complete every required step before submitting.')
      return
    }
    setSaving(true)
    const id = draftId ?? (await saveDraft())
    if (!id) {
      setSaving(false)
      return
    }
    const { error: subErr } = await supabase
      .from('financing_applications')
      .update(payload('submitted'))
      .eq('id', id)
    if (subErr) {
      setSaving(false)
      setError(subErr.message)
      return
    }
    // Activity-feed entry (self-notify only — see loamy_log_my_event).
    //
    // DELIBERATELY NOT TRANSLATED. This text is WRITTEN TO THE DATABASE, not
    // rendered from it. Translating at write time would store whichever
    // language the applicant happened to be using into a permanent record
    // that other people read, so the same event would read differently
    // depending on who created it. The row stays English; localising the
    // activity feed means translating at RENDER time, from the event type.
    await supabase.rpc('loamy_log_my_event', {
      n_title: 'Financing application submitted',
      n_body: `Input Financing (Murabaha) for ${formatNaira(amountNum)} - queued for the partner bank.`,
      n_type: 'financing',
    })
    setSaving(false)
    navigate('/dashboard/farmer/financing', { replace: true })
  }

  function setItem(idx: number, patch: Partial<IntendedItem>) {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }))
  }

  const selectedFarm = farms.find((f) => f.id === state.farm_id)

  if (loading) {
    return (
      <FarmerShell section="financing">
        <div className="h-40 animate-pulse rounded-card bg-white" aria-label={t('a11y.loading')} />
      </FarmerShell>
    )
  }

  return (
    <FarmerShell section="financing">
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-emerald-950">{t('financing.apply.heading')}</h1>
          <p className="mt-0.5 text-sm text-emerald-900/60">
            {t('financing.apply.subtitle')}
          </p>
        </div>

        {/* Step indicator */}
        <ol className="flex flex-wrap items-center gap-1.5" aria-label={t('financing.apply.stepsAria')}>
          {STEP_KEYS.map((stepKey, i) => (
            <li key={stepKey} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold',
                  i < step
                    ? 'bg-emerald-700 text-white'
                    : i === step
                      ? 'bg-gold-400 text-emerald-950'
                      : 'bg-emerald-950/5 text-emerald-900/40',
                )}
              >
                {i < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn('text-xs', i === step ? 'font-semibold text-emerald-950' : 'text-emerald-900/45')}>
                {t(stepKey)}
              </span>
              {i < STEP_KEYS.length - 1 && <span className="mx-0.5 h-px w-4 bg-emerald-950/10" aria-hidden />}
            </li>
          ))}
        </ol>

        <Card className="p-6">
          {step === 0 && (
            <div className="space-y-3">
              <Label htmlFor="farm">{t('financing.apply.whichFarm')}</Label>
              <Select id="farm" value={state.farm_id} onChange={(e) => setState((p) => ({ ...p, farm_id: e.target.value }))}>
                <option value="">{t('financing.apply.notFarmSpecific')}</option>
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.farm_name} - {f.lga}, {f.state} ({Number(f.size_hectares)} ha)
                  </option>
                ))}
              </Select>
              {farms.length === 0 && (
                <p className="text-xs text-amber-700">
                  {t('financing.apply.noFarmsWarning')}
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="amount">{t('financing.apply.amountLabel')}</Label>
                <Input id="amount" type="number" min={1} step="any" value={state.amount} onChange={(e) => setState((p) => ({ ...p, amount: e.target.value }))} placeholder={t('financing.apply.amountPlaceholder')} />
                <p className={cn('mt-1 text-xs', state.amount !== '' && !amountValid ? 'text-red-700' : 'text-emerald-900/50')}>
                  {state.amount !== '' && !amountValid
                    ? t('financing.apply.amountInvalid')
                    : t('financing.apply.amountHint')}
                </p>
              </div>
              <div>
                <Label htmlFor="purpose">{t('financing.apply.purposeLabel')}</Label>
                <Textarea id="purpose" value={state.purpose} onChange={(e) => setState((p) => ({ ...p, purpose: e.target.value }))} placeholder={t('financing.apply.purposePlaceholder')} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t('financing.apply.intendedItems')}</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setState((p) => ({ ...p, items: [...p.items, { item: '', qty: '' }] }))}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> {t('financing.apply.addItem')}
                </Button>
              </div>
              {state.items.length === 0 ? (
                <p className="py-3 text-sm text-emerald-900/55">
                  {t('financing.apply.itemsHint')}
                </p>
              ) : (
                <div className="space-y-2">
                  {state.items.map((it, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input value={it.item} onChange={(e) => setItem(i, { item: e.target.value })} placeholder={t('financing.apply.itemPlaceholder')} aria-label={t('financing.apply.itemAria', { n: i + 1 })} />
                      <Input value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} placeholder={t('financing.apply.qtyPlaceholder')} className="max-w-36" aria-label={t('financing.apply.qtyAria', { n: i + 1 })} />
                      <button
                        type="button"
                        onClick={() => setState((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}
                        className="flex min-h-touch min-w-touch items-center justify-center rounded-md text-emerald-900/35 hover:bg-red-50 hover:text-red-600"
                        aria-label={t('financing.apply.removeItemAria', { n: i + 1 })}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-medium text-emerald-950">
                {t('financing.apply.disbursementQuestion')}
              </legend>
              {(
                [
                  // The VALUES are the contract with the database and never
                  // change; only the words beside them are looked up.
                  {
                    value: 'supplier_payment',
                    titleKey: 'financing.apply.supplierPayment.title',
                    bodyKey: 'financing.apply.supplierPayment.body',
                  },
                  {
                    value: 'cash',
                    titleKey: 'financing.apply.cash.title',
                    bodyKey: 'financing.apply.cash.body',
                  },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors',
                    state.disbursement === opt.value
                      ? 'border-emerald-700 bg-emerald-50 ring-1 ring-emerald-700'
                      : 'border-emerald-100 hover:border-emerald-300',
                  )}
                >
                  <input
                    type="radio"
                    name="disbursement"
                    value={opt.value}
                    checked={state.disbursement === opt.value}
                    onChange={() => setState((p) => ({ ...p, disbursement: opt.value }))}
                    className="mt-1 accent-emerald-700"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-emerald-950">{t(opt.titleKey)}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-emerald-900/60">{t(opt.bodyKey)}</span>
                  </span>
                </label>
              ))}
              <p className="text-xs text-emerald-900/50">
                {t('financing.apply.disbursementNote')}
              </p>
            </fieldset>
          )}

          {step === 4 && (
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-emerald-900/55">{t('financing.review.product')}</dt>
                <dd className="font-medium text-emerald-950">{t('financing.apply.productLine')}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-emerald-900/55">{t('financing.review.farm')}</dt>
                <dd className="font-medium text-emerald-950">
                  {/* The farm name, LGA and state are DATA and pass through
                      untranslated; only the "no farm chosen" case is wording. */}
                  {selectedFarm
                    ? `${selectedFarm.farm_name} - ${selectedFarm.lga}, ${selectedFarm.state}`
                    : t('financing.apply.notFarmSpecificShort')}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-emerald-900/55">{t('financing.review.amount')}</dt>
                <dd className="font-semibold text-emerald-950">{amountValid ? formatNaira(amountNum) : '-'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-emerald-900/55">{t('financing.review.purpose')}</dt>
                <dd className="max-w-[60%] text-right font-medium text-emerald-950">{state.purpose || '-'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-emerald-900/55">{t('financing.review.items')}</dt>
                <dd className="max-w-[60%] text-right font-medium text-emerald-950">
                  {state.items.filter((i) => i.item.trim()).length > 0
                    ? state.items.filter((i) => i.item.trim()).map((i) => `${i.item}${i.qty ? ` (${i.qty})` : ''}`).join(', ')
                    : t('financing.apply.noneListed')}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-emerald-900/55">{t('financing.review.disbursement')}</dt>
                <dd className="font-medium text-emerald-950">
                  {state.disbursement === 'supplier_payment'
                    ? t('financing.apply.supplierPayment.short')
                    : state.disbursement === 'cash'
                      ? t('financing.apply.cash.short')
                      : '-'}
                </dd>
              </div>
              <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-xs leading-relaxed text-emerald-800">
                {t('financing.apply.submitNote')}
              </p>
            </dl>
          )}
        </Card>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={() => (step === 0 ? navigate('/dashboard/farmer/financing') : setStep((s) => s - 1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden /> {step === 0 ? t('common.cancel') : t('common.back')}
          </Button>
          {step < STEP_KEYS.length - 1 ? (
            <Button type="button" onClick={next} disabled={!stepValid} loading={saving}>
              {t('common.next')} <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button type="button" variant="gold" onClick={submit} loading={saving}>
              {t('financing.apply.submit')}
            </Button>
          )}
        </div>
        <p className="text-center text-[11px] text-emerald-900/40">
          {t('financing.apply.draftNote')}
        </p>
      </div>
    </FarmerShell>
  )
}
