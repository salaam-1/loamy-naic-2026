import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Megaphone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { NotificationRow } from '@/lib/types'
import { cn, formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/** Admin notifications: the admin's own platform notifications + a shortcut to
 * compose announcements. */
export default function AdminNotifications() {
  const [items, setItems] = useState<NotificationRow[] | null>(null)

  async function load() {
    const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
    setItems((data as NotificationRow[]) ?? [])
  }

  useEffect(() => { void load() }, [])

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('read', false)
    await load()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <Card className="flex items-center justify-between gap-3 px-4 py-2.5">
        <p className="text-sm text-emerald-900/70">Broadcast a message to members:</p>
        <Link to="/admin/announcements" className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-50">
          <Megaphone className="h-3.5 w-3.5" aria-hidden /> Announcements
        </Link>
      </Card>

      <DashboardCard
        title="My notifications"
        action={items && items.some((n) => !n.read) ? <Button size="sm" variant="ghost" onClick={markAllRead}>Mark all read</Button> : undefined}
      >
        {items === null ? (
          <div className="h-16 animate-pulse rounded bg-emerald-50" aria-label="Loading" />
        ) : items.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-emerald-900/55"><Bell className="h-4 w-4" aria-hidden /> No notifications.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className={cn('py-2', !n.read && 'rounded bg-emerald-50/50 px-2')}>
                <p className="text-sm font-medium text-emerald-950">{n.title}</p>
                {n.body && <p className="mt-0.5 text-xs text-emerald-900/60">{n.body}</p>}
                <p className="mt-0.5 text-[11px] text-emerald-900/40">{n.type} · {formatDateShort(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>
    </div>
  )
}
