import { useCallback, useEffect, useState } from 'react'
import { Truck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { fetchCompanyMembers, fetchMyCompanies } from '@/lib/companies'
import { fetchAllAwards, type RfqAward } from '@/lib/awards'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import AwardLogistics from '@/pages/processor/AwardLogistics'

function canProcure(role: string | null, isOwner: boolean) {
  return isOwner || role === 'Procurement Director' || role === 'Procurement Manager' || role === 'Logistics Coordinator'
}

/** Buyer logistics hub: per awarded consignment, arrange transport + storage. */
export default function Logistics() {
  const { t } = useT()
  const errorText = useErrorText()
  const { profile } = useAuth()
  const [awards, setAwards] = useState<RfqAward[]>([])
  const [loading, setLoading] = useState(true)
  const [can, setCan] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [hasCompany, setHasCompany] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cos = await fetchMyCompanies()
      if (!cos.length) { setHasCompany(false); return }
      setHasCompany(true)
      const [list, members] = await Promise.all([fetchAllAwards(), fetchCompanyMembers(cos[0].id)])
      // Only awards belonging to this company (view also returns supplier's own).
      setAwards(list.filter((a) => a.status !== 'cancelled'))
      const me = members.find((m) => m.user_id === profile?.id)
      setCan(canProcure(me?.company_role ?? null, me?.is_owner ?? false))
    } catch (e) { setError(errorText(e, 'processor.logistics.couldNotLoad', 'Could not load logistics.')) }
    finally { setLoading(false) }
  }, [profile?.id])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className="h-40 animate-pulse rounded bg-emerald-50" aria-label={t('processor.logistics.loading')} />
  if (!hasCompany) return <EmptyState icon={Truck} title={t('processor.logistics.registerFirst')} body={t('processor.logistics.registerFirstBody')} />

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <DashboardCard title={t('processor.logistics.awardedCount', { count: awards.length })}>
        {awards.length === 0 ? (
          <p className="py-6 text-center text-sm text-emerald-900/55">{t('processor.logistics.noneAwarded')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {awards.map((a) => (
              <div key={a.id} className="py-2.5">
                <button onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full items-center justify-between gap-2 text-left">
                  <span className="text-sm font-medium text-emerald-950">{t('processor.logistics.row', {
                    commodity: a.commodity ?? t('processor.logistics.consignmentFallback'),
                    quantity: a.awarded_quantity,
                    supplier: a.supplier_name ?? t('processor.logistics.supplierFallback'),
                  })}</span>
                  <span className="text-[12px] text-emerald-700">{open === a.id ? t('processor.logistics.hide') : t('processor.logistics.manage')}</span>
                </button>
                {open === a.id && (
                  <div className="mt-3">
                    <AwardLogistics awardId={a.id} commodity={a.commodity ?? ''} unit={a.unit ?? ''} deliveryState={a.supplier_state} canProcure={can} />
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
