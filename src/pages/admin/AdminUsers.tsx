import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeCheck, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PLATFORM_ROLE_SLUGS } from '@/lib/types'
import { cn, formatDateShort } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

interface UserRow {
  id: string
  full_name: string | null
  digital_id: string | null
  platform_role: string | null
  role: string
  state: string | null
  verified_badge: boolean
  active: boolean
  created_at: string
}

interface UserSummary {
  farms: number
  listings: number
  applications: number
  interests: number
  last_activity: string | null
}

/**
 * User management. Admin sees OPERATIONAL data only — counts and recency,
 * never verification evidence beyond what the S4 review flow exposes.
 * Admin grant itself stays manual in Supabase (deliberate — no button here).
 */
export default function AdminUsers() {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [search, setSearch] = useState('')
  const [roleF, setRoleF] = useState('')
  const [statusF, setStatusF] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [summary, setSummary] = useState<UserSummary | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, digital_id, platform_role, role, state, verified_badge, active, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    setUsers((data as UserRow[]) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (users ?? []).filter(
      (u) =>
        (!q || (u.full_name ?? '').toLowerCase().includes(q) || (u.digital_id ?? '').toLowerCase().includes(q)) &&
        (!roleF || u.platform_role === roleF) &&
        (!statusF || (statusF === 'active' ? u.active : !u.active)),
    )
  }, [users, search, roleF, statusF])

  async function openUser(u: UserRow) {
    if (open === u.id) {
      setOpen(null)
      return
    }
    setOpen(u.id)
    setSummary(null)
    const { data } = await supabase.rpc('loamy_admin_user_summary', { p_user: u.id })
    setSummary(data as UserSummary)
  }

  async function changeRole(u: UserRow, role: string) {
    if (!role || role === u.platform_role) return
    if (!window.confirm(`Change ${u.full_name ?? u.digital_id}'s role to ${role.replaceAll('_', ' ')}? This is audit-logged.`)) return
    setBusy(u.id)
    const { error } = await supabase.rpc('loamy_admin_set_role', { p_user: u.id, p_role: role })
    setBusy(null)
    if (error) setMsg(error.message)
    await load()
  }

  async function toggleActive(u: UserRow) {
    const verb = u.active ? 'Deactivate' : 'Reactivate'
    if (!window.confirm(`${verb} ${u.full_name ?? u.digital_id}? This is audit-logged.`)) return
    setBusy(u.id)
    const { error } = await supabase.rpc('loamy_admin_set_user_active', { p_user: u.id, p_active: !u.active })
    setBusy(null)
    if (error) setMsg(error.message)
    await load()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-base font-semibold text-emerald-950">
          Users <span className="font-mono text-sm font-normal text-emerald-900/50">{filtered.length}</span>
        </h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-900/35" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or Digital ID" className="w-56 pl-8" aria-label="Search users" />
        </div>
        <Select value={roleF} onChange={(e) => setRoleF(e.target.value)} className="w-40" aria-label="Filter by role">
          <option value="">All roles</option>
          {[...PLATFORM_ROLE_SLUGS, 'bank'].map((r) => (
            <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>
          ))}
        </Select>
        <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-32" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="deactivated">Deactivated</option>
        </Select>
      </div>

      <p className="text-[11px] text-emerald-900/45">
        Admin access itself is granted manually in Supabase by standing decision - there is no
        make-admin control here.
      </p>
      {msg && <p className="rounded bg-red-50 px-2.5 py-1.5 text-sm text-red-700">{msg}</p>}

      {users === null ? (
        <div className="h-32 animate-pulse rounded bg-white" aria-label="Loading users" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">State</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Joined</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"><span className="sr-only">Detail</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((u) => (
                <>
                  <tr key={u.id} className="cursor-pointer transition-colors hover:bg-emerald-50/60" onClick={() => void openUser(u)}>
                    <td className="px-4 py-2">
                      <p className="flex items-center gap-1 font-medium text-emerald-950">
                        {u.full_name ?? '-'}
                        {u.verified_badge && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="Verified" />}
                        {u.role === 'admin' && <span className="rounded bg-gold-100 px-1 py-0.5 text-[10px] font-medium text-gold-700">admin</span>}
                      </p>
                      <p className="font-mono text-[11px] text-emerald-900/50">{u.digital_id}</p>
                    </td>
                    <td className="px-4 py-2 capitalize text-emerald-900/70">{u.platform_role?.replaceAll('_', ' ') ?? '-'}</td>
                    <td className="hidden px-4 py-2 text-emerald-900/70 md:table-cell">{u.state ?? '-'}</td>
                    <td className="hidden px-4 py-2 text-emerald-900/70 sm:table-cell">{formatDateShort(u.created_at)}</td>
                    <td className="px-4 py-2">
                      <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', u.active ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200')}>
                        {u.active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-emerald-900/40">
                      {open === u.id ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                    </td>
                  </tr>
                  {open === u.id && (
                    <tr key={u.id + '-detail'} className="bg-emerald-50/40">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                            <div><dt className="inline text-emerald-900/50">Farms </dt><dd className="inline font-mono">{summary?.farms ?? '…'}</dd></div>
                            <div><dt className="inline text-emerald-900/50">Listings </dt><dd className="inline font-mono">{summary?.listings ?? '…'}</dd></div>
                            <div><dt className="inline text-emerald-900/50">Applications </dt><dd className="inline font-mono">{summary?.applications ?? '…'}</dd></div>
                            <div><dt className="inline text-emerald-900/50">Interests </dt><dd className="inline font-mono">{summary?.interests ?? '…'}</dd></div>
                            <div><dt className="inline text-emerald-900/50">Last activity </dt><dd className="inline">{summary?.last_activity ? formatDateShort(summary.last_activity) : '-'}</dd></div>
                          </dl>
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            {u.platform_role !== 'bank' && u.role !== 'admin' && (
                              <Select value={u.platform_role ?? ''} onChange={(e) => void changeRole(u, e.target.value)} className="w-44" aria-label="Change role">
                                <option value="" disabled>Change role…</option>
                                {PLATFORM_ROLE_SLUGS.map((r) => (
                                  <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>
                                ))}
                              </Select>
                            )}
                            {u.role !== 'admin' && (
                              <Button size="sm" variant="outline" loading={busy === u.id} onClick={() => void toggleActive(u)}>
                                {u.active ? 'Deactivate' : 'Reactivate'}
                              </Button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
