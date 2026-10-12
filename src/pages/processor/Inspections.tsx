import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { canAdminRole, fetchCompanyMembers, fetchMyCompanies } from '@/lib/companies'
import { fetchCompanyInspections, type InspectionJob } from '@/lib/inspections'
import { formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import InspectionReport from '@/pages/processor/InspectionReport'

const STATUS_CLS: Record<InspectionJob['status'], string> = {
  requested: 'bg-emerald-50 text-emerald-900/60 ring-emerald-200',
  assigned: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  in_progress: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  submitted: 'bg-amber-50 text-amber-700 ring-amber-200',
  accepted: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  disputed: 'bg-red-50 text-red-600 ring-red-200',
  cancelled: 'bg-emerald-50 text-emerald-900/45 ring-emerald-200',
}

/** Company-wide inspections overview for the processor. */
export default function Inspections() {
  const { t, tOr } = useT()
  const errorText = useErrorText()
  const { profile } = useAuth()
  const [jobs, setJobs] = useState<InspectionJob[]>([])
  const [loading, setLoading] = useState(true)
  const [canReview, setCanReview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [hasCompany, setHasCompany] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cos = await fetchMyCompanies()
      if (!cos.length) { setHasCompany(false); return }
      setHasCompany(true)
      const [list, members] = await Promise.all([fetchCompanyInspections(), fetchCompanyMembers(cos[0].id)])
      setJobs(list)
      const me = members.find((m) => m.user_id === profile?.id)
      const role = me?.company_role ?? null
      setCanReview(canAdminRole(role, me?.is_owner ?? false) || role === 'Procurement Manager')
    } catch (e) {
      setError(errorText(e, 'processor.inspection.couldNotLoad', 'Could not load inspections.'))
    } finally { setLoading(false) }
  }, [profile?.id])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className="h-40 animate-pulse rounded bg-emerald-50" aria-label={t('processor.inspection.loading')} />
  if (!hasCompany) return <EmptyState icon={ClipboardCheck} title={t('processor.inspection.registerFirst')} body={t('processor.inspection.registerFirstBody')} />

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <DashboardCard title={t('processor.inspection.titleCount', { count: jobs.length })}>
        {jobs.length === 0 ? (
          <p className="py-6 text-center text-sm text-emerald-900/55">{t('processor.inspection.noneYetRequest')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {jobs.map((j) => (
              <div key={j.id} className="py-2.5">
                <button onClick={() => setOpen(open === j.id ? null : j.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                  <div>
                    <p className="text-sm font-medium text-emerald-950">{t('processor.inspection.headline', { commodity: j.commodity, quantity: j.awarded_quantity, unit: j.unit })}</p>
                    <p className="text-[11px] text-emerald-900/50">{t('processor.inspection.subline', {
                      reference: j.rfq_reference,
                      supplier: j.supplier_name ?? t('processor.inspection.supplierFallback'),
                      date: formatDateShort(j.created_at),
                    })}</p>
                  </div>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ring-1 ${STATUS_CLS[j.status]}`}>{tOr(`processor.inspectionStatus.${j.status}`, j.status.replace('_', ' '))}</span>
                </button>
                {open === j.id && (
                  <div className="mt-3">
                    {j.status === 'requested' || j.status === 'assigned' || j.status === 'in_progress' ? (
                      <p className="text-[13px] text-emerald-900/55">
                        {j.mode === 'loamy_partner'
                          ? (j.assigned_partner_id
                            ? t('processor.inspection.beingInspectedBy', {
                              partner: j.partner_name ?? t('processor.inspection.aGrowthPartner'),
                            })
                            : t('processor.inspection.offeredToPartners'))
                          : t('processor.inspection.awaitingReport')}
                      </p>
                    ) : (
                      <InspectionReport job={j} canReview={canReview} onReviewed={load} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DashboardCard>
    </div>
  )
}
