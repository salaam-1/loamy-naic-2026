import { useCallback, useEffect, useState } from 'react'
import { Download, ScrollText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { downloadCsv } from '@/lib/csv'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

interface AuditRow {
  id: string
  actor_id: string | null
  actor_role: string | null
  event_type: string
  subject_type: string | null
  subject_id: string | null
  detail: Record<string, unknown>
  created_at: string
}

/** Audit trail viewer: admin-only reads, definer-only writes, CSV export. */
export default function AdminAudit() {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [typeF, setTypeF] = useState('')
  const [roleF, setRoleF] = useState('')
  const [dateF, setDateF] = useState('')
  const [types, setTypes] = useState<string[]>([])

  const load = useCallback(async () => {
    let query = supabase.from('audit_events').select('*').order('created_at', { ascending: false }).limit(300)
    if (typeF) query = query.eq('event_type', typeF)
    if (roleF) query = query.eq('actor_role', roleF)
    if (dateF) query = query.gte('created_at', dateF).lt('created_at', `${dateF}T23:59:59Z`)
    const { data } = await query
    const list = (data as AuditRow[]) ?? []
    setRows(list)
    setTypes((prev) => [...new Set([...prev, ...list.map((r) => r.event_type)])].sort())
  }, [typeF, roleF, dateF])

  useEffect(() => {
    void load()
  }, [load])

  async function exportCsv() {
    if (!rows) return
    await downloadCsv(
      'audit-events',
      ['created_at', 'event_type', 'actor_role', 'actor_id', 'subject_type', 'subject_id', 'detail'],
      rows.map((r) => [r.created_at, r.event_type, r.actor_role, r.actor_id, r.subject_type, r.subject_id, JSON.stringify(r.detail)]),
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-base font-semibold text-emerald-950">
          Audit trail <span className="font-mono text-sm font-normal text-emerald-900/50">{rows?.length ?? ''}</span>
        </h1>
        <Select value={typeF} onChange={(e) => setTypeF(e.target.value)} className="w-52" aria-label="Filter by event type">
          <option value="">All event types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
        <Select value={roleF} onChange={(e) => setRoleF(e.target.value)} className="w-36" aria-label="Filter by actor role">
          <option value="">All actors</option>
          {['admin', 'bank', 'growth_partner', 'farmer', 'system'].map((r) => (
            <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>
          ))}
        </Select>
        <Input type="date" value={dateF} onChange={(e) => setDateF(e.target.value)} className="w-40" aria-label="Filter by date" />
        <Button size="sm" variant="outline" onClick={() => void exportCsv()}>
          <Download className="h-3.5 w-3.5" aria-hidden /> CSV
        </Button>
      </div>

      {rows === null ? (
        <div className="h-32 animate-pulse rounded bg-white" aria-label="Loading audit trail" />
      ) : rows.length === 0 ? (
        <Card className="flex items-center gap-2.5 px-4 py-4">
          <ScrollText className="h-5 w-5 text-emerald-700" aria-hidden />
          <p className="text-sm text-emerald-900/60">No events match. Key mutations are logged here automatically.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Event</th>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Subject</th>
                <th className="hidden px-4 py-2 font-medium lg:table-cell">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[12px] text-emerald-900/70">
                    {new Date(r.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px] font-medium text-emerald-800">{r.event_type}</td>
                  <td className="px-4 py-2 capitalize text-emerald-900/70">{r.actor_role?.replaceAll('_', ' ') ?? 'system'}</td>
                  <td className="hidden px-4 py-2 font-mono text-[11px] text-emerald-900/50 md:table-cell">
                    {r.subject_type ? `${r.subject_type} ${r.subject_id?.slice(0, 8) ?? ''}` : '-'}
                  </td>
                  <td className="hidden max-w-md truncate px-4 py-2 font-mono text-[11px] text-emerald-900/50 lg:table-cell">
                    {JSON.stringify(r.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
