import { useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Heart, Loader2, ShoppingCart } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCart } from '@/context/CartContext'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * Product-card actions used on BOTH the public and signed-in cards. For a
 * signed-out visitor every tap routes to /signup (browsing is open, acting is
 * gated); for a member they persist to the real cart_items / wishlists tables.
 * The buttons live inside a card-wide <Link>, so they stop the click from
 * navigating to the listing.
 */

export function WishlistHeart({ listingId, className }: { listingId: string; className?: string }) {
  const { t } = useT()
  const { session } = useAuth()
  const { isWishlisted, toggleWishlist } = useCart()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const saved = isWishlisted(listingId)

  // A short pop on the transition INTO saved. Nothing on the way out: undoing
  // a save is not an event worth celebrating.
  const [pop, setPop] = useState(false)

  const onClick = async (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!session) { navigate('/signup'); return }
    setBusy(true)
    const wasSaved = saved
    try {
      await toggleWishlist(listingId)
      // Only after the write resolves, and only when it became saved.
      if (!wasSaved) {
        setPop(true)
        setTimeout(() => setPop(false), 260)
      }
    } catch { /* keep prior state */ } finally { setBusy(false) }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={saved ? t('marketplace.removeFromSaved') : t('marketplace.saveForLater')}
      aria-pressed={saved}
      className={cn(
        // 36px, not 32: a save control sits beside a price on a phone and was
        // the smallest hit area on the listing page.
        'flex h-9 w-9 min-h-touch min-w-touch items-center justify-center rounded border bg-white transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1',
        // Saved reads in the brand's own green, not red. A heart in rose on an
        // agricultural marketplace borrowed a social-media signal that means
        // something else; emerald-700 is the existing token one step lighter
        // than the locked primary, so the fill stays legible at 16px.
        saved ? 'border-emerald-200 text-emerald-700' : 'border-line text-emerald-900/45 hover:text-emerald-900',
        className,
      )}
    >
      <Heart
        className={cn(
          'h-4 w-4 transition-transform duration-200 ease-out',
          saved && 'fill-current',
          pop && 'scale-125',
        )}
        strokeWidth={1.5}
        aria-hidden
      />
    </button>
  )
}

export function AddToCartButton({ listingId, className }: { listingId: string; className?: string }) {
  const { t } = useT()
  const { session } = useAuth()
  const { inCart, addToCart } = useCart()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const added = inCart(listingId)

  const onClick = async (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!session) { navigate('/signup'); return }
    if (added) { navigate('/cart'); return }
    setBusy(true)
    try { await addToCart(listingId) } catch { /* surfaced as no state change */ } finally { setBusy(false) }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={added ? t('marketplace.inCartViewCart') : t('marketplace.addToCartAria')}
      className={cn(
        'inline-flex h-8 min-h-touch shrink-0 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors',
        added ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-emerald-800 text-white hover:bg-emerald-700',
        className,
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : added ? (
        <><Check className="h-3.5 w-3.5" aria-hidden /> {t('marketplace.inCart')}</>
      ) : (
        <><ShoppingCart className="h-3.5 w-3.5" aria-hidden /> {t('marketplace.add')}</>
      )}
    </button>
  )
}
