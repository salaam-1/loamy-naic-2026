import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarOff, CheckCircle2, Database, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'

/** Config key per dataset. `market_events` intentionally has no threshold. */
type DatasetKey = 'ambassador_submissions' | 'historical_prices' | 'macro' | 'market_events'

interface Dataset { key: DatasetKey; label: string; hint: string }
const DATASETS: Dataset[] = [
  { key: 'historical_prices', label: 'Historical prices', hint: 'WFP publishes on a lag' },
  { key: 'ambassador_submissions', label: 'Ambassador submissions', hint: 'Daily data - a gap means something is wrong' },
  { key: 'macro', label: 'Macro (CPI/FX)', hint: 'Monthly series' },
  { key: 'market_events', label: 'Market events', hint: 'No threshold - absence of events is normal' },
]

const DEFAULT_THRESHOLDS: Record<DatasetKey, number | null> = {
  ambassador_submissions: 3, historical_prices: 120, macro: 90, market_events: null,
}

interface Health { key: DatasetKey; count: number; earliest: string | null; latest: string | null }
interface Coverage { commodity: string; price_type: string; earliest: string | null; latest: string | null; rows: number }

const daysAgo = (d: string | null) => (d ? Math.floor((Date.now() - Date.parse(d)) / 864e5) : Infinity)

/**
 * Admin data-health: per-dataset row counts + freshness, judged against a
 * PER-DATASET staleness threshold (editable, stored in platform_config). Market
 * events have no threshold — their absence is normal. Plus a per-commodity
 * coverage table so early-ending series (Maize vs Maize (flour)) are visible.
 */
export function AdminDataHealth() {
  const [rows, setRows] = useState<Health[] | null>(null)
  const [thresholds, setThresholds] = useState<Record<DatasetKey, number | null>>(DEFAULT_THRESHOLDS)
  const [draft, setDraft] = useState<Record<DatasetKey, string>>({ ambassador_submissions: '', historical_prices: '', macro: '', market_events: '' })
  const [coverage, setCoverage] = useState<Coverage[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Thresholds from config (fall back to defaults).
    supabase.from('platform_config').select('data_health').eq('id', 1).maybeSingle().then(({ data }) => {
      if (cancelled) return
      const cfg = { ...DEFAULT_THRESHOLDS, ...((data?.data_health as Partial<Record<DatasetKey, number | null>>) ?? {}) }
      setThresholds(cfg)
      setDraft({
        historical_prices: cfg.historical_prices?.toString() ?? '',
        ambassador_submissions: cfg.ambassador_submissions?.toString() ?? '',
        macro: cfg.macro?.toString() ?? '',
        market_events: cfg.market_events?.toString() ?? '',
      })
    })

    async function span(table: string, dateCol: string, key: DatasetKey): Promise<Health> {
      const [{ count }, mx, mn] = await Promise.all([
        supabase.from(table).select('id', { count: 'exact', head: true }),
        supabase.from(table).select(dateCol).order(dateCol, { ascending: false }).limit(1),
        supabase.from(table).select(dateCol).order(dateCol, { ascending: true }).limit(1),
      ])
      const rec = (o: { data: unknown }): string | null => {
        const d = o.data as Record<string, unknown>[] | null
        return (d?.[0]?.[dateCol] as string) ?? null
      }
      return { key, count: count ?? 0, earliest: rec(mn), latest: rec(mx) }
    }

    Promise.all([
      span('market_prices_history', 'date', 'historical_prices'),
      span('market_events', 'start_date', 'market_events'),
      span('ambassador_price_submissions', 'observed_date', 'ambassador_submissions'),
    ]).then(async (base) => {
      const [{ count: mc }, latest] = await Promise.all([
        supabase.from('macro_context').select('id', { count: 'exact', head: true }),
        supabase.from('macro_context').select('year,month').order('year', { ascending: false }).order('month', { ascending: false }).limit(1),
      ])
      const l = (latest.data as { year: number; month: number }[] | null)?.[0]
      const macro: Health = { key: 'macro', count: mc ?? 0, earliest: null, latest: l ? `${l.year}-${String(l.month).padStart(2, '0')}-01` : null }
      if (!cancelled) setRows([...base, macro])
    })

    supabase.from('loamy_price_coverage').select('*').then(({ data }) => {
      if (cancelled) return
      const c = ((data ?? []) as Coverage[]).slice().sort((a, b) => (a.latest ?? '').localeCompare(b.latest ?? ''))
      setCoverage(c)
    })

    return () => { cancelled = true }
  }, [])

  async function saveThresholds() {
    setSaving(true); setSaved(false)
    const next: Record<DatasetKey, number | null> = {
      historical_prices: draft.historical_prices ? Number(draft.historical_prices) : DEFAULT_THRESHOLDS.historical_prices,
      ambassador_submissions: draft.ambassador_submissions ? Number(draft.ambassador_submissions) : DEFAULT_THRESHOLDS.ambassador_submissions,
      macro: draft.macro ? Number(draft.macro) : DEFAULT_THRESHOLDS.macro,
      market_events: draft.market_events ? Number(draft.market_events) : null,
    }
    const { error } = await supabase.from('platform_config').update({ data_health: next }).eq('id', 1)
    setSaving(false)
    if (!error) { setThresholds(next); setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  const meta = (d: Dataset) => DATASETS.find((x) => x.key === d.key)!
  const dataMax = coverage?.reduce((m, c) => Math.max(m, Date.parse(c.latest ?? '0')), 0) ?? 0

  return (
    <div className="space-y-4">
      <DashboardCard
        title="Data health"
        action={
          <Button size="sm" variant="outline" onClick={saveThresholds} disabled={saving}>
            <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save thresholds'}
          </Button>
        }
      >
        {rows === null ? (
          <div className="h-24 animate-pulse rounded bg-emerald-50" aria-hidden />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-1.5 pr-4 font-medium">Dataset</th>
                  <th className="py-1.5 pr-4 font-medium">Rows</th>
                  <th className="py-1.5 pr-4 font-medium">Earliest</th>
                  <th className="py-1.5 pr-4 font-medium">Latest</th>
                  <th className="py-1.5 pr-4 font-medium">Stale after (days)</th>
                  <th className="py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {DATASETS.map((d) => {
                  const r = rows.find((x) => x.key === d.key)!
                  const threshold = thresholds[d.key]
                  const noThreshold = d.key === 'market_events' || threshold == null
                  const stale = !noThreshold && r.count > 0 && daysAgo(r.latest) > (threshold as number)
                  return (
                    <tr key={d.key}>
                      <td className="py-1.5 pr-4">
                        <span className="text-emerald-950">{meta(d).label}</span>
                        <span className="block text-[11px] text-emerald-900/45">{meta(d).hint}</span>
                      </td>
                      <td className="py-1.5 pr-4 font-mono text-[13px]">{r.count.toLocaleString()}</td>
                      <td className="py-1.5 pr-4 font-mono text-[13px] text-emerald-900/60">{r.earliest ? formatDateShort(r.earliest) : '-'}</td>
                      <td className="py-1.5 pr-4 font-mono text-[13px]">{r.latest ? formatDateShort(r.latest) : '-'}</td>
                      <td className="py-1.5 pr-4">
                        {d.key === 'market_events' ? (
                          <span className="text-[12px] text-emerald-900/40">n/a</span>
                        ) : (
                          <input
                            type="number" min="1" value={draft[d.key]}
                            onChange={(e) => setDraft((v) => ({ ...v, [d.key]: e.target.value }))}
                            className="h-8 w-20 rounded border border-line bg-white px-2 font-mono text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                            placeholder={String(DEFAULT_THRESHOLDS[d.key] ?? '')}
                          />
                        )}
                      </td>
                      <td className="py-1.5">
                        {r.count === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-900/45"><Database className="h-3.5 w-3.5" aria-hidden /> Empty</span>
                        ) : d.key === 'market_events' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-900/55"><CalendarOff className="h-3.5 w-3.5" aria-hidden /> No events since {r.latest ? formatDateShort(r.latest) : '-'}</span>
                        ) : stale ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Stale (&gt;{threshold}d)</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Current</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-relaxed text-emerald-900/45">
              Thresholds are per dataset - daily ambassador data goes stale far sooner than lagged WFP prices.
              Market events have no threshold: a quiet stretch is normal, so it reads as info, not a warning.
            </p>
          </div>
        )}
      </DashboardCard>

      <DashboardCard title="Per-commodity price coverage">
        {coverage === null ? (
          <div className="h-24 animate-pulse rounded bg-emerald-50" aria-hidden />
        ) : coverage.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-emerald-900/50">No price history loaded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-1.5 pr-4 font-medium">Commodity</th>
                  <th className="py-1.5 pr-4 font-medium">Price type</th>
                  <th className="py-1.5 pr-4 font-medium">Earliest</th>
                  <th className="py-1.5 pr-4 font-medium">Latest</th>
                  <th className="py-1.5 pr-4 font-medium">Rows</th>
                  <th className="py-1.5 font-medium">Series ends</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {coverage.map((c) => {
                  // Flag a series ending well before the freshest data in the table.
                  const behindDays = dataMax && c.latest ? Math.floor((dataMax - Date.parse(c.latest)) / 864e5) : 0
                  const early = behindDays > 180
                  return (
                    <tr key={`${c.commodity}-${c.price_type}`}>
                      <td className="py-1.5 pr-4 text-emerald-950">{c.commodity}</td>
                      <td className="py-1.5 pr-4 text-[13px] capitalize text-emerald-900/70">{c.price_type}</td>
                      <td className="py-1.5 pr-4 font-mono text-[13px] text-emerald-900/60">{c.earliest ? formatDateShort(c.earliest) : '-'}</td>
                      <td className="py-1.5 pr-4 font-mono text-[13px]">{c.latest ? formatDateShort(c.latest) : '-'}</td>
                      <td className="py-1.5 pr-4 font-mono text-[13px]">{c.rows.toLocaleString()}</td>
                      <td className="py-1.5">
                        {early ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> ends early (~{Math.round(behindDays / 30)}mo behind)</span>
                        ) : (
                          <span className="text-[11px] text-emerald-900/45">current</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-relaxed text-emerald-900/45">
              A commodity’s series can legitimately end earlier than the dataset max (e.g. WFP stopped reporting
              plain “Maize” retail after Jan 2023 while “Maize (flour)” continues). Use this to check before
              trusting a commodity’s recent price.
            </p>
          </div>
        )}
      </DashboardCard>
    </div>
  )
}
