import { useCallback, useEffect, useState } from 'react'
import { Award, CheckCircle2, Flag, Settings2, X } from 'lucide-react'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import {
  fetchFlaggedQueue, fetchLeaderboard, fetchValidationConfig, reviewSubmission, updateValidationConfig,
  type AmbassadorSubmission, type LeaderRow, type ValidationConfig,
  perUnitLabel
} from '@/lib/ambassador'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const FLAG_LABEL: Record<string, string> = {
  duplicate: 'Duplicate submission for the day',
  market_deviation: '>threshold from this market’s 7-day median',
  state_deviation: '>threshold from other markets in the state',
  outside_territory: 'Outside the ambassador’s assigned territory',
}

type Tab = 'review' | 'leaderboard' | 'settings'

/** Admin: ambassador price review queue, leaderboard, and validation settings. */
export default function AdminAmbassadors() {
  const [tab, setTab] = useState<Tab>('review')
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-emerald-950">Ambassador prices</h1>
        <p className="mt-1 text-sm text-emerald-900/60">Review flagged submissions, track ambassadors, and tune validation thresholds.</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line">
        {([['review', 'Review queue'], ['leaderboard', 'Leaderboard'], ['settings', 'Settings']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors', tab === k ? 'border-emerald-800 text-emerald-900' : 'border-transparent text-emerald-900/55 hover:text-emerald-900')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'review' && <ReviewTab />}
      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

function ReviewTab() {
  const [rows, setRows] = useState<AmbassadorSubmission[] | null>(null)
  const [people, setPeople] = useState<Record<string, PublicProfile>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await fetchFlaggedQueue()
    setRows(r)
    const ids = r.map((x) => x.ambassador_id).filter(Boolean) as string[]
    if (ids.length) setPeople(await fetchPublicProfiles(ids))
  }, [])
  useEffect(() => { void load() }, [load])

  const act = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id)
    try { await reviewSubmission(id, action, null); await load() } finally { setBusy(null) }
  }

  if (rows === null) return <div className="h-24 animate-pulse rounded bg-white" aria-hidden />
  if (rows.length === 0) return <DashboardCard title="Review queue"><p className="text-sm text-emerald-900/55">No flagged submissions - clean prices auto-publish.</p></DashboardCard>

  return (
    <div className="space-y-3">
      {rows.map((s) => (
        <div key={s.id} className="rounded border border-line bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-emerald-950">{s.commodity} <span className="font-mono text-[13px] font-normal text-emerald-800">{formatNaira(Number(s.price_low))}–{formatNaira(Number(s.price_high))}/{perUnitLabel(s.quantity, s.unit)}</span></p>
              <p className="mt-0.5 text-xs text-emerald-900/55">
                {formatNaira(Number(s.price_low_per_kg))}–{formatNaira(Number(s.price_high_per_kg))}/kg · {s.market_name}, {s.state} · {formatDateShort(s.observed_date)} · {people[s.ambassador_id ?? '']?.full_name ?? 'Ambassador'}
              </p>
            </div>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {s.flags.map((f) => (
              <li key={f} className="flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                <Flag className="h-3 w-3" aria-hidden /> {FLAG_LABEL[f] ?? f}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2 border-t border-line pt-2.5">
            <Button size="sm" loading={busy === s.id} onClick={() => act(s.id, 'approve')}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Approve</Button>
            <Button size="sm" variant="outline" loading={busy === s.id} onClick={() => act(s.id, 'reject')}><X className="h-3.5 w-3.5" aria-hidden /> Reject</Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function LeaderboardTab() {
  const [rows, setRows] = useState<LeaderRow[] | null>(null)
  const [people, setPeople] = useState<Record<string, PublicProfile>>({})
  useEffect(() => {
    void fetchLeaderboard().then(async (r) => {
      setRows(r)
      if (r.length) setPeople(await fetchPublicProfiles(r.map((x) => x.ambassador_id)))
    })
  }, [])
  return (
    <DashboardCard title="This month">
      {rows === null ? <div className="h-16 animate-pulse rounded bg-emerald-50" aria-hidden />
       : rows.length === 0 ? <p className="text-sm text-emerald-900/55">No submissions yet this month.</p>
       : (
        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.ambassador_id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-emerald-900/45">{i + 1}.</span>
                {i === 0 && <Award className="h-3.5 w-3.5 text-gold-500" aria-hidden />}
                <span className="font-medium text-emerald-950">{people[r.ambassador_id]?.full_name ?? 'Ambassador'}</span>
              </span>
              <span className="font-mono text-xs text-emerald-900/60">{r.validated}/{r.total} validated · {r.total ? Math.round((r.validated / r.total) * 100) : 0}%</span>
            </li>
          ))}
        </ol>
      )}
    </DashboardCard>
  )
}

function SettingsTab() {
  const [cfg, setCfg] = useState<ValidationConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { void fetchValidationConfig().then(setCfg) }, [])
  if (!cfg) return <div className="h-24 animate-pulse rounded bg-white" aria-hidden />
  const save = async () => {
    setBusy(true); setMsg(null)
    try { await updateValidationConfig(cfg); setMsg('Saved.') } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed.') } finally { setBusy(false) }
  }
  return (
    <DashboardCard title="Validation thresholds">
      <div className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs text-emerald-900/55"><Settings2 className="h-3.5 w-3.5" aria-hidden /> Submissions beyond these deviations are flagged for review (never auto-rejected).</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="cf-m">Market deviation %</Label>
            <Input id="cf-m" type="number" value={cfg.market_dev_pct} onChange={(e) => setCfg({ ...cfg, market_dev_pct: Number(e.target.value) })} />
          </div>
          <div>
            <Label htmlFor="cf-s">State deviation %</Label>
            <Input id="cf-s" type="number" value={cfg.state_dev_pct} onChange={(e) => setCfg({ ...cfg, state_dev_pct: Number(e.target.value) })} />
          </div>
          <div>
            <Label htmlFor="cf-r">₦ per validated submission</Label>
            <Input id="cf-r" type="number" value={cfg.submission_rate} onChange={(e) => setCfg({ ...cfg, submission_rate: Number(e.target.value) })} />
          </div>
        </div>
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        <Button size="sm" loading={busy} onClick={save}>Save thresholds</Button>
      </div>
    </DashboardCard>
  )
}
