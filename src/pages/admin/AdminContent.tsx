import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { FileText, Plus, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { ContentEntry } from '@/lib/support'
import { cn } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

/** Content management: admin-managed Help/FAQ and notices. Published entries
 * appear to members (FAQ on the Support page). */
export default function AdminContent() {
  const { profile } = useAuth()
  const [entries, setEntries] = useState<ContentEntry[] | null>(null)
  const [kind, setKind] = useState<'faq' | 'notice' | 'page'>('faq')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('content_entries').select('*').order('kind').order('sort_order')
    setEntries((data as ContentEntry[]) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!title.trim() || !body.trim()) return setMsg('Title and body are required.')
    setBusy('add')
    const { error } = await supabase.from('content_entries').insert({
      kind, title: title.trim(), body: body.trim(), sort_order: Number(sortOrder) || 0, updated_by: profile?.id,
    })
    setBusy(null)
    if (error) return setMsg(error.message)
    setTitle(''); setBody('')
    await load()
  }

  async function togglePublish(en: ContentEntry) {
    setBusy(en.id)
    await supabase.from('content_entries').update({ published: !en.published }).eq('id', en.id)
    setBusy(null)
    await load()
  }

  async function remove(en: ContentEntry) {
    if (!window.confirm(`Delete "${en.title}"?`)) return
    await supabase.from('content_entries').delete().eq('id', en.id)
    await load()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <DashboardCard title="Add content">
        <form onSubmit={add} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr_8rem]">
            <div>
              <Label htmlFor="c_kind">Kind</Label>
              <Select id="c_kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="faq">FAQ</option>
                <option value="notice">Notice</option>
                <option value="page">Page</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="c_title">Title</Label>
              <Input id="c_title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="c_sort">Order</Label>
              <Input id="c_sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="c_body">Body</Label>
            <Textarea id="c_body" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {msg && <p className="text-xs text-red-700">{msg}</p>}
          <Button type="submit" size="sm" loading={busy === 'add'}><Plus className="h-4 w-4" aria-hidden /> Add (unpublished)</Button>
        </form>
      </DashboardCard>

      <DashboardCard title={`Content (${entries?.length ?? 0})`}>
        {entries === null ? (
          <div className="h-16 animate-pulse rounded bg-emerald-50" aria-label="Loading content" />
        ) : entries.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-emerald-900/55"><FileText className="h-4 w-4" aria-hidden /> No content yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((en) => (
              <li key={en.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-emerald-950">{en.title}</p>
                  <p className="text-[11px] uppercase tracking-wide text-emerald-900/45">{en.kind} · order {en.sort_order}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={busy === en.id} onClick={() => togglePublish(en)}
                    className={cn('flex items-center gap-1 rounded px-2 py-1 text-xs font-medium', en.published ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-emerald-950/5 text-emerald-900/55')}>
                    {en.published ? <ToggleRight className="h-4 w-4" aria-hidden /> : <ToggleLeft className="h-4 w-4" aria-hidden />}
                    {en.published ? 'Published' : 'Draft'}
                  </button>
                  <button type="button" onClick={() => remove(en)} className="rounded p-1 text-emerald-900/35 hover:bg-red-50 hover:text-red-600" aria-label="Delete">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>
    </div>
  )
}
