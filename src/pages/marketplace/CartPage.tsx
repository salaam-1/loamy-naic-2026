import { useT } from '@/lib/i18n'
import { Link } from 'react-router-dom'
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { RoleShell } from '@/pages/shared/RoleShell'
import { ListingImage } from '@/components/ListingImage'
import { Button } from '@/components/ui/button'
import { useCart } from '@/context/CartContext'
import { BANK_RAILS_COPY } from '@/lib/marketplace'
import { formatNaira } from '@/lib/utils'

/**
 * Cart — real cart_items for the signed-in member, in the dashboard chrome.
 * Items whose listing has since gone inactive (sold/paused) can't be read back
 * (RLS), so they're shown as "no longer available" with a Remove — never left as
 * an invisible badge count. Checkout excludes them automatically.
 */
export default function CartPage() {
  const { t } = useT()
  const { cart, loading, setQuantity, removeFromCart } = useCart()

  const lines = cart.filter((c) => c.listing)
  const unavailable = cart.filter((c) => !c.listing)
  const subtotal = lines.reduce((sum, c) => sum + Number(c.listing!.price_per_unit) * c.quantity, 0)
  const itemCount = lines.reduce((sum, c) => sum + c.quantity, 0)

  return (
    <RoleShell section="marketplace">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-emerald-800" strokeWidth={1.5} aria-hidden />
          <h1 className="text-lg font-bold text-emerald-950">{t('cart.yourCart')}</h1>
          {cart.length > 0 && <span className="text-sm text-emerald-900/55">· {cart.length} listing{cart.length > 1 ? 's' : ''}</span>}
        </div>

        {loading && cart.length === 0 ? (
          <div className="mt-5 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded border border-line bg-white" aria-hidden />
            ))}
          </div>
        ) : cart.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded border border-line bg-white px-4 py-14 text-center">
            <ShoppingCart className="h-8 w-8 text-emerald-900/20" aria-hidden />
            <p className="text-sm text-emerald-900/60">{t('cart.isEmpty')}</p>
            <Link to="/marketplace"><Button size="sm">{t('public.browseMarketplace')}</Button></Link>
          </div>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* Line items */}
            <div className="space-y-3">
              {lines.map((item) => {
                const l = item.listing!
                const lineTotal = Number(l.price_per_unit) * item.quantity
                return (
                  <div key={item.id} className="flex gap-3 rounded border border-line bg-white p-3">
                    <Link to={`/marketplace/${l.id}`} className="shrink-0">
                      <ListingImage path={l.photos?.[0]} listingType={l.listing_type} alt={l.commodity} className="h-20 w-20 rounded" />
                    </Link>
                    <div className="flex flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Link to={`/marketplace/${l.id}`} className="font-semibold text-emerald-950 hover:text-emerald-700">{l.commodity}</Link>
                          <p className="mt-0.5 font-mono text-[13px] font-semibold text-emerald-800">
                            {formatNaira(Number(l.price_per_unit))}
                            <span className="text-xs font-normal text-emerald-900/50">/{l.unit}</span>
                            <span className="ml-2 text-xs font-normal text-emerald-900/45">{l.state}</span>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeFromCart(item.id)}
                          aria-label={t('cart.removeItem')}
                          className="flex h-8 w-8 min-h-touch min-w-touch items-center justify-center rounded text-emerald-900/45 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                        </button>
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                        {/* Quantity stepper */}
                        <div className="inline-flex items-center rounded border border-line">
                          <button
                            type="button"
                            onClick={() => void setQuantity(item.id, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            aria-label={t('cart.decreaseQuantity')}
                            className="flex h-8 w-8 min-h-touch min-w-touch items-center justify-center text-emerald-900/70 hover:bg-emerald-50 disabled:opacity-40"
                          >
                            <Minus className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <span className="min-w-10 text-center font-mono text-sm text-emerald-950">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => void setQuantity(item.id, item.quantity + 1)}
                            aria-label={t('cart.increaseQuantity')}
                            className="flex h-8 w-8 min-h-touch min-w-touch items-center justify-center text-emerald-900/70 hover:bg-emerald-50"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <span className="px-2 text-xs text-emerald-900/45">{l.unit}</span>
                        </div>
                        <p className="font-mono text-sm font-semibold text-emerald-950">{formatNaira(lineTotal)}</p>
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Unavailable items — listing no longer readable (sold/paused). */}
              {unavailable.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded border border-dashed border-line bg-surface px-3 py-2.5">
                  <p className="text-sm text-emerald-900/55">{t('marketplace.listingUnavailable')}</p>
                  <Button size="sm" variant="outline" onClick={() => void removeFromCart(item.id)}>{t('common.remove')}</Button>
                </div>
              ))}
            </div>

            {/* Summary */}
            <aside className="lg:sticky lg:top-20 lg:self-start">
              <div className="rounded border border-line bg-white p-4">
                <h2 className="text-sm font-semibold text-emerald-950">{t('cart.orderSummary')}</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-emerald-900/60">{t('cart.items_label')}</dt>
                    <dd className="font-medium text-emerald-950">{itemCount}</dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-2">
                    <dt className="text-emerald-900/60">{t('cart.subtotal')}</dt>
                    <dd className="font-mono font-semibold text-emerald-950">{formatNaira(subtotal)}</dd>
                  </div>
                </dl>
                {lines.length > 0 ? (
                  <Link to="/checkout" className="mt-4 block">
                    <Button className="w-full">{t('cart.proceedToCheckout')}</Button>
                  </Link>
                ) : (
                  <Button className="mt-4 w-full" disabled>{t('cart.nothingAvailable')}</Button>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-emerald-900/55">
                  You place the order first; secure payment with Paystack escrow follows once the seller confirms. {BANK_RAILS_COPY}
                </p>
              </div>
              <Link to="/marketplace" className="mt-3 block text-center text-sm font-medium text-emerald-700 hover:text-emerald-800">
                {t('checkout.continueShopping')}
              </Link>
            </aside>
          </div>
        )}
      </div>
    </RoleShell>
  )
}
