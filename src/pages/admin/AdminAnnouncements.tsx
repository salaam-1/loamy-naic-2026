import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Megaphone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PLATFORM_ROLE_SLUGS } from '@/lib/types'
import { formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface AnnouncementEvent {
  id: string
  detail: { title?: string; segment?: string; recipients?: number }
  created_at: string
}

/** Announcements: plain text, batched into notifications, audit-logged. */
export default function AdminAnnouncements() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [segment, setSegment] = useState('')
  const [recent, setRecent] = useState<AnnouncementEvent[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('audit_events')
      .select('id, detail, created_at')
      .eq('event_type', 'announcement_sent')
      .order('created_at', { ascending: false })
      .limit(15)
    setRecent((data as AnnouncementEvent[]) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function send(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!title.trim()) return setMsg({ ok: false, text: 'Title is required.' })
    const target = segment ? segment.replaceAll('_', ' ') + 's' : 'all active users'
    if (!window.confirm(`Send this announcement to ${target}?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('loamy_announce', {
      p_title: title.trim(),
      p_body: body.trim(),
      p_role: segment || null,
    })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: error.message })
    setMsg({ ok: true, text: `Sent to ${data} recipient(s).` })
    setTitle('')
    setBody('')
    await load()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <DashboardCard title="Send announcement">
        <form onSubmit={send} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <div>
              <Label htmlFor="an_title">Title</Label>
              <Input id="an_title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scheduled maintenance on 25 Jul" />
            </div>
            <div>
              <Label htmlFor="an_seg">Audience</Label>
              <Select id="an_seg" value={segment} onChange={(e) => setSegment(e.target.value)}>
                <option value="">All active users</option>
                {PLATFORM_ROLE_SLUGS.map((r) => (
                  <option key={r} value={r}>{r.replaceAll('_', ' ')}s</option>
                ))}
                <option value="bank">bank officers</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="an_body">Body</Label>
            <Textarea id="an_body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Plain text. Keep it terse." />
          </div>
          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'rounded bg-emerald-50 px-2.5 py-1.5 text-sm text-emerald-800' : 'rounded bg-red-50 px-2.5 py-1.5 text-sm text-red-700'}>
              {msg.text}
            </p>
          )}
          <Button type="submit" size="sm" loading={busy}>
            <Megaphone className="h-4 w-4" aria-hidden /> Send
          </Button>
        </form>
      </DashboardCard>

      <DashboardCard title="Recent announcements">
        {recent.length === 0 ? (
          <p className="py-2 text-sm text-emerald-900/55">None sent yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {recent.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="truncate text-emerald-950">{a.detail.title ?? '-'}</span>
                <span className="whitespace-nowrap text-[11px] text-emerald-900/50">
                  {a.detail.segment ?? 'all'} · <span className="font-mono">{a.detail.recipients ?? 0}</span> · {formatDateShort(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>
    </div>
  )
}
