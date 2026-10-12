import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, LifeBuoy, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import { TICKET_STATUS_META, type SupportMessage, type SupportTicket } from '@/lib/support'
import { cn, formatDateShort } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { DashboardCard } from '@/components/DashboardCard'
import { NoteDialog } from '@/components/NoteDialog'

/** Admin disputes/support queue: view tickets, reply, resolve/close. */
export default function AdminSupport() {
  const { profile } = useAuth()
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null)
  const [people, setPeople] = useState<Record<string, PublicProfile>>({})
  const [statusF, setStatusF] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false })
    const rows = (data as SupportTicket[]) ?? []
    setTickets(rows)
    setPeople(await fetchPublicProfiles(rows.map((t) => t.opener_id)))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function openThread(id: string) {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    const { data } = await supabase.from('support_messages').select('*').eq('ticket_id', id).order('created_at')
    setMessages((data as SupportMessage[]) ?? [])
  }

  async function sendReply(id: string) {
    if (!reply.trim()) return
    setBusy(true)
    await supabase.rpc('loamy_ticket_reply', { p_ticket: id, p_body: reply.trim() })
    setReply('')
    setBusy(false)
    const { data } = await supabase.from('support_messages').select('*').eq('ticket_id', id).order('created_at')
    setMessages((data as SupportMessage[]) ?? [])
    await load()
  }

  async function resolve(id: string, status: 'in_progress' | 'resolved' | 'closed') {
    if (status === 'resolved') { setResolving(id); return }
    setBusy(true)
    await supabase.rpc('loamy_admin_resolve_ticket', { p_ticket: id, p_status: status, p_note: null })
    setBusy(false)
    await load()
  }

  const filtered = (tickets ?? []).filter((t) => !statusF || t.status === statusF)
  const openCount = (tickets ?? []).filter((t) => t.status === 'open').length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-base font-semibold text-emerald-950">
          Disputes & support <span className="font-mono text-sm font-normal text-emerald-900/50">{filtered.length}</span>
          {openCount > 0 && <span className="ml-2 text-xs font-normal text-gold-600">{openCount} open</span>}
        </h1>
        <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-40" aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(TICKET_STATUS_META).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
        </Select>
      </div>

      {tickets === null ? (
        <div className="h-32 animate-pulse rounded bg-white" aria-label="Loading tickets" />
      ) : filtered.length === 0 ? (
        <Card className="flex items-center gap-2.5 px-4 py-4">
          <LifeBuoy className="h-5 w-5 text-emerald-700" aria-hidden />
          <p className="text-sm text-emerald-900/60">No tickets match. New tickets from members appear here.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const meta = TICKET_STATUS_META[t.status]
            const isOpen = open === t.id
            return (
              <Card key={t.id} className="p-4">
                <button type="button" onClick={() => void openThread(t.id)} className="flex w-full items-center justify-between gap-3 text-left">
                  <div>
                    <p className="text-sm font-medium text-emerald-950">{t.subject}</p>
                    <p className="text-[11px] text-emerald-900/50">{people[t.opener_id]?.full_name ?? '-'} · {t.category} · {formatDateShort(t.created_at)}</p>
                  </div>
                  <span className="flex items-center gap-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', meta.chip)}>{meta.label}</span>
                    {isOpen ? <ChevronUp className="h-4 w-4 text-emerald-900/40" aria-hidden /> : <ChevronDown className="h-4 w-4 text-emerald-900/40" aria-hidden />}
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    {messages.map((m) => (
                      <div key={m.id} className={cn('rounded px-2.5 py-1.5 text-[13px]', m.sender_id === profile?.id ? 'bg-emerald-50 text-emerald-900' : 'bg-emerald-950/5 text-emerald-900/80')}>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-900/45">{m.sender_id === profile?.id ? 'You (admin)' : people[t.opener_id]?.full_name ?? 'Member'} · {formatDateShort(m.created_at)}</p>
                        <p className="whitespace-pre-line">{m.body}</p>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to member…" />
                      <Button size="sm" loading={busy} onClick={() => void sendReply(t.id)}><Send className="h-3.5 w-3.5" aria-hidden /></Button>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {t.status !== 'in_progress' && <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve(t.id, 'in_progress')}>Mark in progress</Button>}
                      {t.status !== 'resolved' && <Button size="sm" disabled={busy} onClick={() => resolve(t.id, 'resolved')}>Resolve</Button>}
                      {t.status !== 'closed' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => resolve(t.id, 'closed')}>Close</Button>}
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <NoteDialog
        open={!!resolving}
        onClose={() => setResolving(null)}
        title="Resolve ticket"
        label="Resolution note (optional)"
        placeholder="How was this resolved?"
        submitLabel="Resolve"
        onSubmit={async (note) => {
          if (!resolving) return
          const { error } = await supabase.rpc('loamy_admin_resolve_ticket', { p_ticket: resolving, p_status: 'resolved', p_note: note })
          if (error) throw new Error(error.message)
          await load()
        }}
      />
    </div>
  )
}
