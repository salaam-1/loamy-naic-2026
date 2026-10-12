import { useT } from '@/lib/i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Store } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { COMMODITY_GROUPS, NIGERIA_STATES } from '@/lib/nigeria'
import { fetchPublicProfiles, type Listing, type PublicProfile } from '@/lib/marketplace'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { MarketPricesPanel } from '@/components/MarketPricesPanel'
import { CategoryRail } from '@/pages/marketplace/CategoryRail'
import { FeaturedCategories } from '@/pages/marketplace/FeaturedCategories'
import { ProductCard } from '@/pages/marketplace/ProductCard'

const PAGE_SIZE = 12
type SortKey = 'newest' | 'price_asc' | 'price_desc'
const SORT_TABS: { key: SortKey; labelKey: string }[] = [
  { key: 'newest', labelKey: 'marketplace.sort.newArrivals' },
  { key: 'price_asc', labelKey: 'marketplace.sort.priceLow' },
  { key: 'price_desc', labelKey: 'marketplace.sort.priceHigh' },
]

/**
 * Buyer marketplace storefront: search + category rail, hero, featured
 * categories (real counts), a recommended-products grid over live listings, a
 * market-prices rail and honest trust sections. NO cart, checkout, pay button,
 * ratings or fabricated stats — interest replaces checkout, and every number
 * shown comes from real data.
 */
export default function MarketplaceHome() {
  const { t } = useT()
  const { profile } = useAuth()
  const role = profile?.platform_role

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [stateFilter, setStateFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')

  const [listings, setListings] = useState<Listing[]>([])
  const [sellers, setSellers] = useState<Record<string, PublicProfile>>({})
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  const productsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  // Real category counts: tally active listings per commodity, then per group.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('listings')
      .select('commodity')
      .eq('status', 'active')
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

  const load = useCallback(
    async (pageIndex: number, append: boolean) => {
      setLoading(true)
      let query = supabase
        .from('listings')
        .select('*')
        .eq('status', 'active')
        .range(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE - 1)

      const groupDef = group ? COMMODITY_GROUPS.find((g) => g.key === group) : null
      if (groupDef) query = query.in('commodity', groupDef.commodities)
      if (stateFilter) query = query.eq('state', stateFilter)
      if (debouncedSearch) {
        query = query.or(`commodity.ilike.%${debouncedSearch}%,description.ilike.%${debouncedSearch}%`)
      }
      query =
        sort === 'newest'
          ? query.order('created_at', { ascending: false })
          : query.order('price_per_unit', { ascending: sort === 'price_asc' })

      const { data } = await query
      const rows = (data as Listing[]) ?? []
      const sellerProfiles = await fetchPublicProfiles(rows.map((l) => l.seller_id))
      setSellers((prev) => ({ ...prev, ...sellerProfiles }))
      setListings((prev) => (append ? [...prev, ...rows] : rows))
      setHasMore(rows.length === PAGE_SIZE)
      setLoading(false)
    },
    [group, stateFilter, debouncedSearch, sort],
  )

  useEffect(() => {
    setPage(0)
    void load(0, false)
  }, [load])

  const activeGroupLabel = useMemo(
    () => (group ? COMMODITY_GROUPS.find((g) => g.key === group)?.label ?? null : null),
    [group],
  )

  const hasFilters = Boolean(group || stateFilter || debouncedSearch)
  const directoryHref = `/dashboard/${role}/directory`
  const listingHref = (id: string) => `/dashboard/${role}/marketplace/listing/${id}`

  const scrollTo = (ref: React.RefObject<HTMLElement>) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="space-y-5">
      {/* Search toolbar */}
      <div className="rounded border border-line bg-white p-3">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-900/35" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('marketplace.searchListingsPlaceholder')}
              className="pl-9"
              aria-label={t('marketplace.searchListings')}
            />
          </div>
          <Select
            value={group ?? ''}
            onChange={(e) => setGroup(e.target.value || null)}
            className="sm:w-48"
            aria-label={t('marketplace.category')}
          >
            <option value="">{t('marketplace.allCategories')}</option>
            {COMMODITY_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </Select>
          <Select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="sm:w-40"
            aria-label={t('marketplace.deliverToState')}
          >
            <option value="">{t('marketplace.allStates')}</option>
            {NIGERIA_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Button className="sm:w-auto" onClick={() => { setDebouncedSearch(search.trim()); scrollTo(productsRef) }}>
            <Search className="h-4 w-4" aria-hidden /> Search
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[190px_minmax(0,1fr)]">
        {/* Left category rail (wide screens) */}
        <div className="hidden xl:block">
          <div className="sticky top-4">
            <CategoryRail activeGroup={group} onSelect={setGroup} directoryHref={directoryHref} />
          </div>
        </div>

        <div className="space-y-5">
          {/* Featured categories */}
          <section>
            <h3 className="mb-2.5 text-sm font-semibold text-emerald-950">{t('marketplace.featuredCategories')}</h3>
            <FeaturedCategories counts={counts} activeGroup={group} onSelect={setGroup} />
          </section>

          {/* Products + market rail */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section ref={productsRef}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-emerald-950">
                  {activeGroupLabel ?? t('marketplace.sort.recommended')}
                </h3>
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

              {loading && listings.length === 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-64 animate-pulse rounded border border-line bg-white" aria-hidden />
                  ))}
                </div>
              ) : listings.length === 0 ? (
                <EmptyState
                  icon={Store}
                  title={t('marketplace.noListingsMatchShort')}
                  body={
                    hasFilters
                      ? t('marketplace.tryClearingFilter')
                      : t('marketplace.openAndWaiting')
                  }
                />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {listings.map((l) => (
                      <ProductCard key={l.id} listing={l} seller={sellers[l.seller_id]} href={listingHref(l.id)} />
                    ))}
                  </div>
                  {hasMore && (
                    <div className="mt-4 flex justify-center">
                      <Button
                        variant="outline"
                        loading={loading}
                        onClick={() => {
                          const next = page + 1
                          setPage(next)
                          void load(next, true)
                        }}
                      >
                        {t('marketplace.loadMore')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </section>

            <aside className="space-y-4">
              <MarketPricesPanel />
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
