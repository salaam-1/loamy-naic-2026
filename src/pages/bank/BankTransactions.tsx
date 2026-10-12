import { useEffect, useState } from 'react'
import { Receipt } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_AGGREGATE_CEILING, BANK_LIST_LIMIT } from '@/lib/limits'
import { fetchPublicProfiles } from '@/lib/marketplace'
import type { DisbursementRecord, Facility, RepaymentInstalment } from '@/lib/bank'
import { cn, formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'

interface Row {
  id: string
  date: string
  kind: 'Disbursement' | 'Repayment'
  borrower: string
  amount: number
  reference: string | null
}

/** Combined transaction view for the bank: recorded disbursements (out) and
 * repayments (in) across its facilities. Record-only — no funds move on Loamy. */
export default function BankTransactions() {
  const { t, tOr, dateShort } = useT()
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: facs }, { data: disb }, { data: reps }] = await Promise.all([
        supabase.from('facilities').select('id, borrower_id')
          .order('id', { ascending: true }).limit(BANK_AGGREGATE_CEILING),
        supabase.from('disbursement_records').select('*')
          .order('disbursed_on', { ascending: false }).order('id', { ascending: true })
          .limit(BANK_LIST_LIMIT),
        supabase.from('repayment_schedule').select('*').not('amount_paid', 'is', null)
          .order('due_date', { ascending: false }).order('id', { ascending: true })
          .limit(BANK_LIST_LIMIT),
      ])
      const facMap = new Map(((facs as Facility[]) ?? []).map((f) => [f.id, f.borrower_id]))
      const profiles = await fetchPublicProfiles([...facMap.values()])
      const name = (fid: string) => profiles[facMap.get(fid) ?? '']?.full_name ?? '-'
      if (cancelled) return
      const out: Row[] = ((disb as DisbursementRecord[]) ?? []).map((d) => ({
        id: 'd' + d.id, date: d.disbursed_on, kind: 'Disbursement', borrower: name(d.facility_id), amount: Number(d.amount), reference: d.external_reference,
      }))
      const inc: Row[] = ((reps as RepaymentInstalment[]) ?? []).map((r) => ({
        id: 'r' + r.id, date: r.paid_on ?? r.due_date, kind: 'Repayment', borrower: name(r.facility_id), amount: Number(r.amount_paid ?? 0), reference: r.external_reference,
      }))
      setRows([...out, ...inc].sort((a, b) => (a.date < b.date ? 1 : -1)))
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return (
    <BankShell section="transactions">
      {rows === null ? (
        <div className="h-32 animate-pulse rounded bg-white" aria-label={t('bank.transactions.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Receipt} title={t('bank.transactions.noneTitle')} body={t('bank.transactions.noneBody')} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="px-4 py-2 font-medium">{t('bank.col.date')}</th>
                <th className="px-4 py-2 font-medium">{t('bank.col.type')}</th>
                <th className="px-4 py-2 font-medium">{t('bank.col.customer')}</th>
                <th className="px-4 py-2 font-medium">{t('bank.col.amount')}</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">{t('bank.col.reference')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-mono text-[12px] text-emerald-900/70">{dateShort(r.date)}</td>
                  <td className="px-4 py-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', r.kind === 'Disbursement' ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200')}>{r.kind === 'Disbursement' ? t('bank.transactions.disbursement') : t('bank.transactions.repayment')}</span>
                  </td>
                  <td className="px-4 py-2 text-emerald-950">{r.borrower}</td>
                  <td className="px-4 py-2 font-mono text-[13px]">{formatNaira(r.amount)}</td>
                  <td className="hidden px-4 py-2 font-mono text-[11px] text-emerald-900/50 sm:table-cell">{r.reference ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </BankShell>
  )
}
