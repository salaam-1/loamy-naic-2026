import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ClipboardList, FileStack, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { fetchCompanyMembers, fetchMyCompanies } from '@/lib/companies'
import {
  cancelRfq, closeRfq, deleteRfqDraft, deleteTemplate, fetchRfqs, fetchTemplates,
  GRADE_SLUG, INSPECTION_LABELS, PACKAGING_SLUG, PAYMENT_LABELS, UNIT_SLUG, VISIBILITY_LABELS,
  type Rfq, type RfqStatus, type RfqTemplate,
} from '@/lib/rfqs'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import RfqWizard from '@/pages/processor/RfqWizard'
import RfqBidsPanel from '@/pages/processor/RfqBidsPanel'

const STATUS_STYLE: Record<RfqStatus, string> = {
  draft: 'bg-emerald-50 text-emerald-900/60 ring-emerald-200',
  open: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  closed: 'bg-amber-50 text-amber-700 ring-amber-200',
  awarded: 'bg-[#faf4e6] text-[#8a6d24] ring-[#e4cf9c]',
  completed: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  cancelled: 'bg-red-50 text-red-600 ring-red-200',
}

function StatusBadge({ s }: { s: RfqStatus }) {
  const { tOr } = useT()
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ring-1 ${STATUS_STYLE[s]}`}>
      {tOr(`processor.rfqStatus.${s}`, s)}
    </span>
  )
}

function canProcure(role: string | null, isOwner: boolean) {
  return isOwner || role === 'Procurement Director' || role === 'Procurement Manager'
}
function canSettleRole(role: string | null, isOwner: boolean) {
  return isOwner || role === 'Procurement Director' || role === 'Finance Officer'
}

type View =
  | { mode: 'list' }
  | { mode: 'wizard'; rfq: Rfq | null }
  | { mode: 'detail'; rfq: Rfq }

/**
 * Buy Requests section: the company's RFQs, reusable templates, and the entry
 * point into the six-step wizard. Suppliers' bids on each request arrive in
 * Part 3; this part covers creation and lifecycle (publish / close / cancel).
 */
export default function BuyRequests() {
  const { t, tOr } = useT()
  const errorText = useErrorText()
  const unitLabel = (v: string) => tOr(`processor.unit.${UNIT_SLUG[v] ?? v}`, v)
  const gradeLabel = (v: string) => tOr(`processor.grade.${GRADE_SLUG[v] ?? v}`, v)
  const packagingLabel = (v: string) => tOr(`processor.packaging.${PACKAGING_SLUG[v] ?? v}`, v)
  const { profile } = useAuth()
  const [view, setView] = useState<View>({ mode: 'list' })
  const [rfqs, setRfqs] = useState<Rfq[]>([])
  const [templates, setTemplates] = useState<RfqTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [canCreate, setCanCreate] = useState(false)
  const [canSettle, setCanSettle] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasCompany, setHasCompany] = useState(true)
  const [confirm, setConfirm] = useState<{ kind: 'close' | 'cancel' | 'delete-draft'; rfq: Rfq } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cos = await fetchMyCompanies()
      if (!cos.length) { setHasCompany(false); return }
      setHasCompany(true)
      const [list, tpls, members] = await Promise.all([fetchRfqs(), fetchTemplates(), fetchCompanyMembers(cos[0].id)])
      setRfqs(list); setTemplates(tpls)
      const me = members.find((m) => m.user_id === profile?.id)
      setCanCreate(canProcure(me?.company_role ?? null, me?.is_owner ?? false))
      setCanSettle(canSettleRole(me?.company_role ?? null, me?.is_owner ?? false))
    } catch (e) {
      setError(errorText(e, 'processor.rfq.couldNotLoad', 'Could not load buy requests.'))
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { void load() }, [load])

  async function runConfirm() {
    if (!confirm) return
    setBusy(true); setError(null)
    try {
      if (confirm.kind === 'close') await closeRfq(confirm.rfq.id)
      else if (confirm.kind === 'cancel') await cancelRfq(confirm.rfq.id)
      else await deleteRfqDraft(confirm.rfq.id)
      setConfirm(null)
      await load()
    } catch (e) {
      setError(errorText(e, 'processor.rfq.actionFailed', 'Action failed.'))
    } finally { setBusy(false) }
  }

  if (view.mode === 'wizard') {
    return <RfqWizard initial={view.rfq} onDone={() => { setView({ mode: 'list' }); void load() }} onCancel={() => setView({ mode: 'list' })} />
  }

  if (view.mode === 'detail') {
    const r = view.rfq
    return (
      <div className="space-y-5">
        <button onClick={() => setView({ mode: 'list' })} className="inline-flex items-center gap-1 text-[13px] text-emerald-900/60 hover:text-emerald-900">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {t('processor.rfq.backToRequests')}
        </button>
        <DashboardCard
          title={r.reference}
          action={<StatusBadge s={r.status} />}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label={t('processor.rfq.commodity')} value={r.commodity} />
            <Detail label={t('processor.rfq.quantity')} value={`${r.quantity} ${unitLabel(r.unit)}`} />
            <Detail label={t('processor.rfq.grade')} value={r.grade ? gradeLabel(r.grade) : '-'} />
            <Detail label={t('processor.rfq.maxMoisture')} value={r.moisture_content != null ? `${r.moisture_content}%` : '-'} />
            <Detail label={t('processor.rfq.packaging')} value={r.packaging_type ? packagingLabel(r.packaging_type) : '-'} />
            <Detail label={t('processor.rfq.deliveryState')} value={r.delivery_state || '-'} />
            <Detail label={t('processor.rfq.deliveryDeadline')} value={r.delivery_deadline ? formatDateShort(r.delivery_deadline) : '-'} />
            <Detail label={t('processor.rfq.schedule')} value={r.delivery_schedule || '-'} />
            <Detail label={t('processor.rfq.pricing')} value={r.pricing_mode === 'fixed'
              ? t('processor.rfq.fixedMax', { amount: formatNaira(r.max_price ?? 0) })
              : t('processor.rfq.openBidding')} />
            <Detail label={t('processor.rfq.visibility')} value={tOr(`processor.visibility.${r.visibility}.label`, VISIBILITY_LABELS[r.visibility].label)} />
            <Detail label={t('processor.rfq.inspection')} value={tOr(`processor.inspectionMode.${r.inspection_mode}.label`, INSPECTION_LABELS[r.inspection_mode].label)} />
            <Detail label={t('processor.rfq.payment')} value={tOr(`processor.paymentMode.${r.payment_mode}.label`, PAYMENT_LABELS[r.payment_mode].label)} />
            <Detail label={t('processor.rfq.published')} value={r.published_at ? formatDateShort(r.published_at) : '-'} />
            <Detail label={t('processor.rfq.closes')} value={r.closes_at ? formatDateShort(r.closes_at) : '-'} />
          </div>
          {r.delivery_address && <div className="mt-4"><Detail label={t('processor.rfq.deliveryAddress')} value={r.delivery_address} /></div>}

          {canCreate && (r.status === 'open' || r.status === 'closed') && (
            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              {r.status === 'open' && <Button variant="outline" onClick={() => setConfirm({ kind: 'close', rfq: r })}>{t('processor.rfq.closeBidding')}</Button>}
              <Button variant="outline" className="!text-red-700 !border-red-200 hover:!bg-red-50" onClick={() => setConfirm({ kind: 'cancel', rfq: r })}>
                {t('processor.rfq.cancelRequest')}
              </Button>
            </div>
          )}
        </DashboardCard>

        {(r.status === 'open' || r.status === 'closed' || r.status === 'awarded') && (
          <DashboardCard title={t('processor.rfq.supplierBids')}>
            <RfqBidsPanel
              rfq={{ id: r.id, delivery_state: r.delivery_state, delivery_deadline: r.delivery_deadline, unit: r.unit, quantity: r.quantity }}
              canAward={canCreate}
              canSettle={canSettle}
            />
          </DashboardCard>
        )}
      </div>
    )
  }

  // LIST
  if (loading) return <div className="h-40 animate-pulse rounded bg-emerald-50" aria-label={t('processor.rfq.loading')} />

  if (!hasCompany) {
    return <EmptyState icon={ClipboardList} title={t('processor.rfq.registerFirst')}
      body={t('processor.rfq.registerFirstBody')} />
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <DashboardCard
        title={t('processor.rfq.titleCount', { count: rfqs.length })}
        action={canCreate ? (
          <Button size="sm" onClick={() => setView({ mode: 'wizard', rfq: null })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {t('processor.rfq.newBuyRequest')}
          </Button>
        ) : undefined}
      >
        {rfqs.length === 0 ? (
          <p className="py-6 text-center text-sm text-emerald-900/55">
            {t('processor.rfq.noneYetShort')}{canCreate ? t('processor.rfq.noneYetCta') : ''}
          </p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="py-2 pr-4 font-medium">{t('processor.rfq.reference')}</th>
                <th className="py-2 pr-4 font-medium">{t('processor.rfq.commodity')}</th>
                <th className="py-2 pr-4 font-medium">{t('processor.rfq.quantity')}</th>
                <th className="py-2 pr-4 font-medium">{t('processor.rfq.pricing')}</th>
                <th className="py-2 pr-4 font-medium">{t('processor.rfq.status')}</th>
                <th className="py-2 pr-4 font-medium">{t('processor.rfq.closes')}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rfqs.map((r) => (
                <tr key={r.id} className="hover:bg-emerald-50/40">
                  <td className="py-2.5 pr-4 font-mono text-[12px] text-emerald-900/70">{r.reference}</td>
                  <td className="py-2.5 pr-4 font-medium text-emerald-950">{r.commodity}</td>
                  <td className="py-2.5 pr-4 text-emerald-900/80">{r.quantity} {unitLabel(r.unit)}</td>
                  <td className="py-2.5 pr-4 text-emerald-900/70">{r.pricing_mode === 'fixed' ? formatNaira(r.max_price ?? 0) : t('processor.rfq.open')}</td>
                  <td className="py-2.5 pr-4"><StatusBadge s={r.status} /></td>
                  <td className="py-2.5 pr-4 text-[13px] text-emerald-900/55">{r.closes_at ? formatDateShort(r.closes_at) : '-'}</td>
                  <td className="py-2.5 text-right">
                    {r.status === 'draft' ? (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setView({ mode: 'wizard', rfq: r })} className="rounded px-2 py-1 text-[13px] text-emerald-700 hover:bg-emerald-50">{t('processor.rfq.continueDraft')}</button>
                        {canCreate && (
                          <button onClick={() => setConfirm({ kind: 'delete-draft', rfq: r })} className="rounded px-2 py-1 text-[13px] text-red-700 hover:bg-red-50" aria-label={t('processor.rfq.deleteDraft')}>
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                    ) : (
                      <button onClick={() => setView({ mode: 'detail', rfq: r })} className="rounded px-2 py-1 text-[13px] text-emerald-700 hover:bg-emerald-50">{t('processor.rfq.view')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DashboardCard>

      {templates.length > 0 && (
        <DashboardCard title={t('processor.rfq.templates')}>
          <div className="flex flex-col divide-y divide-line">
            {templates.map((tpl) => (
              <div key={tpl.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <FileStack className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-emerald-950">{tpl.name}</p>
                    <p className="text-[11px] text-emerald-900/50">{t('processor.rfq.templateSaved', {
                      commodity: tpl.payload.commodity ?? t('processor.rfq.templateFallbackName'),
                      date: formatDateShort(tpl.created_at),
                    })}</p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {canCreate && (
                    <button onClick={() => setView({ mode: 'wizard', rfq: { ...(tpl.payload as Rfq), id: '', status: 'draft' } as Rfq })}
                      className="rounded px-2 py-1 text-[13px] text-emerald-700 hover:bg-emerald-50">{t('processor.rfq.useTemplate')}</button>
                  )}
                  {canCreate && (
                    <button onClick={async () => { await deleteTemplate(tpl.id); void load() }}
                      className="rounded px-2 py-1 text-[13px] text-red-700 hover:bg-red-50" aria-label={t('processor.rfq.deleteTemplate')}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DashboardCard>
      )}

      <Modal open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm?.kind === 'close'
          ? t('processor.rfq.closeBidding')
          : confirm?.kind === 'cancel'
            ? t('processor.rfq.cancelBuyRequestTitle')
            : t('processor.rfq.deleteDraftTitle')}>
        <p className="text-sm text-emerald-900/70">
          {confirm?.kind === 'close' && t('processor.rfq.confirmClose')}
          {confirm?.kind === 'cancel' && t('processor.rfq.confirmCancel')}
          {confirm?.kind === 'delete-draft' && t('processor.rfq.confirmDeleteDraft')}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="!text-red-700 !border-red-200 hover:!bg-red-50" onClick={runConfirm} disabled={busy}>
            {busy
              ? t('processor.rfq.working')
              : confirm?.kind === 'close'
                ? t('processor.rfq.closeBidding')
                : confirm?.kind === 'cancel'
                  ? t('processor.rfq.cancelRequest')
                  : t('processor.rfq.delete')}
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(null)}>{t('processor.rfq.keep')}</Button>
        </div>
      </Modal>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-emerald-900/45">{label}</p>
      <p className="mt-0.5 text-sm text-emerald-950">{value}</p>
    </div>
  )
}
