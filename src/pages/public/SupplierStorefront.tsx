import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, MapPin, Store } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { PublicListing, PublicSupplier } from '@/lib/marketplace'
import { PublicShell } from '@/pages/public/PublicShell'
import { PublicProductCard } from '@/pages/marketplace/PublicProductCard'
import { VerifiedTag } from '@/components/VerifiedTag'
import { Card } from '@/components/ui/card'

/**
 * Public supplier storefront (route: /suppliers/:id). The seller's profile plus
 * all their ACTIVE listings, from the anon-safe views. Contact stays gated —
 * buyers act on individual listings (add to cart / express interest).
 */
export default function SupplierStorefront() {
  const { id } = useParams()
  const [supplier, setSupplier] = useState<PublicSupplier | null | 'missing'>(null)
  const [listings, setListings] = useState<PublicListing[] | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    supabase.from('loamy_public_suppliers').select('*').eq('seller_id', id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setSupplier((data as PublicSupplier) ?? 'missing') })
    supabase.from('loamy_public_seller_listings').select('*').eq('seller_id', id).order('created_at', { ascending: false })
      .then(({ data }) => { if (!cancelled) setListings((data as PublicListing[]) ?? []) })
    return () => { cancelled = true }
  }, [id])

  return (
    <PublicShell>
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <Link to="/suppliers" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All suppliers
        </Link>

        {supplier === null ? (
          <div className="h-24 animate-pulse rounded border border-line bg-white" aria-hidden />
        ) : supplier === 'missing' ? (
          <Card className="p-8 text-center text-sm text-emerald-900/60">This supplier is no longer listed.</Card>
        ) : (
          <>
            <Card className="flex items-start gap-4 p-5">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-lg font-bold text-white">
                {(supplier.seller_display_name ?? 'S').slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold text-emerald-950">{supplier.seller_display_name ?? 'Loamy seller'}</h1>
                  <VerifiedTag verified={supplier.seller_verified} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-emerald-900/60">
                  <span>{supplier.seller_category ?? 'Seller'}</span>
                  {supplier.seller_state && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{supplier.seller_state}</span>}
                  <span>{Number(supplier.listing_count)} active listing{Number(supplier.listing_count) === 1 ? '' : 's'}</span>
                </p>
              </div>
            </Card>

            <section>
              <h2 className="mb-2.5 text-sm font-semibold text-emerald-950">Active listings</h2>
              {listings === null ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (<div key={i} className="h-64 animate-pulse rounded border border-line bg-white" aria-hidden />))}
                </div>
              ) : listings.length === 0 ? (
                <div className="flex items-center gap-2.5 rounded border border-line bg-white px-4 py-8">
                  <Store className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
                  <p className="text-sm text-emerald-900/60">This supplier has no active listings right now.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {listings.map((l) => (<PublicProductCard key={l.id} listing={l} />))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </PublicShell>
  )
}
