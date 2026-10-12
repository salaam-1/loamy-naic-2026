import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Mail, MessageCircle, Store, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { COMMODITY_GROUPS } from '@/lib/nigeria'
import {
  getHomepageMarketplaceListings, getMarketplaceListings,
  type PublicListing,
} from '@/lib/marketplace'
import { cn } from '@/lib/utils'
import { PublicShell } from '@/pages/public/PublicShell'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { DailyPricesPanel } from '@/components/DailyPricesPanel'
import { StorefrontHero } from '@/pages/marketplace/StorefrontHero'
import { CategoryRail } from '@/pages/marketplace/CategoryRail'
import { FeaturedCategories } from '@/pages/marketplace/FeaturedCategories'
import { PublicProductCard } from '@/pages/marketplace/PublicProductCard'
import { TradingInsightCard, TrustBar, WhyLoamy } from '@/pages/marketplace/StorefrontInfo'

type SortKey = 'newest' | 'price_asc' | 'price_desc'
const SORT_TABS: { key: SortKey; labelKey: string }[] = [
  { key: 'newest', labelKey: 'marketplace.sort.newArrivals' },
  { key: 'price_asc', labelKey: 'marketplace.sort.priceLow' },
  { key: 'price_desc', labelKey: 'marketplace.sort.priceHigh' },
]

/**
 * The public marketplace storefront, rendered at two routes with one
 * difference between them.
 *
 *   /             `preview` — a bounded shop window: at most
 *                 HOMEPAGE_MARKETPLACE_LIMIT listings, then a link onward.
 *   /marketplace  the full browse surface, unchanged.
 *
 * Anyone can browse, search and filter over the anon-safe
 * loamy_public_listings view (never the base tables), which is defined
 * `where status = 'active'` and withholds seller_id, phone, email and
 * coordinates. No ratings, no fabricated statistics.
 *
 * WHY THE HOMEPAGE IS BOUNDED IN THE QUERY
 *   `/` used to read sixty rows with `select('*')`, so the landing page WAS
 *   the catalogue and the footer sat below all of it. Capping in CSS or
 *   slicing on the client would have fixed the scroll and kept the bandwidth,
 *   so the bound is in the read: `getHomepageMarketplaceListings` takes no
 *   limit argument and twelve rows cross the wire.
 *
 *   A NOTE ON THE COMMENT THIS REPLACES: it said "No cart, no checkout". That
 *   stopped being true when the shared card gained AddToCartButton and
 *   WishlistHeart, both of which route a signed-out visitor to sign-up. The
 *   card is unchanged by this work.
 */
export default function PublicMarketplace({ preview = false }: { preview?: boolean }) {
  const { t } = useT()
  const { session } = useAuth()
  const [params] = useSearchParams()
  const [debounced, setDebounced] = useState(params.get('q') ?? '')
  const [group, setGroup] = useState<string | null>(params.get('group') || null)
  const [stateF, setStateF] = useState(params.get('state') ?? '')
  const [sort, setSort] = useState<SortKey>('newest')
  const [rows, setRows] = useState<PublicListing[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})

  const productsRef = useRef<HTMLDivElement>(null)

  // The search + deliver-to + category live in the shell top bar; it drives this
  // page through the URL. Sync filters whenever those params change.
  useEffect(() => {
    setDebounced(params.get('q') ?? '')
    setGroup(params.get('group') || null)
    setStateF(params.get('state') ?? '')
    if (params.get('q') || params.get('group') || params.get('state')) {
      productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [params])

  // Real category counts from the anon-safe view.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('loamy_public_listings')
      .select('commodity')
      .limit(2000)
      .then(({ data }) => {
        if (cancelled) return
        const perCommodity: Record<string, number> = {}
        for (const r of (data as { commodity: string }[]) ?? []) {
          perCommodity[r.commodity] = (perCommodity[r.commodity] ?? 0) + 1
        }
        const perGroup: Record<string, number> = {}
        for (const g of COMMODITY_GROUPS) {
          perGroup[g.key] = g.commodities.reduce((sum, c) => sum + (perCommodity[c] ?? 0), 0)
        }
        setCounts(perGroup)
      })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    const groupDef = group ? COMMODITY_GROUPS.find((g) => g.key === group) : null
    const filters = {
      commodities: groupDef?.commodities ?? null,
      state: stateF,
      query: debounced,
      sort,
    }
    // Two readers, one difference. The preview one cannot be asked for more.
    const read = preview ? getHomepageMarketplaceListings : getMarketplaceListings
    try {
      setRows(await read(filters))
    } catch {
      // A failed read must not leave the skeleton spinning forever: an empty
      // result renders the existing truthful empty state, which is the honest
      // thing to show when we do not know what is out there.
      setRows([])
    }
  }, [group, stateF, debounced, sort, preview])

  useEffect(() => { void load() }, [load])

  const activeGroupLabel = useMemo(
    () => (group ? COMMODITY_GROUPS.find((g) => g.key === group)?.label ?? null : null),
    [group],
  )
  const hasFilters = Boolean(group || stateF || debounced)
  const scrollToProducts = () => productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <PublicShell>
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <StorefrontHero
          onBrowse={scrollToProducts}
          browseLabel={t('marketplace.shopTheMarketplace')}
          secondary={{ label: t('marketplace.sellOnLoamy'), to: '/signup' }}
        />

        <div className="grid gap-5 xl:grid-cols-[190px_minmax(0,1fr)]">
          {/* Left category rail (wide screens) */}
          <div className="hidden xl:block">
            <div className="sticky top-4">
              <CategoryRail activeGroup={group} onSelect={setGroup} />
            </div>
          </div>

          <div className="space-y-5">
            {/* Featured categories */}
            <section>
              <h3 className="mb-2.5 text-sm font-semibold text-emerald-950">{t('marketplace.featuredCategoriesHeading')}</h3>
              <FeaturedCategories counts={counts} activeGroup={group} onSelect={setGroup} />
            </section>

            {/* Products + right rail */}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <section ref={productsRef}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-emerald-950">{activeGroupLabel ?? t('marketplace.verifiedListings')}</h3>
                  <div className="inline-flex rounded border border-line bg-white p-0.5 text-xs">
                    {SORT_TABS.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setSort(tab.key)}
                        className={cn(
                          'inline-flex min-h-touch items-center rounded px-2.5 py-1 font-medium transition-colors',
                          sort === tab.key ? 'bg-emerald-800 text-white' : 'text-emerald-900/70 hover:text-emerald-900',
                        )}
                      >
                        {t(tab.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>

                {rows === null ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-64 animate-pulse rounded border border-line bg-white" aria-hidden />
                    ))}
                  </div>
                ) : rows.length === 0 ? (
                  <div className="flex items-center gap-2.5 rounded border border-line bg-white px-4 py-8">
                    <Store className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
                    <p className="text-sm text-emerald-900/60">
                      {hasFilters
                        ? t('marketplace.noListingsTryClearing')
                        : t('marketplace.listingsAppearHere')}
                    </p>
                    {/* Nothing here is still a reason to offer the marketplace:
                        a filter may be hiding everything, and the full surface
                        can clear it. No placeholder cards, no invented count. */}
                    {preview && (
                      <Link
                        to="/marketplace"
                        aria-label={t('marketplace.preview.ariaExploreAll')}
                        data-testid="preview-cta-empty"
                        className="ml-auto shrink-0"
                      >
                        <Button variant="outline" size="sm" className="min-h-touch">
                          {t('marketplace.preview.exploreAll')}
                        </Button>
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {rows.map((l) => (<PublicProductCard key={l.id} listing={l} />))}
                  </div>
                )}

                {/* The preview's exit. Shown whenever the homepage rendered any
                    listing at all, including when fewer than the limit exist:
                    the full marketplace has filters and sorting this section
                    does not, so the link is useful either way. It is NOT shown
                    on /marketplace, which is where it would point. */}
                {preview && rows !== null && rows.length > 0 && (
                  <div className="mt-5 flex flex-col items-center gap-2 border-t border-line pt-5">
                    <p className="text-center text-xs text-emerald-900/60">
                      {t('marketplace.preview.showingNewest')}
                    </p>
                    <Link
                      to="/marketplace"
                      aria-label={t('marketplace.preview.ariaExploreAll')}
                      data-testid="preview-cta"
                    >
                      <Button variant="outline" className="min-h-touch">
                        {t('marketplace.preview.exploreAll')}
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </Button>
                    </Link>
                  </div>
                )}
              </section>

              <aside className="space-y-4">
                {/* Today's market prices — anon-safe view (loamy_public_market_prices). */}
                <div id="market-prices" className="scroll-mt-32">
                  <DailyPricesPanel />
                </div>

                {/* Sign-up gate prompt — shown to visitors only; hidden once signed in. */}
                {!session && (
                  <div className="rounded border border-emerald-700 bg-emerald-800 p-4">
                    <p className="text-sm font-semibold text-white">{t('marketplace.readyToTrade')}</p>
                    <p className="mt-1 text-xs leading-relaxed text-[#C9D6CF]">
                      {t('marketplace.browsingOpenToAll')}
                    </p>
                    <Link to="/signup" className="mt-3 block">
                      <Button variant="gold" className="w-full"><UserPlus className="h-4 w-4" aria-hidden /> {t('marketplace.createFreeAccount')}</Button>
                    </Link>
                    <p className="mt-2 text-center text-[11px] text-[#9FB5AC]">
                      {t('marketplace.alreadyMember')}{' '}
                      <Link to="/login" className="font-semibold text-white hover:underline">{t('public.signIn')}</Link>
                    </p>
                  </div>
                )}

                <TradingInsightCard />

                {/* Join our community — real contact channels only, no invented following. */}
                <div className="rounded border border-line bg-white p-4">
                  <p className="text-sm font-semibold text-emerald-950">{t('marketplace.joinOurCommunity')}</p>
                  <p className="mt-1 text-xs leading-relaxed text-emerald-900/60">
                    {t('marketplace.marketUpdates')}
                  </p>
                  <div className="mt-3 space-y-2 text-sm">
                    <a href="https://wa.me/2347042768655" target="_blank" rel="noreferrer" className="flex items-center gap-2 font-medium text-emerald-800 hover:text-emerald-700">
                      <MessageCircle className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {t('marketplace.whatsappUs')}
                    </a>
                    <a href="mailto:support@loamy.ng" className="flex items-center gap-2 font-medium text-emerald-800 hover:text-emerald-700">
                      <Mail className="h-4 w-4" strokeWidth={1.5} aria-hidden /> support@loamy.ng
                    </a>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>

        <div id="why-loamy">
          <WhyLoamy />
        </div>
        <TrustBar />
      </div>
    </PublicShell>
  )
}
