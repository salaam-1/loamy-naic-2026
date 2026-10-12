import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatDateShort } from '@/lib/utils'
import { AdminSystemHealth } from '@/components/AdminSystemHealth'
import { DashboardCard } from '@/components/DashboardCard'
import { StatCard } from '@/components/StatCard'

interface AuditRow { id: string; event_type: string; actor_role: string | null; created_at: string }

/** System monitoring: live service health + recent platform events. */
export default function AdminMonitoring() {
  const [events, setEvents] = useState<AuditRow[]>([])
  const [counts, setCounts] = useState<{ today: number; total: number }>({ today: 0, total: 0 })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const since = new Date(); since.setHours(0, 0, 0, 0)
      const [{ data: ev }, { count: total }, { count: today }] = await Promise.all([
        supabase.from('audit_events').select('id, event_type, actor_role, created_at').order('created_at', { ascending: false }).limit(20),
        supabase.from('audit_events').select('id', { count: 'exact', head: true }),
        supabase.from('audit_events').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString()),
      ])
      if (cancelled) return
      setEvents((ev as AuditRow[]) ?? [])
      setCounts({ today: today ?? 0, total: total ?? 0 })
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard icon={Activity} label="Audited events (today)" value={counts.today} sub="platform activity" />
        <StatCard icon={Activity} label="Audited events (total)" value={counts.total} sub="all time" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminSystemHealth />
        <DashboardCard title="Recent platform events">
          {events.length === 0 ? (
            <p className="py-2 text-sm text-emerald-900/55">No events yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {events.map((e) => (
                <li key={e.id} className="py-1.5">
                  <span className="font-mono text-[12px] text-emerald-700">{e.event_type}</span>
                  <span className="text-emerald-900/50"> · {e.actor_role ?? 'system'} · {formatDateShort(e.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      </div>
    </div>
  )
}
