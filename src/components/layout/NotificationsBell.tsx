import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { NotificationRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * Real notifications only — reads the user's own rows (RLS-scoped) from the
 * `notifications` table. New accounts correctly see zero.
 */
export function NotificationsBell() {
  const { t } = useT()
  const { session, profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!session) return
    const [{ data: rows }, { count }] = await Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('read', false),
    ])
    setItems((rows as NotificationRow[]) ?? [])
    setUnread(count ?? 0)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('read', false)
    await load()
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        className="relative flex h-10 w-10 min-h-touch min-w-touch items-center justify-center rounded-full text-emerald-900/70 transition-colors hover:bg-emerald-50 hover:text-emerald-900"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-400 px-1 text-[10px] font-bold text-emerald-950">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-card border border-emerald-950/5 bg-white shadow-card-hover">
          <div className="flex items-center justify-between border-b border-emerald-950/5 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-950">Notifications</p>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead}>
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                {t('notifications.markAllRead')}
              </Button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <Inbox className="h-8 w-8 text-emerald-900/20" aria-hidden />
                <p className="text-sm text-emerald-900/50">
                  {t('notifications.noneYet')}
                </p>
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'border-b border-emerald-950/5 px-4 py-3 last:border-b-0',
                    !n.read && 'bg-emerald-50/60',
                  )}
                >
                  <p className="text-sm font-medium text-emerald-950">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-xs text-emerald-900/60">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-emerald-900/40">
                    {new Date(n.created_at).toLocaleString('en-NG', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              ))
            )}
          </div>
          {/* Full notifications page is a shared section for every role. */}
          {profile?.platform_role && (
            <Link
              to={`/dashboard/${profile.platform_role}/notifications`}
              onClick={() => setOpen(false)}
              className="block border-t border-emerald-950/5 px-4 py-2.5 text-center text-xs font-semibold text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
            >
              {t('notifications.viewAll')}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
