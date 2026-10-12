import { Link } from 'react-router-dom'
import { ListingImage } from '@/components/ListingImage'
import { StockClaim } from '@/components/StockClaim'
import { VerifiedTag } from '@/components/VerifiedTag'
import type { PublicListing } from '@/lib/marketplace'
import { formatDateShort, formatNaira } from '@/lib/utils'
import { AddToCartButton, WishlistHeart } from '@/pages/marketplace/CardActions'
import { useT } from '@/lib/i18n'

/**
 * Public (signed-out) product card — reads the anon-safe PublicListing shape
 * (no seller_id/phone/email). Browsing is open; the card links to the public
 * listing detail. The save + add-to-cart actions route signed-out visitors to
 * sign-up and persist for members. No fabricated ratings or badges.
 */
export function PublicProductCard({ listing }: { listing: PublicListing }) {
  const { t } = useT()
  return (
    <Link
      to={`/marketplace/${listing.id}`}
      className="flex h-full flex-col overflow-hidden rounded border border-line bg-white transition-colors hover:bg-emerald-50/40"
    >
      <div className="relative">
        <ListingImage path={listing.photos?.[0]} listingType={listing.listing_type} alt={listing.commodity} className="h-36" />
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
          {Number(listing.quantity)} {listing.unit} · {listing.state} · {formatDateShort(listing.created_at)}
        </p>
        {/* Whether the stock behind this listing is real, kept visually
            separate from whether the SELLER is verified. */}
        <StockClaim
          claimBasis={listing.claim_basis}
          verificationStatus={listing.verification_status}
          originTraced={listing.origin_traced}
          originState={listing.origin_state}
        />
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2">
          <span className="truncate text-xs text-emerald-900/60">{listing.seller_display_name ?? t('marketplace.loamySeller')}</span>
          <VerifiedTag verified={listing.seller_verified} />
        </div>
      </div>
    </Link>
  )
}
