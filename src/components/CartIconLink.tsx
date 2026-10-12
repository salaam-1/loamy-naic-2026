import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import { useCart } from '@/context/CartContext'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * The cart control in the header, for both the public and signed-in shells.
 *
 * WHY IT IS SHARED
 *   The two shells had their own copy of this link. The add-to-cart
 *   acknowledgement has to behave identically in both, and two copies of an
 *   animation are two things to keep in step, so the behaviour lives here and
 *   each shell passes only its own sizing and hover treatment.
 *
 * WHAT IT ACKNOWLEDGES
 *   `cartBump` increments once per SUCCESSFUL add (see CartContext). A failed
 *   add never increments it, so a failure cannot produce a success animation.
 *
 * NOT ANIMATION ALONE
 *   Motion is not feedback for everyone: it is invisible to a screen-reader
 *   user and suppressed under prefers-reduced-motion. The polite live region
 *   below carries the same message in text, so the acknowledgement survives
 *   without any motion at all.
 */
export function CartIconLink({
  className,
  badgeClassName,
}: {
  className?: string
  badgeClassName?: string
}) {
  const { cartCount, cartBump } = useCart()
  const { t, tPlural } = useT()
  const [bumping, setBumping] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const firstRender = useRef(true)

  useEffect(() => {
    // Skip the initial mount: restoring an existing cart is not an "added".
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setBumping(true)
    setAnnouncement(tPlural('a11y.addedToCartAnnouncement', cartCount))
    const t = setTimeout(() => setBumping(false), 340)
    return () => clearTimeout(t)
    // cartCount is read, not watched: only a bump starts a reaction, so adding
    // it here would fire on removals too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartBump])

  return (
    <>
      <Link
        to="/cart"
        aria-label={cartCount ? t('a11y.cartWithCount', { count: cartCount }) : t('a11y.cart')}
        className={cn('relative flex min-h-touch min-w-touch items-center justify-center', className)}
      >
        {/* The animation is on the icon, not the link, so the hit area and the
            layout box never move. Nothing around it shifts. */}
        <ShoppingCart
          className={cn('h-5 w-5', bumping && 'animate-cart-bump')}
          strokeWidth={1.5}
          aria-hidden
        />
        {cartCount > 0 && (
          <span className={cn('grid place-items-center rounded-full bg-gold-400 font-bold leading-none text-emerald-950', badgeClassName)}>
            {cartCount > 99 ? '99+' : cartCount}
          </span>
        )}
      </Link>
      <span aria-live="polite" className="sr-only">{announcement}</span>
    </>
  )
}
