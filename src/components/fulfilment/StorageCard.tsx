import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Warehouse } from 'lucide-react'
import {
  requestStorage, suggestWarehouses,
  type Fulfilment, type WarehouseSuggestion,
} from '@/lib/fulfilment'
import { Card } from '@/components/ui/card'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDateShort } from '@/lib/utils'

/**
 * Storage — offered, never assumed.
 *
 * NOT EVERY PURCHASE NEEDS A WAREHOUSE. Most goods go straight to the buyer,
 * and this card says so rather than presenting storage as a step to be
 * completed. Suggestions are a list of facilities; nothing is reserved until
 * the member asks and the facility ACCEPTS. `loamy_request_storage` creates a
 * request, `loamy_respond_storage` is the facility's answer, and only an
 * accepted reservation is a booking.
 *
 * THE SUGGESTION FUNCTION HAD NEVER RUN. `loamy_suggest_warehouses` read
 * `transactions.origin_state`, `service_directory.verified` and
 * `service_directory.active` — none of which exist. Three bugs, invisible
 * because plpgsql resolves columns at run time and nothing ever called it.
 * Origin is now resolved through transaction → batch → listing → farm.
 */
export function StorageCard({
  transactionId,
  state,
  onChange,
}: {
  transactionId: string
  state: Fulfilment
  onChange: () => Promise<void> | void
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<WarehouseSuggestion[] | null>(null)
  const [searched, setSearched] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [chosen, setChosen] = useState<WarehouseSuggestion | null>(null)
  const [quantity, setQuantity] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadSuggestions = useCallback(async () => {
    const result = await suggestWarehouses(transactionId)
    if (!result.ok) { setError(result.error); return }
    const v = result.value
    if (!v.available) {
      setUnavailable(v.message ?? 'Storage suggestions are not available for this purchase.')
      setItems([])
      return
    }
    setUnavailable(null)
    setItems(v.items ?? [])
    setSearched(v.searched_state ?? null)
  }, [transactionId])

  useEffect(() => { if (open && items === null) void loadSuggestions() }, [open, items, loadSuggestions])

  async function send() {
    if (!chosen) return
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Enter how much space you need.')
      return
    }
    setBusy(true); setError(null); setNotice(null)
    const result = await requestStorage({
      transactionId, facilityId: chosen.facility_id, quantity: qty,
      startDate: startDate || null, endDate: endDate || null, note,
    })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    setChosen(null); setOpen(false); setQuantity(''); setNote('')
    setNotice('Request sent. Nothing is booked until the facility accepts it.')
    await onChange()
  }

  const existing = state.storage

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-950">
          <Warehouse className="h-3.5 w-3.5 text-emerald-700" aria-hidden /> {t('warehouse.storage.title')}
        </h3>
        <span className="text-[11px] text-emerald-900/45">{t('warehouse.storage.optional')}</span>
      </div>

      {existing.length > 0 ? (
        <ul className="mt-2 divide-y divide-line">
          {existing.map((s) => (
            <li key={s.reservation_id} className="py-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                <span className="font-medium text-emerald-950">{s.facility ?? 'Facility'}</span>
                <span className={
                  s.status === 'confirmed' || s.status === 'accepted'
                    ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700'
                    : s.status === 'declined'
                      ? 'rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700'
                      : 'rounded-full bg-sand px-2 py-0.5 text-[11px] font-medium text-emerald-900/65'
                }>
                  {/* 'requested' is not 'booked'. The distinction is the point. */}
                  {s.status === 'requested' ? 'Awaiting the facility' : s.status}
                </span>
              </div>
              <p className="text-[12px] text-emerald-900/60">
                {Number(s.space_quantity).toLocaleString('en-NG')} {s.unit ?? ''}
                {s.facility_state ? ` · ${s.facility_lga ? `${s.facility_lga}, ` : ''}${s.facility_state}` : ''}
                {s.start_date ? ` · from ${formatDateShort(s.start_date)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-emerald-900/60">
          {t('warehouse.storage.mostGoStraight')}
        </p>
      )}

      {!open ? (
        <Button size="sm" variant="outline" className="mt-3"
          onClick={() => { setOpen(true); setError(null); setNotice(null) }}>
          {t('warehouse.storage.findStorage')}
        </Button>
      ) : (
        <div className="mt-3 space-y-2.5 rounded-lg bg-sand p-3">
          {items === null ? (
            <p className="text-[12px] text-emerald-900/55">{t('warehouse.storage.looking')}</p>
          ) : unavailable ? (
            <p className="text-[12px] text-emerald-900/70">{unavailable}</p>
          ) : items.length === 0 ? (
            <p className="text-[12px] text-emerald-900/70">
              No warehouses are listed in {searched ?? 'that state'} yet. Nothing was reserved.
            </p>
          ) : !chosen ? (
            <>
              <p className="text-[12px] text-emerald-900/70">
                Facilities in {searched}. Suggestions only - nothing is reserved until you ask and
                the facility accepts.
              </p>
              <ul className="divide-y divide-clay">
                {items.map((w) => (
                  <li key={w.facility_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p className="text-[13px] font-medium text-emerald-950">
                        {w.business_name}
                        {/* Only a Loamy-inspected facility reads as verified. */}
                        {w.verified && (
                          <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            {t('verification.verified')}
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-emerald-900/55">
                        {w.lga ? `${w.lga}, ` : ''}{w.state}
                        {w.capacity_tonnes ? ` · ${w.capacity_tonnes}t capacity` : ''}
                        {w.capacity_note ? ` · ${w.capacity_note}` : ''}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => {
                      setChosen(w)
                      setQuantity(String(state.transaction.quantity))
                    }}>
                      {t('warehouse.storage.askForSpace')}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="text-[12px] font-medium text-emerald-900">
                Request space at {chosen.business_name}
              </p>
              <div>
                <Label htmlFor="st-qty">How much ({state.transaction.unit})</Label>
                <Input id="st-qty" type="number" step="any" min={0} value={quantity}
                  onChange={(e) => setQuantity(e.target.value)} className="mt-1" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor="st-from">{t('warehouse.storage.from')}</Label>
                  <Input id="st-from" type="date" value={startDate}
                    onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="st-to">{t('warehouse.storage.until')}</Label>
                  <Input id="st-to" type="date" value={endDate}
                    onChange={(e) => setEndDate(e.target.value)} className="mt-1" />
                </div>
              </div>
              <div>
                <Label htmlFor="st-note">{t('warehouse.storage.noteToFacility')}</Label>
                <Textarea id="st-note" value={note} onChange={(e) => setNote(e.target.value)}
                  className="mt-1" placeholder={t('warehouse.storage.optionalShort')} />
              </div>
              {error && (
                <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{error}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" loading={busy} onClick={send}>{t('warehouse.storage.sendRequest')}</Button>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => { setChosen(null); setError(null) }}>{t('common.back')}</Button>
              </div>
            </>
          )}

          {!chosen && (
            <Button size="sm" variant="outline"
              onClick={() => { setOpen(false); setError(null) }}>{t('common.close')}</Button>
          )}
        </div>
      )}

      {notice && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">{notice}</p>
      )}
    </Card>
  )
}
