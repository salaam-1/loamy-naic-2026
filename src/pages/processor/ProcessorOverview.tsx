import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BadgeCheck, BarChart3, Boxes, ClipboardCheck, ClipboardList, Handshake, Landmark, PackageCheck, Truck,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { fetchMyCompanies } from '@/lib/companies'
import { fetchKpis, type ProcurementKpis } from '@/lib/procurement'
import { formatNaira } from '@/lib/utils'
import { StatCard } from '@/components/StatCard'
import { EmptyState } from '@/components/EmptyState'
import { DashboardCard } from '@/components/DashboardCard'
import { useT } from '@/lib/i18n'

/**
 * Procurement dashboard home — live KPI cards (real data, zeros show as zeros)
 * and quick links into the procurement workflow. Shared by every procurement
 * role (processor, exporter), so every link is built from the signed-in user's
 * own role slug — a hardcoded /dashboard/processor/... would bounce an exporter
 * straight back out via RoleDashboard's own-role guard.
 */
export default function ProcessorOverview() {
  const { t } = useT()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [kpis, setKpis] = useState<ProcurementKpis | null>(null)
  const [hasCompany, setHasCompany] = useState<boolean | null>(null)
  const base = `/dashboard/${profile?.platform_role ?? 'processor'}`

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cos = await fetchMyCompanies().catch(() => [])
      if (cancelled) return
      setHasCompany(cos.length > 0)
      if (cos.length) fetchKpis().then((k) => { if (!cancelled) setKpis(k) }).catch(() => {})
    })()
    return () => { cancelled = true }
  }, [])

  if (hasCompany === false) {
    return (
      <div className="space-y-5">
        <EmptyState icon={ClipboardList} title={t('processor.overview.welcome')}
          body={t('processor.overview.registerPrompt')}
          action={{ label: t('processor.overview.registerCompany'), onClick: () => navigate(`${base}/company`) }} />
      </div>
    )
  }

  const loading = kpis === null
  const cards = [
    { label: t('processor.overview.activeBuyRequests'), sub: t('processor.overview.openForBids'), icon: ClipboardList, value: kpis?.activeRfqs },
    { label: t('processor.overview.bidsAwaitingReview'), sub: t('processor.overview.toCompare'), icon: Handshake, value: kpis?.bidsAwaiting },
    { label: t('processor.overview.awardsInProgress'), sub: t('processor.overview.beingFulfilled'), icon: BadgeCheck, value: kpis?.awardsInProgress },
    { label: t('processor.overview.commodities'), sub: t('processor.overview.beingProcured'), icon: Boxes, value: kpis?.commodities },
    { label: t('processor.overview.fundsInEscrow'), sub: t('processor.overview.heldByPartner'), icon: Landmark, value: kpis ? formatNaira(kpis.fundsInEscrow) : undefined },
    { label: t('processor.overview.inspectionsPending'), sub: t('processor.overview.awaitingOrInReview'), icon: ClipboardCheck, value: kpis?.inspectionsPending },
    { label: t('processor.overview.deliveriesPending'), sub: t('processor.overview.inTransit'), icon: Truck, value: kpis?.deliveriesPending },
    { label: t('processor.overview.completed'), sub: t('processor.overview.fulfilledAwards'), icon: PackageCheck, value: kpis?.completed },
  ]

  const links = [
    { label: t('processor.overview.postBuyRequest'), to: `${base}/rfqs`, icon: ClipboardList },
    { label: t('processor.overview.reviewBidsAward'), to: `${base}/rfqs`, icon: Handshake },
    { label: t('processor.overview.analytics'), to: `${base}/analytics`, icon: BarChart3 },
    { label: t('processor.overview.companyAndTeam'), to: `${base}/team`, icon: Boxes },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} icon={c.icon} label={c.label} sub={c.sub}
            value={c.value ?? (typeof c.value === 'number' ? 0 : '-')} loading={loading} />
        ))}
      </div>

      <DashboardCard title={t('processor.overview.quickActions')}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {links.map((l) => (
            <button key={l.label} onClick={() => navigate(l.to)}
              className="flex items-center gap-2 rounded border border-line bg-white px-3 py-2.5 text-left text-sm text-emerald-900 hover:bg-emerald-50">
              <l.icon className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden /> {l.label}
            </button>
          ))}
        </div>
      </DashboardCard>

      <DashboardCard title={t('processor.overview.digitalId')}>
        <p className="font-mono text-lg font-semibold tracking-wider text-emerald-800">{profile?.digital_id ?? '-'}</p>
        <p className="mt-1 text-xs text-emerald-900/50">{t('processor.overview.digitalIdHint')}</p>
      </DashboardCard>
    </div>
  )
}
