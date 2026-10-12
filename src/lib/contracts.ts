import { supabase } from '@/lib/supabase'
import { PROCUREMENT_LIST_LIMIT } from '@/lib/limits'
import { formatNaira, formatDateShort } from '@/lib/utils'

/**
 * Purchase contracts (auto-generated from awards) and the company document
 * repository. Contracts are read-only except for e-signing, which goes through
 * loamy_sign_contract. Documents live in a private, company-scoped bucket.
 */

export type ContractStatus = 'pending_signatures' | 'active' | 'cancelled' | 'superseded'

export interface ContractTerms {
  rfq_reference?: string
  commodity?: string
  grade?: string | null
  moisture_max?: number | null
  packaging?: string | null
  quantity?: number
  unit?: string
  price_per_unit?: number
  total_value?: number
  currency?: string
  delivery_state?: string | null
  delivery_deadline?: string | null
  inspection_mode?: string
  payment_mode?: string
  buyer_company?: string
  supplier_name?: string
}

export interface Contract {
  id: string
  rfq_id: string
  award_id: string
  company_id: string
  supplier_id: string
  contract_number: string
  terms: ContractTerms
  version: number
  status: ContractStatus
  buyer_signed_at: string | null
  supplier_signed_at: string | null
  created_at: string
  rfq_reference: string
  commodity: string
  buyer_company: string
  supplier_name: string | null
}

export const DOC_TYPES = [
  'contract', 'invoice', 'inspection_report', 'warehouse_receipt',
  'transport_document', 'certificate', 'payment_receipt', 'other',
] as const
export type DocType = (typeof DOC_TYPES)[number]

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  contract: 'Contract', invoice: 'Invoice', inspection_report: 'Inspection report',
  warehouse_receipt: 'Warehouse receipt', transport_document: 'Transport document',
  certificate: 'Certificate', payment_receipt: 'Payment receipt', other: 'Other',
}

export interface DocumentRow {
  id: string
  company_id: string
  rfq_id: string | null
  award_id: string | null
  doc_type: DocType
  title: string | null
  file_url: string
  created_at: string
}

export async function fetchContracts(): Promise<Contract[]> {
  const { data, error } = await supabase.from('loamy_contracts_v').select('*')
    .order('created_at', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as Contract[]
}

export async function fetchContractsForRfq(rfqId: string): Promise<Contract[]> {
  const { data, error } = await supabase.from('loamy_contracts_v').select('*').eq('rfq_id', rfqId)
    .order('version', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as Contract[]
}

export async function signContract(contractId: string, signerName: string): Promise<void> {
  // IP is captured as an optional v1 acknowledgement; the browser can't reliably
  // read its own public IP, so it's left null here.
  // TODO: capture IP server-side / integrate a qualified e-signature provider.
  const { error } = await supabase.rpc('loamy_sign_contract', { p_contract_id: contractId, p_signer_name: signerName, p_ip: null })
  if (error) throw error
}

// ---- Documents --------------------------------------------------------------

export async function fetchDocuments(companyId: string, rfqId?: string): Promise<DocumentRow[]> {
  let q = supabase.from('documents').select('*').eq('company_id', companyId)
    .order('created_at', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (rfqId) q = q.eq('rfq_id', rfqId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DocumentRow[]
}

export async function uploadDocument(
  companyId: string, docType: DocType, file: File,
  opts: { rfqId?: string | null; awardId?: string | null; title?: string } = {},
): Promise<void> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${companyId}/${opts.rfqId ?? 'general'}/${Date.now()}_${safe}`
  const up = await supabase.storage.from('rfq-documents').upload(path, file, { upsert: false })
  if (up.error) throw up.error
  const { error } = await supabase.from('documents').insert({
    company_id: companyId, rfq_id: opts.rfqId ?? null, award_id: opts.awardId ?? null,
    doc_type: docType, title: opts.title ?? file.name, file_url: path,
  })
  if (error) throw error
}

export async function documentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('rfq-documents').createSignedUrl(path, 60 * 10)
  if (error) return null
  return data.signedUrl
}

export async function deleteDocument(id: string, path: string): Promise<void> {
  await supabase.storage.from('rfq-documents').remove([path])
  const { error } = await supabase.from('documents').delete().eq('id', id)
  if (error) throw error
}

// ---- Downloadable contract (self-contained HTML → print to PDF) -------------

export function contractHtml(c: Contract): string {
  const t = c.terms
  const row = (k: string, v: string | number | null | undefined) =>
    v == null || v === '' ? '' : `<tr><td class="k">${k}</td><td>${v}</td></tr>`
  const signed = (label: string, at: string | null) =>
    `<div class="sig"><div class="line"></div><strong>${label}</strong><br/>${at ? 'Signed ' + formatDateShort(at) : 'Awaiting signature'}</div>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${c.contract_number}</title>
<style>body{font-family:Georgia,serif;color:#0b2b24;max-width:720px;margin:40px auto;padding:0 24px;line-height:1.5}
h1{font-size:20px;margin:0}.muted{color:#5b736c;font-size:13px}table{width:100%;border-collapse:collapse;margin:18px 0}
td{padding:6px 8px;border-bottom:1px solid #e3ebe8;font-size:14px;vertical-align:top}td.k{color:#5b736c;width:220px}
.sigs{display:flex;gap:40px;margin-top:48px}.sig{flex:1;font-size:13px}.line{border-top:1px solid #0b2b24;margin-bottom:6px;height:28px}
.total{font-size:16px;font-weight:bold}</style></head><body>
<h1>Purchase Contract</h1>
<p class="muted">${c.contract_number} · Version ${c.version} · ${c.status.replace('_', ' ')}</p>
<table>
${row('Buyer', t.buyer_company)}
${row('Supplier', t.supplier_name)}
${row('Buy request', t.rfq_reference)}
${row('Commodity', t.commodity)}
${row('Grade', t.grade)}
${row('Max moisture', t.moisture_max != null ? t.moisture_max + '%' : null)}
${row('Packaging', t.packaging)}
${row('Quantity', t.quantity != null ? `${t.quantity} ${t.unit ?? ''}` : null)}
${row('Price', t.price_per_unit != null ? `${formatNaira(t.price_per_unit)} / ${t.unit ?? 'unit'}` : null)}
${row('Total value', t.total_value != null ? `<span class="total">${formatNaira(t.total_value)}</span>` : null)}
${row('Delivery', [t.delivery_state, t.delivery_deadline ? 'by ' + formatDateShort(t.delivery_deadline) : ''].filter(Boolean).join(' '))}
${row('Inspection', t.inspection_mode)}
${row('Payment', t.payment_mode === 'escrow' ? 'Escrow via payment partner (Paystack)' : t.payment_mode)}
</table>
<p class="muted">This acknowledgement records the agreed terms above. E-signature below captures the typed
name and timestamp of each party as a v1 acknowledgement.</p>
<div class="sigs">${signed('Buyer', c.buyer_signed_at)}${signed('Supplier', c.supplier_signed_at)}</div>
</body></html>`
}

export function downloadContract(c: Contract): void {
  const blob = new Blob([contractHtml(c)], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${c.contract_number}.html`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
