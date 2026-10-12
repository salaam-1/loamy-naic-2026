import { useT } from '@/lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Store } from 'lucide-react'
import { RoleShell } from '@/pages/shared/RoleShell'
import { ListingImage } from '@/components/ListingImage'
import { Price, MetricValue } from '@/components/Money'
import { FEE_LABEL, checkoutFees, describeRate, isBuyerPayable, type FeeBreakdown } from '@/lib/fees'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useCart } from '@/context/CartContext'
import { fetchPublicProfiles, BANK_RAILS_COPY, type PublicProfile } from '@/lib/marketplace'
import { checkoutCart, proposeTransaction } from '@/lib/checkout'
import { supabase } from '@/lib/supabase'
import { NIGERIA_STATES } from '@/lib/nigeria'
import { formatNaira } from '@/lib/utils'
import type { CartItem } from '@/lib/cart'

/**
 * Checkout — reviews the cart grouped by seller (one order per seller), takes a
 * delivery state + note, and creates authoritative transactions via
 * loamy_checkout_cart. It no longer writes to the non-authoritative `orders`
 * model, which could not be financed, verified, shipped, stored or settled.
 * No payment happens here: an order is placed for the seller to confirm, then
 * Paystack escrow (Stage 4) handles the money.
 */
export default function CheckoutPage() {
  const { t } = useT()
  const { cart, refresh } = useCart()
  const navigate = useNavigate()
  const [sellers, setSellers] = useState<Record<string, PublicProfile>>({})
  const [deliveryState, setDeliveryState] = useState('')
  const [note, setNote] = useState('')
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lines = useMemo(() => cart.filter((c) => c.listing), [cart])

  // Group lines by seller.
  const groups = useMemo(() => {
    const map = new Map<string, CartItem[]>()
    for (const item of lines) {
      const sid = item.listing!.seller_id
      map.set(sid, [...(map.get(sid) ?? []), item])
    }
    return [...map.entries()]
  }, [lines])

  useEffect(() => {
    const ids = groups.map(([sid]) => sid)
    if (ids.length) void fetchPublicProfiles(ids).then(setSellers)
  }, [groups])

  const grandTotal = lines.reduce((sum, c) => sum + Number(c.listing!.price_per_unit) * c.quantity, 0)

  // Fees come from the authoritative schedule (fee_schedules via
  // loamy_resolve_fee), never from a rate written into this component. If no
  // rule matches, `fees` is empty and the buyer sees the subtotal alone --
  // which is the honest rendering of "no fee applies".
  const [fees, setFees] = useState<FeeBreakdown | null>(null)
  useEffect(() => {
    if (grandTotal <= 0) { setFees(null); return }
    let cancelled = false
    void checkoutFees(grandTotal).then((b) => { if (!cancelled) setFees(b) })
    return () => { cancelled = true }
  }, [grandTotal])

  const payable = fees?.total ?? grandTotal

  /**
   * The financing path.
   *
   * Financing attaches to a TRANSACTION, which is the authoritative record of
   * a deal (see docs/loamy-system-of-record.md). The direct-payment path above
   * still creates `orders`, which the freeze lists as retained-but-not-
   * authoritative -- the two are not unified here because that is a migration,
   * not a checkout change, and doing it quietly would be worse.
   *
   * Only ONE line can be financed at a time: a financing application is tied
   * to one purchase from one seller, and pretending otherwise would produce an
   * application the bank cannot assess.
   */
  const applyForFinancing = async (item: CartItem) => {
    setPlacing(true)
    setError(null)
    // Delivery state and note were being discarded here: the function accepts
    // both and the form collects both, but only listing and quantity were
    // passed. The buyer typed them; they belong on the transaction.
    const { transactionId, error: err } = await proposeTransaction(item.listing_id, item.quantity, {
      deliveryState: deliveryState || null,
      note: note.trim() || null,
    })
    if (err || !transactionId) {
      setError(err ?? t('checkout.couldNotStartFinancing'))
      setPlacing(false)
      return
    }
    navigate(`/financing/apply/${transactionId}`)
  }

  /**
   * Checkout, through the authoritative path.
   *
   * Was loamy_place_orders_from_cart -> `orders`, which carried no fee
   * snapshot, no batch_id and no lifecycle, and could not be financed,
   * verified, shipped, stored or settled. Now loamy_checkout_cart, which
   * orchestrates loamy_propose_transaction per line.
   *
   * A failure means nothing was bought -- the server runs the whole cart in
   * one statement -- so the error is shown and the page stays put. It never
   * navigates as though checkout succeeded.
   */
  const placeOrders = async () => {
    setPlacing(true)
    setError(null)
    const { transactionIds, error: err } = await checkoutCart({
      deliveryState: deliveryState || null,
      note: note.trim() || null,
    })
    if (err || transactionIds.length === 0) {
      setError(err ?? t('checkout.couldNotComplete'))
      setPlacing(false)
      return
    }
    await refresh()
    // Always the first purchase's detail, never /orders: that page reads the
    // `orders` table, which new checkout no longer writes to, so a multi-line
    // checkout would land on a screen showing nothing it just created.
    // `placed` tells the page how many were made so it can say so.
    navigate(`/purchase/${transactionIds[0]}?placed=${transactionIds.length}`)
  }

  return (
    <RoleShell section="marketplace">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-lg font-bold text-emerald-950">{t('checkout.title')}</h1>

        {lines.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded border border-line bg-white px-4 py-14 text-center">
            <Store className="h-8 w-8 text-emerald-900/20" aria-hidden />
            <p className="text-sm text-emerald-900/60">{t('cart.isEmpty')}</p>
            <Link to="/marketplace"><Button size="sm">{t('public.browseMarketplace')}</Button></Link>
          </div>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Per-seller review */}
            <div className="space-y-4">
              {groups.map(([sid, items]) => {
                const seller = sellers[sid]
                const groupTotal = items.reduce((s, c) => s + Number(c.listing!.price_per_unit) * c.quantity, 0)
                return (
                  <div key={sid} className="overflow-hidden rounded border border-line bg-white">
                    <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
                      <Store className="h-4 w-4 text-emerald-700" strokeWidth={1.5} aria-hidden />
                      <p className="text-sm font-semibold text-emerald-950">{seller?.full_name ?? t('marketplace.loamySeller')}</p>
                      <span className="ml-auto text-xs text-emerald-900/55">{items.length} item{items.length > 1 ? 's' : ''}</span>
                    </div>
                    <ul className="divide-y divide-line">
                      {items.map((item) => {
                        const l = item.listing!
                        return (
                          <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                            <ListingImage path={l.photos?.[0]} listingType={l.listing_type} alt={l.commodity} className="h-12 w-12 rounded" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-emerald-950">{l.commodity}</p>
                              <p className="font-mono text-xs text-emerald-900/55">
                                {item.quantity} {l.unit} × {formatNaira(Number(l.price_per_unit))}
                              </p>
                            </div>
                            <p className="font-mono text-sm font-semibold text-emerald-950">
                              {formatNaira(Number(l.price_per_unit) * item.quantity)}
                            </p>
                          </li>
                        )
                      })}
                    </ul>
                    <div className="flex justify-between border-t border-line px-3 py-2 text-sm">
                      <span className="text-emerald-900/60">{t('checkout.orderSubtotal')}</span>
                      <span className="font-mono font-semibold text-emerald-950">{formatNaira(groupTotal)}</span>
                    </div>
                  </div>
                )
              })}
              <p className="text-xs leading-relaxed text-emerald-900/55">
                {t('checkout.splitBySellerShort')}
              </p>
            </div>

            {/* Delivery + place */}
            <aside className="lg:sticky lg:top-20 lg:self-start">
              <div className="space-y-3 rounded border border-line bg-white p-4">
                <h2 className="text-sm font-semibold text-emerald-950">{t('checkout.deliveryAndSummary')}</h2>
                <label className="block">
                  <span className="text-xs font-medium text-emerald-900/70">{t('checkout.deliverToState')}</span>
                  <Select value={deliveryState} onChange={(e) => setDeliveryState(e.target.value)} className="mt-1 w-full" aria-label={t('checkout.deliveryState')}>
                    <option value="">{t('checkout.selectStateOptional')}</option>
                    {NIGERIA_STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
                  </Select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-emerald-900/70">{t('checkout.noteOptional')}</span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder={t('checkout.notePlaceholderLong')}
                    className="mt-1 w-full rounded border border-line px-3 py-2 text-sm placeholder:text-emerald-900/35 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                  />
                </label>
                <div className="space-y-2 border-t border-clay pt-3">
                  <MetricValue label={`Subtotal (${groups.length} order${groups.length > 1 ? 's' : ''})`}>
                    <Price amount={grandTotal} size="sm" />
                  </MetricValue>

                  {/* Only fees the schedule actually resolved. A zero row
                      would imply a fee that was calculated and came to
                      nothing, which is a different claim from "none
                      applies". */}
                  {fees?.fees.map((fee) => (
                    <MetricValue
                      key={fee.scope}
                      label={FEE_LABEL[fee.scope]}
                      hint={describeRate(fee) ?? undefined}
                    >
                      {isBuyerPayable(fee) ? (
                        <Price amount={fee.amount} size="sm" />
                      ) : (
                        <span className="text-[11px] text-emerald-900/50">
                          paid by {fee.payer}
                        </span>
                      )}
                    </MetricValue>
                  ))}

                  <div className="border-t border-clay pt-2">
                    <MetricValue label={t('checkout.totalToPayAria')} emphasis>
                      <Price amount={payable} size="lg" />
                    </MetricValue>
                  </div>

                  <p className="text-[11px] leading-relaxed text-emerald-900/45">
                    {t('checkout.feesFrozenOnAccept')}
                  </p>
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
                  </div>
                )}

                <p className="text-xs font-medium text-emerald-900/70">{t('checkout.howToPay')}</p>

                <Button className="w-full" loading={placing} onClick={placeOrders}>
                  Pay directly - place {groups.length > 1 ? `${groups.length} orders` : 'order'}
                </Button>
                <p className="text-[11px] leading-relaxed text-emerald-900/55">
                  No money moves yet - each seller confirms first, then you pay securely with Paystack escrow. {BANK_RAILS_COPY}
                </p>

                <div className="border-t border-line pt-3">
                  {lines.length === 1 ? (
                    <>
                      <Button
                        variant="outline"
                        className="w-full"
                        disabled={placing}
                        onClick={() => applyForFinancing(lines[0])}
                      >
                        {t('checkout.applyFinancingInstead')}
                      </Button>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-emerald-900/55">
                        {t('checkout.financingAgainstPurchase')}
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-emerald-900/55">
                      {t('checkout.financingOneListing')}
                    </p>
                  )}
                </div>
              </div>
              <Link to="/cart" className="mt-3 block text-center text-sm font-medium text-emerald-700 hover:text-emerald-800">
                {t('checkout.backToCart')}
              </Link>
            </aside>
          </div>
        )}
      </div>
    </RoleShell>
  )
}
