import { useState, type FormEvent } from 'react'
import { Download, PenLine, ShieldCheck } from 'lucide-react'
import {
  downloadContract, signContract, type Contract,
} from '@/lib/contracts'
import { GRADE_SLUG, PACKAGING_SLUG, UNIT_SLUG } from '@/lib/rfqs'
import { formatNaira, formatDateShort } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'

const STATUS_LABEL: Record<Contract['status'], { label: string; cls: string }> = {
  pending_signatures: { label: 'Pending signatures', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-50 text-red-600 ring-red-200' },
  superseded: { label: 'Superseded', cls: 'bg-emerald-50 text-emerald-900/50 ring-emerald-200' },
}

function Row({ k, v }: { k: string; v: string | number | null | undefined }) {
  if (v == null || v === '') return null
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 text-[13px]">
      <span className="text-emerald-900/50">{k}</span>
      <span className="text-right text-emerald-950">{v}</span>
    </div>
  )
}

/**
 * Read-only purchase-contract view with e-signature (typed name + timestamp) and
 * a downloadable copy. The signing party (buyer or supplier) is decided
 * server-side; this just offers the action to whoever can still sign.
 */
export default function ContractView({ contract, onSigned }: { contract: Contract; onSigned: () => void }) {
  const { t, tOr } = useT()
  const errorText = useErrorText()
  const unitLabel = (v: string) => tOr(`processor.unit.${UNIT_SLUG[v] ?? v}`, v)
  const terms = contract.terms
  const [signOpen, setSignOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const st = STATUS_LABEL[contract.status]

  async function onSign(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError(t('processor.contractView.typeYourName')); return }
    setBusy(true); setError(null)
    try {
      await signContract(contract.id, name.trim())
      setSignOpen(false); setName('')
      onSigned()
    } catch (e) {
      setError(errorText(e, 'processor.contractView.couldNotSign', 'Could not sign.'))
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold text-emerald-950">{contract.contract_number}</p>
          <p className="text-[11px] text-emerald-900/50">{t('processor.contractView.versionLine', { version: contract.version, reference: terms.rfq_reference ?? '' })}</p>
        </div>
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ring-1 ${st.cls}`}>{tOr(`processor.contractView.${contract.status}`, st.label)}</span>
      </div>

      <div className="rounded border border-line bg-white p-3">
        <Row k={t('processor.contractView.buyer')} v={terms.buyer_company} />
        <Row k={t('processor.contractView.supplier')} v={terms.supplier_name} />
        <Row k={t('processor.contractView.commodity')} v={terms.commodity} />
        <Row k={t('processor.contractView.grade')} v={terms.grade ? tOr(`processor.grade.${GRADE_SLUG[terms.grade] ?? terms.grade}`, terms.grade) : null} />
        <Row k={t('processor.contractView.maxMoisture')} v={terms.moisture_max != null ? `${terms.moisture_max}%` : null} />
        <Row k={t('processor.contractView.packaging')} v={terms.packaging ? tOr(`processor.packaging.${PACKAGING_SLUG[terms.packaging] ?? terms.packaging}`, terms.packaging) : null} />
        <Row k={t('processor.contractView.quantity')} v={terms.quantity != null ? `${terms.quantity} ${terms.unit ? unitLabel(terms.unit) : ''}`.trim() : null} />
        <Row k={t('processor.contractView.price')} v={terms.price_per_unit != null
          ? t('processor.contractView.pricePerUnit', {
            price: formatNaira(terms.price_per_unit),
            unit: terms.unit ? unitLabel(terms.unit) : t('processor.contractView.unitWord'),
          })
          : null} />
        <Row k={t('processor.contractView.totalValue')} v={terms.total_value != null ? formatNaira(terms.total_value) : null} />
        <Row k={t('processor.contractView.delivery')} v={[
          terms.delivery_state,
          terms.delivery_deadline ? t('processor.contractView.byDate', { date: formatDateShort(terms.delivery_deadline) }) : '',
        ].filter(Boolean).join(' ') || null} />
        <Row k={t('processor.contractView.inspection')} v={terms.inspection_mode
          ? tOr(`processor.inspectionMode.${terms.inspection_mode}.label`, terms.inspection_mode)
          : null} />
        <Row k={t('processor.contractView.payment')} v={terms.payment_mode === 'escrow'
          ? t('processor.contractView.escrowViaPartner')
          : terms.payment_mode
            ? tOr(`processor.paymentMode.${terms.payment_mode}.label`, terms.payment_mode)
            : null} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {([{ slug: 'buyer', en: 'Buyer' }, { slug: 'supplier', en: 'Supplier' }] as const).map((party) => {
          const at = party.slug === 'buyer' ? contract.buyer_signed_at : contract.supplier_signed_at
          return (
            <div key={party.slug} className="rounded border border-line p-3 text-[13px]">
              <p className="text-emerald-900/50">{tOr(`processor.contractView.${party.slug}`, party.en)}</p>
              {at ? (
                <p className="mt-1 inline-flex items-center gap-1.5 font-medium text-emerald-700">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> {t('processor.contractView.signedOn', { date: formatDateShort(at) })}
                </p>
              ) : (
                <p className="mt-1 text-emerald-900/45">{t('processor.contractView.awaitingSignature')}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {contract.status === 'pending_signatures' && (
          <Button size="sm" onClick={() => { setSignOpen(true); setError(null) }}>
            <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {t('processor.contractView.signContract')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => downloadContract(contract)}>
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {t('processor.contractView.download')}
        </Button>
      </div>

      <Modal open={signOpen} onClose={() => setSignOpen(false)} title={t('processor.contractView.signContract')}>
        <form onSubmit={onSign} className="space-y-3">
          <p className="text-[13px] text-emerald-900/65">
            {t('processor.contractView.signExplainer')}
          </p>
          <div>
            <Label htmlFor="signname">{t('processor.contractView.yourFullName')}</Label>
            <Input id="signname" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('processor.contractView.namePlaceholder')} autoFocus />
          </div>
          {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? t('processor.contractView.signing') : t('processor.contractView.sign')}</Button>
            <Button type="button" variant="ghost" onClick={() => setSignOpen(false)}>{t('common.cancel')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
