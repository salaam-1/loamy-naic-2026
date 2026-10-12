import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, BadgeCheck, Building2, Coins, Download, FileText, Landmark, Megaphone,
  Receipt, Settings2, Store, TrendingUp, Users,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { PlatformMetrics, PlatformTransaction } from '@/lib/ledger'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { StatCard } from '@/components/StatCard'
import { DashboardCard } from '@/components/DashboardCard'
import { AdminSystemHealth } from '@/components/AdminSystemHealth'
import { TrendLine } from '@/components/charts/TrendLine'
import { BarBreakdown } from '@/components/charts/BarBreakdown'
import { DonutSplit } from '@/components/charts/DonutSplit'
import { ANALYTICS_MAX_ROWS, analyticsSince, bucketWeekly, type WeekBucket } from '@/lib/charts'

interface AdminStats {
  users_total: number
  users_active: number
  users_by_role: Record<string, number>
  verifications: { pending: number; approved: number; rejected: number; avg_turnaround_days: number | null }
  active_listings: number
  applications_by_status: Record<string, number>
  facilities_monitored: number
  banks_active: number
}

interface AuditRow {
  id: string
  actor_role: string | null
  event_type: string
  subject_type: string | null
  detail: Record<string, unknown>
  created_at: string
}

interface Announcement {
  detail: { title?: string; segment?: string; recipients?: number }
  created_at: string
}

const QUICK_ACTIONS = [
  { label: 'Create announcement', icon: Megaphone, to: '/admin/announcements' },
  { label: 'Manage users & roles', icon: Users, to: '/admin/users' },
  { label: 'View exports', icon: Download, to: '/admin/exports' },
  { label: 'Configuration', icon: Settings2, to: '/admin/configuration' },
]

/** Admin home — every number is a live query; the stream is the audit trail. */
export default function AdminHome() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [events, setEvents] = useState<AuditRow[]>([])
  const [registrations, setRegistrations] = useState<WeekBucket[]>([])
  const [throughput, setThroughput] = useState<WeekBucket[]>([])
  const [volume, setVolume] = useState<WeekBucket[]>([])
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null)
  const [financeSeries, setFinanceSeries] = useState<WeekBucket[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: s }, { data: ev }, profilesRes, tasksRes, listingsRes, appsRes, annRes] = await Promise.all([
        supabase.rpc('loamy_admin_stats'),
        supabase.from('audit_events').select('*').order('created_at', { ascending: false }).limit(10),
        // Windowed + ordered + capped: these feed weekly trend charts, not
        // lists, and an unwindowed select was returning an arbitrary 1000-row
        // slice of history. See ANALYTICS_WEEKS in lib/charts.
        supabase.from('profiles').select('created_at')
          .gte('created_at', analyticsSince()).order('created_at', { ascending: false }).limit(ANALYTICS_MAX_ROWS),
        supabase.from('verification_tasks').select('status, created_at, completed_at')
          .gte('created_at', analyticsSince()).order('created_at', { ascending: false }).limit(ANALYTICS_MAX_ROWS),
        supabase.from('listings').select('created_at')
          .gte('created_at', analyticsSince()).order('created_at', { ascending: false }).limit(ANALYTICS_MAX_ROWS),
        supabase.from('financing_applications').select('created_at, status').neq('status', 'draft')
          .gte('created_at', analyticsSince()).order('created_at', { ascending: false }).limit(ANALYTICS_MAX_ROWS),
        supabase.from('audit_events').select('detail, created_at').eq('event_type', 'announcement_sent').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      const [{ data: m }, txnRes] = await Promise.all([
        supabase.rpc('loamy_platform_metrics'),
        supabase.from('platform_transactions').select('txn_type, gross_amount, occurred_on')
          .gte('occurred_on', analyticsSince().slice(0, 10)).order('occurred_on', { ascending: false }).limit(ANALYTICS_MAX_ROWS),
      ])
      if (cancelled) return
      setStats(s as AdminStats)
      setEvents((ev as AuditRow[]) ?? [])
      setAnnouncement((annRes.data as Announcement) ?? null)
      setMetrics(m as PlatformMetrics)

      const txns = (txnRes.data ?? []) as Pick<PlatformTransaction, 'txn_type' | 'gross_amount' | 'occurred_on'>[]
      setFinanceSeries(
        bucketWeekly(txns, [
          { key: 'gmv', date: (r) => (r.txn_type === 'marketplace_settlement' ? r.occurred_on : null), value: (r) => Number(r.gross_amount) },
          { key: 'disbursed', date: (r) => (r.txn_type === 'facility_disbursement' ? r.occurred_on : null), value: (r) => Number(r.gross_amount) },
        ]),
      )

      setRegistrations(
        bucketWeekly((profilesRes.data ?? []) as { created_at: string }[], [
          { key: 'registrations', date: (r) => r.created_at },
        ]),
      )
      const tasks = (tasksRes.data ?? []) as { status: string; created_at: string; completed_at: string | null }[]
      setThroughput(
        bucketWeekly(tasks, [
          { key: 'approved', date: (r) => (r.status === 'approved' ? r.completed_at : null) },
          { key: 'rejected', date: (r) => (r.status === 'rejected' ? r.completed_at : null) },
          { key: 'pending', date: (r) => (['approved', 'rejected'].includes(r.status) ? null : r.created_at) },
        ]),
      )
      type Stamp = { created_at: string; kind: string }
      const vol: Stamp[] = [
        ...((listingsRes.data ?? []) as { created_at: string }[]).map((l) => ({ created_at: l.created_at, kind: 'listing' })),
        ...((appsRes.data ?? []) as { created_at: string }[]).map((a) => ({ created_at: a.created_at, kind: 'application' })),
      ]
      setVolume(
        bucketWeekly(vol, [
          { key: 'listings', date: (r) => (r.kind === 'listing' ? r.created_at : null) },
          { key: 'applications', date: (r) => (r.kind === 'application' ? r.created_at : null) },
        ]),
      )
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const apps = stats?.applications_by_status ?? {}
  const appsTotal = Object.entries(apps).filter(([k]) => k !== 'draft').reduce((s, [, n]) => s + n, 0)

  const roleDonut = Object.entries(stats?.users_by_role ?? {})
    .map(([role, n]) => ({ name: role.replaceAll('_', ' '), value: n }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="space-y-4">
      {announcement && (
        <div className="flex items-start gap-2 rounded border border-line bg-emerald-50/60 px-3 py-2">
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
          <p className="text-[13px] text-emerald-900/80">
            <span className="font-semibold text-emerald-950">Latest announcement:</span>{' '}
            {announcement.detail.title}
            <span className="text-emerald-900/45">
              {' '}· {announcement.detail.segment ?? 'all'} · {announcement.detail.recipients ?? 0} recipients · {formatDateShort(announcement.created_at)}
            </span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Users} label="Users" value={stats?.users_total ?? 0} sub={`${stats?.users_active ?? 0} active`} loading={!stats} />
        <StatCard icon={BadgeCheck} label="Verifications" value={`${stats?.verifications.approved ?? 0} / ${(stats?.verifications.approved ?? 0) + (stats?.verifications.pending ?? 0) + (stats?.verifications.rejected ?? 0)}`} sub={stats?.verifications.avg_turnaround_days != null ? `avg ${stats.verifications.avg_turnaround_days}d turnaround` : `${stats?.verifications.pending ?? 0} pending`} loading={!stats} />
        <StatCard icon={Store} label="Active listings" value={stats?.active_listings ?? 0} sub="marketplace" loading={!stats} />
        <StatCard icon={Landmark} label="Applications" value={appsTotal} sub={`${apps.submitted ?? 0} submitted · ${apps.under_review ?? 0} in review`} loading={!stats} />
        <StatCard icon={Activity} label="Monitored" value={stats?.facilities_monitored ?? 0} sub="facilities" loading={!stats} />
        <StatCard icon={Building2} label="Banks" value={stats?.banks_active ?? 0} sub="active partners" loading={!stats} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardCard title="Registrations (weekly, last 26 weeks)">
          <TrendLine data={registrations} series={[{ key: 'registrations', label: 'New users' }]} height={160} />
        </DashboardCard>
        <DashboardCard title="Verification throughput (weekly, last 26 weeks)">
          <BarBreakdown
            data={throughput}
            xKey="week"
            series={[
              { key: 'approved', label: 'Approved' },
              { key: 'rejected', label: 'Rejected' },
              { key: 'pending', label: 'Opened', other: true },
            ]}
            height={160}
          />
        </DashboardCard>
        <DashboardCard title="Listings & applications (weekly, last 26 weeks)">
          <TrendLine
            data={volume}
            series={[
              { key: 'listings', label: 'Listings' },
              { key: 'applications', label: 'Applications' },
            ]}
            height={160}
          />
        </DashboardCard>
      </div>

      {/* Financial (Phase 2) — REAL figures from the record-only ledger; zero
          until settlements/disbursements are recorded. GMV = marketplace
          settlements; revenue = recorded platform fees. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Coins} label="GMV (MTD)" value={formatNaira(metrics?.gmv_mtd ?? 0)} sub="marketplace settlements" loading={!metrics} />
        <StatCard icon={Landmark} label="Financing disbursed (MTD)" value={formatNaira(metrics?.financing_disbursed_mtd ?? 0)} sub="recorded, bank rails" loading={!metrics} />
        <StatCard icon={TrendingUp} label="Platform revenue (MTD)" value={formatNaira(metrics?.revenue_mtd ?? 0)} sub="recorded fees" loading={!metrics} />
        <StatCard icon={Receipt} label="Transactions (MTD)" value={metrics?.txn_count_mtd ?? 0} sub={`${metrics?.txn_count_total ?? 0} all-time`} loading={!metrics} />
      </div>

      <DashboardCard title="GMV & financing volume (weekly, last 26 weeks, ₦)">
        <TrendLine
          data={financeSeries}
          series={[{ key: 'gmv', label: 'GMV (settlements)' }, { key: 'disbursed', label: 'Financing disbursed' }]}
          height={170}
        />
      </DashboardCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardCard title="Users by role">
          {stats && <DonutSplit data={roleDonut} />}
        </DashboardCard>
        <AdminSystemHealth />
        <DashboardCard title="Quick actions">
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((a) => {
              const Icon = a.icon
              return (
                <Link
                  key={a.to}
                  to={a.to}
                  className="flex items-center gap-2 rounded border border-line px-2.5 py-2 text-xs font-medium text-emerald-900 transition-colors hover:bg-emerald-50"
                >
                  <Icon className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden /> {a.label}
                </Link>
              )
            })}
          </div>
        </DashboardCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-1">
        <DashboardCard title="Recent activity">
          {events.length === 0 ? (
            <p className="py-2 text-sm text-emerald-900/55">No audited events yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {events.map((e) => (
                <li key={e.id} className="py-1.5">
                  <p className="text-emerald-950">
                    <span className="font-mono text-[12px] text-emerald-700">{e.event_type}</span>
                    <span className="text-emerald-900/50"> · {e.actor_role ?? 'system'} · {formatDateShort(e.created_at)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      </div>
    </div>
  )
}
