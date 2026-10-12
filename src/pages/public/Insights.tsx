import { useEffect, useMemo, useState } from 'react'
import { BarChart3, ClipboardList, Package, TrendingUp, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { COMMODITY_GROUPS } from '@/lib/nigeria'
import { formatNaira } from '@/lib/utils'
import { PublicShell } from '@/pages/public/PublicShell'
import { StatCard } from '@/components/StatCard'
import { DashboardCard } from '@/components/DashboardCard'
import { BarBreakdown } from '@/components/charts/BarBreakdown'
import { DailyPricesPanel } from '@/components/DailyPricesPanel'

interface ListingRow { commodity: string; price_per_unit: number; unit: string; state: string | null }

/** Commodity → group label, for the category breakdown. */
const GROUP_OF: Record<string, string> = Object.fromEntries(
  COMMODITY_GROUPS.flatMap((g) => g.commodities.map((c) => [c, g.label])),
)

/**
 * Market insights (route: /insights). Honest analytics computed from REAL
 * marketplace data — active listings, suppliers, open demand, price ranges.
 * Charts fall back to plain totals when data is sparse; nothing is invented.
 */
export default function Insights() {
  const [listings, setListings] = useState<ListingRow[] | null>(null)
  const [supplierCount, setSupplierCount] = useState(0)
  const [requests, setRequests] = useState<{ commodity: string }[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('loamy_public_listings').select('commodity, price_per_unit, unit, state').limit(2000),
      supabase.from('loamy_public_suppliers').select('seller_id'),
      supabase.from('loamy_public_buy_requests').select('commodity').limit(500),
    ]).then(([l, s, r]) => {
      if (cancelled) return
      setListings((l.data as ListingRow[]) ?? [])
      setSupplierCount((s.data ?? []).length)
      setRequests((r.data as { commodity: string }[]) ?? [])
    })
    return () => { cancelled = true }
  }, [])

  const loading = listings === null
  const rows = listings ?? []

  const commodities = useMemo(() => new Set(rows.map((l) => l.commodity)), [rows])

  // Listings per commodity group.
  const byGroup = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of rows) {
      const g = GROUP_OF[l.commodity] ?? 'Other'
      counts[g] = (counts[g] ?? 0) + 1
    }
    return COMMODITY_GROUPS.map((g) => ({ group: g.label, count: counts[g.label] ?? 0 })).filter((d) => d.count > 0)
  }, [rows])

  // Supply (listings) vs demand (open buy requests) for the busiest commodities.
  const supplyDemand = useMemo(() => {
    const supply: Record<string, number> = {}
    const demand: Record<string, number> = {}
    for (const l of rows) supply[l.commodity] = (supply[l.commodity] ?? 0) + 1
    for (const r of requests) demand[r.commodity] = (demand[r.commodity] ?? 0) + 1
    const keys = [...new Set([...Object.keys(supply), ...Object.keys(demand)])]
    return keys
      .map((c) => ({ commodity: c, supply: supply[c] ?? 0, demand: demand[c] ?? 0 }))
      .sort((a, b) => b.supply + b.demand - (a.supply + a.demand))
      .slice(0, 6)
  }, [rows, requests])

  // Price range per commodity+unit (same unit within a group → honest ranges).
  const priceRanges = useMemo(() => {
    const groups: Record<string, number[]> = {}
    for (const l of rows) {
      const key = `${l.commodity}|${l.unit}`
      ;(groups[key] ??= []).push(Number(l.price_per_unit))
    }
    return Object.entries(groups)
      .map(([key, prices]) => {
        const [commodity, unit] = key.split('|')
        const min = Math.min(...prices)
        const max = Math.max(...prices)
        const avg = prices.reduce((s, p) => s + p, 0) / prices.length
        return { commodity, unit, count: prices.length, min, avg, max }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [rows])

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-emerald-950">
            <BarChart3 className="h-5 w-5 text-emerald-800" strokeWidth={1.5} aria-hidden /> Market insights
          </h1>
          <p className="mt-0.5 text-sm text-emerald-900/60">Live from the Loamy marketplace - real listings, demand and prices.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={Package} label="Active listings" value={loading ? '-' : rows.length} sub="On the marketplace now" loading={loading} />
          <StatCard icon={Users} label="Suppliers" value={loading ? '-' : supplierCount} sub="Sellers with listings" loading={loading} />
          <StatCard icon={ClipboardList} label="Open buy requests" value={loading ? '-' : requests.length} sub="Active demand" loading={loading} />
          <StatCard icon={TrendingUp} label="Commodities" value={loading ? '-' : commodities.size} sub="Distinct products listed" loading={loading} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <DashboardCard title="Listings by category">
            <BarBreakdown data={byGroup} xKey="group" series={[{ key: 'count', label: 'Listings' }]} />
          </DashboardCard>
          <DashboardCard title="Supply vs demand (top commodities)">
            <BarBreakdown
              data={supplyDemand}
              xKey="commodity"
              series={[{ key: 'supply', label: 'Listings' }, { key: 'demand', label: 'Buy requests', other: true }]}
            />
          </DashboardCard>
        </div>

        {/* grid-cols-[minmax(0,1fr)] on the mobile column, not just the lg one.
            A grid item defaults to min-width:auto, which floors it at its
            content's min-content width. The price table cannot shrink below
            about 366px, so the card grew to ~406px inside a 390px viewport and
            pushed the whole page sideways, and CardContent's overflow-x-auto
            never got the chance to scroll because the item it lives in had
            already been widened. minmax(0,...) removes that floor, the card
            fits the column, and the table scrolls inside the card as intended.
            The lg track already did this; the mobile one was missed. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <DashboardCard title="Price ranges (from active listings)">
            {priceRanges.length === 0 ? (
              <p className="py-2 text-sm text-emerald-900/55">Price ranges appear as sellers publish listings.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                    <th className="py-1.5 pr-4 font-medium">Commodity</th>
                    <th className="py-1.5 pr-4 font-medium">Low</th>
                    <th className="py-1.5 pr-4 font-medium">Avg</th>
                    <th className="py-1.5 pr-4 font-medium">High</th>
                    <th className="py-1.5 font-medium">Listings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {priceRanges.map((p) => (
                    <tr key={`${p.commodity}-${p.unit}`}>
                      <td className="py-1.5 pr-4 text-emerald-950">{p.commodity} <span className="text-xs text-emerald-900/45">/{p.unit}</span></td>
                      <td className="py-1.5 pr-4 font-mono text-[13px]">{formatNaira(p.min)}</td>
                      <td className="py-1.5 pr-4 font-mono text-[13px] font-semibold text-emerald-800">{formatNaira(Math.round(p.avg))}</td>
                      <td className="py-1.5 pr-4 font-mono text-[13px]">{formatNaira(p.max)}</td>
                      <td className="py-1.5 font-mono text-[13px] text-emerald-900/60">{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </DashboardCard>

          <DailyPricesPanel />
        </div>

        <p className="text-[11px] leading-relaxed text-emerald-900/45">
          Figures are computed live from active marketplace listings and open buy requests. Reference prices are
          published by the Loamy team as they are gathered. Nothing here is estimated or seeded.
        </p>
      </div>
    </PublicShell>
  )
}
