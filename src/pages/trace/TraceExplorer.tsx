import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle, ArrowRight, Ban, Banknote, Boxes, CheckCircle2, Clock,
  MapPin, Search, ShieldCheck, Sprout, Store, Truck, Warehouse, Wheat,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PublicShell } from '@/pages/public/PublicShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  SCOPE_COPY, TRACE_LABELS, TRACE_ORDER, gapKind, gapMessage,
  looksLikeRef, normaliseRef, traceRefusal,
  type TraceNodeKey, type TraceScope,
} from '@/lib/trace'
import { cn } from '@/lib/utils'

type Node = { available?: boolean; reason?: string; items?: Record<string, unknown>[] } & Record<string, unknown>
type Trace = {
  found: boolean
  reason?: string
  message?: string
  scope: TraceScope
  batch: Record<string, unknown>
  entered_via?: { ref: string; entity_type: string }
  /** The append-only batch event spine. Always present, possibly empty. */
  events?: Record<string, unknown>[]
} & Record<TraceNodeKey, Node>

const ICONS: Record<TraceNodeKey, typeof Sprout> = {
  farm: Sprout,
  production_cycle: Wheat,
  harvest: Wheat,
  batch: Boxes,
  verifications: ShieldCheck,
  listings: Store,
  transactions: Banknote,
  financing: Banknote,
  warehouse: Warehouse,
  logistics: Truck,
}

/**
 * Trace Explorer (routes: /trace, /trace/:ref).
 *
 * Accepts ANY Loamy reference — a batch, a transaction, a listing, a warehouse
 * receipt — because the thing a person is holding is rarely the batch ref.
 *
 * The display rule that matters: a step that DID NOT HAPPEN and a step this
 * viewer MAY NOT SEE are rendered differently and labelled differently. The
 * server distinguishes them; collapsing them here would tell a buyer that a
 * batch was never verified when in fact they simply lack the access.
 */
export default function TraceExplorer() {
  const { ref: routeRef } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState(routeRef ?? '')
  const [trace, setTrace] = useState<Trace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (raw: string) => {
    const ref = normaliseRef(raw)
    if (!ref) return
    setBusy(true); setError(null); setTrace(null)

    const { data, error: rpcError } = await supabase.rpc('loamy_trace', { p_ref: ref })
    setBusy(false)

    if (rpcError) { setError(rpcError.message); return }
    const t = data as Trace | null
    if (!t?.found) { setError(t?.message ?? traceRefusal(t?.reason)); return }
    setTrace(t)
  }, [])

  useEffect(() => { if (routeRef) { setInput(routeRef); void run(routeRef) } }, [routeRef, run])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const ref = normaliseRef(input)
    if (!ref) return
    if (!looksLikeRef(ref)) {
      setError('That does not look like a Loamy reference. They look like BATCH-000982 or TXN-000244.')
      setTrace(null)
      return
    }
    navigate(`/trace/${ref}`)
  }

  return (
    <PublicShell>
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <header>
          <h1 className="text-lg font-semibold text-emerald-950">Trace</h1>
          <p className="mt-0.5 text-sm text-emerald-900/60">
            Follow any commodity from the farm it grew on to where it went.
          </p>
        </header>

        <Card className="p-4">
          <form onSubmit={onSubmit} className="flex flex-wrap gap-2">
            <label htmlFor="trace-ref" className="sr-only">Loamy reference</label>
            <input
              id="trace-ref"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="BATCH-000982, TXN-000244, LIST-000117…"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded border border-line px-3 py-2 font-mono text-sm text-emerald-950 placeholder:font-sans placeholder:text-emerald-900/35 focus:border-emerald-700 focus:outline-none"
            />
            <Button type="submit" disabled={busy}>
              <Search className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {busy ? 'Tracing…' : 'Trace'}
            </Button>
          </form>
          <p className="mt-2 text-xs text-emerald-900/50">
            Any Loamy reference works - a batch, a deal, a listing, a warehouse receipt or a
            transport job. What you can see depends on your relationship to the goods.
          </p>
        </Card>

        {error && (
          <Card className="flex items-start gap-2.5 border-amber-300 bg-amber-50/60 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" strokeWidth={1.5} aria-hidden />
            <p className="text-sm text-amber-900">{error}</p>
          </Card>
        )}

        {trace && <Chain trace={trace} />}
      </div>
    </PublicShell>
  )
}

function Chain({ trace }: { trace: Trace }) {
  const batch = trace.batch ?? {}
  return (
    <>
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-sm font-semibold text-emerald-950">
            {String(batch.ref ?? '')}
          </span>
          <span className="text-sm text-emerald-900/80">{String(batch.commodity ?? '')}</span>
          {batch.status != null && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
              {String(batch.status)}
            </span>
          )}
        </div>

        {trace.entered_via && trace.entered_via.entity_type !== 'commodity_batch' && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-xs text-emerald-900/50">
            {trace.entered_via.ref}
            <ArrowRight className="h-3 w-3" strokeWidth={1.5} aria-hidden />
            {String(batch.ref ?? '')}
          </p>
        )}

        <p className="mt-3 border-t border-line pt-2.5 text-xs text-emerald-900/60">
          {SCOPE_COPY[trace.scope] ?? ''}
        </p>
      </Card>

      <ol className="space-y-2">
        {TRACE_ORDER.filter((k) => k !== 'batch').map((key) => (
          <Step key={key} nodeKey={key} node={trace[key]} />
        ))}
      </ol>

      <Events events={trace.events ?? []} />
    </>
  )
}

function Step({ nodeKey, node }: { nodeKey: TraceNodeKey; node: Node | undefined }) {
  const Icon = ICONS[nodeKey]
  const present = node?.available === true
  const kind = gapKind(node?.reason)

  return (
    <li>
      <Card className={cn('p-4', !present && 'bg-emerald-900/[0.02]')}>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded',
              present ? 'bg-emerald-50 text-emerald-700'
                : kind === 'withheld' ? 'bg-slate-100 text-slate-500'
                : 'bg-emerald-900/5 text-emerald-900/30',
            )}
          >
            {present ? <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              : kind === 'withheld' ? <Ban className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              : <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-emerald-950">{TRACE_LABELS[nodeKey]}</h3>
              {present
                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.5} aria-hidden />
                : (
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[11px] font-medium',
                      kind === 'withheld'
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-emerald-900/5 text-emerald-900/50',
                    )}
                  >
                    {gapMessage(node?.reason)}
                  </span>
                )}
            </div>

            {present && <NodeBody nodeKey={nodeKey} node={node!} />}
          </div>
        </div>
      </Card>
    </li>
  )
}

/**
 * Node detail. Fields the server redacted arrive as null, and a null is
 * simply not rendered — a redacted price must never fall back to 0.
 */
function NodeBody({ nodeKey, node }: { nodeKey: TraceNodeKey; node: Node }) {
  const items = Array.isArray(node.items) ? node.items : [node]

  return (
    <div className="mt-1.5 space-y-2">
      {items.map((item, i) => (
        <dl key={i} className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {Object.entries(item)
            .filter(([k, v]) => v !== null && v !== undefined && k !== 'available' && k !== 'reason')
            .map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1">
                <dt className="text-emerald-900/45">{prettyKey(k)}</dt>
                <dd className={cn('text-emerald-900/85', isNumericKey(k) && 'font-mono')}>
                  {formatValue(k, v)}
                </dd>
              </div>
            ))}
        </dl>
      ))}
      {nodeKey === 'farm' && node.state != null && (
        <p className="inline-flex items-center gap-1 text-xs text-emerald-900/50">
          <MapPin className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Origin recorded
        </p>
      )}
    </div>
  )
}

function Events({ events }: { events: Record<string, unknown>[] }) {
  if (!events.length) return null
  return (
    <Card className="p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-950">
        <Clock className="h-4 w-4 text-emerald-700" strokeWidth={1.5} aria-hidden />
        Event log
      </h3>
      <p className="mt-0.5 text-xs text-emerald-900/50">
        Append-only. Every movement of this batch, in order.
      </p>
      <ol className="mt-3 divide-y divide-line border-t border-line">
        {events.map((e, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-2 text-xs">
            <span className="font-mono text-emerald-900/40">
              {e.at ? new Date(String(e.at)).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
            </span>
            <span className="font-medium text-emerald-950">{prettyKey(String(e.event ?? ''))}</span>
            {e.from != null && e.to != null && (
              <span className="text-emerald-900/55">{String(e.from)} → {String(e.to)}</span>
            )}
            {e.quantity_after != null && (
              <span className="font-mono text-emerald-900/55">{String(e.quantity_after)} left</span>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}

const NUMERIC = /(quantity|amount|price|hectares|subtotal)/
function isNumericKey(k: string) { return NUMERIC.test(k) }

function prettyKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function formatValue(key: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  if (/_at$|date$/.test(key) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return new Date(s).toLocaleDateString('en-NG', { dateStyle: 'medium' })
  }
  return s
}
