import { supabase } from '@/lib/supabase'
import { ANALYTICS_MAX_ROWS, analyticsSince } from '@/lib/charts'

/**
 * Processor dashboard KPIs + analytics. Every figure is a live, company-scoped
 * query over RLS-protected tables/views — real data only, zeros show as zeros.
 * Nothing here predicts future prices or estimates future spend.
 */

export interface ProcurementKpis {
  activeRfqs: number
  bidsAwaiting: number
  awardsInProgress: number
  commodities: number
  fundsInEscrow: number
  inspectionsPending: number
  deliveriesPending: number
  completed: number
}

/** Ceiling for the two KPI reads that need rows rather than a count. */
const KPI_ROW_CAP = 1000

export async function fetchKpis(): Promise<ProcurementKpis> {
  // Six of these eight figures are counts. They used to be produced by pulling
  // whole tables over RLS and calling .filter().length in the browser, which is
  // unbounded by construction and silently truncates at PostgREST's 1000-row
  // ceiling once a processor has traded for long enough. `head: true` moves
  // each one into Postgres and transfers no rows at all.
  const n = (q: { count: number | null }) => q.count ?? 0
  const [
    activeRfqs, bidsAwaiting, awardsInProgress, inspectionsPending, deliveriesPending, completed,
    openCommodities, escrow,
  ] = await Promise.all([
    supabase.from('rfqs').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('loamy_rfq_bids_v').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    supabase.from('loamy_rfq_awards_v').select('id', { count: 'exact', head: true })
      .in('status', ['awarded', 'in_progress', 'inspected', 'delivered']),
    supabase.from('loamy_inspection_jobs_v').select('id', { count: 'exact', head: true })
      .in('status', ['requested', 'assigned', 'in_progress', 'submitted']),
    supabase.from('loamy_transport_jobs_v').select('id', { count: 'exact', head: true })
      .in('status', ['broadcast', 'assigned', 'picked_up', 'in_transit']),
    supabase.from('loamy_rfq_awards_v').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    // These two cannot be a count: one is a DISTINCT and the other a SUM, and
    // adding a database aggregate is out of scope here. Both are filtered to
    // the rows that actually contribute, and capped.
    supabase.from('rfqs').select('commodity').in('status', ['open', 'awarded']).limit(KPI_ROW_CAP),
    supabase.from('escrow_transactions').select('amount, released_amount')
      .in('status', ['funded', 'partially_released']).limit(KPI_ROW_CAP),
  ])

  const commoditySet = new Set<string>()
  for (const r of (openCommodities.data ?? []) as { commodity: string | null }[]) {
    if (r.commodity) commoditySet.add(r.commodity)
  }

  const fundsInEscrow = ((escrow.data ?? []) as { amount: number; released_amount: number }[])
    .reduce((sum, e) => sum + (Number(e.amount) - Number(e.released_amount)), 0)

  return {
    activeRfqs: n(activeRfqs),
    bidsAwaiting: n(bidsAwaiting),
    awardsInProgress: n(awardsInProgress),
    commodities: commoditySet.size,
    fundsInEscrow,
    inspectionsPending: n(inspectionsPending),
    deliveriesPending: n(deliveriesPending),
    completed: n(completed),
  }
}

export interface CommodityStat { commodity: string; quantity: number; avgPrice: number; spend: number }
export interface SupplierStat { supplier: string; quantity: number; awards: number }
export interface StateStat { state: string; spend: number }
export interface MonthStat { month: string; spend: number }

export interface ProcurementAnalytics {
  awardCount: number
  totalSpend: number
  savingsVsHighest: number
  byCommodity: CommodityStat[]
  topSuppliers: SupplierStat[]
  byState: StateStat[]
  monthly: MonthStat[]
  deliveryRate: number | null       // delivered+completed / total awards
  inspectionPassRate: number | null // accepted / reviewed
}

export async function fetchAnalytics(): Promise<ProcurementAnalytics> {
  // Analytics needs rows, because it groups by commodity, supplier, state and
  // month, and no database aggregate may be added here. So it is windowed to
  // the same 26 weeks the charts render, ordered newest first and capped. An
  // unwindowed version returned an arbitrary slice once the 1000-row ceiling
  // was reached, which is worse than a stated window: the numbers looked
  // complete and were not.
  const since = analyticsSince()
  const [awardsRes, bidsRes, inspRes] = await Promise.all([
    supabase.from('loamy_rfq_awards_v')
      .select('rfq_id, commodity, supplier_name, supplier_state, awarded_quantity, awarded_price, status, created_at')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(ANALYTICS_MAX_ROWS),
    supabase.from('loamy_rfq_bids_v').select('rfq_id, price_per_unit, status')
      .order('created_at', { ascending: false }).limit(ANALYTICS_MAX_ROWS),
    supabase.from('loamy_inspection_jobs_v').select('status, recommendation')
      .order('created_at', { ascending: false }).limit(ANALYTICS_MAX_ROWS),
  ])
  const awards = (awardsRes.data ?? []) as {
    rfq_id: string; commodity: string | null; supplier_name: string | null; supplier_state: string | null
    awarded_quantity: number; awarded_price: number; status: string; created_at: string
  }[]
  const bids = (bidsRes.data ?? []) as { rfq_id: string; price_per_unit: number; status: string }[]

  const value = (a: { awarded_quantity: number; awarded_price: number }) => Number(a.awarded_quantity) * Number(a.awarded_price)
  const totalSpend = awards.reduce((s, a) => s + value(a), 0)

  // Savings vs the highest bid received on each award's RFQ.
  const maxBidByRfq = new Map<string, number>()
  bids.forEach((b) => { const cur = maxBidByRfq.get(b.rfq_id) ?? 0; if (Number(b.price_per_unit) > cur) maxBidByRfq.set(b.rfq_id, Number(b.price_per_unit)) })
  const savingsVsHighest = awards.reduce((s, a) => {
    const hi = maxBidByRfq.get(a.rfq_id) ?? Number(a.awarded_price)
    return s + Math.max(0, (hi - Number(a.awarded_price)) * Number(a.awarded_quantity))
  }, 0)

  const commodityMap = new Map<string, { quantity: number; spend: number; prices: number[] }>()
  const supplierMap = new Map<string, { quantity: number; awards: number }>()
  const stateMap = new Map<string, number>()
  const monthMap = new Map<string, number>()

  awards.forEach((a) => {
    const c = a.commodity ?? 'Unspecified'
    const cm = commodityMap.get(c) ?? { quantity: 0, spend: 0, prices: [] }
    cm.quantity += Number(a.awarded_quantity); cm.spend += value(a); cm.prices.push(Number(a.awarded_price))
    commodityMap.set(c, cm)

    const s = a.supplier_name?.trim() || 'Supplier'
    const sm = supplierMap.get(s) ?? { quantity: 0, awards: 0 }
    sm.quantity += Number(a.awarded_quantity); sm.awards += 1
    supplierMap.set(s, sm)

    if (a.supplier_state) stateMap.set(a.supplier_state, (stateMap.get(a.supplier_state) ?? 0) + value(a))
    const month = (a.created_at ?? '').slice(0, 7)
    if (month) monthMap.set(month, (monthMap.get(month) ?? 0) + value(a))
  })

  const byCommodity: CommodityStat[] = [...commodityMap.entries()].map(([commodity, v]) => ({
    commodity, quantity: v.quantity, spend: v.spend, avgPrice: v.prices.reduce((x, y) => x + y, 0) / v.prices.length,
  })).sort((a, b) => b.spend - a.spend)

  const topSuppliers: SupplierStat[] = [...supplierMap.entries()].map(([supplier, v]) => ({ supplier, quantity: v.quantity, awards: v.awards })).sort((a, b) => b.quantity - a.quantity)
  const byState: StateStat[] = [...stateMap.entries()].map(([state, spend]) => ({ state, spend })).sort((a, b) => b.spend - a.spend)
  const monthly: MonthStat[] = [...monthMap.entries()].map(([month, spend]) => ({ month, spend })).sort((a, b) => a.month.localeCompare(b.month))

  const delivered = awards.filter((a) => a.status === 'delivered' || a.status === 'completed').length
  const deliveryRate = awards.length ? delivered / awards.length : null

  const reviewed = (inspRes.data ?? []).filter((j: { status: string }) => j.status === 'accepted' || j.status === 'disputed')
  const passed = (inspRes.data ?? []).filter((j: { status: string; recommendation: string | null }) => j.status === 'accepted').length
  const inspectionPassRate = reviewed.length ? passed / reviewed.length : null

  return { awardCount: awards.length, totalSpend, savingsVsHighest, byCommodity, topSuppliers, byState, monthly, deliveryRate, inspectionPassRate }
}

/** Build a CSV string from the analytics for the finance team. */
export function analyticsCsv(a: ProcurementAnalytics): string {
  const rows: string[] = []
  rows.push('Section,Key,Quantity,Avg price,Spend')
  rows.push(`Summary,Total spend,,,"${a.totalSpend}"`)
  rows.push(`Summary,Savings vs highest bid,,,"${Math.round(a.savingsVsHighest)}"`)
  rows.push(`Summary,Awards,${a.awardCount},,`)
  a.byCommodity.forEach((c) => rows.push(`Commodity,"${c.commodity}",${c.quantity},"${Math.round(c.avgPrice)}","${Math.round(c.spend)}"`))
  a.topSuppliers.forEach((s) => rows.push(`Supplier,"${s.supplier}",${s.quantity},,`))
  a.byState.forEach((s) => rows.push(`State,"${s.state}",,,"${Math.round(s.spend)}"`))
  return rows.join('\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
