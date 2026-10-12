import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Building2, Info, Landmark, Receipt } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { PayoutAccountCard } from '@/components/PayoutAccountCard'
import { formatNaira } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

interface Entry {
  ref: string
  at: string
  event: string
  amount: number
  direction: 'owed_to_you' | 'owed_by_you'
  description: string | null
  provider: string | null
  subject_type: string | null
  subject_id: string | null
}

interface Activity {
  available: boolean
  currency: string
  receivable: number
  payable: number
  settled_externally: number
  entries: Entry[]
  custody: 'none'
  note: string
}

/**
 * A ledger event type this build has no wording for.
 *
 * The event types are the database's, not ours, and a new one can appear
 * without a release here. Rendering it as itself -- `escrow_topup` as
 * "escrow topup" -- is the same fallback the page used before it was
 * translated: unfamiliar, but readable, and never a translation key.
 */
const humanise = (event: string) => event.replace(/_/g, ' ')

/**
 * Financial activity (dashboard section: `wallet` — route preserved so no
 * existing link breaks).
 *
 * This REPLACES the old Wallet. The distinction is the entire point:
 *
 *   a wallet says      "your money is here, withdraw it"
 *   this says          "here is what happened, and who owes what"
 *
 * Loamy holds no member funds, so there is no balance, no available figure
 * and no withdraw form. Everything is read from the authoritative
 * double-entry ledger via loamy_my_financial_activity.
 */
export default function FinancialActivity() {
  const { t, tOr } = useT()
  const [activity, setActivity] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('loamy_my_financial_activity', { p_limit: 50 })
    setActivity((data as Activity) ?? null)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const entries = activity?.entries ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-emerald-950">{t('financial.title')}</h1>
        <p className="mt-0.5 text-sm text-emerald-900/60">
          {t('financial.subtitle')}
        </p>
      </header>

      {/* The honest framing, stated before any number. */}
      <div className="flex items-start gap-2.5 rounded border border-line bg-emerald-900/[0.02] p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" strokeWidth={1.5} aria-hidden />
        <p className="text-xs leading-relaxed text-emerald-900/70">
          <strong className="font-medium text-emerald-900">{t('financial.noCustody')}</strong>{' '}
          {/* `activity.note` is written by loamy_my_financial_activity and
              arrives in English. It is the server's sentence, not the
              interface's, so it is rendered as given; the fallback below is
              ours and is translated. Localising the server note means
              returning a code from the RPC, which is a schema change. */}
          {activity?.note ?? t('financial.noteFallback')}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          icon={ArrowDownLeft}
          label={t('financial.owedToYou')}
          sub={t('financial.owedToYouSub')}
          value={activity?.receivable ?? 0}
          loading={loading}
          tone="good"
        />
        <Figure
          icon={ArrowUpRight}
          label={t('financial.owedByYou')}
          sub={t('financial.owedByYouSub')}
          value={activity?.payable ?? 0}
          loading={loading}
        />
        <Figure
          icon={Building2}
          label={t('financial.paidDirectly')}
          sub={t('financial.paidDirectlySub')}
          value={activity?.settled_externally ?? 0}
          loading={loading}
        />
      </div>

      <DashboardCard title={t('financial.movements')}>
        {loading ? (
          <div className="h-20 animate-pulse rounded bg-emerald-50" aria-label={t('financial.loadingActivity')} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t('financial.empty')}
            body={t('financial.emptyBody')}
          />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.ref} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-emerald-950">
                    {tOr(`financial.event.${e.event}`, humanise(e.event))}
                  </p>
                  <p className="text-[11px] text-emerald-900/50">
                    {new Date(e.at).toLocaleDateString('en-NG', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                    {e.provider ? ` · ${e.provider}` : ''}
                    {' · '}<span className="font-mono">{e.ref}</span>
                  </p>
                  {e.description && (
                    <p className="mt-0.5 text-[11px] text-emerald-900/45">{e.description}</p>
                  )}
                </div>
                <p className={cn(
                  'font-mono text-sm font-medium',
                  e.direction === 'owed_to_you' ? 'text-emerald-700' : 'text-emerald-900/70',
                )}>
                  {e.direction === 'owed_to_you' ? '+' : '−'}{formatNaira(Math.abs(Number(e.amount)))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>

      {/* Where settlement lands — the honest counterpart to a withdraw form. */}
      <PayoutAccountCard />

      <p className="flex items-start gap-1.5 text-xs text-emerald-900/55">
        <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
        {t('financial.settlementNote')}{' '}
        <Link to="/trace" className="font-medium text-emerald-700 hover:text-emerald-800">
          {t('financial.traceReference')}
        </Link>
      </p>
    </div>
  )
}

function Figure({
  icon: Icon, label, sub, value, loading, tone,
}: {
  icon: typeof Receipt
  label: string
  sub: string
  value: number
  loading: boolean
  tone?: 'good'
}) {
  return (
    <DashboardCard title={label}>
      {loading ? (
        <div className="h-10 animate-pulse rounded bg-emerald-50" aria-hidden />
      ) : (
        <>
          <p className={cn(
            'font-mono text-xl font-semibold',
            tone === 'good' ? 'text-emerald-700' : 'text-emerald-950',
          )}>
            {formatNaira(value)}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-900/55">
            <Icon className="h-3 w-3" strokeWidth={1.5} aria-hidden />
            {sub}
          </p>
        </>
      )}
    </DashboardCard>
  )
}
