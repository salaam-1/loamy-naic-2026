import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ClipboardList, MapPin, Plus, Store } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { COMMODITY_GROUPS, NIGERIA_STATES } from '@/lib/nigeria'
import { LISTING_UNITS, fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import {
  fetchMyRequests, fetchOpenRequests, fetchResponses, postRequest, respondToRequest, setRequestStatus,
  type BuyRequest, type BuyRequestResponse, type PublicBuyRequest,
} from '@/lib/buyRequests'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { PublicShell } from '@/pages/public/PublicShell'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const ALL_COMMODITIES = [...new Set(COMMODITY_GROUPS.flatMap((g) => g.commodities))].sort()

export default function BuyRequests() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [tab, setTab] = useState<'open' | 'mine'>('open')
  const [postInitial, setPostInitial] = useState<{ commodity?: string; quantity?: string; unit?: string; targetPrice?: string; state?: string } | undefined>()
  const [open, setOpen] = useState<PublicBuyRequest[] | null>(null)
  const [mine, setMine] = useState<BuyRequest[] | null>(null)

  const [posting, setPosting] = useState(false)
  const [respondingTo, setRespondingTo] = useState<PublicBuyRequest | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [responses, setResponses] = useState<Record<string, BuyRequestResponse[]>>({})
  const [responders, setResponders] = useState<Record<string, PublicProfile>>({})

  const gate = () => navigate('/signup?redirect=/buy-requests')

  const loadOpen = useCallback(() => { void fetchOpenRequests().then(setOpen) }, [])
  const loadMine = useCallback(() => { if (session) void fetchMyRequests().then(setMine) }, [session])

  useEffect(() => { loadOpen() }, [loadOpen])
  useEffect(() => { loadMine() }, [loadMine])

  // Prefill + open the post form when arriving from a Co-pilot buy-request draft.
  useEffect(() => {
    const d = (location.state as { copilotDraft?: Record<string, string | number | null> } | null)?.copilotDraft
    if (!d || !session) return
    setPostInitial({
      commodity: d.commodity != null ? String(d.commodity) : '',
      quantity: d.quantity != null ? String(d.quantity) : '',
      unit: d.unit != null ? String(d.unit) : undefined,
      targetPrice: d.price_expectation != null ? String(d.price_expectation) : '',
      state: d.state != null ? String(d.state) : '',
    })
    setPosting(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openResponses = async (reqId: string) => {
    if (expanded === reqId) { setExpanded(null); return }
    setExpanded(reqId)
    const rows = await fetchResponses(reqId)
    setResponses((r) => ({ ...r, [reqId]: rows }))
    const profs = await fetchPublicProfiles(rows.map((x) => x.responder_id))
    setResponders((prev) => ({ ...prev, ...profs }))
  }

  return (
    <PublicShell>
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold text-emerald-950">
              <ClipboardList className="h-5 w-5 text-emerald-800" strokeWidth={1.5} aria-hidden /> Buy requests
            </h1>
            <p className="mt-0.5 text-sm text-emerald-900/60">Buyers post what they need; verified sellers respond with an offer.</p>
          </div>
          <Button onClick={() => (session ? (setPostInitial(undefined), setPosting(true)) : gate())}><Plus className="h-4 w-4" aria-hidden /> Post a buy request</Button>
        </div>

        {/* Tabs */}
        <div className="inline-flex rounded border border-line bg-white p-0.5 text-sm">
          {([['open', 'Open requests', open?.length], ['mine', 'My requests', mine?.length]] as const).map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => (k === 'mine' && !session ? gate() : setTab(k))}
              className={cn('rounded px-3 py-1.5 font-medium transition-colors', tab === k ? 'bg-emerald-800 text-white' : 'text-emerald-900/70 hover:text-emerald-900')}
            >
              {label}{typeof n === 'number' && n > 0 ? ` (${n})` : ''}
            </button>
          ))}
        </div>

        {/* Open requests */}
        {tab === 'open' && (
          open === null ? (
            <SkeletonList />
          ) : open.length === 0 ? (
            <Empty text="No open buy requests yet. Post the first one." />
          ) : (
            <div className="space-y-3">
              {open.map((r) => (
                <div key={r.id} className="rounded border border-line bg-white p-4">
                  <RequestBody
                    commodity={r.commodity} quantity={r.quantity} unit={r.unit} target_price={r.target_price}
                    state={r.state} note={r.note} created_at={r.created_at}
                    who={r.buyer_display_name} category={r.buyer_category}
                  />
                  <div className="mt-3 border-t border-line pt-2.5">
                    <Button size="sm" variant="outline" onClick={() => (session ? setRespondingTo(r) : gate())}>Respond</Button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* My requests */}
        {tab === 'mine' && (
          mine === null ? (
            <SkeletonList />
          ) : mine.length === 0 ? (
            <Empty text="You haven’t posted any buy requests yet." />
          ) : (
            <div className="space-y-3">
              {mine.map((r) => (
                <div key={r.id} className="rounded border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <RequestBody
                      commodity={r.commodity} quantity={r.quantity} unit={r.unit} target_price={r.target_price}
                      state={r.state} note={r.note} created_at={r.created_at}
                    />
                    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', r.status === 'open' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-emerald-950/5 text-emerald-900/50')}>
                      {r.status === 'open' ? 'Open' : 'Closed'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                    <Button size="sm" variant="outline" onClick={() => void openResponses(r.id)}>
                      {expanded === r.id ? 'Hide responses' : 'View responses'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => { await setRequestStatus(r.id, r.status === 'open' ? 'closed' : 'open'); loadMine() }}
                    >
                      {r.status === 'open' ? 'Close' : 'Reopen'}
                    </Button>
                  </div>
                  {expanded === r.id && (
                    <div className="mt-3 space-y-2">
                      {(responses[r.id] ?? []).length === 0 ? (
                        <p className="text-xs text-emerald-900/55">No responses yet.</p>
                      ) : (
                        (responses[r.id] ?? []).map((resp) => (
                          <div key={resp.id} className="rounded border border-line bg-surface p-2.5 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium text-emerald-950">{responders[resp.responder_id]?.full_name ?? 'Loamy seller'}</p>
                              {resp.offered_price != null && (
                                <p className="font-mono text-[13px] font-semibold text-emerald-800">
                                  {formatNaira(Number(resp.offered_price))}{resp.offered_quantity != null ? ` · ${Number(resp.offered_quantity)} ${r.unit}` : ''}
                                </p>
                              )}
                            </div>
                            {resp.message && <p className="mt-1 text-xs text-emerald-900/70">{resp.message}</p>}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <PostModal open={posting} initial={postInitial} onClose={() => setPosting(false)} onDone={() => { setPosting(false); loadOpen(); loadMine() }} />
      <RespondModal request={respondingTo} onClose={() => setRespondingTo(null)} />
    </PublicShell>
  )
}

function RequestBody({ commodity, quantity, unit, target_price, state, note, created_at, who, category }: {
  commodity: string; quantity: number; unit: string; target_price: number | null; state: string | null; note: string | null; created_at: string; who?: string | null; category?: string | null
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="font-semibold text-emerald-950">{commodity}</p>
        <span className="text-sm text-emerald-900/60">· {Number(quantity)} {unit}</span>
      </div>
      <p className="mt-0.5 font-mono text-[13px] font-semibold text-emerald-800">
        {target_price != null ? <>Target {formatNaira(Number(target_price))}/{unit}</> : <span className="text-emerald-900/55">Open to offers</span>}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-emerald-900/55">
        {state && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{state}</span>}
        {who && <span>· {who}{category ? ` (${category})` : ''}</span>}
        <span>· {formatDateShort(created_at)}</span>
      </p>
      {note && <p className="mt-1.5 text-sm text-emerald-900/70">{note}</p>}
    </div>
  )
}

function SkeletonList() {
  return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => (<div key={i} className="h-28 animate-pulse rounded border border-line bg-white" aria-hidden />))}</div>
}
function Empty({ text }: { text: string }) {
  return <div className="flex items-center gap-2.5 rounded border border-line bg-white px-4 py-8"><Store className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden /><p className="text-sm text-emerald-900/60">{text}</p></div>
}

function PostModal({ open, initial, onClose, onDone }: {
  open: boolean
  initial?: { commodity?: string; quantity?: string; unit?: string; targetPrice?: string; state?: string }
  onClose: () => void
  onDone: () => void
}) {
  const [commodity, setCommodity] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState<string>('bags')
  const [targetPrice, setTargetPrice] = useState('')
  const [state, setState] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed from a Co-pilot draft when present, else blank.
  useEffect(() => {
    if (!open) return
    setCommodity(initial?.commodity ?? '')
    setQuantity(initial?.quantity ?? '')
    setUnit(initial?.unit && (LISTING_UNITS as readonly string[]).includes(initial.unit) ? initial.unit : 'bags')
    setTargetPrice(initial?.targetPrice ?? '')
    setState(initial?.state && (NIGERIA_STATES as readonly string[]).includes(initial.state) ? initial.state : '')
    setNote(''); setError(null); setBusy(false)
  }, [open, initial])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!commodity.trim()) { setError('Enter a commodity.'); return }
    const q = Number(quantity)
    if (!Number.isFinite(q) || q <= 0) { setError('Enter a valid quantity.'); return }
    const tp = targetPrice.trim() === '' ? null : Number(targetPrice)
    if (tp !== null && (!Number.isFinite(tp) || tp < 0)) { setError('Enter a valid target price, or leave it blank.'); return }
    setBusy(true); setError(null)
    try {
      await postRequest({ commodity: commodity.trim(), quantity: q, unit, target_price: tp, state: state || null, note: note.trim() || null })
      onDone()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not post your request.'); setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Post a buy request">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="br-com">Commodity</Label>
          <Input id="br-com" list="br-commodities" value={commodity} onChange={(e) => setCommodity(e.target.value)} className="mt-1" placeholder="e.g. Maize" />
          <datalist id="br-commodities">{ALL_COMMODITIES.map((c) => (<option key={c} value={c} />))}</datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="br-qty">Quantity</Label>
            <Input id="br-qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="br-unit">Unit</Label>
            <Select id="br-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 w-full">
              {LISTING_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="br-price">Target price /{unit} (optional)</Label>
            <Input id="br-price" type="number" min={0} value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} className="mt-1" placeholder="Open to offers" />
          </div>
          <div>
            <Label htmlFor="br-state">Deliver to (optional)</Label>
            <Select id="br-state" value={state} onChange={(e) => setState(e.target.value)} className="mt-1 w-full">
              <option value="">Any state</option>
              {NIGERIA_STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="br-note">Note (optional)</Label>
          <Textarea id="br-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1" placeholder="Quality, timing, packaging…" />
        </div>
        {error && <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" loading={busy}>Post request</Button>
        </div>
      </form>
    </Modal>
  )
}

function RespondModal({ request, onClose }: { request: PublicBuyRequest | null; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => { if (request) { setMessage(''); setPrice(''); setQty(''); setError(null); setBusy(false); setDone(false) } }, [request])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!request) return
    const p = price.trim() === '' ? null : Number(price)
    const q = qty.trim() === '' ? null : Number(qty)
    if (p !== null && (!Number.isFinite(p) || p < 0)) { setError('Enter a valid price, or leave it blank.'); return }
    if (q !== null && (!Number.isFinite(q) || q <= 0)) { setError('Enter a valid quantity, or leave it blank.'); return }
    setBusy(true); setError(null)
    try {
      await respondToRequest(request.id, message.trim() || null, p, q)
      setDone(true)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send your response.'); setBusy(false) }
  }

  return (
    <Modal open={!!request} onClose={onClose} title={request ? `Respond · ${request.commodity}` : 'Respond'}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-800">Your response was sent to the buyer.</p>
          <div className="flex justify-end"><Button size="sm" onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rr-price">Your price /{request?.unit ?? 'unit'} (optional)</Label>
              <Input id="rr-price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="rr-qty">Quantity you can supply (optional)</Label>
              <Input id="rr-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label htmlFor="rr-msg">Message to the buyer</Label>
            <Textarea id="rr-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="mt-1" placeholder="Introduce yourself and what you can supply" />
          </div>
          {error && <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" loading={busy}>Send response</Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
