import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MapPin, Truck } from 'lucide-react'
import {
  fetchMyAssignedTransport, fetchOpenTransportJobs, submitTransportOffer, updateTransportStatus,
  TRANSPORT_LABEL, type OpenTransportJob, type TransportJob,
} from '@/lib/logistics'
import { formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { logisticsTransition, type LogisticsEvent } from '@/lib/fulfilment'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'

/** Logistics-provider board: bid on broadcast transport jobs, then run them. */
/** Carrier button -> the logistics event that produces that status. */
const TRANSITION_FOR: Partial<Record<string, LogisticsEvent>> = {
  picked_up: 'loaded',
  in_transit: 'departed',
  delivered: 'delivered',
}

export default function TransportBoard() {
  const [open, setOpen] = useState<OpenTransportJob[]>([])
  const [mine, setMine] = useState<TransportJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offerFor, setOfferFor] = useState<OpenTransportJob | null>(null)
  const [price, setPrice] = useState(''); const [date, setDate] = useState(''); const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [o, m] = await Promise.all([fetchOpenTransportJobs(), fetchMyAssignedTransport()])
      setOpen(o); setMine(m)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load jobs.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function onOffer(e: FormEvent) {
    e.preventDefault()
    if (!offerFor) return
    if (!price || Number(price) < 0) { setModalError('Enter a valid price.'); return }
    setBusy(true); setModalError(null)
    try { await submitTransportOffer(offerFor.id, Number(price), date || null, note || null); setOfferFor(null); setPrice(''); setDate(''); setNote(''); await load() }
    catch (e) { setModalError(e instanceof Error ? e.message : 'Could not submit offer.') }
    finally { setBusy(false) }
  }

  /**
   * Move a job on.
   *
   * A job from a MARKETPLACE PURCHASE goes through
   * `loamy_logistics_transition`, which owns the transition rules and writes
   * a shipment event the buyer can see. `loamy_update_transport_status` is
   * the older RFQ path and authorises through company procurement rights a
   * marketplace counterparty does not have -- it would refuse here.
   *
   * Same table, same statuses, two authorisation branches. Not a second
   * logistics model.
   */
  async function advance(job: TransportJob, s: TransportJob['status']) {
    setError(null)
    if (job.transaction_id) {
      const event = TRANSITION_FOR[s]
      if (!event) { setError(`No transition for ${s}.`); return }
      const result = await logisticsTransition(job.id, event)
      if (!result.ok) { setError(result.error); return }
      await load()
      return
    }
    try { await updateTransportStatus(job.id, s); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update.') }
  }

  if (loading) return <div className="h-40 animate-pulse rounded bg-emerald-50" aria-label="Loading" />

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <DashboardCard title={`Open transport jobs · ${open.length}`}>
        {open.length === 0 ? (
          <EmptyState icon={Truck} title="No transport jobs right now" body="When a processor broadcasts a transport request on your routes, it appears here to bid on." />
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {open.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium text-emerald-950">{j.commodity} · {j.quantity} {j.unit}</p>
                  <p className="text-[11px] text-emerald-900/50"><MapPin className="mr-0.5 inline h-3 w-3" aria-hidden />{j.pickup_state ?? '-'} → {j.dropoff_state ?? '-'}{j.requested_date && ` · ${formatDateShort(j.requested_date)}`}</p>
                </div>
                <Button size="sm" variant={j.already_offered ? 'outline' : 'primary'} onClick={() => { setOfferFor(j); setModalError(null) }}>{j.already_offered ? 'Update offer' : 'Submit offer'}</Button>
              </div>
            ))}
          </div>
        )}
      </DashboardCard>

      {mine.length > 0 && (
        <DashboardCard title={`Assigned to you · ${mine.length}`}>
          <div className="flex flex-col divide-y divide-line">
            {mine.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium text-emerald-950">{j.commodity} · {j.quantity} {j.unit}</p>
                  <p className="text-[11px] text-emerald-900/50">{j.pickup_location ?? j.pickup_state} → {j.dropoff_location ?? j.dropoff_state} · {TRANSPORT_LABEL[j.status]}</p>
                </div>
                <div className="flex gap-1.5">
                  {j.status === 'assigned' && <Button size="sm" variant="outline" onClick={() => advance(j, 'picked_up')}>Picked up</Button>}
                  {j.status === 'picked_up' && <Button size="sm" variant="outline" onClick={() => advance(j, 'in_transit')}>In transit</Button>}
                  {j.status === 'in_transit' && <Button size="sm" onClick={() => advance(j, 'delivered')}>Delivered</Button>}
                </div>
              </div>
            ))}
          </div>
        </DashboardCard>
      )}

      <Modal open={!!offerFor} onClose={() => setOfferFor(null)} title="Submit transport offer">
        {offerFor && (
          <form onSubmit={onOffer} className="space-y-4">
            <p className="rounded bg-emerald-50/60 px-3 py-2 text-[12px] text-emerald-900/70">{offerFor.commodity} · {offerFor.quantity} {offerFor.unit} · {offerFor.pickup_state} → {offerFor.dropoff_state}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="tp">Your price (₦) *</Label><Input id="tp" type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus /></div>
              <div><Label htmlFor="td">Available date</Label><Input id="td" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <div><Label htmlFor="tn">Note</Label><Textarea id="tn" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vehicle type, terms…" /></div>
            {modalError && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{modalError}</p>}
            <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit offer'}</Button><Button type="button" variant="ghost" onClick={() => setOfferFor(null)}>Cancel</Button></div>
          </form>
        )}
      </Modal>
    </div>
  )
}
