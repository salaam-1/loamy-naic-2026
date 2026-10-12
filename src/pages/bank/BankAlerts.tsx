import { useEffect, useState } from 'react'
import { AlertTriangle, BellRing } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_AGGREGATE_CEILING, BANK_LIST_LIMIT } from '@/lib/limits'
import { fetchPublicProfiles } from '@/lib/marketplace'
import type { Facility, RepaymentInstalment } from '@/lib/bank'
import { formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'

/** Live risk alerts: overdue instalments across the bank's facilities. */
export default function BankAlerts() {
  const { t, dateShort } = useT()
  const [overdue, setOverdue] = useState<(RepaymentInstalment & { borrower?: string })[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      await supabase.rpc('loamy_mark_overdue_repayments')
      const [{ data: facs }, { data: sched }] = await Promise.all([
        supabase.from('facilities').select('id, borrower_id')
          .order('id', { ascending: true }).limit(BANK_AGGREGATE_CEILING),
        supabase.from('repayment_schedule').select('*').eq('status', 'overdue')
          .order('due_date').order('id', { ascending: true }).limit(BANK_LIST_LIMIT),
      ])
      const facMap = new Map(((facs as Facility[]) ?? []).map((f) => [f.id, f.borrower_id]))
      const profiles = await fetchPublicProfiles([...facMap.values()])
      if (cancelled) return
      setOverdue(((sched as RepaymentInstalment[]) ?? []).map((r) => ({ ...r, borrower: profiles[facMap.get(r.facility_id) ?? '']?.full_name ?? '-' })))
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return (
    <BankShell section="alerts">
      {overdue === null ? (
        <div className="h-32 animate-pulse rounded bg-white" aria-label={t('bank.alerts.loading')} />
      ) : overdue.length === 0 ? (
        <EmptyState icon={BellRing} title={t('bank.alerts.noneTitle')} body={t('bank.alerts.noneBody')} />
      ) : (
        <div className="space-y-3">
          <p className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            <AlertTriangle className="h-4 w-4" aria-hidden /> {overdue.length} overdue instalment(s) need attention.
          </p>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="px-4 py-2 font-medium">{t('bank.col.due')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.customer')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.amountDue')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.daysOverdue')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {overdue.map((r) => {
                  const days = Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000)
                  return (
                    <tr key={r.id} className="bg-red-50/40">
                      <td className="px-4 py-2 font-mono text-[13px]">{dateShort(r.due_date)}</td>
                      <td className="px-4 py-2 text-emerald-950">{r.borrower}</td>
                      <td className="px-4 py-2 font-mono text-[13px]">{formatNaira(Number(r.amount_due))}</td>
                      <td className="px-4 py-2 font-mono text-[13px] text-red-600">{days}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </BankShell>
  )
}
