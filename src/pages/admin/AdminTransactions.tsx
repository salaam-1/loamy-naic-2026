import { useCallback, useEffect, useState } from 'react'
import { Download, Receipt } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { downloadCsv } from '@/lib/csv'
import { TXN_TYPE_META, type PlatformTransaction, type TxnType } from '@/lib/ledger'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'

/**
 * Platform transactions / settlements ledger. RECORD-ONLY — every row mirrors
 * an event settled off-platform on the bank's/PSP's rails. Admin reads all;
 * CSV export is audit-logged.
 */
export default function AdminTransactions() {
  const [rows, setRows] = useState<PlatformTransaction[] | null>(null)
  const [typeF, setTypeF] = useState('')

  const load = useCallback(async () => {
    let q = supabase.from('platform_transactions').select('*').order('occurred_on', { ascending: false }).limit(500)
    if (typeF) q = q.eq('txn_type', typeF)
    const { data } = await q
    setRows((data as PlatformTransaction[]) ?? [])
  }, [typeF])

  useEffect(() => {
    void load()
  }, [load])

  async function exportCsv() {
    if (!rows) return
    await downloadCsv(
      'transactions',
      ['occurred_on', 'txn_type', 'gross_amount', 'fee_amount', 'currency', 'subject_type', 'external_reference', 'status'],
      rows.map((r) => [r.occurred_on, r.txn_type, r.gross_amount, r.fee_amount, r.currency, r.subject_type, r.external_reference, r.status]),
    )
  }

  const gross = (rows ?? []).reduce((s, r) => s + Number(r.gross_amount), 0)
  const fees = (rows ?? []).reduce((s, r) => s + Number(r.fee_amount), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-base font-semibold text-emerald-950">
          Transactions & settlements <span className="font-mono text-sm font-normal text-emerald-900/50">{rows?.length ?? ''}</span>
        </h1>
        <Select value={typeF} onChange={(e) => setTypeF(e.target.value)} className="w-52" aria-label="Filter by type">
          <option value="">All types</option>
          {Object.entries(TXN_TYPE_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
        <Button size="sm" variant="outline" onClick={() => void exportCsv()}>
          <Download className="h-3.5 w-3.5" aria-hidden /> CSV
        </Button>
      </div>

      <p className="rounded border border-line bg-emerald-50/50 px-3 py-2 text-[12px] text-emerald-900/70">
        Record-only ledger - mirrors events settled on the bank's/PSP's rails. Loamy holds no
        funds. Shown total: {formatNaira(gross)} gross · {formatNaira(fees)} platform fees.
      </p>

      {rows === null ? (
        <div className="h-32 animate-pulse rounded bg-white" aria-label="Loading transactions" />
      ) : rows.length === 0 ? (
        <Card className="flex items-center gap-2.5 px-4 py-4">
          <Receipt className="h-5 w-5 text-emerald-700" aria-hidden />
          <p className="text-sm text-emerald-900/60">
            No transactions recorded yet. Marketplace settlements and facility disbursements/repayments appear here as they are recorded.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Gross</th>
                <th className="px-4 py-2 font-medium">Fee</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-mono text-[12px] text-emerald-900/70">{formatDateShort(r.occurred_on)}</td>
                  <td className="px-4 py-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', TXN_TYPE_META[r.txn_type as TxnType].chip)}>
                      {TXN_TYPE_META[r.txn_type as TxnType].label}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-[13px] text-emerald-950">{formatNaira(Number(r.gross_amount))}</td>
                  <td className="px-4 py-2 font-mono text-[13px] text-emerald-900/70">{Number(r.fee_amount) > 0 ? formatNaira(Number(r.fee_amount)) : '-'}</td>
                  <td className="hidden px-4 py-2 font-mono text-[11px] text-emerald-900/50 md:table-cell">{r.external_reference ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
