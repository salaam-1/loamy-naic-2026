import { useT } from '@/lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck, Boxes, ClipboardCheck, Compass, Landmark, LineChart, Package,
  Plus, Receipt, Route as RouteIcon, ShieldCheck, Sprout, Store, Tags, Tractor,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { isPlatformRole, type PlatformRole } from '@/lib/types'
import {
  EMPTY_CONTEXT, canFinance, canGrow, canSell, fetchHomeContext, greeting,
  buildYieldChart, isActiveTransaction, isOpenFinancing, leadTransaction,
  type HomeContext,
} from '@/lib/home'
import { Price } from '@/components/Money'
import { HomeHero } from '@/components/home/HomeHero'
import {
  ActiveDeal, ActivityFeed, Figure, HomeEmpty, QuickActions, Section,
  type ActivityItem, type QuickAction,
} from '@/components/home/HomeSections'
import { DailyPricesPanel } from '@/components/DailyPricesPanel'
import { BarBreakdown } from '@/components/charts/BarBreakdown'
import { Card } from '@/components/ui/card'
import { Skeleton, SkeletonRow, LoadingRegion } from '@/components/ui/skeleton'
import { firstName, formatDateShort } from '@/lib/utils'

/**
 * Home — the front door.
 *
 * WHAT IT REPLACES
 *   Four stat cards reading `role_details.role_data` (onboarding self-reports,
 *   not live data), an empty state, and two explainer cards. Every role saw
 *   the same shape, and three of the four numbers were usually blank.
 *
 * WHAT IT ANSWERS, IN ORDER
 *   1. Who am I?        the hero, with the member's own identity and state
 *   2. What can I do?   quick actions, chosen for the role
 *   3. What's happening? the active deal, with its real three state machines
 *   4. What's next?     market context and recent activity
 *
 * COMPOSITION
 *   Hero → actions → deal → context → activity. Each band has a different
 *   shape on purpose (§19): an image-backed hero, a chip row, a wide panel
 *   with rails, a price panel, a timeline. Nothing here is a grid of equal
 *   cards, because that is the pattern this phase exists to remove.
 *
 * NO FABRICATION
 *   Every number is a row count or a column from a table the member can see
 *   under RLS. A member with nothing gets an empty state and a next action —
 *   never a plausible-looking figure.
 */

const HERO_IMAGE: Partial<Record<PlatformRole, string>> = {
  // The public, credited photographs already shipped in /public/images. Chosen
  // so the picture matches what the role actually does; nothing here is
  // anybody's private farm or verification evidence.
  farmer: '/images/hero-farmer.jpg',
  trader: '/images/hero-market.jpg',
  buyer: '/images/hero-market.jpg',
  exporter: '/images/hero-harvest.jpg',
  input_supplier: '/images/hero-market.jpg',
  growth_partner: '/images/hero-farmer.jpg',
  // These three were missing, and a missing key is legal here because the map
  // is Partial<>, so TypeScript never complained. HomeHero falls back to a
  // flat `bg-env-sage` panel, which is why the logistics dashboard showed a
  // large empty block where every other role gets a photograph.
  //
  // Logistics and processing then got their own photographs rather than
  // borrowing the market and harvest ones. A haulier and a miller do not
  // recognise their work in a picture of a grain market, and the point of the
  // hero is that the role sees itself.
  logistics_provider: '/images/hero-logistics.jpg',
  warehouse_owner: '/images/hero-harvest.jpg',
  processor: '/images/hero-processing.jpg',
}

/** Photographs bright enough to need the heavier scrim. Verified by measurement. */
const HERO_SCRIM: Partial<Record<PlatformRole, 'default' | 'strong'>> = {
  farmer: 'strong',
  growth_partner: 'strong',
}

const HERO_ALT: Partial<Record<PlatformRole, string>> = {
  farmer: 'A farmer holding freshly harvested cassava roots',
  trader: 'Traders at a Nigerian grain market',
  buyer: 'Traders at a Nigerian grain market',
  exporter: 'Sacks of harvested grain ready for market',
  input_supplier: 'Traders at a Nigerian grain market',
  growth_partner: 'A farmer holding freshly harvested cassava roots',
  logistics_provider: 'Workers loading sacks of grain onto a flatbed truck',
  warehouse_owner: 'Sacks of harvested grain ready for market',
  processor: 'Peeled cassava roots being fed into a processing machine',
}

export default function Home({ role }: { role: PlatformRole }) {
  const { t } = useT()
  const { profile } = useAuth()
  const [ctx, setCtx] = useState<HomeContext | null>(null)

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    void fetchHomeContext(profile.id, isPlatformRole(role) ? role : null).then((c) => {
      if (!cancelled) setCtx(c)
    })
    return () => { cancelled = true }
  }, [profile, role])

  // Every list is guarded. Home is the first screen after sign-in; a shape
  // surprise from any one source must degrade that panel, not blank the page.
  const raw = ctx ?? EMPTY_CONTEXT
  const c: HomeContext = {
    ...raw,
    farms: Array.isArray(raw.farms) ? raw.farms : [],
    cropRecords: Array.isArray(raw.cropRecords) ? raw.cropRecords : [],
    listings: Array.isArray(raw.listings) ? raw.listings : [],
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    financing: Array.isArray(raw.financing) ? raw.financing : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
  }
  const loading = ctx === null
  const base = `/dashboard/${role}`

  const deal = useMemo(() => leadTransaction(c.transactions), [c.transactions])
  const activeCount = c.transactions.filter(isActiveTransaction).length
  const openFinancing = c.financing.filter(isOpenFinancing)
  const verifiedFarms = c.farms.filter((f) => f.verification_status === 'verified').length
  const hectares = c.farms.reduce((n, f) => n + Number(f.size_hectares ?? 0), 0)
  const openTasks = c.tasks.filter((t) => !['approved', 'rejected'].includes(t.status))
  // The farmer's credit file, charted from recorded yields only.
  const yieldChart = useMemo(() => buildYieldChart(c.cropRecords), [c.cropRecords])

  // ---- Hero, per role, from real state -------------------------------------
  let eyebrow = `${greeting()}, ${firstName(profile?.full_name)}`
  let title = 'Your agricultural network, in one place.'
  let subtitle: string | undefined
  let facts: { label: string; value: string; strong?: boolean }[] = []
  let heroAction: { label: string; to: string } | undefined
  let badge: { label: string; verified?: boolean } | undefined

  if (role === 'growth_partner') {
    title = openTasks.length > 0
      ? `${openTasks.length} verification ${openTasks.length === 1 ? 'case' : 'cases'} need you`
      : 'No field work assigned right now'
    subtitle = openTasks.length > 0
      ? 'Loamy members are waiting on a field visit. Accept a case to begin.'
      : 'New verification cases appear here as they are assigned to you.'
    if (openTasks[0]) {
      facts = [
        { label: 'Next case', value: openTasks[0].ref ?? openTasks[0].task_type.replace(/_/g, ' ') },
        { label: 'Location', value: [openTasks[0].expected_lga, openTasks[0].expected_state].filter(Boolean).join(', ') || 'Not specified' },
      ]
      heroAction = { label: 'Open field work', to: `${base}/verification-tasks` }
    }
  } else if (canGrow(role) && c.farms.length > 0) {
    const farm = c.farms[0]
    title = farm.farm_name
    subtitle = [farm.lga, farm.state].filter(Boolean).join(', ') || undefined
    facts = [
      { label: 'Land on record', value: `${hectares.toLocaleString('en-NG')} ha`, strong: true },
      { label: 'Crops', value: farm.primary_crops?.join(', ') || 'Not recorded' },
      { label: 'Farms', value: String(c.farms.length) },
    ]
    badge = verifiedFarms > 0
      ? { label: `${verifiedFarms} field-verified`, verified: true }
      : { label: 'Not yet verified' }
    heroAction = { label: 'Open your farm', to: `${base}/my-farm` }
  } else if (canGrow(role)) {
    title = 'Register your first farm'
    subtitle = 'A verified farm record is what unlocks financing, traceable stock and verified supply on Loamy.'
    heroAction = { label: 'Register a farm', to: `${base}/my-farm` }
  } else if (activeCount > 0 && deal) {
    title = `${deal.commodity} ${deal.side === 'buying' ? 'purchase' : 'sale'} in progress`
    subtitle = `${activeCount} ${activeCount === 1 ? 'deal is' : 'deals are'} moving through Loamy right now.`
    heroAction = { label: 'Open the marketplace', to: `${base}/marketplace` }
  } else if (canSell(role) && c.listings.length > 0) {
    title = `${c.listings.length} ${c.listings.length === 1 ? 'listing' : 'listings'} live on the marketplace`
    subtitle = 'Buyers can find and enquire about your stock.'
    heroAction = { label: 'Manage listings', to: `${base}/my-listings` }
  } else {
    subtitle = 'Verified identity, traceable commodities and bank-rails financing - in one place.'
    heroAction = { label: 'Explore the marketplace', to: `${base}/marketplace` }
  }

  // ---- Quick actions, per role ---------------------------------------------
  const actions: QuickAction[] = []
  if (canGrow(role)) {
    actions.push({ label: 'Record a harvest', to: `${base}/my-farm`, icon: Sprout, primary: c.farms.length > 0 })
    actions.push({ label: 'My stock', to: `${base}/my-stock`, icon: Boxes })
  }
  if (canSell(role)) {
    actions.push({ label: 'Create a listing', to: `${base}/my-listings/new`, icon: Plus, primary: !canGrow(role) })
  }
  if (role === 'growth_partner') {
    actions.push({ label: 'Field work', to: `${base}/verification-tasks`, icon: ClipboardCheck, primary: true })
    actions.push({ label: 'Onboard a farmer', to: `${base}/onboard`, icon: Plus })
    actions.push({ label: 'Earnings', to: `${base}/earnings`, icon: Receipt })
  } else {
    actions.push({ label: 'Marketplace', to: `${base}/marketplace`, icon: Store })
    actions.push({ label: 'Discover', to: `${base}/discover`, icon: Compass })
  }
  if (canFinance(role)) actions.push({ label: 'Financing', to: `${base}/financing`, icon: Landmark })
  actions.push({ label: 'Trace', to: '/trace', icon: RouteIcon })

  // ---- Activity feed, from real rows ---------------------------------------
  const activity: ActivityItem[] = useMemo(() => {
    const items: ActivityItem[] = []
    for (const t of c.transactions.slice(0, 4)) {
      items.push({
        id: `t-${t.id}`,
        title: `${t.commodity} ${t.side === 'buying' ? 'purchase' : 'sale'} · ${t.status.replace(/_/g, ' ')}`,
        detail: `${Number(t.quantity).toLocaleString('en-NG')} ${t.unit}`,
        at: t.created_at,
        to: `/purchase/${t.id}`,
        tone: isActiveTransaction(t) ? 'pending' : 'verified',
      })
    }
    for (const f of c.financing.slice(0, 2)) {
      items.push({
        id: `f-${f.id}`,
        title: `Financing application · ${f.status.replace(/_/g, ' ')}`,
        at: f.created_at,
        to: `${base}/financing`,
        tone: isOpenFinancing(f) ? 'pending' : 'neutral',
      })
    }
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
  }, [c.transactions, c.financing, base])

  if (loading) {
    return (
      <LoadingRegion label="Loading your home" className="space-y-6">
        <Skeleton className="h-60 w-full rounded-card sm:h-68" />
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-32 rounded-pill" />)}
        </div>
        <Skeleton className="h-40 w-full rounded-card" />
        <Card className="p-5">{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</Card>
      </LoadingRegion>
    )
  }

  return (
    <div className="space-y-7">
      <HomeHero
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
        facts={facts}
        action={heroAction}
        badge={badge}
        image={HERO_IMAGE[role]}
        imageAlt={HERO_ALT[role]}
        scrim={HERO_SCRIM[role] ?? 'default'}
      />

      <QuickActions actions={actions} />

      {deal && (
        <Section
          title={t('dashboard.activeDeal')}
          hint={activeCount > 1 ? `${activeCount} deals in progress` : undefined}
          action={activeCount > 1 ? { label: 'View all', to: '/orders' } : undefined}
        >
          <ActiveDeal txn={deal} to={`/purchase/${deal.id}`} />
        </Section>
      )}

      {/* A band of real figures — only the ones this role actually has. */}
      {(canGrow(role) || canSell(role) || canFinance(role)) && (
        <Card variant="plain" className="grid grid-cols-2 divide-x divide-y divide-clay/60 sm:grid-cols-4 sm:divide-y-0">
          {canGrow(role) && (
            <Figure icon={Tractor} label={t('dashboard.farms')} value={String(c.farms.length)} hint={`${hectares.toLocaleString('en-NG')} ha on record`} to={`${base}/my-farm`} />
          )}
          {canGrow(role) && (
            <Figure icon={BadgeCheck} label={t('dashboard.fieldVerified')} value={String(verifiedFarms)} hint={verifiedFarms === 0 ? 'Request a visit' : 'of your farms'} to={`${base}/my-farm`} />
          )}
          {canSell(role) && (
            <Figure icon={Tags} label={t('dashboard.liveListings')} value={String(c.listings.length)} hint={c.listings.length === 0 ? 'Nothing listed yet' : 'on the marketplace'} to={`${base}/my-listings`} />
          )}
          <Figure icon={Package} label={t('dashboard.dealsInProgress')} value={String(activeCount)} hint={activeCount === 0 ? 'None right now' : 'awaiting a step'} to="/orders" />
          {canFinance(role) && openFinancing.length > 0 && (
            <Figure icon={Landmark} label={t('dashboard.financingOpen')} value={String(openFinancing.length)} hint="with a partner bank" to={`${base}/financing`} />
          )}
        </Card>
      )}

      {/* Financing context — factual, never a promise. */}
      {openFinancing.length > 0 && (
        <Section title={t('financing.title')} action={{ label: 'View', to: `${base}/financing` }}>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <Price amount={Number(openFinancing[0].amount_requested)} size="lg" />
              <p className="mt-1 text-[13px] text-emerald-900/60">
                Requested {formatDateShort(openFinancing[0].created_at)} ·{' '}
                {openFinancing[0].status.replace(/_/g, ' ')}
              </p>
            </div>
            <p className="max-w-sm text-[12px] leading-relaxed text-emerald-900/55">
              The decision and the disbursement happen at the partner bank. Loamy prepares and
              forwards the application; it does not approve or price anything.
            </p>
          </Card>
        </Section>
      )}

      {/* Yield history — the farmer's own record, and the thing a partner
          bank actually reads. Rendered only when there IS recorded yield:
          an empty chart says nothing, and an empty state says what to do. */}
      {canGrow(role) && (
        <Section
          title={t('dashboard.yieldHistory')}
          hint="Recorded yield per season - this is the record a partner bank reads"
          action={{ label: 'My farm', to: `${base}/my-farm` }}
        >
          {yieldChart.rows.length > 0 ? (
            <Card className="p-5">
              <BarBreakdown data={yieldChart.rows} xKey="season" series={yieldChart.series} />
            </Card>
          ) : (
            <HomeEmpty
              icon={Sprout}
              title="No harvest recorded yet"
              body="Record a season's actual yield and it starts building the history banks assess."
              action={{ label: 'Record a harvest', to: `${base}/my-farm` }}
            />
          )}
        </Section>
      )}

      {/* Market context. Real observed prices, with their own provenance. */}
      <Section
        title={t('dashboard.marketToday')}
        hint="Observed prices reported from Nigerian markets"
        action={{ label: 'Intelligence', to: `${base}/intelligence` }}
      >
        <DailyPricesPanel />
      </Section>

      <Section title={t('dashboard.recentActivity')} action={activity.length > 0 ? { label: 'All orders', to: '/orders' } : undefined}>
        <ActivityFeed
          items={activity}
          empty={
            <HomeEmpty
              icon={LineChart}
              title="Nothing has happened yet"
              body={
                canSell(role)
                  ? 'Your listings, enquiries and deals will appear here as they happen.'
                  : 'Your purchases, financing and deliveries will appear here as they happen.'
              }
              action={{ label: 'Explore the marketplace', to: `${base}/marketplace` }}
            />
          }
        />
      </Section>

      {/* Digital identity — a differentiator, so it is stated, not buried. */}
      <Card variant="plain" className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {t('dashboard.digitalId')}
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tracking-wider tabular text-emerald-800">
            {profile?.digital_id ?? '-'}
          </p>
          <p className="mt-0.5 text-[12px] text-emerald-900/50">
            Your permanent identity across Loamy
            {profile?.founding_member ? ' · Founding Member' : ''}.
          </p>
        </div>
        {profile?.username && (
          <a
            href={`/u/${profile.username}`}
            className="inline-flex h-10 items-center rounded-control border border-clay bg-white px-4 text-[13px] font-semibold text-emerald-900 hover:bg-sand"
          >
            View public profile
          </a>
        )}
      </Card>
    </div>
  )
}
