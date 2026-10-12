import { useEffect, useState } from 'react'
import { Banknote } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_AGGREGATE_CEILING, BANK_LIST_LIMIT } from '@/lib/limits'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import type { DisbursementRecord, Facility } from '@/lib/bank'
import { formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'

/** Every bank-confirmed disbursement recorded across this bank's facilities. */
export default function BankDisbursements() {
  const { t, dateShort } = useT()
  const [rows, setRows] = useState<(DisbursementRecord & { borrower?: string })[] | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: facs }, { data: disb }] = await Promise.all([
        supabase.from('facilities').select('id, borrower_id')
          .order('id', { ascending: true }).limit(BANK_AGGREGATE_CEILING),
        supabase.from('disbursement_records').select('*')
          .order('disbursed_on', { ascending: false }).order('id', { ascending: true })
          .limit(BANK_LIST_LIMIT),
      ])
      const facMap = new Map(((facs as Facility[]) ?? []).map((f) => [f.id, f.borrower_id]))
      const profiles = await fetchPublicProfiles([...facMap.values()])
      if (cancelled) return
      const records = ((disb as DisbursementRecord[]) ?? []).map((d) => ({
        ...d, borrower: (profiles as Record<string, PublicProfile>)[facMap.get(d.facility_id) ?? '']?.full_name ?? '-',
      }))
      setRows(records)
      setTotal(records.reduce((s, d) => s + Number(d.amount), 0))
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return (
    <BankShell section="disbursements">
      {rows === null ? (
        <div className="h-32 animate-pulse rounded bg-white" aria-label={t('bank.disbursements.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Banknote} title={t('bank.disbursements.noneTitle')} body={t('bank.disbursements.noneBody')} />
      ) : (
        <div className="space-y-3">
          <p className="rounded border border-line bg-emerald-50/50 px-3 py-2 text-[12px] text-emerald-900/70">
            Bank-confirmed disbursement references - recorded, not executed by Loamy. Total shown: {formatNaira(total)}.
          </p>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="px-4 py-2 font-medium">{t('bank.col.date')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.customer')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.amount')}</th>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">{t('bank.col.reference')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2 font-mono text-[12px] text-emerald-900/70">{dateShort(d.disbursed_on)}</td>
                    <td className="px-4 py-2 text-emerald-950">{d.borrower}</td>
                    <td className="px-4 py-2 font-mono text-[13px]">{formatNaira(Number(d.amount))}</td>
                    <td className="hidden px-4 py-2 font-mono text-[11px] text-emerald-900/50 sm:table-cell">{d.external_reference ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </BankShell>
  )
}
