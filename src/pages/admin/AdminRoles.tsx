import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { DashboardCard } from '@/components/DashboardCard'
import { Card } from '@/components/ui/card'
import { DonutSplit } from '@/components/charts/DonutSplit'

interface RoleRow {
  slug: string
  label: string
  is_operational: boolean
  count: number
}

/**
 * Role management overview: the canonical platform roles, live user counts,
 * and capability tallies (can-verify partners, bank officers). Per-user role
 * changes live under Users; admin grants stay manual in Supabase.
 */
export default function AdminRoles() {
  const [rows, setRows] = useState<RoleRow[] | null>(null)
  const [canVerify, setCanVerify] = useState(0)
  const [officers, setOfficers] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // These are counts, so count them in Postgres. This used to pull every
      // profile row and every role_details row into the browser and tally them
      // with a Map, which was both wasteful and WRONG: PostgREST caps an
      // unbounded select at 1000 rows, profiles passed 1000 some time ago, and
      // the page has been quietly under-reporting every role ever since.
      // `head: true` transfers no rows at all and `count: 'exact'` is not
      // subject to that cap, so the numbers are now both cheap and correct.
      const { data: roles } = await supabase
        .from('loamy_platform_roles')
        .select('slug, label, is_operational, sort_order')
        .order('sort_order')
      if (cancelled) return

      const roleRows = (roles ?? []) as Omit<RoleRow, 'count'>[]
      const [counts, verifyRes, officerRes] = await Promise.all([
        Promise.all(
          roleRows.map((r) =>
            supabase
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .eq('platform_role', r.slug)
              .then((res) => res.count ?? 0),
          ),
        ),
        supabase
          .from('role_details')
          .select('user_id', { count: 'exact', head: true })
          .eq('role_data->>can_verify', 'true'),
        supabase
          .from('role_details')
          .select('user_id', { count: 'exact', head: true })
          .not('role_data->>bank_id', 'is', null),
      ])
      if (cancelled) return
      setRows(roleRows.map((r, i) => ({ ...r, count: counts[i] })))
      setCanVerify(verifyRes.count ?? 0)
      setOfficers(officerRes.count ?? 0)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const donut = (rows ?? []).filter((r) => r.count > 0).map((r) => ({ name: r.label, value: r.count }))

  return (
    <div className="space-y-4">
      <p className="rounded border border-line bg-emerald-50/50 px-3 py-2 text-[12px] text-emerald-900/70">
        Per-user role changes are made under <Link to="/admin/users" className="font-medium text-emerald-700">Users</Link>.
        Admin access is granted manually in Supabase by standing decision - there is no make-admin control.
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <DashboardCard title="Distribution">
          {rows && <DonutSplit data={donut} />}
        </DashboardCard>
        <DashboardCard title="Capabilities">
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-emerald-900/50"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Can-verify partners</p>
              <p className="mt-1 font-mono text-xl font-semibold text-emerald-950">{canVerify}</p>
            </Card>
            <Card className="p-3">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-emerald-900/50"><Users className="h-3.5 w-3.5" aria-hidden /> Bank officers</p>
              <p className="mt-1 font-mono text-xl font-semibold text-emerald-950">{officers}</p>
            </Card>
          </div>
          <p className="mt-3 text-[11px] text-emerald-900/50">
            Manage the can-verify capability under <Link to="/admin/partners" className="font-medium text-emerald-700">Partners</Link>,
            and bank officers under <Link to="/admin/bank-officers" className="font-medium text-emerald-700">Bank Officers</Link>.
          </p>
        </DashboardCard>
      </div>

      <DashboardCard title="Platform roles">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 pr-4 font-medium">Slug</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 font-medium">Users</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(rows ?? []).map((r) => (
              <tr key={r.slug}>
                <td className="py-2 pr-4 font-medium text-emerald-950">{r.label}</td>
                <td className="py-2 pr-4 font-mono text-[12px] text-emerald-900/60">{r.slug}</td>
                <td className="py-2 pr-4 text-emerald-900/70">{r.is_operational ? 'Operational' : 'Participant'}</td>
                <td className="py-2 font-mono text-[13px]">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DashboardCard>
    </div>
  )
}
