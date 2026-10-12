import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Warehouse } from 'lucide-react'
import { fetchMyReservations, respondReservation, type WarehouseReservation } from '@/lib/logistics'
import { recordWarehouseReceipt, respondStorage } from '@/lib/fulfilment'
import { errorMessage } from '@/lib/errors'
import { formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The warehouse owner's inbox.
 *
 * WHY THIS WAS EMPTY FOR MARKETPLACE PURCHASES
 *   `loamy_warehouse_reservations_v` filtered on `company_id`, which is NULL
 *   for a purchase-linked reservation, and `NULL in (...)` is NULL — so a
 *   facility never saw a storage request from a marketplace buyer.
 *   `loamy_request_storage` was writing into a table nobody read. Fixed in
 *   the Wave 1 migration.
 *
 * TWO ORIGINS, TWO AUTHORISATION BRANCHES
 *   A purchase reservation is answered through `loamy_respond_storage`, which
 *   authorises the facility owner. An RFQ reservation goes through
 *   `loamy_respond_reservation`, which authorises through company procurement
 *   rights. Same table, same statuses; the row says which door to use. Not a
 *   second storage model.
 *
 * SIGNING GOODS IN IS SEPARATE FROM ACCEPTING A BOOKING
 *   Accepting a request is a commercial answer. A receipt is a statement that
 *   physical goods are in the building, and it writes a batch event that
 *   appears in the trace. A facility records CUSTODY — it cannot verify
 *   quality or authenticity, and nothing here implies it can.
 */
export default function WarehouseInbox() {
  const [rows, setRows] = useState<WarehouseReservation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [receiptFor, setReceiptFor] = useState<WarehouseReservation | null>(null)
  const [quantity, setQuantity] = useState('')
  const [condition, setCondition] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await fetchMyReservations()) }
    catch (e) { setError(errorMessage(e, 'Could not load reservations.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function respond(w: WarehouseReservation, accept: boolean) {
    setBusy(w.id); setError(null); setNotice(null)
    // The row itself says which authorisation branch applies.
    if (w.transaction_id) {
      const result = await respondStorage(w.id, accept)
      setBusy(null)
      if (!result.ok) { setError(result.error); return }
    } else {
      try { await respondReservation(w.id, accept) }
      catch (e) { setBusy(null); setError(errorMessage(e, 'Could not respond.')); return }
      setBusy(null)
    }
    setNotice(accept ? 'Booking confirmed.' : 'Request declined.')
    await load()
  }

  async function signIn() {
    if (!receiptFor) return
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) { setError('Enter the quantity received.'); return }
    if (!receiptFor.batch_id || !receiptFor.facility_id) {
      setError('This reservation has no batch or facility on record, so a receipt cannot be signed.')
      return
    }
    setBusy(receiptFor.id); setError(null); setNotice(null)
    const result = await recordWarehouseReceipt({
      facilityId: receiptFor.facility_id,
      batchId: receiptFor.batch_id,
      movement: 'arrival',
      quantity: qty,
      condition,
      reservationId: receiptFor.id,
      transactionId: receiptFor.transaction_id,
    })
    setBusy(null)
    if (!result.ok) { setError(result.error); return }
    setReceiptFor(null); setQuantity(''); setCondition('')
    setNotice('Goods signed in. The receipt appears in the purchase and its trace.')
    await load()
  }

  if (loading) {
    return <div className="h-40 animate-pulse rounded-card bg-sand" aria-label="Loading reservations" />
  }

  const confirmed = ['confirmed', 'accepted']

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">{notice}</p>
      )}

      <DashboardCard title={`Storage requests · ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Warehouse}
            title="No storage requests yet"
            body="When a buyer or a procuring company asks for space at your facility, it appears here to confirm or decline. Nothing is ever booked without your answer."
          />
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {rows.map((w) => (
              <div key={w.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-emerald-950">
                      {w.buyer_company ?? (w.transaction_ref ? 'Marketplace purchase' : 'Requester')}
                      {w.commodity ? ` · ${w.commodity}` : ''}
                      <span className="ml-1.5 rounded bg-sand px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-900/60">
                        {w.reservation_kind ?? 'contract'}
                      </span>
                    </p>
                    <p className="text-[11px] text-emerald-900/50">
                      {w.space_quantity ? `${w.space_quantity} ${w.unit ?? ''} · ` : ''}
                      {w.start_date
                        ? `${formatDateShort(w.start_date)}${w.end_date ? '–' + formatDateShort(w.end_date) : ''}`
                        : 'dates not set'}
                      {w.transaction_ref ? ` · ${w.transaction_ref}` : ''}
                      {' · '}<span className="capitalize">{w.status}</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {w.status === 'requested' && (
                      <>
                        <Button size="sm" onClick={() => respond(w, true)} disabled={busy === w.id}>
                          Confirm
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy === w.id}
                          onClick={() => respond(w, false)}>
                          Decline
                        </Button>
                      </>
                    )}
                    {confirmed.includes(w.status) && w.transaction_id && (
                      <Button size="sm" variant="outline" disabled={busy === w.id}
                        onClick={() => {
                          setReceiptFor(w)
                          setQuantity(String(w.space_quantity ?? ''))
                          setError(null); setNotice(null)
                        }}>
                        Sign goods in
                      </Button>
                    )}
                  </div>
                </div>

                {receiptFor?.id === w.id && (
                  <div className="mt-2.5 space-y-2.5 rounded-lg bg-sand p-3">
                    <p className="text-[12px] text-emerald-900/75">
                      Record what physically arrived. This writes a receipt against the batch and
                      appears in the purchase trace. It records custody, not quality.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`qty-${w.id}`}>Quantity received ({w.unit ?? 'units'})</Label>
                        <Input id={`qty-${w.id}`} type="number" step="any" min={0} value={quantity}
                          onChange={(e) => setQuantity(e.target.value)} className="mt-1" />
                      </div>
                      <div>
                        <Label htmlFor={`cond-${w.id}`}>Condition on arrival</Label>
                        <Input id={`cond-${w.id}`} value={condition}
                          onChange={(e) => setCondition(e.target.value)} className="mt-1"
                          placeholder="e.g. dry, bags intact" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" loading={busy === w.id} onClick={signIn}>Record receipt</Button>
                      <Button size="sm" variant="outline" disabled={busy === w.id}
                        onClick={() => { setReceiptFor(null); setError(null) }}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DashboardCard>
    </div>
  )
}
