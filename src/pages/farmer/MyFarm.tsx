import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Tractor } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Farm } from '@/lib/farming'
import { OWNERSHIP_LABELS } from '@/lib/farming'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { useT } from '@/lib/i18n'
import { VerificationBadge } from '@/components/VerificationBadge'

/** Farm register — dense table; RLS returns only the signed-in farmer's farms. */
export default function MyFarm() {
  const { t } = useT()
  const navigate = useNavigate()
  const [farms, setFarms] = useState<Farm[] | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('farms')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setFarms((data as Farm[]) ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (farms === null) {
    return <div className="h-32 animate-pulse rounded bg-white" aria-label={t('farm.loadingFarms')} />
  }

  if (farms.length === 0) {
    return (
      <EmptyState
        icon={Tractor}
        title={t('farm.noFarmsRegistered')}
        body={t('farm.noFarmsHint')}
        action={{ label: t('farm.registerFarmShort'), onClick: () => navigate('/dashboard/farmer/my-farm/new') }}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-emerald-950">
          Farms <span className="font-mono text-sm font-normal text-emerald-900/50">{farms.length}</span>
        </h1>
        <Button size="sm" onClick={() => navigate('/dashboard/farmer/my-farm/new')}>
          <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {t('farm.addFarm')}
        </Button>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
              <th className="px-4 py-2 font-medium">Farm</th>
              <th className="px-4 py-2 font-medium">{t('farm.location')}</th>
              <th className="px-4 py-2 font-medium">{t('farm.size')}</th>
              <th className="hidden px-4 py-2 font-medium md:table-cell">{t('farm.crops')}</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">{t('farm.tenure')}</th>
              <th className="px-4 py-2 font-medium">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {farms.map((farm) => (
              <tr
                key={farm.id}
                onClick={() => navigate(`/dashboard/farmer/my-farm/${farm.id}`)}
                className="cursor-pointer transition-colors hover:bg-emerald-50/60"
              >
                <td className="px-4 py-2.5 font-medium text-emerald-950">{farm.farm_name}</td>
                <td className="px-4 py-2.5 text-emerald-900/70">{farm.lga}, {farm.state}</td>
                <td className="px-4 py-2.5 font-mono text-[13px] text-emerald-950">{Number(farm.size_hectares)} ha</td>
                <td className="hidden max-w-52 truncate px-4 py-2.5 text-emerald-900/70 md:table-cell">
                  {farm.primary_crops.join(', ')}
                </td>
                <td className="hidden px-4 py-2.5 text-emerald-900/70 sm:table-cell">
                  {OWNERSHIP_LABELS[farm.ownership_type]}
                </td>
                <td className="px-4 py-2.5"><VerificationBadge status={farm.verification_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
