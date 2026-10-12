import { useCallback, useEffect, useState } from 'react'
import { Check, Truck, Warehouse } from 'lucide-react'
import {
  fetchDirectoryWarehouses, fetchOffersForJob, fetchReservationForAward, fetchTransportForAward,
  requestTransport, reserveWarehouse, selectOffer, updateTransportStatus,
  TRANSPORT_LABEL, TRANSPORT_STEPS,
  type DirectoryWarehouse, type TransportJob, type TransportOffer, type WarehouseReservation,
} from '@/lib/logistics'
import { formatNaira, formatDateShort } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const selectCls = 'h-9 min-h-touch rounded border border-line bg-white px-2 text-[13px] text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-600/30'

/** Transport + warehouse for a single award (buyer side). */
export default function AwardLogistics({ awardId, commodity, unit, deliveryState, canProcure }: {
  awardId: string; commodity: string; unit: string; deliveryState: string | null; canProcure: boolean
}) {
  const { t, tOr, tPlural } = useT()
  const errorText = useErrorText()
  const [job, setJob] = useState<TransportJob | null>(null)
  const [offers, setOffers] = useState<TransportOffer[]>([])
  const [resv, setResv] = useState<WarehouseReservation | null>(null)
  const [warehouses, setWarehouses] = useState<DirectoryWarehouse[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // transport request form
  const [mode, setMode] = useState<'loamy' | 'external'>('loamy')
  const [pickup, setPickup] = useState(''); const [dropoff, setDropoff] = useState('')
  const [reqDate, setReqDate] = useState(''); const [extName, setExtName] = useState('')
  // warehouse form
  const [whOwner, setWhOwner] = useState(''); const [whStart, setWhStart] = useState(''); const [whEnd, setWhEnd] = useState('')

  const load = useCallback(async () => {
    try {
      const j = await fetchTransportForAward(awardId)
      setJob(j)
      if (j && j.status === 'broadcast') setOffers(await fetchOffersForJob(j.id))
      setResv(await fetchReservationForAward(awardId))
    } catch (e) { setError(errorText(e, 'processor.awardLogistics.couldNotLoad', 'Could not load logistics.')) }
  }, [awardId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { fetchDirectoryWarehouses(deliveryState ?? undefined).then(setWarehouses).catch(() => {}) }, [deliveryState])

  async function onRequest() {
    setBusy(true); setError(null)
    try {
      await requestTransport(awardId, { mode, pickup: pickup || undefined, dropoff: dropoff || undefined, requestedDate: reqDate || null, externalProvider: extName || undefined })
      await load()
    } catch (e) { setError(errorText(e, 'processor.awardLogistics.couldNotRequest', 'Could not request transport.')) }
    finally { setBusy(false) }
  }
  async function onSelect(id: string) { setBusy(true); try { await selectOffer(id); await load() } catch (e) { setError(errorText(e, 'processor.awardLogistics.failed', 'Failed.')) } finally { setBusy(false) } }
  async function onAdvance(s: TransportJob['status']) { setBusy(true); try { await updateTransportStatus(job!.id, s); await load() } catch (e) { setError(errorText(e, 'processor.awardLogistics.failed', 'Failed.')) } finally { setBusy(false) } }
  async function onReserve() {
    if (!whOwner) { setError(t('processor.awardLogistics.chooseWarehouseError')); return }
    setBusy(true); setError(null)
    try { await reserveWarehouse(awardId, whOwner, { unit, start: whStart || null, end: whEnd || null }); await load() }
    catch (e) { setError(errorText(e, 'processor.awardLogistics.couldNotReserve', 'Could not reserve.')) }
    finally { setBusy(false) }
  }

  const stepIdx = job ? TRANSPORT_STEPS.indexOf(job.status) : -1

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}

      {/* Transport */}
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-emerald-900/50"><Truck className="mr-1 inline h-3.5 w-3.5" aria-hidden />{t('processor.awardLogistics.transport')}</p>
        {!job ? (
          canProcure ? (
            <div className="space-y-2 rounded border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select className={selectCls} value={mode} onChange={(e) => setMode(e.target.value as 'loamy' | 'external')}>
                  <option value="loamy">{t('processor.awardLogistics.modeLoamy')}</option>
                  <option value="external">{t('processor.awardLogistics.modeExternal')}</option>
                </select>
                <Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder={t('processor.awardLogistics.pickupPlaceholder')} className="h-9 min-h-touch w-40 text-[13px]" />
                <Input value={dropoff} onChange={(e) => setDropoff(e.target.value)} placeholder={t('processor.awardLogistics.dropoffPlaceholder')} className="h-9 min-h-touch w-40 text-[13px]" />
                <Input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)} className="h-9 min-h-touch w-36 text-[13px]" />
                {mode === 'external' && <Input value={extName} onChange={(e) => setExtName(e.target.value)} placeholder={t('processor.awardLogistics.providerPlaceholder')} className="h-9 min-h-touch w-40 text-[13px]" />}
                <Button size="sm" onClick={onRequest} disabled={busy}>{busy ? '…' : t('processor.awardLogistics.arrange')}</Button>
              </div>
            </div>
          ) : <p className="text-[13px] text-emerald-900/50">{t('processor.awardLogistics.noneArranged')}</p>
        ) : (
          <div className="space-y-3 rounded border border-line p-3">
            <p className="text-[13px] text-emerald-900/70">
              {job.mode === 'loamy'
                ? t('processor.awardLogistics.loamyLogistics')
                : t('processor.awardLogistics.externalProvider', {
                  provider: job.external_provider_name ?? t('processor.awardLogistics.providerFallback'),
                })}
              {job.provider_name && ` · ${job.provider_name}`}
            </p>

            {job.status === 'broadcast' ? (
              <div>
                <p className="text-[12px] text-emerald-900/55">{tPlural('processor.awardLogistics.offersReceived', offers.length, { count: offers.length })}</p>
                <div className="mt-2 space-y-1.5">
                  {offers.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 rounded border border-line px-2.5 py-1.5 text-[13px]">
                      <span className="text-emerald-950">{o.provider_name ?? t('processor.awardLogistics.offerProviderFallback')} · <span className="font-mono">{formatNaira(o.price)}</span>{o.available_date && ` · ${formatDateShort(o.available_date)}`}</span>
                      {canProcure && <Button size="sm" variant="outline" onClick={() => onSelect(o.id)} disabled={busy}>{t('processor.awardLogistics.select')}</Button>}
                    </div>
                  ))}
                  {offers.length === 0 && <p className="text-[12px] text-emerald-900/45">{t('processor.awardLogistics.awaitingOffers')}</p>}
                </div>
              </div>
            ) : (
              <>
                <ol className="flex flex-wrap gap-x-3 gap-y-1">
                  {TRANSPORT_STEPS.map((s, i) => (
                    <li key={s} className="flex items-center gap-1 text-[11px]">
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full ${i <= stepIdx ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-transparent'}`}>{i <= stepIdx && <Check className="h-2.5 w-2.5" aria-hidden />}</span>
                      <span className={i <= stepIdx ? 'text-emerald-800' : 'text-emerald-900/40'}>{tOr(`logistics.transportStatus.${s}`, TRANSPORT_LABEL[s])}</span>
                    </li>
                  ))}
                </ol>
                {canProcure && job.status !== 'completed' && job.status !== 'cancelled' && (
                  <div className="flex flex-wrap gap-2">
                    {job.mode === 'external' && job.status === 'assigned' && <Button size="sm" variant="outline" onClick={() => onAdvance('picked_up')} disabled={busy}>{t('processor.awardLogistics.markPickedUp')}</Button>}
                    {job.mode === 'external' && job.status === 'picked_up' && <Button size="sm" variant="outline" onClick={() => onAdvance('in_transit')} disabled={busy}>{t('processor.awardLogistics.markInTransit')}</Button>}
                    {job.mode === 'external' && job.status === 'in_transit' && <Button size="sm" variant="outline" onClick={() => onAdvance('delivered')} disabled={busy}>{t('processor.awardLogistics.markDelivered')}</Button>}
                    {job.status === 'delivered' && <Button size="sm" onClick={() => onAdvance('completed')} disabled={busy}>{t('processor.awardLogistics.confirmComplete')}</Button>}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Warehouse */}
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-emerald-900/50"><Warehouse className="mr-1 inline h-3.5 w-3.5" aria-hidden />{t('processor.awardLogistics.warehouse')}</p>
        {resv ? (
          <p className="rounded border border-line p-3 text-[13px] text-emerald-900/70">
            {resv.warehouse_name ?? t('processor.awardLogistics.warehouseFallback')} · <span className="capitalize">{resv.status}</span>
            {resv.start_date && ` · ${formatDateShort(resv.start_date)}${resv.end_date ? '–' + formatDateShort(resv.end_date) : ''}`}
          </p>
        ) : canProcure ? (
          <div className="flex flex-wrap items-center gap-2 rounded border border-line p-3">
            <select className={selectCls} value={whOwner} onChange={(e) => setWhOwner(e.target.value)}>
              <option value="">{deliveryState
                ? t('processor.awardLogistics.chooseWarehouseIn', { state: deliveryState })
                : t('processor.awardLogistics.chooseWarehouse')}</option>
              {warehouses.map((w) => <option key={w.owner_id} value={w.owner_id}>{w.capacity_note
                ? t('processor.awardLogistics.warehouseOptionWithNote', { name: w.business_name, state: w.state, note: w.capacity_note })
                : t('processor.awardLogistics.warehouseOption', { name: w.business_name, state: w.state })}</option>)}
            </select>
            <Input type="date" value={whStart} onChange={(e) => setWhStart(e.target.value)} className="h-9 min-h-touch w-36 text-[13px]" />
            <Input type="date" value={whEnd} onChange={(e) => setWhEnd(e.target.value)} className="h-9 min-h-touch w-36 text-[13px]" />
            <Button size="sm" variant="outline" onClick={onReserve} disabled={busy || !warehouses.length}>{t('processor.awardLogistics.reserve')}</Button>
            {!warehouses.length && <span className="text-[12px] text-emerald-900/45">{deliveryState
              ? t('processor.awardLogistics.noWarehousesIn', { state: deliveryState })
              : t('processor.awardLogistics.noWarehouses')}</span>}
          </div>
        ) : <p className="text-[13px] text-emerald-900/50">{t('processor.awardLogistics.noStorage')}</p>}
      </div>
    </div>
  )
}
