import { Link } from 'react-router-dom'
import { Heart } from 'lucide-react'
import { RoleShell } from '@/pages/shared/RoleShell'
import { Button } from '@/components/ui/button'
import { ProductCard } from '@/pages/marketplace/ProductCard'
import { useCart } from '@/context/CartContext'
import { useT } from '@/lib/i18n'

/**
 * Saved items — the member's real wishlists rows, in the dashboard chrome. Each
 * card's heart is already "on"; tapping it removes the listing here and
 * everywhere. Saved listings that have since gone inactive can't be read back
 * (RLS), so they surface as a removable "no longer available" row.
 */
export default function WishlistPage() {
  const { t } = useT()
  const { wishlist, loading, toggleWishlist } = useCart()
  const saved = wishlist.filter((w) => w.listing)
  const unavailable = wishlist.filter((w) => !w.listing)

  return (
    <RoleShell section="marketplace">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-emerald-800" strokeWidth={1.5} aria-hidden />
          <h1 className="text-lg font-bold text-emerald-950">{t('marketplace.savedItems')}</h1>
          {saved.length > 0 && <span className="text-sm text-emerald-900/55">· {saved.length}</span>}
        </div>

        {loading && wishlist.length === 0 ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded border border-line bg-white" aria-hidden />
            ))}
          </div>
        ) : wishlist.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded border border-line bg-white px-4 py-14 text-center">
            <Heart className="h-8 w-8 text-emerald-900/20" aria-hidden />
            <p className="text-sm text-emerald-900/60">{t('marketplace.noSavedListings')}</p>
            <Link to="/marketplace"><Button size="sm">{t('marketplace.browse')}</Button></Link>
          </div>
        ) : (
          <>
            {saved.length > 0 && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {saved.map((w) => (
                  <ProductCard key={w.id} listing={w.listing!} href={`/marketplace/${w.listing!.id}`} />
                ))}
              </div>
            )}
            {unavailable.length > 0 && (
              <div className="mt-4 space-y-2">
                {unavailable.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-3 rounded border border-dashed border-line bg-surface px-3 py-2.5">
                    <p className="text-sm text-emerald-900/55">{t('marketplace.savedNoLongerAvailable')}</p>
                    <Button size="sm" variant="outline" onClick={() => void toggleWishlist(w.listing_id)}>{t('marketplace.remove')}</Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </RoleShell>
  )
}
