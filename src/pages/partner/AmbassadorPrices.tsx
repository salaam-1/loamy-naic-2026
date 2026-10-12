import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, CloudOff, Flag, MapPin, Plus, WifiOff } from 'lucide-react'
import { COMMODITIES, NIGERIA_STATES } from '@/lib/nigeria'
import { lgasFor } from '@/lib/lgas'
import {
  fetchLastFor, fetchUnits, fetchVarieties, submitAmbassadorPrice,
  type CommodityUnit, type CommodityVariety, type NewSubmission,
  perUnitLabel
} from '@/lib/ambassador'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

const today = () => new Date().toISOString().slice(0, 10)
const MARKET_KEY = 'loamy_amb_market_v1'
const QUEUE_KEY = 'loamy_amb_queue_v1'

interface SessionRow { commodity: string; low: number; high: number; unit: string; quantity: number; status: string; flags: string[]; queued?: boolean }

/** Units the server has no conversion for yet still deserve to be offered. */
const FALLBACK_UNITS = ['kg', '50kg bag', '100kg', 'tonne'] as const

const FLAG_LABEL: Record<string, string> = {
  duplicate: 'Duplicate for today',
  market_deviation: 'Far from this market’s recent prices',
  state_deviation: 'Far from other markets in the state',
  outside_territory: 'Outside your assigned territory',
}

/**
 * Ambassador price entry: pick your market once, then file commodities rapidly.
 * Prices are submitted as low–high ranges in a local unit; the server converts
 * to ₦/kg and validates. Works offline — entries queue and sync on reconnect.
 */
export default function AmbassadorPrices() {
  const [varieties, setVarieties] = useState<CommodityVariety[]>([])
  const [units, setUnits] = useState<CommodityUnit[]>([])

  // Market context (remembered)
  const saved = (() => { try { return JSON.parse(localStorage.getItem(MARKET_KEY) ?? '{}') } catch { return {} } })()
  const [state, setState] = useState<string>(saved.state ?? '')
  const [lga, setLga] = useState<string>(saved.lga ?? '')
  const [market, setMarket] = useState<string>(saved.market ?? '')

  // Entry row
  const [commodity, setCommodity] = useState('')
  const [varietyId, setVarietyId] = useState('')
  const [low, setLow] = useState('')
  const [high, setHigh] = useState('')
  const [unit, setUnit] = useState('bag')
  const [quantity, setQuantity] = useState('1')
  const [date, setDate] = useState(today())
  const [lastHint, setLastHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<SessionRow[]>([])
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [queued, setQueued] = useState(0)

  useEffect(() => { void fetchVarieties().then(setVarieties); void fetchUnits().then(setUnits) }, [])
  useEffect(() => { localStorage.setItem(MARKET_KEY, JSON.stringify({ state, lga, market })) }, [state, lga, market])

  const unitNames = useMemo(
    () => [...new Set([...units.map((u) => u.unit_name), ...FALLBACK_UNITS])],
    [units],
  )
  const qtyNum = Number(quantity)
  const kgPerUnit = useMemo(
    () => units.find((u) => u.unit_name.toLowerCase() === unit.toLowerCase())?.kg_equivalent ?? null,
    [units, unit],
  )
  const commodityList = useMemo(() => [...new Set([...varieties.map((v) => v.commodity), ...COMMODITIES])].sort(), [varieties])
  const varietyOptions = useMemo(() => varieties.filter((v) => v.commodity.toLowerCase() === commodity.toLowerCase()), [varieties, commodity])

  // "Last recorded" hint when commodity + market are set
  useEffect(() => {
    if (!commodity || !market) { setLastHint(null); return }
    let cancelled = false
    fetchLastFor(commodity, market).then((r) => {
      if (cancelled) return
      setLastHint(r ? `Last: ${formatNaira(Number(r.price_low))}–${formatNaira(Number(r.price_high))}/${r.unit} · ${formatDateShort(r.observed_date)}` : null)
    })
    return () => { cancelled = true }
  }, [commodity, market])

  const flushQueue = useCallback(async () => {
    let q: NewSubmission[] = []
    try { q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') } catch { q = [] }
    if (q.length === 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) { setQueued(q.length); return }
    const remaining: NewSubmission[] = []
    for (const s of q) {
      try { await submitAmbassadorPrice(s) } catch { remaining.push(s) }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
    setQueued(remaining.length)
  }, [])

  useEffect(() => {
    const on = () => { setOnline(true); void flushQueue() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    void flushQueue()
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [flushQueue])

  const marketReady = state && market
  const marketRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!marketReady) { setError('Set your state and market first.'); marketRef.current?.focus(); return }
    if (!commodity.trim()) { setError('Choose a commodity.'); return }
    const lo = Number(low), hi = Number(high)
    if (!Number.isFinite(lo) || lo < 0 || !Number.isFinite(hi) || hi < lo) { setError('Enter a valid low–high range.'); return }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) { setError('Quantity must be greater than zero.'); return }

    const payload: NewSubmission = {
      state, lga: lga || null, market_name: market, commodity: commodity.trim(),
      variety_id: varietyId || null, price_low: lo, price_high: hi, unit, quantity: qtyNum,
      observed_date: date, note: null,
    }
    setBusy(true)
    if (!online) {
      const q: NewSubmission[] = (() => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') } catch { return [] } })()
      q.push(payload); localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); setQueued(q.length)
      setSession((s) => [{ commodity: payload.commodity, low: lo, high: hi, unit, quantity: qtyNum, status: 'queued', flags: [], queued: true }, ...s])
      setCommodity(''); setVarietyId(''); setLow(''); setHigh(''); setBusy(false)
      return
    }
    try {
      const res = await submitAmbassadorPrice(payload)
      setSession((s) => [{ commodity: payload.commodity, low: lo, high: hi, unit, quantity: qtyNum, status: res.status, flags: res.flags }, ...s])
      setCommodity(''); setVarietyId(''); setLow(''); setHigh(''); setLastHint(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-emerald-950">
          <MapPin className="h-5 w-5 text-emerald-800" strokeWidth={1.5} aria-hidden /> Market prices
        </h1>
        <p className="mt-1 text-sm text-emerald-900/60">File today’s local prices as ranges. The server converts to ₦/kg and checks them.</p>
      </div>

      {!online && (
        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden /> Offline - entries are saved and will sync when you reconnect.
        </div>
      )}
      {queued > 0 && (
        <div className="flex items-center gap-2 rounded border border-line bg-surface px-3 py-2 text-xs text-emerald-900/70">
          <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden /> {queued} entr{queued === 1 ? 'y' : 'ies'} waiting to sync.
        </div>
      )}

      <DashboardCard title="Your market">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="am-state">State</Label>
            <Select id="am-state" value={state} onChange={(e) => { setState(e.target.value); setLga("") }} className="w-full">
              <option value="">Select…</option>
              {NIGERIA_STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </Select>
          </div>
          <div>
            <Label htmlFor="am-lga">LGA (optional)</Label>
            <Select id="am-lga" value={lga} disabled={!state} onChange={(e) => setLga(e.target.value)} className="w-full">
              <option value="">{state ? 'Any / not specified' : 'Choose a state first'}</option>
              {lgasFor(state).map((l) => (<option key={l} value={l}>{l}</option>))}
            </Select>
          </div>
          <div>
            <Label htmlFor="am-market">Market</Label>
            <Input ref={marketRef} id="am-market" value={market} onChange={(e) => setMarket(e.target.value)} placeholder="e.g. Bakori market" />
          </div>
        </div>
      </DashboardCard>

      <DashboardCard title="Add a price">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="am-com">Commodity</Label>
              <Input id="am-com" list="am-commodities" value={commodity} onChange={(e) => { setCommodity(e.target.value); setVarietyId('') }} placeholder="e.g. Maize" />
              <datalist id="am-commodities">{commodityList.map((c) => (<option key={c} value={c} />))}</datalist>
              {lastHint && <p className="mt-1 text-[11px] text-emerald-700">{lastHint}</p>}
            </div>
            <div>
              <Label htmlFor="am-var">Variety (optional)</Label>
              <Select id="am-var" value={varietyId} onChange={(e) => setVarietyId(e.target.value)} className="w-full" disabled={varietyOptions.length === 0}>
                <option value="">{varietyOptions.length ? 'Any / not specified' : 'No varieties listed'}</option>
                {varietyOptions.map((v) => (<option key={v.id} value={v.id}>{v.variety_name}{v.local_name_hausa ? ` (${v.local_name_hausa})` : ''}</option>))}
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            <div>
              <Label htmlFor="am-low">Low (₦)</Label>
              <Input id="am-low" type="number" inputMode="numeric" min={0} value={low} onChange={(e) => setLow(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="am-high">High (₦)</Label>
              <Input id="am-high" type="number" inputMode="numeric" min={0} value={high} onChange={(e) => setHigh(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="am-qty">Quantity</Label>
              <Input id="am-qty" type="number" inputMode="decimal" min={0} step="any" value={quantity}
                onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="am-unit">Per</Label>
              <Select id="am-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full">
                {unitNames.map((u) => (<option key={u} value={u}>{u}</option>))}
              </Select>
            </div>
            <div>
              <Label htmlFor="am-date">Date</Label>
              <Input id="am-date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-emerald-900/55">
            The range covers {Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : '-'} × {unit}
            {kgPerUnit ? ` (≈ ${Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum * kgPerUnit : kgPerUnit} kg in total)` : ''}.
            Use quantity for lot prices - e.g. 2 × tonne.
          </p>
          {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" loading={busy}><Plus className="h-4 w-4" aria-hidden /> Add price</Button>
        </form>
      </DashboardCard>

      {session.length > 0 && (
        <DashboardCard title={`Filed this session (${session.length})`}>
          <ul className="divide-y divide-line">
            {session.map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-emerald-950">{r.commodity}</span>
                  <span className="ml-2 font-mono text-[13px] text-emerald-800">{formatNaira(r.low)}–{formatNaira(r.high)}/{perUnitLabel(r.quantity, r.unit)}</span>
                  {r.flags.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-amber-700">{r.flags.map((f) => FLAG_LABEL[f] ?? f).join(' · ')}</p>
                  )}
                </div>
                <span className={
                  r.status === 'validated' ? 'inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700'
                  : r.status === 'queued' ? 'inline-flex items-center gap-1 text-[11px] font-medium text-emerald-900/50'
                  : 'inline-flex items-center gap-1 text-[11px] font-medium text-amber-700'
                }>
                  {r.status === 'validated' ? <><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Published</>
                   : r.status === 'queued' ? <><CloudOff className="h-3.5 w-3.5" aria-hidden /> Queued</>
                   : <><Flag className="h-3.5 w-3.5" aria-hidden /> Sent for review</>}
                </span>
              </li>
            ))}
          </ul>
        </DashboardCard>
      )}
    </div>
  )
}
