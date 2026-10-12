import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Check, ShoppingCart } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCart } from '@/context/CartContext'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WishlistHeart } from '@/pages/marketplace/CardActions'
import { Price } from '@/components/Money'
import { checkQuantity, quantityStep } from '@/lib/quantity'
import { errorMessage } from '@/lib/errors'

/**
 * The purchase box on a listing detail page.
 *
 * TWO DEFECTS FIXED IN PHASE 4 SLICE 2
 *
 * 1. FAILURES WERE SILENT. `add` caught every error and discarded it, so a
 *    member whose add-to-cart was refused — by RLS for their own listing, or
 *    by the network — watched the button finish and nothing happen. A failed
 *    write that looks like a successful one is the worst outcome available.
 *    Errors are now shown, the entered quantity is kept, and nothing claims
 *    the item was added.
 *
 * 2. FRACTIONAL QUANTITIES WERE TRUNCATED. `Math.floor` forced whole units,
 *    so a listing priced per tonne could not be bought as 2.5 tonnes. Nothing
 *    in the backend imposes that: listings.quantity_kg, cart_items.quantity
 *    and transactions.quantity are all `numeric` with a `> 0` check, and a
 *    quantity of 3.89 has been round-tripped through checkout end to end.
 *
 *    The schema carries no precision or step metadata, so none is invented
 *    here. The client validates only what the backend validates — greater
 *    than zero, and not more than is listed — and lets the server remain
 *    authoritative. The `step` is a keyboard-arrow convenience chosen from
 *    the unit, never a constraint on what may be typed.
 */
export function BuyBox({
  listingId,
  unit,
  price,
  availableQty,
}: {
  listingId: string
  unit: string
  price: number
  availableQty?: number
}) {
  const { session } = useAuth()
  const { inCart, addToCart } = useCart()
  const navigate = useNavigate()
  const location = useLocation()
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inCartAlready = inCart(listingId) || added
  const check = checkQuantity(qty, { unit, available: availableQty })

  const add = async () => {
    if (!session) {
      navigate(`/signup?redirect=${encodeURIComponent(location.pathname)}`)
      return
    }
    if (!check.ok) {
      setError(check.message)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addToCart(listingId, check.value)
      setAdded(true)
    } catch (e) {
      // Shown, not swallowed. The quantity stays as typed so the member can
      // correct one thing rather than start again.
      // errorMessage, not `instanceof Error`: supabase-js rejects with a
      // PostgrestError, which is a plain object, so the instanceof check threw
      // away the only accurate description of the refusal.
      setError(errorMessage(e, 'Could not add this to your cart. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <Price amount={price} per={unit} size="lg" />
        <WishlistHeart listingId={listingId} />
      </div>

      {session && !inCartAlready && (
        <div>
          <Label htmlFor="buy-qty">Quantity ({unit})</Label>
          <Input
            id="buy-qty"
            type="number"
            inputMode="decimal"
            min={0}
            // A convenience for the arrow keys, not a restriction: a typed
            // value that is not a multiple of the step is still accepted.
            step={quantityStep(unit)}
            value={qty}
            onChange={(e) => { setQty(e.target.value); setError(null) }}
            aria-invalid={qty !== '' && !check.ok}
            aria-describedby="buy-qty-help"
            className="mt-1"
          />
          <p id="buy-qty-help" className="mt-1.5 text-sm">
            {check.ok ? (
              <span className="text-emerald-900/70">
                Total <Price amount={price * check.value} size="sm" />
              </span>
            ) : qty !== '' ? (
              <span className="text-amber-700">{check.message}</span>
            ) : (
              <span className="text-emerald-900/50">
                {availableQty != null ? `Up to ${availableQty} ${unit} available` : `In ${unit}`}
              </span>
            )}
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] leading-snug text-rose-800"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {inCartAlready ? (
        <Link to="/cart" className="block">
          <Button variant="outline" className="w-full">
            <Check className="h-4 w-4" aria-hidden /> In cart - view cart
          </Button>
        </Link>
      ) : (
        <Button
          className="w-full"
          loading={busy}
          disabled={Boolean(session) && !check.ok}
          onClick={add}
        >
          <ShoppingCart className="h-4 w-4" aria-hidden /> {session ? 'Add to cart' : 'Sign in to buy'}
        </Button>
      )}

      <p className="text-[11px] leading-relaxed text-emerald-900/45">
        {availableQty != null ? `${availableQty} ${unit} available · ` : ''}
        Secure payment held in Paystack escrow until you confirm receipt.
      </p>
    </Card>
  )
}
