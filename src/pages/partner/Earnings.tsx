import { useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PAYOUT_COPY, type PartnerEarning } from '@/lib/partner'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { useT } from '@/lib/i18n'
import { StatCard } from '@/components/StatCard'

/** Earnings are TRACKED here; payout execution does not exist on Loamy. */
export default function Earnings() {
  const { t, tOr } = useT()
  const [earnings, setEarnings] = useState<PartnerEarning[] | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('partner_earnings')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setEarnings((data as PartnerEarning[]) ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const accrued = (earnings ?? []).filter((e) => e.status === 'accrued').reduce((s, e) => s + Number(e.amount), 0)
  const paid = (earnings ?? []).filter((e) => e.status === 'paid_externally').reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard icon={ClipboardList} label={t('verification.earnings.accrued')} value={formatNaira(accrued)} sub={t('verification.earnings.awaitingPayout')} loading={earnings === null} />
        <StatCard icon={ClipboardList} label={t('verification.earnings.paidExternally')} value={formatNaira(paid)} sub={t('verification.earnings.settledOutside')} loading={earnings === null} />
      </div>

      <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-800">
        {tOr('verification.payoutCopy', PAYOUT_COPY)}
      </p>

      <DashboardCard title={t('verification.earnings.history')}>
        {earnings === null ? (
          <div className="h-24 animate-pulse rounded-lg bg-emerald-50" aria-label={t('verification.earnings.loading')} />
        ) : earnings.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ClipboardList className="h-7 w-7 text-emerald-900/20" aria-hidden />
            <p className="max-w-sm text-sm text-emerald-900/50">
              {t('verification.earnings.nothingYetFull')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-emerald-950/5">
            {earnings.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-emerald-950">
                    {e.earning_type === 'onboarding' ? t('verification.earnings.farmerOnboarding') : t('verification.earnings.farmVerification')} · {formatNaira(Number(e.amount))}
                  </p>
                  <p className="text-[11px] text-emerald-900/45">
                    {formatDateShort(e.created_at)}
                    {e.paid_note ? ` · ${e.paid_note}` : ''}
                  </p>
                </div>
                <span
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium',
                    e.status === 'accrued'
                      ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                      : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
                  )}
                >
                  {e.status === 'accrued' ? t('verification.earnings.accrued') : t('verification.earnings.paidExternallyShort')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>
    </div>
  )
}
