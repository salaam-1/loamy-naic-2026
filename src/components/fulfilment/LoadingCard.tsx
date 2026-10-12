import { useState } from 'react'
import { AlertCircle, PackageOpen } from 'lucide-react'
import { recordLoading, type Fulfilment, type LoadingStage } from '@/lib/fulfilment'
import { LoadingFlags } from '@/components/fulfilment/FulfilmentPanel'
import { Card } from '@/components/ui/card'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDateShort } from '@/lib/utils'

/**
 * Loading — the seller's move, and the first step of the fulfilment spine.
 *
 * WHY THE SELLER
 *   `loamy_record_loading` authorises either party, but the goods are in the
 *   seller's hands: they are the only one who can honestly say a lorry was
 *   loaded. The buyer sees what was recorded and the evidence gaps.
 *
 * WHY THIS BLOCKS TRANSPORT
 *   `loamy_request_transport_for_transaction` refuses while
 *   `fulfilment_state` is `not_started`, with "arrange transport once the
 *   seller has scheduled loading". That ordering is the server's, not this
 *   component's.
 *
 * EVIDENCE IS FLAGGED, NOT DEMANDED
 *   A completed loading with no photo, no waybill, no GPS, or a quantity that
 *   does not match is RECORDED and MARKED. Refusing would push people to
 *   record nothing, and a flagged record is far more useful than an absent
 *   one. The flags are shown to both sides — never hidden from the buyer.
 */
export function LoadingCard({
  transactionId,
  state,
  onChange,
  canRecord,
}: {
  transactionId: string
  state: Fulfilment
  onChange: () => Promise<void> | void
  canRecord: boolean
}) {
  const { t } = useT()
  const [open, setOpen] = useState<LoadingStage | null>(null)
  const [quantity, setQuantity] = useState('')
  const [waybill, setWaybill] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const latest = state.loading[0] ?? null
  const done = new Set(state.loading.map((l) => l.stage))
  const completed = done.has('completed')

  /** Only stages that make sense next. The server validates regardless. */
  const nextStages: LoadingStage[] = completed
    ? []
    : done.has('started') ? ['completed', 'failed']
    : done.has('scheduled') ? ['started', 'failed']
    : ['scheduled', 'started']

  function start(stage: LoadingStage) {
    setOpen(stage)
    setError(null); setWarning(null)
    // Pre-fill with what was purchased. The seller corrects it if the lorry
    // took less; a mismatch is flagged by the server, not hidden here.
    if (stage === 'completed') setQuantity(String(state.transaction.quantity))
  }

  async function submit() {
    if (!open) return
    setBusy(true); setError(null); setWarning(null)

    const result = await recordLoading({
      transactionId,
      stage: open,
      quantity: open === 'completed' && quantity !== '' ? Number(quantity) : null,
      unit: state.transaction.unit,
      waybill, vehicle, note,
    })
    setBusy(false)

    if (!result.ok) { setError(result.error); return }

    // Recorded, but the state machine refused the move. That is NOT a
    // success, and saying "saved" alone would leave the next actor waiting
    // for a step that never happened.
    if (!result.value.state_moved && result.value.state_error) {
      setWarning(`Recorded, but the purchase did not move on: ${result.value.state_error}`)
    }

    setOpen(null); setQuantity(''); setWaybill(''); setVehicle(''); setNote('')
    await onChange()
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-950">
          <PackageOpen className="h-3.5 w-3.5 text-emerald-700" aria-hidden /> {t('logistics.loading.title')}
        </h3>
        {latest && (
          <span className="text-[11px] text-emerald-900/50">
            {latest.stage} · {formatDateShort(latest.recorded_at)}
          </span>
        )}
      </div>

      {state.loading.length === 0 ? (
        <p className="mt-1 text-[13px] text-emerald-900/60">
          {canRecord
            ? 'Nothing recorded yet. Schedule loading when the goods are ready to leave.'
            : 'The seller has not scheduled loading yet.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {state.loading.map((l) => (
            <li key={l.id} className="py-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                <span className="font-medium text-emerald-950">{stageLabel(l.stage)}</span>
                <span className="font-mono text-[11px] text-emerald-900/50">
                  {formatDateShort(l.recorded_at)}
                </span>
              </div>
              <p className="text-[12px] text-emerald-900/60">
                {l.quantity_confirmed != null
                  ? `${Number(l.quantity_confirmed).toLocaleString('en-NG')} ${l.unit ?? ''}`
                  : 'No quantity recorded'}
                {l.waybill_ref ? ` · waybill ${l.waybill_ref}` : ''}
                {l.vehicle_registration ? ` · ${l.vehicle_registration}` : ''}
                {l.photo_count > 0 ? ` · ${l.photo_count} photo${l.photo_count === 1 ? '' : 's'}` : ''}
              </p>
              {l.note && <p className="text-[12px] italic text-emerald-900/50">{l.note}</p>}
              <LoadingFlags flags={l.flags} />
            </li>
          ))}
        </ul>
      )}

      {warning && (
        <p role="alert" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          {warning}
        </p>
      )}

      {canRecord && nextStages.length > 0 && (
        open === null ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {nextStages.map((s) => (
              <Button key={s} size="sm" variant={s === 'failed' ? 'outline' : 'primary'}
                onClick={() => start(s)}>
                {stageAction(s)}
              </Button>
            ))}
          </div>
        ) : (
          <div className="mt-3 space-y-2.5 rounded-lg bg-sand p-3">
            <p className="text-[12px] font-medium text-emerald-900">{stageAction(open)}</p>

            {open === 'completed' && (
              <>
                <div>
                  <Label htmlFor="load-qty">Quantity loaded ({state.transaction.unit})</Label>
                  <Input id="load-qty" type="number" step="any" min={0}
                    value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1" />
                  <p className="mt-1 text-[11px] text-emerald-900/50">
                    Purchased: {Number(state.transaction.quantity).toLocaleString('en-NG')}{' '}
                    {state.transaction.unit}. A difference is recorded and flagged, not rejected.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="load-waybill">{t('logistics.loading.waybillRef')}</Label>
                    <Input id="load-waybill" value={waybill}
                      onChange={(e) => setWaybill(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="load-vehicle">{t('logistics.loading.vehicleReg')}</Label>
                    <Input id="load-vehicle" value={vehicle}
                      onChange={(e) => setVehicle(e.target.value)} className="mt-1" />
                  </div>
                </div>
              </>
            )}

            <div>
              <Label htmlFor="load-note">{t('logistics.loading.note')}</Label>
              <Textarea id="load-note" value={note}
                onChange={(e) => setNote(e.target.value)} className="mt-1"
                placeholder={t('logistics.loading.buyerSeesThis')} />
            </div>

            {error && (
              <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button size="sm" loading={busy} onClick={submit}>{t('logistics.loading.record')}</Button>
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => { setOpen(null); setError(null) }}>{t('common.cancel')}</Button>
            </div>
          </div>
        )
      )}
    </Card>
  )
}

function stageLabel(s: string): string {
  return ({
    requested: 'Loading requested', scheduled: 'Loading scheduled',
    started: 'Loading started', completed: 'Loaded',
    failed: 'Loading failed', cancelled: 'Loading cancelled',
  } as Record<string, string>)[s] ?? s
}

function stageAction(s: LoadingStage): string {
  return ({
    requested: 'Request loading', scheduled: 'Schedule loading',
    started: 'Start loading', completed: 'Confirm loaded',
    failed: 'Record a problem', cancelled: 'Cancel loading',
  } as Record<LoadingStage, string>)[s]
}
