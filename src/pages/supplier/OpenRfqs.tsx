import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, ChevronLeft, ClipboardList, FileText, MapPin, PackageCheck } from 'lucide-react'
import {
  fetchMyBids, fetchOpenRfqs, submitBid, withdrawBid,
  type OpenRfq, type RfqBid,
} from '@/lib/bids'
import { fetchContracts, type Contract } from '@/lib/contracts'
import ContractView from '@/pages/processor/ContractView'
import { formatNaira, formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'

/**
 * Supplier board: the open buy requests this supplier qualifies for, with a bid
 * form, plus the bids they have already placed. Buyers' contact details are
 * never shown here — a supplier only sees the request and bids on it.
 */
export default function OpenRfqs() {
  const [rfqs, setRfqs] = useState<OpenRfq[]>([])
  const [myBids, setMyBids] = useState<RfqBid[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [openContract, setOpenContract] = useState<Contract | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [bidFor, setBidFor] = useState<OpenRfq | null>(null)
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  const [date, setDate] = useState('')
  const [origin, setOrigin] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [open, mine, cs] = await Promise.all([fetchOpenRfqs(), fetchMyBids(), fetchContracts()])
      setRfqs(open); setMyBids(mine); setContracts(cs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load buy requests.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  function openBid(r: OpenRfq) {
    setBidFor(r)
    setPrice(r.max_price ? String(r.max_price) : '')
    setQty(String(r.quantity))
    setDate(r.delivery_deadline ?? '')
    setOrigin(''); setNote(''); setModalError(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!bidFor) return
    setModalError(null)
    const p = Number(price), q = Number(qty)
    if (!p || p <= 0) { setModalError('Enter a price greater than zero.'); return }
    if (!q || q <= 0) { setModalError('Enter the quantity you can supply.'); return }
    if (bidFor.pricing_mode === 'fixed' && bidFor.max_price != null && p > bidFor.max_price) {
      setModalError(`This buyer’s maximum price is ${formatNaira(bidFor.max_price)} per ${bidFor.unit}.`); return
    }
    setBusy(true)
    try {
      await submitBid({ rfq_id: bidFor.id, price_per_unit: p, unit: bidFor.unit, available_quantity: q,
        delivery_date: date || null, farm_origin: origin || null, note: note || null })
      setBidFor(null)
      await load()
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Could not submit your bid.')
    } finally { setBusy(false) }
  }

  async function onWithdraw(bidId: string) {
    try { await withdrawBid(bidId); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not withdraw the bid.') }
  }

  if (loading) return <div className="h-40 animate-pulse rounded bg-emerald-50" aria-label="Loading" />

  if (openContract) {
    return (
      <div className="space-y-4">
        <button onClick={() => setOpenContract(null)} className="inline-flex items-center gap-1 text-[13px] text-emerald-900/60 hover:text-emerald-900">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Back
        </button>
        <DashboardCard title="Contract">
          <ContractView contract={openContract} onSigned={() => { void load(); setOpenContract(null) }} />
        </DashboardCard>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {contracts.length > 0 && (
        <DashboardCard title={`My contracts · ${contracts.length}`}>
          <div className="flex flex-col divide-y divide-line">
            {contracts.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-emerald-950">{c.contract_number} · {c.commodity}</p>
                    <p className="text-[11px] text-emerald-900/50">
                      {c.buyer_company} · {c.status.replace('_', ' ')}
                      {c.status === 'pending_signatures' && !c.supplier_signed_at && ' · awaiting your signature'}
                    </p>
                  </div>
                </div>
                <button onClick={() => setOpenContract(c)} className="shrink-0 rounded px-2 py-1 text-[13px] text-emerald-700 hover:bg-emerald-50">Open</button>
              </div>
            ))}
          </div>
        </DashboardCard>
      )}

      <DashboardCard title={`Open buy requests · ${rfqs.length}`}>
        {rfqs.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No open buy requests right now"
            body="When processors post requests that match your commodities and state, they will appear here for you to bid on." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rfqs.map((r) => (
              <div key={r.id} className="flex flex-col rounded border border-line bg-white p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-emerald-950">{r.commodity}</p>
                    <p className="font-mono text-[11px] text-emerald-900/45">{r.reference}</p>
                  </div>
                  {r.already_bid && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> Bid placed
                    </span>
                  )}
                </div>
                <dl className="mt-2 space-y-1 text-[12px] text-emerald-900/70">
                  <div className="flex justify-between"><dt className="text-emerald-900/50">Quantity</dt><dd>{r.quantity} {r.unit}</dd></div>
                  {r.grade && <div className="flex justify-between"><dt className="text-emerald-900/50">Grade</dt><dd>{r.grade}</dd></div>}
                  <div className="flex justify-between"><dt className="text-emerald-900/50">Pricing</dt><dd>{r.pricing_mode === 'fixed' ? `Max ${formatNaira(r.max_price ?? 0)}` : 'Open bidding'}</dd></div>
                  <div className="flex justify-between"><dt className="text-emerald-900/50">Buyer</dt><dd className="truncate">{r.company_name}</dd></div>
                  {r.closes_at && <div className="flex justify-between"><dt className="text-emerald-900/50">Closes</dt><dd>{formatDateShort(r.closes_at)}</dd></div>}
                </dl>
                <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-900/45">
                  <MapPin className="h-3 w-3" aria-hidden /> Deliver to {r.delivery_state ?? 'n/a'}
                  {r.delivery_deadline && ` by ${formatDateShort(r.delivery_deadline)}`}
                </p>
                <div className="mt-3">
                  <Button size="sm" variant={r.already_bid ? 'outline' : 'primary'} onClick={() => openBid(r)} className="w-full">
                    {r.already_bid ? 'Update bid' : 'Place bid'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DashboardCard>

      {myBids.length > 0 && (
        <DashboardCard title={`My bids · ${myBids.length}`}>
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="py-2 pr-4 font-medium">Price</th>
                <th className="py-2 pr-4 font-medium">Quantity</th>
                <th className="py-2 pr-4 font-medium">Delivery</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {myBids.map((b) => (
                <tr key={b.id}>
                  <td className="py-2.5 pr-4 font-mono text-[13px] text-emerald-950">{formatNaira(b.price_per_unit)}<span className="text-emerald-900/45">/{b.unit}</span></td>
                  <td className="py-2.5 pr-4 text-emerald-900/80">{b.available_quantity} {b.unit}</td>
                  <td className="py-2.5 pr-4 text-[13px] text-emerald-900/55">{b.delivery_date ? formatDateShort(b.delivery_date) : '-'}</td>
                  <td className="py-2.5 pr-4"><span className="inline-flex items-center gap-1 text-[12px] capitalize text-emerald-900/70"><PackageCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />{b.status}</span></td>
                  <td className="py-2.5 text-right">
                    {(b.status === 'submitted' || b.status === 'shortlisted') && (
                      <button onClick={() => onWithdraw(b.id)} className="rounded px-2 py-1 text-[13px] text-red-700 hover:bg-red-50">Withdraw</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DashboardCard>
      )}

      <Modal open={!!bidFor} onClose={() => setBidFor(null)} title={bidFor?.already_bid ? 'Update your bid' : `Bid on ${bidFor?.commodity ?? ''}`}>
        {bidFor && (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="rounded bg-emerald-50/60 px-3 py-2 text-[12px] text-emerald-900/70">
              {bidFor.company_name} wants {bidFor.quantity} {bidFor.unit} of {bidFor.commodity}
              {bidFor.pricing_mode === 'fixed' && bidFor.max_price != null && ` · max ${formatNaira(bidFor.max_price)}/${bidFor.unit}`}.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="bprice">Your price (₦ per {bidFor.unit}) *</Label>
                <Input id="bprice" type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 72000" autoFocus />
              </div>
              <div>
                <Label htmlFor="bqty">Quantity you can supply *</Label>
                <Input id="bqty" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bdate">Delivery date</Label>
                <Input id="bdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="borigin">Farm / origin</Label>
                <Input id="borigin" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="e.g. Kano, own farm" />
              </div>
            </div>
            <div>
              <Label htmlFor="bnote">Note to buyer</Label>
              <Textarea id="bnote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quality, packaging, terms…" />
            </div>
            {modalError && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{modalError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : bidFor.already_bid ? 'Update bid' : 'Submit bid'}</Button>
              <Button type="button" variant="ghost" onClick={() => setBidFor(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
