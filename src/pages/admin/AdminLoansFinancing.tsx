import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import type { Facility } from '@/lib/bank'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { StatCard } from '@/components/StatCard'
import { DashboardCard } from '@/components/DashboardCard'
import { Card } from '@/components/ui/card'

interface Bank { id: string; name: string }

/** Cross-bank oversight of financing: all facilities + applications standing.
 * Admin RLS sees every bank's facilities. Loamy records; banks hold funds. */
export default function AdminLoansFinancing() {
  const [facilities, setFacilities] = useState<Facility[] | null>(null)
  const [banks, setBanks] = useState<Record<string, string>>({})
  const [borrowers, setBorrowers] = useState<Record<string, PublicProfile>>({})
  const [appStatus, setAppStatus] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: facs }, { data: bk }, { data: apps }] = await Promise.all([
        supabase.from('facilities').select('*').order('created_at', { ascending: false }),
        supabase.from('banks').select('id, name'),
        supabase.from('financing_applications').select('status').neq('status', 'draft'),
      ])
      if (cancelled) return
      const f = (facs as Facility[]) ?? []
      setFacilities(f)
      setBanks(Object.fromEntries(((bk as Bank[]) ?? []).map((b) => [b.id, b.name])))
      setBorrowers(await fetchPublicProfiles(f.map((x) => x.borrower_id)))
      const counts: Record<string, number> = {}
      for (const a of (apps ?? []) as { status: string }[]) counts[a.status] = (counts[a.status] ?? 0) + 1
      setAppStatus(counts)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const active = (facilities ?? []).filter((f) => f.status === 'active')
  const totalPrincipal = active.reduce((s, f) => s + Number(f.principal), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Wallet} label="Total portfolio" value={formatNaira(totalPrincipal)} sub="active, all banks" loading={!facilities} />
        <StatCard icon={Wallet} label="Active facilities" value={active.length} sub="across banks" loading={!facilities} />
        <StatCard icon={Landmark} label="Applications submitted" value={appStatus.submitted ?? 0} sub="awaiting review" loading={!facilities} />
        <StatCard icon={Landmark} label="Decisions communicated" value={appStatus.decided_external ?? 0} sub="by partner banks" loading={!facilities} />
      </div>

      <Card className="px-4 py-2.5 text-[12px] text-emerald-900/70">
        Manage bank officer accounts under <Link to="/admin/bank-officers" className="font-medium text-emerald-700">Bank Officers</Link>.
        Loamy is the origination + monitoring layer; funds move at the bank of record.
      </Card>

      <DashboardCard title="Facilities (all banks)">
        {facilities === null ? (
          <div className="h-16 animate-pulse rounded bg-emerald-50" aria-label="Loading" />
        ) : facilities.length === 0 ? (
          <p className="py-2 text-sm text-emerald-900/55">No facilities opened yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-2 pr-4 font-medium">Borrower</th>
                  <th className="py-2 pr-4 font-medium">Bank</th>
                  <th className="py-2 pr-4 font-medium">Principal</th>
                  <th className="hidden py-2 pr-4 font-medium sm:table-cell">Sector</th>
                  <th className="hidden py-2 pr-4 font-medium md:table-cell">Opened</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {facilities.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2 pr-4 text-emerald-950">{borrowers[f.borrower_id]?.full_name ?? '-'}</td>
                    <td className="py-2 pr-4 text-emerald-900/70">{banks[f.bank_id] ?? '-'}</td>
                    <td className="py-2 pr-4 font-mono text-[13px]">{formatNaira(Number(f.principal))}</td>
                    <td className="hidden py-2 pr-4 text-emerald-900/70 sm:table-cell">{f.sector}</td>
                    <td className="hidden py-2 pr-4 text-emerald-900/70 md:table-cell">{formatDateShort(f.opened_on)}</td>
                    <td className="py-2"><span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">{f.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCard>
    </div>
  )
}
