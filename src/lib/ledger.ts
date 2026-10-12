/** Platform transactions ledger (Stage 8). RECORD-ONLY: rows mirror financial
 * events that settled on the bank's/PSP's rails; Loamy holds no funds. */

export type TxnType = 'marketplace_settlement' | 'facility_disbursement' | 'facility_repayment'

export const TXN_TYPE_META: Record<TxnType, { label: string; chip: string }> = {
  marketplace_settlement: { label: 'Marketplace settlement', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  facility_disbursement: { label: 'Disbursement', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  facility_repayment: { label: 'Repayment', chip: 'bg-gold-100 text-gold-700' },
}

export interface PlatformTransaction {
  id: string
  txn_type: TxnType
  gross_amount: number
  fee_amount: number
  currency: string
  subject_type: string | null
  subject_id: string | null
  from_user: string | null
  to_user: string | null
  external_reference: string | null
  status: 'recorded' | 'reconciled'
  occurred_on: string
  created_at: string
}

export interface PlatformMetrics {
  gmv_mtd: number
  gmv_total: number
  financing_disbursed_mtd: number
  revenue_mtd: number
  revenue_total: number
  txn_count_mtd: number
  txn_count_total: number
}
