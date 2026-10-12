import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, LifeBuoy, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  TICKET_CATEGORIES, TICKET_STATUS_META,
  type ContentEntry, type SupportMessage, type SupportTicket, type TicketCategory,
} from '@/lib/support'
import { cn, formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

/** User support: published Help/FAQ + open a ticket + track own tickets with a
 * message thread. Real ticketing (replaces the Stage-1 placeholder). */
export default function Support() {
  const { profile } = useAuth()
  const [faq, setFaq] = useState<ContentEntry[]>([])
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null)
  const [openFaq, setOpenFaq] = useState<string | null>(null)
  const [openTicket, setOpenTicket] = useState<string | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [category, setCategory] = useState<TicketCategory>('account')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: f }, { data: t }] = await Promise.all([
      supabase.from('content_entries').select('*').eq('kind', 'faq').eq('published', true).order('sort_order'),
      supabase.from('support_tickets').select('*').order('created_at', { ascending: false }),
    ])
    setFaq((f as ContentEntry[]) ?? [])
    setTickets((t as SupportTicket[]) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function openThread(id: string) {
    if (openTicket === id) { setOpenTicket(null); return }
    setOpenTicket(id)
    const { data } = await supabase.from('support_messages').select('*').eq('ticket_id', id).order('created_at')
    setMessages((data as SupportMessage[]) ?? [])
  }

  async function submitTicket(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!subject.trim() || !body.trim()) return setError('Add a subject and a message.')
    setBusy(true)
    const { error: rpcErr } = await supabase.rpc('loamy_open_ticket', { p_category: category, p_subject: subject.trim(), p_body: body.trim() })
    setBusy(false)
    if (rpcErr) return setError(rpcErr.message)
    setSubject(''); setBody('')
    await load()
  }

  async function sendReply(ticketId: string) {
    if (!reply.trim()) return
    setBusy(true)
    await supabase.rpc('loamy_ticket_reply', { p_ticket: ticketId, p_body: reply.trim() })
    setReply('')
    setBusy(false)
    await openThread(ticketId); await openThread(ticketId) // reload thread
    await load()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {faq.length > 0 && (
        <DashboardCard title="Help & FAQ">
          <ul className="divide-y divide-line">
            {faq.map((f) => (
              <li key={f.id} className="py-1.5">
                <button type="button" onClick={() => setOpenFaq(openFaq === f.id ? null : f.id)} className="flex w-full items-center justify-between gap-2 text-left">
                  <span className="text-sm font-medium text-emerald-950">{f.title}</span>
                  {openFaq === f.id ? <ChevronUp className="h-4 w-4 text-emerald-900/40" aria-hidden /> : <ChevronDown className="h-4 w-4 text-emerald-900/40" aria-hidden />}
                </button>
                {openFaq === f.id && <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-emerald-900/70">{f.body}</p>}
              </li>
            ))}
          </ul>
        </DashboardCard>
      )}

      <DashboardCard title="Contact support">
        <form onSubmit={submitTicket} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <div>
              <Label htmlFor="t_cat">Category</Label>
              <Select id="t_cat" value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
                {TICKET_CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
              </Select>
            </div>
            <div>
              <Label htmlFor="t_subj">Subject</Label>
              <Input id="t_subj" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary" />
            </div>
          </div>
          <div>
            <Label htmlFor="t_body">Message</Label>
            <Textarea id="t_body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe the issue" />
          </div>
          {error && <p className="text-xs text-red-700">{error}</p>}
          <Button type="submit" size="sm" loading={busy}><LifeBuoy className="h-4 w-4" aria-hidden /> Open ticket</Button>
        </form>
      </DashboardCard>

      <DashboardCard title="My tickets">
        {tickets === null ? (
          <div className="h-16 animate-pulse rounded bg-emerald-50" aria-label="Loading tickets" />
        ) : tickets.length === 0 ? (
          <p className="py-2 text-sm text-emerald-900/55">No tickets yet.</p>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => {
              const meta = TICKET_STATUS_META[t.status]
              const isOpen = openTicket === t.id
              return (
                <Card key={t.id} className="border border-line p-3 shadow-none">
                  <button type="button" onClick={() => void openThread(t.id)} className="flex w-full items-center justify-between gap-2 text-left">
                    <div>
                      <p className="text-sm font-medium text-emerald-950">{t.subject}</p>
                      <p className="text-[11px] text-emerald-900/50">{t.category} · {formatDateShort(t.created_at)}</p>
                    </div>
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', meta.chip)}>{meta.label}</span>
                  </button>
                  {isOpen && (
                    <div className="mt-3 space-y-2 border-t border-line pt-3">
                      {t.resolution_note && <p className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">Resolution: {t.resolution_note}</p>}
                      {messages.map((m) => (
                        <div key={m.id} className={cn('rounded px-2.5 py-1.5 text-[13px]', m.sender_id === profile?.id ? 'bg-emerald-50 text-emerald-900' : 'bg-emerald-950/5 text-emerald-900/80')}>
                          <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-900/45">{m.sender_id === profile?.id ? 'You' : 'Loamy team'} · {formatDateShort(m.created_at)}</p>
                          <p className="whitespace-pre-line">{m.body}</p>
                        </div>
                      ))}
                      {t.status !== 'closed' && (
                        <div className="flex gap-2">
                          <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" />
                          <Button size="sm" loading={busy} onClick={() => void sendReply(t.id)}><Send className="h-3.5 w-3.5" aria-hidden /></Button>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </DashboardCard>
    </div>
  )
}
