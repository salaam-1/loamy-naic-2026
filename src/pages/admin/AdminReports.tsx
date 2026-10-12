import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, LineChart } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ANALYTICS_MAX_ROWS, analyticsSince, bucketWeekly, type WeekBucket } from '@/lib/charts'
import { TrendLine } from '@/components/charts/TrendLine'
import { BarBreakdown } from '@/components/charts/BarBreakdown'
import { DashboardCard } from '@/components/DashboardCard'
import { Card } from '@/components/ui/card'

/** Reports & analytics hub: platform trends + links to exports and prices. */
export default function AdminReports() {
  const [registrations, setRegistrations] = useState<WeekBucket[]>([])
  const [throughput, setThroughput] = useState<WeekBucket[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Windowed, ordered and capped. See ANALYTICS_WEEKS in lib/charts for
      // why an unwindowed version of this was not merely wasteful but wrong.
      const since = analyticsSince()
      const [{ data: profiles }, { data: tasks }] = await Promise.all([
        supabase
          .from('profiles')
          .select('created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(ANALYTICS_MAX_ROWS),
        supabase
          .from('verification_tasks')
          .select('status, created_at, completed_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(ANALYTICS_MAX_ROWS),
      ])
      if (cancelled) return
      setRegistrations(bucketWeekly((profiles ?? []) as { created_at: string }[], [{ key: 'registrations', date: (r) => r.created_at }]))
      const t = (tasks ?? []) as { status: string; created_at: string; completed_at: string | null }[]
      setThroughput(bucketWeekly(t, [
        { key: 'approved', date: (r) => (r.status === 'approved' ? r.completed_at : null) },
        { key: 'rejected', date: (r) => (r.status === 'rejected' ? r.completed_at : null) },
      ]))
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardCard title="Registrations (weekly, last 26 weeks)">
          <TrendLine data={registrations} series={[{ key: 'registrations', label: 'New users' }]} height={170} />
        </DashboardCard>
        <DashboardCard title="Verification throughput (weekly, last 26 weeks)">
          <BarBreakdown data={throughput} xKey="week" series={[{ key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }]} height={170} />
        </DashboardCard>
      </div>

      <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
        <p className="mr-auto text-sm text-emerald-900/70">Detailed data exports and reference market prices:</p>
        <Link to="/admin/exports" className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-50">
          <Download className="h-3.5 w-3.5" aria-hidden /> CSV exports
        </Link>
        <Link to="/admin/market-prices" className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-50">
          <LineChart className="h-3.5 w-3.5" aria-hidden /> Market prices
        </Link>
      </Card>
    </div>
  )
}
