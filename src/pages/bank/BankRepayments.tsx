import { useCallback, useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_AGGREGATE_CEILING, BANK_LIST_LIMIT } from '@/lib/limits'
import { fetchPublicProfiles } from '@/lib/marketplace'
import { REPAYMENT_STATUS_META, type Facility, type RepaymentInstalment } from '@/lib/bank'
import { cn, formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { EmptyState } from '@/components/EmptyState'
import { AmountReferenceDialog } from '@/components/AmountReferenceDialog'

/** All repayment instalments across the bank's facilities, overdue first. */
export default function BankRepayments() {
  const { t, tOr, dateShort } = useT()
  const repaymentLabel = (st: RepaymentInstalment['status']) =>
    tOr(`bank.repaymentStatus.${st}`, REPAYMENT_STATUS_META[st].label)
  const [rows, setRows] = useState<(RepaymentInstalment & { borrower?: string })[] | null>(null)
  const [statusF, setStatusF] = useState('')
  const [paying, setPaying] = useState<RepaymentInstalment | null>(null)

  /**
   * The status filter runs in the QUERY, not over the fetched rows.
   *
   * It used to fetch every instalment and filter in the browser. Bounding that
   * read would have quietly broken the filter: cap at the first N by due date,
   * filter for `overdue` over those N, and an officer looking for an overdue
   * instalment that sorts later sees an empty table and concludes there is
   * nothing overdue. Filtering server-side keeps the question the officer
   * asked and the rows they get back describing the same set.
   *
   * `overdue` still sorts first, which is why the status order is applied
   * after the fetch rather than instead of it.
   */
  const load = useCallback(async () => {
    await supabase.rpc('loamy_mark_overdue_repayments')
    let scheduleQuery = supabase.from('repayment_schedule').select('*')
    if (statusF) scheduleQuery = scheduleQuery.eq('status', statusF)
    const [{ data: facs }, { data: sched }] = await Promise.all([
      supabase.from('facilities').select('id, borrower_id')
        .order('id', { ascending: true }).limit(BANK_AGGREGATE_CEILING),
      scheduleQuery
        .order('due_date').order('id', { ascending: true }).limit(BANK_LIST_LIMIT),
    ])
    const facMap = new Map(((facs as Facility[]) ?? []).map((f) => [f.id, f.borrower_id]))
    const profiles = await fetchPublicProfiles([...facMap.values()])
    setRows(((sched as RepaymentInstalment[]) ?? []).map((r) => ({
      ...r, borrower: profiles[facMap.get(r.facility_id) ?? '']?.full_name ?? '-',
    })))
  }, [statusF])

  useEffect(() => { void load() }, [load])

  const filtered = [...(rows ?? [])]
    .sort((a, b) => (a.status === 'overdue' ? -1 : 0) - (b.status === 'overdue' ? -1 : 0))

  return (
    <BankShell section="repayments">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold text-emerald-950">{t('bank.repayments.title')}</h1>
          <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-40" aria-label={t('bank.repayments.filterStatus')}>
            <option value="">{t('bank.repayments.allStatuses')}</option>
            {Object.entries(REPAYMENT_STATUS_META).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
          </Select>
        </div>
        {rows === null ? (
          <div className="h-32 animate-pulse rounded bg-white" aria-label={t('bank.repayments.loading')} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={CalendarClock} title={t('bank.repayments.noneTitle')} body={t('bank.repayments.noneBody')} />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="px-4 py-2 font-medium">{t('bank.col.due')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.customer')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.amountDue')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.paid')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.status')}</th>
                  <th className="px-4 py-2 font-medium"><span className="sr-only">{t('bank.col.action')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r) => (
                  <tr key={r.id} className={r.status === 'overdue' ? 'bg-red-50/40' : undefined}>
                    <td className="px-4 py-2 font-mono text-[13px]">{dateShort(r.due_date)}</td>
                    <td className="px-4 py-2 text-emerald-950">{r.borrower}</td>
                    <td className="px-4 py-2 font-mono text-[13px]">{formatNaira(Number(r.amount_due))}</td>
                    <td className="px-4 py-2 font-mono text-[13px]">{r.amount_paid != null ? formatNaira(Number(r.amount_paid)) : '-'}</td>
                    <td className="px-4 py-2"><span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', REPAYMENT_STATUS_META[r.status].chip)}>{repaymentLabel(r.status)}</span></td>
                    <td className="px-4 py-2 text-right">
                      {r.status !== 'paid' && <Button size="sm" variant="outline" onClick={() => setPaying(r)}>{t('bank.repayments.record')}</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <AmountReferenceDialog
        open={!!paying}
        onClose={() => setPaying(null)}
        title={t('bank.facility.recordRepayment')}
        amountLabel={t('bank.facility.amountPaid')}
        defaultAmount={paying ? Number(paying.amount_due) : ''}
        hint={paying
          ? t('bank.facility.instalmentHint', {
            date: dateShort(paying.due_date),
            amount: formatNaira(Number(paying.amount_due)),
          })
          : undefined}
        submitLabel={t('bank.facility.recordRepayment')}
        onSubmit={async (amount, reference) => {
          if (!paying) return
          const { error } = await supabase.rpc('loamy_record_repayment', {
            p_schedule: paying.id, p_amount_paid: amount, p_paid_on: null, p_reference: reference,
          })
          if (error) throw new Error(error.message)
          await load()
        }}
      />
    </BankShell>
  )
}
