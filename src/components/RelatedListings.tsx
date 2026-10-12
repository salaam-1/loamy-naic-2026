import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { PublicListing } from '@/lib/marketplace'
import { formatNaira } from '@/lib/utils'
import { ListingImage } from '@/components/ListingImage'

/**
 * "More <commodity> listings" — real related products from the anon-safe view,
 * same commodity, excluding the current one. Renders nothing when there are no
 * others (never a fabricated recommendation).
 */
export function RelatedListings({
  commodity,
  excludeId,
  linkTo,
}: {
  commodity: string
  excludeId: string
  linkTo: (id: string) => string
}) {
  const [rows, setRows] = useState<PublicListing[] | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('loamy_public_listings')
      .select('*')
      .eq('commodity', commodity)
      .neq('id', excludeId)
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => { if (!cancelled) setRows((data as PublicListing[]) ?? []) })
    return () => { cancelled = true }
  }, [commodity, excludeId])

  if (!rows || rows.length === 0) return null

  return (
    <section className="mt-6">
      <h2 className="mb-2.5 text-sm font-semibold text-emerald-950">More {commodity} listings</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((l) => (
          <Link
            key={l.id}
            to={linkTo(l.id)}
            className="flex flex-col overflow-hidden rounded border border-line bg-white transition-colors hover:bg-emerald-50/40"
          >
            <ListingImage path={l.photos?.[0]} listingType={l.listing_type} alt={l.commodity} className="h-28" />
            <div className="space-y-0.5 p-2.5">
              <p className="truncate text-sm font-semibold text-emerald-950">{l.commodity}</p>
              <p className="font-mono text-[13px] font-semibold text-emerald-800">
                {formatNaira(Number(l.price_per_unit))}<span className="text-xs font-normal text-emerald-900/50">/{l.unit}</span>
              </p>
              <p className="truncate text-[11px] text-emerald-900/55">{Number(l.quantity)} {l.unit} · {l.state}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
