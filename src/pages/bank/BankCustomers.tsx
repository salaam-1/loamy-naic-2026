import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_AGGREGATE_CEILING } from '@/lib/limits'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import type { Facility } from '@/lib/bank'
import { formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'

interface Customer {
  id: string
  profile?: PublicProfile
  facilities: number
  exposure: number
}

/** Borrowers of this bank with active facilities and total exposure. */
export default function BankCustomers() {
  const { t } = useT()
  const [rows, setRows] = useState<Customer[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: facs } = await supabase.from('facilities').select('*')
        .order('id', { ascending: true }).limit(BANK_AGGREGATE_CEILING)
      const facilities = (facs as Facility[]) ?? []
      const byBorrower = new Map<string, Customer>()
      for (const f of facilities) {
        const c = byBorrower.get(f.borrower_id) ?? { id: f.borrower_id, facilities: 0, exposure: 0 }
        c.facilities += 1
        if (f.status === 'active') c.exposure += Number(f.principal)
        byBorrower.set(f.borrower_id, c)
      }
      const profiles = await fetchPublicProfiles([...byBorrower.keys()])
      if (cancelled) return
      setRows([...byBorrower.values()].map((c) => ({ ...c, profile: profiles[c.id] })).sort((a, b) => b.exposure - a.exposure))
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return (
    <BankShell section="customers">
      {rows === null ? (
        <div className="h-32 animate-pulse rounded bg-white" aria-label={t('bank.customers.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title={t('bank.customers.noneTitle')} body={t('bank.customers.noneBody')} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="px-4 py-2 font-medium">{t('bank.col.customer')}</th>
                <th className="px-4 py-2 font-medium">{t('bank.col.state')}</th>
                <th className="px-4 py-2 font-medium">{t('bank.col.facilities')}</th>
                <th className="px-4 py-2 font-medium">{t('bank.col.activeExposure')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-medium text-emerald-950">{c.profile?.full_name ?? '-'}</td>
                  <td className="px-4 py-2 text-emerald-900/70">{c.profile?.state ?? '-'}</td>
                  <td className="px-4 py-2 font-mono text-[13px]">{c.facilities}</td>
                  <td className="px-4 py-2 font-mono text-[13px]">{formatNaira(c.exposure)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </BankShell>
  )
}
