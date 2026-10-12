import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, BadgeCheck, Compass, Info, MapPin, Package, Search, Sparkles, Truck,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PublicShell } from '@/pages/public/PublicShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { COMMODITIES, NIGERIA_STATES } from '@/lib/nigeria'
import { useDiscoveryEvents } from '@/lib/useDiscoveryEvents'
import {
  VIEWS, comparisonLabel, comparisonQualifier, comparisonRefusal, isRecommended,
  landedCost, superlativeLabel, topReasons,
  type DiscoveryItem, type DiscoveryResult, type DiscoveryView, type LogisticsEstimate,
} from '@/lib/discovery'
import { profilePath } from '@/lib/identity'
import { cn } from '@/lib/utils'

/**
 * Discovery (route: /discover).
 *
 * Three views over the same truth — Buy, Source, Opportunity. They change
 * which signals are weighted, never what is shown, and the weights are
 * printed on the page so the ordering can be argued with.
 *
 * The page will not say "recommended" about a listing the engine could not
 * give a reason for; that listing is shown as an ordinary match instead.
 */
export default function Discover() {
  const record = useDiscoveryEvents('search')

  const [commodity, setCommodity] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('tonne')
  const [deliveryState, setDeliveryState] = useState('')
  const [referenceMarket, setReferenceMarket] = useState('')
  const [view, setView] = useState<DiscoveryView>('buy')

  const [result, setResult] = useState<DiscoveryResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWeights, setShowWeights] = useState(false)

  // Prefill from saved preferences, so a returning buyer is not asked twice.
  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      supabase.from('buyer_preferences').select('*').eq('user_id', data.user.id).maybeSingle()
        .then(({ data: p }) => {
          if (cancelled || !p) return
          if (p.commodities?.[0]) setCommodity(p.commodities[0])
          if (p.delivery_states?.[0]) setDeliveryState(p.delivery_states[0])
          if (p.reference_market) setReferenceMarket(p.reference_market)
          if (p.typical_quantity_min) setQuantity(String(p.typical_quantity_min))
          if (p.typical_unit) setUnit(p.typical_unit)
        })
    })
    return () => { cancelled = true }
  }, [])

  const run = useCallback(async (nextView: DiscoveryView) => {
    setBusy(true); setError(null)
    const { data, error: rpcError } = await supabase.rpc('loamy_discover_supply', {
      p_commodity: commodity || null,
      p_quantity: quantity ? Number(quantity) : null,
      p_unit: quantity ? unit : null,
      p_delivery_state: deliveryState || null,
      p_reference_market: referenceMarket || null,
      p_view: nextView,
      p_limit: 24,
    })
    setBusy(false)

    if (rpcError) { setError(rpcError.message); return }
    const r = data as DiscoveryResult
    if (r?.error) { setError(r.error); return }
    setResult(r)

    record('search', {
      objectType: 'search',
      commodity: commodity || null,
      state: deliveryState || null,
      quantity: quantity ? Number(quantity) : null,
      unit: quantity ? unit : null,
      searchTerms: commodity || null,
      metadata: { view: nextView, results: r?.returned ?? 0, matching: r?.matching_listings ?? 0 },
    })
  }, [commodity, quantity, unit, deliveryState, referenceMarket, record])

  function onSubmit(e: FormEvent) { e.preventDefault(); void run(view) }

  function switchView(next: DiscoveryView) {
    setView(next)
    if (result) void run(next)
  }

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <header>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
            <Compass className="h-5 w-5 text-emerald-700" strokeWidth={1.5} aria-hidden />
            Discover supply
          </h1>
          <p className="mt-0.5 text-sm text-emerald-900/60">
            Find commodity you would not have searched for - then check it before you commit.
          </p>
        </header>

        <Card className="p-4">
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <Label htmlFor="d-commodity">Commodity</Label>
              <Select id="d-commodity" value={commodity} onChange={(e) => setCommodity(e.target.value)}>
                <option value="">Any</option>
                {COMMODITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="d-qty">Quantity needed</Label>
              <div className="flex gap-1.5">
                <Input
                  id="d-qty" type="number" min="0" step="any" value={quantity}
                  onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 180"
                />
                <Select value={unit} onChange={(e) => setUnit(e.target.value)} className="w-24">
                  <option value="tonne">tonne</option>
                  <option value="kg">kg</option>
                  <option value="bags">bags</option>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="d-delivery">Deliver to</Label>
              <Select id="d-delivery" value={deliveryState} onChange={(e) => setDeliveryState(e.target.value)}>
                <option value="">Anywhere</option>
                {NIGERIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="d-ref">Compare prices against</Label>
              <Select id="d-ref" value={referenceMarket} onChange={(e) => setReferenceMarket(e.target.value)}>
                <option value="">No reference</option>
                {NIGERIA_STATES.map((s) => <option key={s} value={s}>{s} market</option>)}
              </Select>
            </div>

            <div className="flex items-end">
              <Button type="submit" loading={busy} className="w-full">
                <Search className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Find supply
              </Button>
            </div>
          </form>

          {!referenceMarket && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-emerald-900/55">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
              Choose a market to compare prices against. Loamy has no national benchmark -
              every comparison names the market it came from.
            </p>
          )}
        </Card>

        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Discovery view">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              onClick={() => switchView(v.key)}
              className={cn(
                'rounded border px-3 py-1.5 text-xs font-medium transition-colors',
                view === v.key
                  ? 'border-emerald-800 bg-emerald-800 text-white'
                  : 'border-line bg-white text-emerald-900 hover:bg-emerald-50',
              )}
            >
              {v.label}
              <span className="ml-1.5 font-normal opacity-70">{v.question}</span>
            </button>
          ))}
        </div>

        {error && (
          <Card className="flex items-start gap-2.5 border-amber-300 bg-amber-50/60 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" strokeWidth={1.5} aria-hidden />
            <p className="text-sm text-amber-900">{error}</p>
          </Card>
        )}

        {result && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900/60">
              <p>
                {result.matching_listings} matching listing{result.matching_listings === 1 ? '' : 's'}
                {result.reference_market && <> · compared against <strong className="font-medium text-emerald-900">{result.reference_market}</strong></>}
              </p>
              <button
                onClick={() => setShowWeights((s) => !s)}
                className="font-medium text-emerald-700 underline-offset-2 hover:underline"
              >
                {showWeights ? 'Hide' : 'How is this ordered?'}
              </button>
            </div>

            {showWeights && (
              <Card className="p-4">
                <h2 className="text-sm font-semibold text-emerald-950">How this ordering works</h2>
                <p className="mt-1 text-xs text-emerald-900/65">
                  Nothing here is learned or hidden. Each listing scores against these weights,
                  and every card shows its own breakdown. Price is one signal among several -
                  the cheapest listing does not automatically rank first.
                </p>
                <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  {Object.entries(result.weights).map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-1">
                      <dt className="text-emerald-900/50">{k.replace(/_/g, ' ')}</dt>
                      <dd className="font-mono text-emerald-900/85">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}

            {result.reference_market_note && (
              <p className="text-xs text-emerald-900/55">{result.reference_market_note}</p>
            )}

            {result.items.length === 0 ? (
              <Card className="p-8 text-center text-sm text-emerald-900/60">
                No active listings match that request yet.
              </Card>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {result.items.map((item) => (
                  <ResultCard
                    key={item.listing_id}
                    item={item}
                    deliveryState={deliveryState}
                    onOpen={() => record('view_listing', {
                      objectType: 'listing', objectId: item.listing_id,
                      commodity: item.commodity, state: item.state,
                      pricePerUnit: item.price_per_unit, source: 'recommendation',
                    })}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PublicShell>
  )
}

function ResultCard({
  item, deliveryState, onOpen,
}: {
  item: DiscoveryItem
  deliveryState: string
  onOpen: () => void
}) {
  const [logistics, setLogistics] = useState<LogisticsEstimate | null>(null)
  const comparison = comparisonLabel(item.price_comparison)
  const qualifier = comparisonQualifier(item.price_comparison)
  const refusal = comparisonRefusal(item.price_comparison)
  const superlative = superlativeLabel(item)
  const reasons = topReasons(item)
  const recommended = isRecommended(item)

  // Freight is asked for only when there is a destination to ask about.
  useEffect(() => {
    if (!deliveryState || deliveryState === item.state) { setLogistics(null); return }
    let cancelled = false
    supabase.rpc('loamy_logistics_estimate', {
      p_from_state: item.state, p_to_state: deliveryState,
      p_quantity: item.quantity, p_unit: item.unit, p_commodity: item.commodity,
    }).then(({ data }) => { if (!cancelled) setLogistics(data as LogisticsEstimate) })
    return () => { cancelled = true }
  }, [deliveryState, item.state, item.quantity, item.unit, item.commodity])

  const landed = landedCost(item, logistics)

  return (
    <li>
      <Card className="flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-emerald-950">{item.commodity}</h3>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-emerald-900/60">
              <MapPin className="h-3 w-3" strokeWidth={1.5} aria-hidden />
              {item.lga ? `${item.lga}, ` : ''}{item.state}
            </p>
          </div>
          {recommended && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
              <Sparkles className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Suggested
            </span>
          )}
        </div>

        <p className="mt-2 font-mono text-base font-semibold text-emerald-950">
          ₦{Number(item.price_per_unit).toLocaleString('en-NG')}
          <span className="ml-1 font-sans text-xs font-normal text-emerald-900/55">/{item.unit}</span>
        </p>
        <p className="font-mono text-xs text-emerald-900/60">
          {Number(item.quantity).toLocaleString('en-NG')} {item.unit} available
        </p>

        {comparison && (
          <p className="mt-1.5 text-xs">
            <span className={cn('font-medium',
              item.price_comparison.direction === 'below' ? 'text-emerald-700' : 'text-amber-700')}>
              {comparison}
            </span>
            {qualifier && <span className="text-emerald-900/45"> · {qualifier}</span>}
          </p>
        )}
        {!comparison && refusal && (
          <p className="mt-1.5 text-xs text-emerald-900/45">{refusal}</p>
        )}

        {superlative && (
          <p className="mt-1 text-[11px] font-medium text-emerald-700">{superlative}</p>
        )}

        {/* Landed cost, only when the freight half is observed. */}
        {deliveryState && deliveryState !== item.state && (
          <div className="mt-2 rounded border border-line bg-emerald-900/[0.02] p-2">
            <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-900/70">
              <Truck className="h-3 w-3" strokeWidth={1.5} aria-hidden />
              To {deliveryState}
            </p>
            {landed.shown ? (
              <p className="mt-0.5 font-mono text-xs text-emerald-950">
                ₦{landed.commodity_per_kg}/kg + ₦{landed.freight_per_kg}/kg freight ={' '}
                <strong>₦{landed.landed_per_kg}/kg landed</strong>
                <span className="ml-1 font-sans text-[11px] font-normal text-emerald-900/45">
                  ({landed.observations} past loads)
                </span>
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-emerald-900/50">{landed.note}</p>
            )}
          </div>
        )}

        {item.hidden_supply.outside_your_usual_sourcing && item.hidden_supply.caveat && (
          <p className="mt-2 border-l-2 border-gold-400 pl-2 text-[11px] text-emerald-900/65">
            {item.hidden_supply.caveat}
          </p>
        )}

        {reasons.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {reasons.map((r) => (
              <li key={r.code} className="text-[11px] text-emerald-900/65">· {r.label}</li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-emerald-900/60">
            {item.seller.verified && (
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" strokeWidth={1.5} aria-hidden />
            )}
            {item.seller.username ? (
              <Link to={profilePath(item.seller.username)} className="truncate hover:text-emerald-800">
                {item.seller.display_name}
              </Link>
            ) : (
              <span className="truncate">{item.seller.display_name}</span>
            )}
          </span>

          <Link
            to={`/marketplace/${item.listing_id}`}
            onClick={onOpen}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
          >
            <Package className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Check stock
          </Link>
        </div>
      </Card>
    </li>
  )
}
