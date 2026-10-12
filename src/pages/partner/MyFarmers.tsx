import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sprout } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import type { OnboardedFarmer } from '@/lib/partner'
import { formatDateShort } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { useT } from '@/lib/i18n'
import { SellerCard } from '@/components/SellerCard'

/**
 * Farmers this partner onboarded, with their verification-badge status.
 * The partner sees attribution + public status only — never the farmer's
 * farms, records, or evidence (drilling into internals is deliberately
 * impossible; RLS enforces it).
 */
export default function MyFarmers() {
  const { t } = useT()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [rows, setRows] = useState<OnboardedFarmer[] | null>(null)
  const [farmers, setFarmers] = useState<Record<string, PublicProfile>>({})

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    supabase
      .from('onboarded_farmers')
      .select('*')
      .eq('partner_id', profile.id)
      .order('created_at', { ascending: false })
      .then(async ({ data }) => {
        if (cancelled) return
        const list = (data as OnboardedFarmer[]) ?? []
        setRows(list)
        setFarmers(await fetchPublicProfiles(list.map((r) => r.farmer_id)))
      })
    return () => {
      cancelled = true
    }
  }, [profile])

  if (rows === null) {
    return <div className="h-40 animate-pulse rounded-card bg-white" aria-label={t('verification.farmers.loading')} />
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Sprout}
        title={t('verification.farmers.noneYet')}
        body={t('verification.farmers.noneYetHintFull')}
        action={{ label: t('verification.gp.onboardAFarmer'), onClick: () => navigate('/dashboard/growth_partner/onboard') }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-emerald-950">
        My farmers <span className="text-sm font-normal text-emerald-900/50">({rows.length})</span>
      </h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <Card key={r.id} className="space-y-2.5 p-5">
            <SellerCard profile={farmers[r.farmer_id]} />
            <p className="text-xs text-emerald-900/55">
              Onboarded {formatDateShort(r.created_at)} ·{' '}
              {r.onboarding_method === 'field_assisted' ? 'field-assisted' : 'referral link'}
            </p>
            <p className="text-[11px] text-emerald-900/45">
              {farmers[r.farmer_id]?.verified_badge
                ? 'Verified - this farmer carries the marketplace badge.'
                : t('verification.farmers.notVerified')}
            </p>
          </Card>
        ))}
      </div>
    </div>
  )
}
