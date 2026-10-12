import { useCallback, useEffect, useState } from 'react'
import {
  Activity, BarChart3, CalendarRange, CheckCircle2, HelpCircle, Info,
  Package, TrendingUp,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { COMMODITIES, NIGERIA_STATES } from '@/lib/nigeria'
import { TrendLine } from '@/components/charts/TrendLine'
import {
  canShowBand, classificationBadge, evidenceLine, priceCaption,
  strongestEvidence, supplyRows, unavailableMessage,
  type Classification, type DemandSignal, type SupplySignal,
} from '@/lib/intelligence'
import { cn } from '@/lib/utils'

interface RoleIntel {
  role: string
  demand?: DemandSignal
  supply?: SupplySignal
  price_history?: {
    available: boolean
    reason?: string
    classification?: Classification
    label?: string
    observations?: number
    series?: { date: string; low_per_kg: number; high_per_kg: number; data_class: string }[]
  }
  seasonal?: {
    available: boolean
    reason?: string
    classification?: Classification
    headline?: string
    limitations?: string
    observations?: number
    months?: { month: number; month_name: string; observations: number; sufficient: boolean;
               avg_low_per_kg: number | null; avg_high_per_kg: number | null }[]
  }
  my_activity?: Record<string, number>
}

const TONE_CLASS = {
  fact: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  reported: 'border-amber-200 bg-amber-50 text-amber-800',
  computed: 'border-slate-200 bg-slate-50 text-slate-700',
}

const BAND_CLASS = {
  high: 'text-emerald-700',
  medium: 'text-emerald-800',
  low: 'text-emerald-900/50',
}

/**
 * Market intelligence (route: /dashboard/:role/intelligence).
 *
 * Every figure on this page carries a classification badge, its population
 * and its period. Where the server withholds a result it says "insufficient
 * data" — there is no code path that turns a suppressed answer into a range.
 *
 * The copy deliberately avoids AI language. The platform counts records and
 * computes statistics; saying anything grander would be dressing arithmetic
 * up as insight.
 */
/*
 * NOTE: this renders NO shell of its own.
 *
 * It is reached only through RoleDashboard, which already wraps every
 * section in AppShell. Wrapping again in RoleShell (which is itself an
 * AppShell) nested two shells and painted TWO complete Loamy headers,
 * one directly above the other, on mobile. RoleShell is for DEEP ROUTES
 * that are not inside RoleDashboard, such as the listing detail and
 * editor, and those keep it.
 *
 * No authorization is lost: RoleDashboard enforces the auth guard and the
 * section role list, and this call site never passed allowedRoles.
 */
export default function MarketIntelligence() {
  const [commodity, setCommodity] = useState('Maize')
  const [state, setState] = useState('')
  const [days, setDays] = useState(30)
  const [intel, setIntel] = useState<RoleIntel | null>(null)
  const [busy, setBusy] = useState(false)
  const [explain, setExplain] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    const { data } = await supabase.rpc('loamy_role_intelligence', {
      p_commodity: commodity || null,
      p_state: state || null,
      p_days: days,
    })
    setIntel((data as RoleIntel) ?? null)
    setBusy(false)
  }, [commodity, state, days])

  useEffect(() => { void load() }, [load])

  const demand = intel?.demand
  const supply = intel?.supply
  const history = intel?.price_history
  const seasonal = intel?.seasonal

  return (
    <>
      <div className="mx-auto max-w-5xl space-y-4">
        <header>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
            <BarChart3 className="h-5 w-5 text-emerald-700" strokeWidth={1.5} aria-hidden />
            Market intelligence
          </h1>
          <p className="mt-0.5 text-sm text-emerald-900/60">
            Counted from activity on Loamy. Every figure shows where it came from.
          </p>
        </header>

        <Card className="p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="i-commodity">Commodity</Label>
              <Select id="i-commodity" value={commodity}
                      onChange={(e) => setCommodity(e.target.value)}>
                {COMMODITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="i-state">Location</Label>
              <Select id="i-state" value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">All states</option>
                {NIGERIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="i-days">Period</Label>
              <Select id="i-days" value={String(days)}
                      onChange={(e) => setDays(Number(e.target.value))}>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="w-full" loading={busy} onClick={load}>Update</Button>
            </div>
          </div>
        </Card>

        {/* DEMAND */}
        <Section
          title="Demand"
          icon={TrendingUp}
          classification={demand?.classification}
          onExplain={() => setExplain((v) => !v)}
        >
          {!demand?.available ? (
            <Insufficient message={unavailableMessage(demand)} />
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-3">
                {canShowBand(demand) && (
                  <p className={cn('text-2xl font-semibold capitalize',
                    BAND_CLASS[demand.band!] ?? 'text-emerald-900')}>
                    {demand.band}
                  </p>
                )}
                <p className="font-mono text-xs text-emerald-900/50">
                  score {demand.weighted_score}
                </p>
              </div>

              <p className="mt-1 text-sm text-emerald-900/75">{evidenceLine(demand)}</p>

              {explain && (
                <div className="mt-3 rounded border border-line bg-emerald-900/[0.02] p-3">
                  <p className="text-xs font-medium text-emerald-900/70">
                    How this was calculated
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {strongestEvidence(demand, 8).map((e) => (
                      <li key={e.signal} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="text-emerald-900/70">
                          {e.signal.replace(/_/g, ' ')} × {e.events}
                        </span>
                        <span className="font-mono text-emerald-900/85">
                          {e.contribution}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 border-t border-line pt-2 text-[11px] text-emerald-900/55">
                    A completed transaction is weighted far above a view, and a view above a
                    search. The bands themselves are thresholds Loamy chose; the evidence
                    beneath them is what can be checked.
                  </p>
                </div>
              )}

              {demand.limitations && (
                <p className="mt-2 text-[11px] text-emerald-900/50">{demand.limitations}</p>
              )}
            </>
          )}
        </Section>

        {/* SUPPLY — three numbers, never a total. */}
        <Section title="Supply" icon={Package} classification={supply?.classification}>
          {!supply?.available ? (
            <Insufficient message={unavailableMessage(supply)} />
          ) : (
            <>
              <ul className="divide-y divide-line border-y border-line">
                {supplyRows(supply).map((r) => (
                  <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-emerald-950">{r.label}</p>
                      <p className="text-[11px] text-emerald-900/50">{r.means}</p>
                    </div>
                    <p className="font-mono text-sm text-emerald-950">
                      {Math.round(r.quantityKg).toLocaleString('en-NG')} kg
                      <span className="ml-1.5 font-sans text-[11px] text-emerald-900/45">
                        ({r.count})
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-emerald-900/50">
                These are three different things and are never added together.
                {supply.limitations ? ` ${supply.limitations}` : ''}
              </p>
            </>
          )}
        </Section>

        {/* PRICE HISTORY */}
        <Section title="Price history" icon={Activity}
                 classification={history?.classification}>
          {!history?.available ? (
            <Insufficient message={unavailableMessage(history)} />
          ) : (
            <>
              <p className="text-xs text-emerald-900/60">
                {priceCaption(history.series?.[history.series.length - 1]?.date, history.label)}
                {' · '}{history.observations} observations
              </p>
              <div className="mt-2">
                <TrendLine
                  data={(history.series ?? []).map((pt) => ({
                    week: new Date(pt.date).toLocaleDateString('en-NG',
                      { day: 'numeric', month: 'short' }),
                    low: Number(pt.low_per_kg ?? 0),
                    high: Number(pt.high_per_kg ?? 0),
                  })) as never}
                  series={[
                    { key: 'low', label: 'Low ₦/kg' },
                    { key: 'high', label: 'High ₦/kg' },
                  ]}
                  minPoints={3}
                />
              </div>
            </>
          )}
        </Section>

        {/* SEASONAL — labelled as a calculation, never a forecast. */}
        <Section title="Historical pattern" icon={CalendarRange}
                 classification={seasonal?.classification}>
          {!seasonal?.available ? (
            <Insufficient message={unavailableMessage(seasonal)} />
          ) : (
            <>
              <p className="text-sm text-emerald-900/75">{seasonal.headline}</p>
              <ul className="mt-2 grid gap-1 sm:grid-cols-3">
                {(seasonal.months ?? []).map((m) => (
                  <li key={m.month}
                      className={cn('rounded border px-2 py-1.5 text-xs',
                        m.sufficient ? 'border-line bg-white' : 'border-line bg-emerald-900/[0.02]')}>
                    <span className="font-medium text-emerald-950">{m.month_name}</span>
                    {m.sufficient ? (
                      <span className="ml-1.5 font-mono text-emerald-900/75">
                        ₦{m.avg_low_per_kg}–{m.avg_high_per_kg}/kg
                      </span>
                    ) : (
                      <span className="ml-1.5 text-emerald-900/40">
                        too few observations
                      </span>
                    )}
                    <span className="ml-1 text-[11px] text-emerald-900/35">
                      ({m.observations})
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-emerald-900/55">{seasonal.limitations}</p>
            </>
          )}
        </Section>

        {/* MY ACTIVITY */}
        {intel?.my_activity && (
          <Section title="Your activity" icon={CheckCircle2} classification="observed">
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
              {Object.entries(intel.my_activity).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5">
                  <dt className="text-xs text-emerald-900/55">{k.replace(/_/g, ' ')}</dt>
                  <dd className="font-mono text-emerald-950">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-emerald-900/50">
              Your own records only. Nobody else can see them, and they are not shown to
              other members.
            </p>
          </Section>
        )}
      </div>
    </>
  )
}

function Section({
  title, icon: Icon, classification, onExplain, children,
}: {
  title: string
  icon: typeof TrendingUp
  classification?: string
  onExplain?: () => void
  children: React.ReactNode
}) {
  const badge = classificationBadge(classification)
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-950">
          <Icon className="h-4 w-4 text-emerald-700" strokeWidth={1.5} aria-hidden />
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {badge && (
            <span
              className={cn('rounded border px-1.5 py-0.5 text-[11px] font-medium',
                TONE_CLASS[badge.tone as keyof typeof TONE_CLASS])}
              title={badge.help}
            >
              {badge.label}
            </span>
          )}
          {onExplain && (
            <button
              onClick={onExplain}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:text-emerald-800"
            >
              <HelpCircle className="h-3 w-3" strokeWidth={1.5} aria-hidden />
              Why am I seeing this?
            </button>
          )}
        </div>
      </div>
      <div className="mt-2">{children}</div>
    </Card>
  )
}

/** The only thing shown when a result is withheld. Never a range. */
function Insufficient({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-emerald-900/55">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
      {message}
    </p>
  )
}
