import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_AGGREGATE_CEILING, BANK_LIST_LIMIT } from '@/lib/limits'
import { fetchPublicProfiles } from '@/lib/marketplace'
import type { Collateral, Facility } from '@/lib/bank'
import { formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'

/** All collateral logged across the bank's facilities. */
export default function BankCollateral() {
  const { t, dateShort } = useT()
  const [rows, setRows] = useState<(Collateral & { borrower?: string })[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: facs }, { data: coll }] = await Promise.all([
        supabase.from('facilities').select('id, borrower_id')
          .order('id', { ascending: true }).limit(BANK_AGGREGATE_CEILING),
        supabase.from('collateral').select('*')
          .order('created_at', { ascending: false }).order('id', { ascending: true })
          .limit(BANK_LIST_LIMIT),
      ])
      const facMap = new Map(((facs as Facility[]) ?? []).map((f) => [f.id, f.borrower_id]))
      const profiles = await fetchPublicProfiles([...facMap.values()])
      if (cancelled) return
      setRows(((coll as Collateral[]) ?? []).map((c) => ({ ...c, borrower: profiles[facMap.get(c.facility_id) ?? '']?.full_name ?? '-' })))
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return (
    <BankShell section="collateral">
      {rows === null ? (
        <div className="h-32 animate-pulse rounded bg-white" aria-label={t('bank.collateral.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t('bank.collateral.noneTitle')} body={t('bank.collateral.noneBody')} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="px-4 py-2 font-medium">{t('bank.col.customer')}</th>
                <th className="px-4 py-2 font-medium">{t('bank.col.kind')}</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">{t('bank.col.description')}</th>
                <th className="px-4 py-2 font-medium">{t('bank.col.estValue')}</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">{t('bank.col.logged')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-emerald-950">{c.borrower}</td>
                  <td className="px-4 py-2 font-medium text-emerald-950">{c.kind}</td>
                  <td className="hidden px-4 py-2 text-emerald-900/70 sm:table-cell">{c.description ?? '-'}</td>
                  <td className="px-4 py-2 font-mono text-[13px]">{c.estimated_value != null ? formatNaira(Number(c.estimated_value)) : '-'}</td>
                  <td className="hidden px-4 py-2 text-emerald-900/70 md:table-cell">{dateShort(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </BankShell>
  )
}
