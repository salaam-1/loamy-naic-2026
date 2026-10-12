import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { LineChart, Trash2 } from 'lucide-react'
import { COMMODITIES, NIGERIA_STATES } from '@/lib/nigeria'
import { PRICE_UNITS, deletePriceUpdate, fetchMyPriceUpdates, submitPriceUpdate, type PriceUpdate } from '@/lib/prices'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Post a daily market price update as a LOW–HIGH range in a flexible unit
 * (default 100kg). For growth partners (field agents) and admins. Feeds the
 * marketplace price panel and the Co-pilot's current-price answers.
 */
export default function PriceUpdates() {
  const [commodity, setCommodity] = useState('')
  const [state, setState] = useState('')
  const [unit, setUnit] = useState<string>('100kg')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [recordedDate, setRecordedDate] = useState(today())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [mine, setMine] = useState<PriceUpdate[] | null>(null)
  const load = useCallback(() => { void fetchMyPriceUpdates().then(setMine) }, [])
  useEffect(() => { load() }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (!commodity.trim()) { setMsg({ ok: false, text: 'Enter a commodity.' }); return }
    const min = Number(priceMin), max = Number(priceMax)
    if (!Number.isFinite(min) || min < 0) { setMsg({ ok: false, text: 'Enter a valid low price.' }); return }
    if (!Number.isFinite(max) || max < min) { setMsg({ ok: false, text: 'High price must be ≥ low price.' }); return }
    setBusy(true)
    try {
      await submitPriceUpdate({ commodity: commodity.trim(), state: state || null, unit, price_min: min, price_max: max, recorded_date: recordedDate, source_note: note.trim() || null })
      setMsg({ ok: true, text: 'Price update posted.' })
      setPriceMin(''); setPriceMax(''); setNote('')
      load()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not post the update.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-emerald-950">
          <LineChart className="h-5 w-5 text-emerald-800" strokeWidth={1.5} aria-hidden /> Price updates
        </h1>
        <p className="mt-1 text-sm text-emerald-900/60">
          Post today’s market price as a range (low–high) in your unit. These appear on the marketplace and power the Co-pilot.
        </p>
      </div>

      <DashboardCard title="Post a price update">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="pu-com">Commodity</Label>
              <Input id="pu-com" list="pu-commodities" value={commodity} onChange={(e) => setCommodity(e.target.value)} placeholder="e.g. Soybeans" />
              <datalist id="pu-commodities">{COMMODITIES.map((c) => (<option key={c} value={c} />))}</datalist>
            </div>
            <div>
              <Label htmlFor="pu-state">State / market (optional)</Label>
              <Select id="pu-state" value={state} onChange={(e) => setState(e.target.value)} className="w-full">
                <option value="">National / any</option>
                {NIGERIA_STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="pu-min">Low price (₦)</Label>
              <Input id="pu-min" type="number" min={0} value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="72000" />
            </div>
            <div>
              <Label htmlFor="pu-max">High price (₦)</Label>
              <Input id="pu-max" type="number" min={0} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="75000" />
            </div>
            <div>
              <Label htmlFor="pu-unit">Per</Label>
              <Select id="pu-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full">
                {PRICE_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
              </Select>
            </div>
            <div>
              <Label htmlFor="pu-date">Date</Label>
              <Input id="pu-date" type="date" max={today()} value={recordedDate} onChange={(e) => setRecordedDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="pu-note">Source / note (optional)</Label>
            <Input id="pu-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Dawanau market, wholesale" />
          </div>

          {msg && (
            <p className={msg.ok ? 'rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800' : 'rounded bg-red-50 px-3 py-2 text-sm text-red-700'}>{msg.text}</p>
          )}
          <Button type="submit" loading={busy}>Post update</Button>
        </form>
      </DashboardCard>

      <DashboardCard title="Your recent updates">
        {mine === null ? (
          <div className="h-16 animate-pulse rounded bg-emerald-50" aria-hidden />
        ) : mine.length === 0 ? (
          <p className="text-sm text-emerald-900/55">You haven’t posted any price updates yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-emerald-950">{u.commodity}</span>
                  <span className="ml-2 font-mono text-[13px] text-emerald-800">{formatNaira(Number(u.price_min))}–{formatNaira(Number(u.price_max))}/{u.unit}</span>
                  <span className="ml-2 text-xs text-emerald-900/45">{u.state ?? 'National'} · {formatDateShort(u.recorded_date)}</span>
                </div>
                <button type="button" onClick={async () => { await deletePriceUpdate(u.id); load() }} aria-label="Delete" className="flex h-8 w-8 min-h-touch min-w-touch items-center justify-center rounded text-emerald-900/45 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>
    </div>
  )
}
