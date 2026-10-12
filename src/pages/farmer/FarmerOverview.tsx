import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BadgeCheck, Bell, Landmark, MapPinned, Plus, Ruler, Tractor } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ACTIVE_APPLICATION_STATUSES } from '@/lib/farming'
import type { NotificationRow } from '@/lib/types'
import { formatDateShort } from '@/lib/utils'
import { StatCard } from '@/components/StatCard'
import { DashboardCard } from '@/components/DashboardCard'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { BarBreakdown } from '@/components/charts/BarBreakdown'

interface OverviewData {
  farmCount: number
  totalHectares: number
  activeApplications: number
  verifiedFarms: number
  activity: NotificationRow[]
  loading: boolean
}

/**
 * Farmer dashboard overview. Every number is a live query — new farmers see
 * zeros, which is correct. No "farm health" style card: there is no data
 * source for it yet and we never fake metrics.
 */
export default function FarmerOverview() {
  const { t } = useT()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState<OverviewData>({
    farmCount: 0,
    totalHectares: 0,
    activeApplications: 0,
    verifiedFarms: 0,
    activity: [],
    loading: true,
  })
  const [yieldRows, setYieldRows] = useState<
    { season: string; [crop: string]: string | number }[]
  >([])
  const [yieldSeries, setYieldSeries] = useState<{ key: string; label: string; other?: boolean }[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!profile) return
      const [farmsRes, appsRes, activityRes, cropsRes] = await Promise.all([
        supabase.from('farms').select('size_hectares, verification_status'),
        supabase
          .from('financing_applications')
          .select('id', { count: 'exact', head: true })
          .in('status', ACTIVE_APPLICATION_STATUSES),
        supabase
          .from('notifications')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(8),
        // RLS scopes crop_records to the farmer's own farms — the chart query
        // is the same boundary as every other read.
        supabase.from('crop_records').select('crop, season_year, actual_yield_kg'),
      ])
      if (cancelled) return

      // Yield history: seasons on x, one series per crop (top 4 by volume,
      // rest folded into "Other" in gray). Only REAL recorded yields chart.
      const crops = ((cropsRes.data ?? []) as { crop: string; season_year: number; actual_yield_kg: number | null }[])
        .filter((c) => c.actual_yield_kg !== null)
      const totals = new Map<string, number>()
      for (const c of crops) totals.set(c.crop, (totals.get(c.crop) ?? 0) + Number(c.actual_yield_kg))
      const topCrops = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k)
      const hasOther = totals.size > topCrops.length
      const seasons = [...new Set(crops.map((c) => c.season_year))].sort()
      setYieldRows(
        seasons.map((y) => {
          const row: { season: string; [crop: string]: string | number } = { season: String(y) }
          for (const crop of topCrops) row[crop] = 0
          if (hasOther) row.Other = 0
          for (const c of crops.filter((c) => c.season_year === y)) {
            const key = topCrops.includes(c.crop) ? c.crop : 'Other'
            row[key] = (Number(row[key]) || 0) + Number(c.actual_yield_kg)
          }
          return row
        }),
      )
      setYieldSeries([
        ...topCrops.map((c) => ({ key: c, label: c })),
        ...(hasOther ? [{ key: 'Other', label: t('farm.other'), other: true }] : []),
      ])
      const farms = farmsRes.data ?? []
      setData({
        farmCount: farms.length,
        totalHectares: farms.reduce((sum, f) => sum + Number(f.size_hectares ?? 0), 0),
        verifiedFarms: farms.filter((f) => f.verification_status === 'verified').length,
        activeApplications: appsRes.count ?? 0,
        activity: (activityRes.data as NotificationRow[]) ?? [],
        loading: false,
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [profile])

  const hectares =
    data.totalHectares > 0
      ? `${Number(data.totalHectares.toFixed(1))} ha`
      : 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Tractor} label={t('farm.totalFarms')} value={data.farmCount} sub={t('farm.registeredPlots')} loading={data.loading} />
        <StatCard icon={Ruler} label={t('farm.totalHectares')} value={hectares} sub={t('farm.acrossAllFarms')} loading={data.loading} />
        <StatCard icon={Landmark} label={t('farm.activeApplications')} value={data.activeApplications} sub={t('farm.withPartnerBanks')} loading={data.loading} />
        <StatCard icon={BadgeCheck} label={t('farm.verifiedFarms')} value={`${data.verifiedFarms} / ${data.farmCount}`} sub={t('farm.fieldVerified')} loading={data.loading} />
      </div>

      <DashboardCard title={t('farm.yieldHistoryTitle')}>
        <BarBreakdown data={yieldRows} xKey="season" series={yieldSeries.length ? yieldSeries : [{ key: 'yield', label: t('farm.actualYieldKg') }]} />
      </DashboardCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardCard
          title="Recent activity"
          action={
            data.activity.length > 0 ? (
              <Link
                to="/dashboard/farmer/notifications"
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
              >
                View all
              </Link>
            ) : undefined
          }
        >
          {data.activity.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Bell className="h-7 w-7 text-emerald-900/20" aria-hidden />
              <p className="text-sm text-emerald-900/50">
                {t('farm.noActivityYet')}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-emerald-950/5">
              {data.activity.map((n) => (
                <li key={n.id} className="py-2.5">
                  <p className="text-sm font-medium text-emerald-950">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-xs text-emerald-900/60">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] text-emerald-900/40">{formatDateShort(n.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        <div className="space-y-4">
          <DashboardCard title="Quick actions">
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => navigate('/dashboard/farmer/my-farm/new')}>
                <Plus className="h-4 w-4" aria-hidden /> {t('farm.registerFarm')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/dashboard/farmer/my-farm')}>
                <MapPinned className="h-4 w-4" aria-hidden /> {t('farm.myFarms')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/dashboard/farmer/financing')}>
                <Landmark className="h-4 w-4" aria-hidden /> Financing
              </Button>
            </div>
          </DashboardCard>
          <DashboardCard title={t('farm.howFinancingWorks')}>
            <p className="text-sm leading-relaxed text-emerald-900/70">
              {t('farm.financingExplainer')}
            </p>
          </DashboardCard>
        </div>
      </div>
    </div>
  )
}
