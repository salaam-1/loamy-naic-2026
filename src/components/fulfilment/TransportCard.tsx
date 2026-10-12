import { useState } from 'react'
import { AlertCircle, Truck } from 'lucide-react'
import {
  LOGISTICS_EVENT_LABEL, requestTransportForTransaction, selectTransportOffer,
  type Fulfilment,
} from '@/lib/fulfilment'
import { Card } from '@/components/ui/card'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { formatDateShort, formatNaira } from '@/lib/utils'

/**
 * Transport — the buyer arranges it, carriers quote, the buyer picks one.
 *
 * WHY THIS WAS UNREACHABLE
 *   Not because the UI was missing. `loamy_open_transport_jobs` filtered on
 *   `company_id`, which is NULL for a purchase, and `NULL in (...)` is NULL —
 *   so no carrier ever saw marketplace freight and no offer could arrive.
 *   `loamy_transport_offers_v` had the mirror problem: the buyer could not
 *   see offers on their own job. Both were widened in the Wave 1 migration.
 *
 * EXCLUSIVITY IS THE SERVER'S
 *   `loamy_select_transport_offer` assigns the winner and declines every
 *   other offer in the same call, so there is no window in which two carriers
 *   both believe they have the work. This component just asks.
 *
 * EXTERNAL HAULAGE IS A FIRST-CLASS OUTCOME
 *   A buyer who has their own lorry records it as `external`. That is not an
 *   escape hatch — Loamy never forces Loamy logistics — and the job is
 *   created already booked rather than going out for offers.
 */
export function TransportCard({
  transactionId,
  state,
  onChange,
  canArrange,
}: {
  transactionId: string
  state: Fulfilment
  onChange: () => Promise<void> | void
  canArrange: boolean
}) {
  const { t, tOr, tPlural } = useT()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'loamy' | 'external'>('loamy')
  const [pickup, setPickup] = useState('')
  const [dropoff, setDropoff] = useState('')
  const [provider, setProvider] = useState('')
  const [requestedDate, setRequestedDate] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const tr = state.transport
  // The server refuses while loading has not started; say so rather than
  // offering a button that will fail.
  const tooEarly = state.transaction.fulfilment_state === 'not_started'

  async function request() {
    setBusy('request'); setError(null); setNotice(null)
    const result = await requestTransportForTransaction(transactionId, {
      mode, pickup, dropoff,
      requestedDate: requestedDate || null,
      externalProvider: mode === 'external' ? provider : null,
    })
    setBusy(null)
    if (!result.ok) { setError(result.error); return }
    if (!result.value.created) {
      // A refusal the server explains, e.g. too_early or already_arranged.
      setError(result.value.message ?? reasonText(result.value.reason))
      return
    }
    setOpen(false)
    setNotice(mode === 'external'
      ? 'Recorded. Your own carrier is noted against this purchase.'
      : 'Sent to carriers. Offers appear here as they arrive.')
    await onChange()
  }

  async function choose(offerId: string) {
    setBusy(offerId); setError(null); setNotice(null)
    const result = await selectTransportOffer(offerId)
    setBusy(null)
    if (!result.ok) { setError(result.error); return }
    setNotice('Carrier booked. The other offers were declined.')
    await onChange()
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-950">
          <Truck className="h-3.5 w-3.5 text-emerald-700" aria-hidden /> {t('logistics.transport.title')}
        </h3>
        {tr && (
          <span className="rounded-full bg-sand px-2 py-0.5 text-[11px] font-medium text-emerald-900/70">
            {tr.status.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {!tr ? (
        <>
          <p className="mt-1 text-[13px] text-emerald-900/60">
            {tooEarly
              ? 'Transport can be arranged once the seller has scheduled loading.'
              : canArrange
                ? 'No carrier yet. Send this to carriers for offers, or record your own haulage.'
                : 'The buyer has not arranged transport yet.'}
          </p>

          {canArrange && !tooEarly && (
            open ? (
              <div className="mt-3 space-y-2.5 rounded-lg bg-sand p-3">
                <div>
                  <Label htmlFor="tr-mode">{t('logistics.transport.howIsThisMoving')}</Label>
                  <Select id="tr-mode" value={mode} className="mt-1"
                    onChange={(e) => setMode(e.target.value as 'loamy' | 'external')}>
                    <option value="loamy">{t('logistics.transport.findCarrier')}</option>
                    <option value="external">{t('logistics.transport.ownCarrier')}</option>
                  </Select>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="tr-pickup">{t('logistics.transport.pickUpFrom')}</Label>
                    <Input id="tr-pickup" value={pickup} className="mt-1"
                      onChange={(e) => setPickup(e.target.value)} placeholder={t('logistics.transport.optionalPlaceholder')} />
                  </div>
                  <div>
                    <Label htmlFor="tr-dropoff">{t('logistics.transport.deliverTo')}</Label>
                    <Input id="tr-dropoff" value={dropoff} className="mt-1"
                      onChange={(e) => setDropoff(e.target.value)}
                      placeholder={state.transaction.delivery_state ?? t('logistics.transport.optionalPlaceholder')} />
                  </div>
                </div>
                {mode === 'external' ? (
                  <div>
                    <Label htmlFor="tr-provider">{t('logistics.transport.carrierName')}</Label>
                    <Input id="tr-provider" value={provider} className="mt-1"
                      onChange={(e) => setProvider(e.target.value)} />
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="tr-date">{t('logistics.transport.preferredDate')}</Label>
                    <Input id="tr-date" type="date" value={requestedDate} className="mt-1"
                      onChange={(e) => setRequestedDate(e.target.value)} />
                  </div>
                )}

                {error && <ErrorLine text={error} />}

                <div className="flex gap-2">
                  <Button size="sm" loading={busy === 'request'} onClick={request}>
                    {mode === 'external' ? 'Record my carrier' : 'Send to carriers'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={Boolean(busy)}
                    onClick={() => { setOpen(false); setError(null) }}>{t('common.cancel')}</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" className="mt-3" onClick={() => { setOpen(true); setError(null) }}>
                {t('logistics.transport.arrange')}
              </Button>
            )
          )}
          {!open && error && <div className="mt-2"><ErrorLine text={error} /></div>}
        </>
      ) : (
        <div className="mt-1 space-y-2">
          <p className="text-[13px] text-emerald-900/75">
            {/* The carrier's name and the agreed price are DATA and pass
                through; the sentence around them is wording. The bold run
                was dropped rather than split a sentence across languages
                whose word order differs from English. */}
            {tr.mode === 'external'
              ? tr.external_provider_name
                ? t('logistics.transport.ownCarrierNamed', { provider: tr.external_provider_name })
                : t('logistics.transport.ownCarrierUnnamed')
              : tr.assigned_provider
                ? t('logistics.transport.bookedWithProvider', {
                    provider: tr.assigned_provider,
                    price: tr.agreed_price
                      ? t('logistics.transport.atPrice', { price: formatNaira(Number(tr.agreed_price)) })
                      : '',
                  })
                : tr.offers.length > 0
                  ? tPlural('logistics.transport.quoted', tr.offers.length, { count: tr.offers.length })
                  : t('logistics.transport.outToCarriers')}
          </p>

          {/* Offers, cheapest first. Only the buyer may choose. */}
          {!tr.assigned_provider && tr.offers.length > 0 && (
            <ul className="divide-y divide-line">
              {tr.offers.map((o) => (
                <li key={o.offer_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-[13px] font-medium text-emerald-950">
                      {formatNaira(Number(o.price))}
                      <span className="ml-2 font-normal text-emerald-900/60">
                        {o.provider_name}{o.provider_state ? ` · ${o.provider_state}` : ''}
                      </span>
                    </p>
                    {(o.available_date || o.note) && (
                      <p className="text-[11px] text-emerald-900/55">
                        {o.available_date ? `Available ${formatDateShort(o.available_date)}` : ''}
                        {o.available_date && o.note ? ' · ' : ''}{o.note ?? ''}
                      </p>
                    )}
                  </div>
                  {canArrange && (
                    <Button size="sm" loading={busy === o.offer_id} onClick={() => choose(o.offer_id)}>
                      {t('logistics.transport.bookCarrier')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* The carrier's own updates. Read-only here. */}
          {tr.events.length > 0 && (
            <ul className="border-t border-line pt-2 text-[12px]">
              {tr.events.slice(0, 6).map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 py-0.5">
                  <span className="text-emerald-900/75">
                    {tOr(`logistics.event.${e.event_type}`, LOGISTICS_EVENT_LABEL[e.event_type] ?? e.event_type)}
                    {e.note ? ` - ${e.note}` : ''}
                  </span>
                  <span className="font-mono text-[11px] text-emerald-900/45">
                    {formatDateShort(e.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {error && <ErrorLine text={error} />}
        </div>
      )}

      {notice && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">{notice}</p>
      )}
    </Card>
  )
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      {text}
    </p>
  )
}

function reasonText(reason?: string): string {
  switch (reason) {
    case 'too_early': return 'Arrange transport once the seller has scheduled loading.'
    case 'already_arranged': return 'Transport is already arranged for this purchase.'
    default: return 'Transport could not be requested.'
  }
}
