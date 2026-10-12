import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Download, FileText, Trash2, Upload } from 'lucide-react'
import { fetchMyCompanies } from '@/lib/companies'
import {
  DOC_TYPE_LABELS, DOC_TYPES, deleteDocument, documentUrl, fetchContracts, fetchDocuments,
  uploadDocument, type Contract, type DocType, type DocumentRow,
} from '@/lib/contracts'
import { formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import ContractView from '@/pages/processor/ContractView'

const CONTRACT_STATUS_CLS: Record<Contract['status'], string> = {
  pending_signatures: 'bg-amber-50 text-amber-700 ring-amber-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  cancelled: 'bg-red-50 text-red-600 ring-red-200',
  superseded: 'bg-emerald-50 text-emerald-900/45 ring-emerald-200',
}

/**
 * Contracts + document repository for the buyer company. Contracts are
 * auto-generated on award; both parties e-sign here. Documents live in a
 * private, company-scoped bucket.
 */
export default function Contracts() {
  const { t, tOr } = useT()
  const errorText = useErrorText()
  const docTypeLabel = (d: DocType) => tOr(`processor.docType.${d}`, DOC_TYPE_LABELS[d])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [contracts, setContracts] = useState<Contract[]>([])
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Contract | null>(null)
  const [docType, setDocType] = useState<DocType>('other')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cos = await fetchMyCompanies()
      if (!cos.length) { setCompanyId(null); return }
      setCompanyId(cos[0].id)
      const [cs, ds] = await Promise.all([fetchContracts(), fetchDocuments(cos[0].id)])
      setContracts(cs); setDocs(ds)
    } catch (e) {
      setError(errorText(e, 'processor.contract.couldNotLoad', 'Could not load contracts.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function onUpload(file: File) {
    if (!companyId) return
    setUploading(true); setError(null)
    try {
      await uploadDocument(companyId, docType, file)
      await load()
    } catch (e) {
      setError(errorText(e, 'processor.contract.uploadFailed', 'Upload failed.'))
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function onOpenDoc(d: DocumentRow) {
    const url = await documentUrl(d.file_url)
    if (url) window.open(url, '_blank', 'noopener')
  }

  if (loading) return <div className="h-40 animate-pulse rounded bg-emerald-50" aria-label={t('processor.contract.loading')} />

  if (!companyId) {
    return <EmptyState icon={FileText} title={t('processor.contract.registerFirst')}
      body={t('processor.contract.registerFirstBody')} />
  }

  if (open) {
    return (
      <div className="space-y-4">
        <button onClick={() => setOpen(null)} className="inline-flex items-center gap-1 text-[13px] text-emerald-900/60 hover:text-emerald-900">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {t('processor.contract.backToContracts')}
        </button>
        <DashboardCard title={t('processor.contract.one')}>
          <ContractView contract={open} onSigned={() => { void load(); setOpen(null) }} />
        </DashboardCard>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <DashboardCard title={t('processor.contract.titleCount', { count: contracts.length })}>
        {contracts.length === 0 ? (
          <p className="py-6 text-center text-sm text-emerald-900/55">{t('processor.contract.noneYetAuto')}</p>
        ) : (
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="py-2 pr-4 font-medium">{t('processor.contract.colContract')}</th>
                <th className="py-2 pr-4 font-medium">{t('processor.contract.colSupplier')}</th>
                <th className="py-2 pr-4 font-medium">{t('processor.contract.colCommodity')}</th>
                <th className="py-2 pr-4 font-medium">{t('processor.contract.colVersion')}</th>
                <th className="py-2 pr-4 font-medium">{t('processor.contract.colStatus')}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-emerald-50/40">
                  <td className="py-2.5 pr-4 font-mono text-[12px] text-emerald-900/70">{c.contract_number}</td>
                  <td className="py-2.5 pr-4 text-emerald-950">{c.supplier_name?.trim() || t('processor.contract.supplierFallback')}</td>
                  <td className="py-2.5 pr-4 text-emerald-900/80">{c.commodity}</td>
                  <td className="py-2.5 pr-4 text-emerald-900/60">v{c.version}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${CONTRACT_STATUS_CLS[c.status]}`}>
                      {tOr(`processor.contractStatus.${c.status}`, c.status.replace('_', ' '))}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <button onClick={() => setOpen(c)} className="rounded px-2 py-1 text-[13px] text-emerald-700 hover:bg-emerald-50">{t('processor.contract.openContract')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DashboardCard>

      <DashboardCard
        title={t('processor.contract.documentsCount', { count: docs.length })}
        action={
          <div className="flex items-center gap-2">
            <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}
              className="h-8 min-h-touch rounded border border-line bg-white px-2 text-[12px] text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-600/30">
              {DOC_TYPES.map((d) => <option key={d} value={d}>{docTypeLabel(d)}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {uploading ? t('processor.contract.uploading') : t('processor.contract.uploadAction')}
            </Button>
            <input ref={fileRef} type="file" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f) }} />
          </div>
        }
      >
        {docs.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-emerald-900/50">
            {t('processor.contract.noDocuments')}
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-emerald-950">{d.title || d.file_url.split('/').pop()}</p>
                    <p className="text-[11px] text-emerald-900/50">{t('processor.contract.docMeta', { type: docTypeLabel(d.doc_type), date: formatDateShort(d.created_at) })}</p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => onOpenDoc(d)} className="rounded px-2 py-1 text-[13px] text-emerald-700 hover:bg-emerald-50" aria-label={t('processor.contract.downloadAction')}>
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button onClick={async () => { await deleteDocument(d.id, d.file_url); void load() }} className="rounded px-2 py-1 text-[13px] text-red-700 hover:bg-red-50" aria-label={t('processor.contract.deleteAction')}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DashboardCard>
    </div>
  )
}
