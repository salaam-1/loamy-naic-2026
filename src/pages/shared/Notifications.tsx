import { useCallback, useEffect, useState } from 'react'
import { BellOff, CheckCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { NotificationRow } from '@/lib/types'
import { cn, formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'

/** Full notifications page — the user's own rows only (RLS-scoped). */
export default function Notifications() {
  const [items, setItems] = useState<NotificationRow[] | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setItems((data as NotificationRow[]) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('read', false)
    await load()
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    await load()
  }

  const unread = items?.filter((n) => !n.read).length ?? 0

  return (
    <div className="mx-auto max-w-2xl">
      <DashboardCard
        title={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        action={
          unread > 0 ? (
            <Button variant="ghost" size="sm" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark all read
            </Button>
          ) : undefined
        }
      >
        {items === null ? (
          <div className="h-24 animate-pulse rounded-lg bg-emerald-50" aria-label="Loading notifications" />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <BellOff className="h-7 w-7 text-emerald-900/20" aria-hidden />
            <p className="text-sm text-emerald-900/50">
              Nothing yet. Verification updates, financing progress, and platform news will land here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-emerald-950/5">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => !n.read && markRead(n.id)}
                  className={cn(
                    'w-full px-1 py-3 text-left transition-colors',
                    !n.read && 'bg-emerald-50/60 hover:bg-emerald-50',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-emerald-950">{n.title}</p>
                    {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gold-400" aria-label="Unread" />}
                  </div>
                  {n.body && <p className="mt-0.5 text-xs leading-relaxed text-emerald-900/60">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-emerald-900/40">{formatDateShort(n.created_at)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>
    </div>
  )
}
