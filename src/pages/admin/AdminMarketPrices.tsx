import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { COMMODITIES, NIGERIA_STATES } from '@/lib/nigeria'
import type { MarketPrice } from '@/lib/marketplace'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { MarketPricesPanel } from '@/components/MarketPricesPanel'

/**
 * Admin-only reference-price entry (the honest pilot Market Intelligence).
 * RLS restricts INSERT/DELETE to admins; everyone signed-in can read.
 */
export default function AdminMarketPrices() {
  const { profile } = useAuth()
  const [commodity, setCommodity] = useState('')
  const [stateName, setStateName] = useState('')
  const [price, setPrice] = useState('')
  const [recordedDate, setRecordedDate] = useState(new Date().toISOString().slice(0, 10))
  const [sourceNote, setSourceNote] = useState('')
  const [recent, setRecent] = useState<MarketPrice[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('market_prices')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30)
    setRecent((data as MarketPrice[]) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    const p = Number(price)
    if (!commodity) return setMsg({ ok: false, text: 'Select a commodity.' })
    if (!Number.isFinite(p) || p <= 0) return setMsg({ ok: false, text: 'Enter a valid price per kg.' })
    setSaving(true)
    const { error } = await supabase.from('market_prices').insert({
      commodity,
      state: stateName || null,
      price_per_kg: p,
      recorded_date: recordedDate,
      source_note: sourceNote.trim() || null,
      entered_by: profile?.id,
    })
    setSaving(false)
    if (error) {
      setMsg({ ok: false, text: error.message })
      return
    }
    setPrice('')
    setSourceNote('')
    setMsg({ ok: true, text: `${commodity} price recorded.` })
    await load()
  }

  async function remove(id: string) {
    await supabase.from('market_prices').delete().eq('id', id)
    await load()
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <DashboardCard title="Record a reference price">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="mp_commodity">Commodity *</Label>
                <Select id="mp_commodity" value={commodity} onChange={(e) => setCommodity(e.target.value)}>
                  <option value="" disabled>Select…</option>
                  {COMMODITIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="mp_state">State (blank = national)</Label>
                <Select id="mp_state" value={stateName} onChange={(e) => setStateName(e.target.value)}>
                  <option value="">National</option>
                  {NIGERIA_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="mp_price">Price per kg (₦) *</Label>
                <Input id="mp_price" type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 450" />
              </div>
              <div>
                <Label htmlFor="mp_date">Recorded date</Label>
                <Input id="mp_date" type="date" value={recordedDate} onChange={(e) => setRecordedDate(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="mp_source">Source note</Label>
              <Input id="mp_source" value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder="e.g. Zaria main market survey" />
            </div>
            {msg && (
              <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800' : 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700'}>
                {msg.text}
              </p>
            )}
            <Button type="submit" loading={saving}>Record price</Button>
          </form>
        </DashboardCard>

        <DashboardCard title="Recent entries">
          {recent.length === 0 ? (
            <p className="py-4 text-sm text-emerald-900/50">No prices recorded yet.</p>
          ) : (
            <ul className="divide-y divide-emerald-950/5">
              {recent.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-emerald-950">
                      {p.commodity} · {formatNaira(Number(p.price_per_kg))}/kg
                    </p>
                    <p className="text-[11px] text-emerald-900/45">
                      {p.state ?? 'National'} · {formatDateShort(p.recorded_date)}
                      {p.source_note ? ` · ${p.source_note}` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => remove(p.id)} className="rounded-md p-1.5 text-emerald-900/35 hover:bg-red-50 hover:text-red-600" aria-label="Delete entry">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      </div>

      <MarketPricesPanel />
    </div>
  )
}
