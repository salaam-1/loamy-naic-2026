import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, ClipboardList, MapPinned, ShieldCheck, Sprout, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { PAYOUT_COPY, type PartnerAssignment } from '@/lib/partner'
import type { NotificationRow } from '@/lib/types'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { StatCard } from '@/components/StatCard'
import { DashboardCard } from '@/components/DashboardCard'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { FunnelSteps } from '@/components/charts/FunnelSteps'
import { TrendLine } from '@/components/charts/TrendLine'
import { BarBreakdown } from '@/components/charts/BarBreakdown'
import { bucketWeekly, type WeekBucket } from '@/lib/charts'

interface OverviewData {
  onboarded: number
  verificationsCompleted: number
  accrued: number
  territory: string
  activity: NotificationRow[]
  loading: boolean
}

/**
 * Growth Partner overview — every stat is a live query. No conversion funnel:
 * it is only shown when computable from real data, and at pilot start it
 * is not — so it is omitted, never faked.
 */
export default function GrowthPartnerOverview() {
  const { t, tOr } = useT()
  const { profile, canVerify } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState<OverviewData>({
    onboarded: 0, verificationsCompleted: 0, accrued: 0, territory: '-', activity: [], loading: true,
  })
  const [funnel, setFunnel] = useState<{ label: string; value: number }[]>([])
  const [earningsTrend, setEarningsTrend] = useState<WeekBucket[]>([])
  const [earningsByType, setEarningsByType] = useState<{ onboarding: number; verification: number }>({ onboarding: 0, verification: 0 })
  const [territoryLgas, setTerritoryLgas] = useState<{ lga: string; farmers: number }[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!profile) return
      const [onboardedRes, tasksRes, earningsRes, territoryRes, activityRes, funnelRes, lgaRes] = await Promise.all([
        supabase.from('onboarded_farmers').select('id', { count: 'exact', head: true }).eq('partner_id', profile.id),
        supabase.from('verification_tasks').select('id', { count: 'exact', head: true }).eq('assigned_to', profile.id).eq('status', 'approved'),
        supabase.from('partner_earnings').select('amount, status, earning_type, created_at'),
        supabase.from('partner_assignments').select('*').eq('active', true),
        supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(8),
        supabase.rpc('loamy_partner_funnel'),
        supabase.rpc('loamy_partner_territory'),
      ])
      if (cancelled) return

      const f = (funnelRes.data ?? {}) as Record<string, number>
      setFunnel([
        { label: t('verification.gp.registered'), value: f.registered ?? 0 },
        { label: t('verification.gp.profileCompleted'), value: f.profile_completed ?? 0 },
        { label: t('verification.gp.verified'), value: f.verified ?? 0 },
        { label: t('verification.gp.active30d'), value: f.active ?? 0 },
      ])
      setTerritoryLgas((lgaRes.data as { lga: string; farmers: number }[]) ?? [])

      const earningRows = (earningsRes.data ?? []) as { amount: number; earning_type: string; created_at: string }[]
      setEarningsTrend(
        bucketWeekly(earningRows, [
          { key: 'accrued', date: (r) => r.created_at, value: (r) => Number(r.amount) },
        ]),
      )
      setEarningsByType({
        onboarding: earningRows.filter((r) => r.earning_type === 'onboarding').reduce((s, r) => s + Number(r.amount), 0),
        verification: earningRows.filter((r) => r.earning_type === 'verification').reduce((s, r) => s + Number(r.amount), 0),
      })
      const territories = (territoryRes.data as PartnerAssignment[]) ?? []
      setData({
        onboarded: onboardedRes.count ?? 0,
        verificationsCompleted: tasksRes.count ?? 0,
        accrued: (earningsRes.data ?? [])
          .filter((e) => e.status === 'accrued')
          .reduce((s, e) => s + Number(e.amount), 0),
        territory:
          territories.length === 0
            ? 'Not assigned yet'
            : territories.map((t) => (t.lgas.length ? `${t.state} (${t.lgas.length} LGAs)` : t.state)).join(', '),
        activity: (activityRes.data as NotificationRow[]) ?? [],
        loading: false,
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [profile])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label={t('verification.gp.farmersOnboarded')} value={data.onboarded} sub={t('verification.gp.attributedToYou')} loading={data.loading} />
        {canVerify && (
          <StatCard icon={ShieldCheck} label={t('verification.gp.verifications')} value={data.verificationsCompleted} sub={t('verification.gp.approvedByReview')} loading={data.loading} />
        )}
        <StatCard icon={ClipboardList} label={t('verification.gp.accruedEarnings')} value={formatNaira(data.accrued)} sub={t('verification.gp.trackedPaidOffPlatform')} loading={data.loading} />
        <StatCard icon={MapPinned} label={t('verification.gp.territory')} value={data.territory} sub={t('verification.gp.activeAssignment')} loading={data.loading} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardCard title={t('verification.gp.onboardingFunnel')}>
          <FunnelSteps steps={funnel} />
        </DashboardCard>
        <DashboardCard
          title={t('verification.gp.earningsChart')}
          action={
            <span className="flex gap-1.5 text-[11px]">
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
                Onboarding <span className="font-mono">₦{earningsByType.onboarding.toLocaleString('en-NG')}</span>
              </span>
              <span className="rounded bg-gold-100 px-1.5 py-0.5 font-medium text-gold-700">
                Verification <span className="font-mono">₦{earningsByType.verification.toLocaleString('en-NG')}</span>
              </span>
            </span>
          }
        >
          <TrendLine data={earningsTrend} series={[{ key: 'accrued', label: t('verification.gp.accruedNaira') }]} />
        </DashboardCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardCard title={t('verification.gp.territoryPerLga')}>
          <BarBreakdown
            data={territoryLgas.map((t) => ({ lga: t.lga, farmers: t.farmers }))}
            xKey="lga"
            series={[{ key: 'farmers', label: t('verification.gp.farmers') }]}
          />
        </DashboardCard>
        <DashboardCard title={t('verification.gp.recentActivity')}>
          {data.activity.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Bell className="h-7 w-7 text-emerald-900/20" aria-hidden />
              <p className="text-sm text-emerald-900/50">{t('verification.gp.noActivityYet')}</p>
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
          <DashboardCard title={t('verification.gp.quickActions')}>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => navigate('/dashboard/growth_partner/onboard')}>
                <Users className="h-4 w-4" aria-hidden /> Onboard a farmer
              </Button>
              {canVerify && (
                <Button variant="outline" onClick={() => navigate('/dashboard/growth_partner/verification-tasks')}>
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Verification tasks
                </Button>
              )}
              <Button variant="outline" onClick={() => navigate('/dashboard/growth_partner/my-farmers')}>
                <Sprout className="h-4 w-4" aria-hidden /> My farmers
              </Button>
            </div>
          </DashboardCard>
          <DashboardCard title={t('verification.gp.howEarningsWork')}>
            <p className="text-sm leading-relaxed text-emerald-900/70">
              {t('verification.gp.commissionExplainer')}{' '}
              {tOr('verification.payoutCopy', PAYOUT_COPY)}
            </p>
          </DashboardCard>
        </div>
      </div>
    </div>
  )
}
