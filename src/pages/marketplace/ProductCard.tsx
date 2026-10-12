import { Link } from 'react-router-dom'
import { ListingImage } from '@/components/ListingImage'
import { SellerCard } from '@/components/SellerCard'
import type { Listing, PublicProfile } from '@/lib/marketplace'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { AddToCartButton, WishlistHeart } from '@/pages/marketplace/CardActions'

/**
 * Marketplace product card — REAL listing data only. No star ratings or
 * "Best Seller" badges. Save + add-to-cart persist to the member's real
 * cart/wishlist; the card links to the listing (where interest can also be
 * expressed). The only badge is the seller's genuine verification state.
 */
export function ProductCard({
  listing,
  seller,
  href,
}: {
  listing: Listing
  seller?: PublicProfile
  href: string
}) {
  return (
    <Link to={href} className="group flex h-full flex-col overflow-hidden rounded border border-line bg-white transition-colors hover:bg-emerald-50/40">
      <div className="relative">
        <ListingImage path={listing.photos[0]} listingType={listing.listing_type} alt={listing.commodity} className="h-36" />
        <WishlistHeart listingId={listing.id} className="absolute right-2 top-2" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-emerald-950">{listing.commodity}</p>
          <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
            {listing.listing_type}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[13px] font-semibold text-emerald-800">
            {formatNaira(Number(listing.price_per_unit))}
            <span className="text-xs font-normal text-emerald-900/50">/{listing.unit}</span>
          </p>
          <AddToCartButton listingId={listing.id} />
        </div>
        <p className="text-xs text-emerald-900/55">
          {Number(listing.quantity_kg)} {listing.unit} · {listing.state} · {formatDateShort(listing.created_at)}
        </p>
        <div className="mt-auto border-t border-line pt-2">
          <SellerCard profile={seller} compact />
        </div>
      </div>
    </Link>
  )
}
