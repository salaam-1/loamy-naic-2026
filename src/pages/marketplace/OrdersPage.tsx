import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Package, ShieldCheck, X } from 'lucide-react'
import { RoleShell } from '@/pages/shared/RoleShell'
import { Button } from '@/components/ui/button'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import {
  fetchMyOrders,
  fetchSalesOrders,
  ORDER_STATUS_META,
  type Order,
} from '@/lib/orders'

type Tab = 'buying' | 'selling'

/**
 * Orders — HISTORY ONLY.
 *
 * `orders` was deprecated by Phase 4 slice 1, which made `transactions` the
 * authoritative spine. Checkout has not created an order since. This page
 * kept working though, and its Release action called paystack-payout, which
 * credited the seller's Loamy WALLET -- the custodial write Wave 1 QA found
 * in production.
 *
 * So every lifecycle action is gone: no pay, no release, no settle, no
 * cancel, no accept. What remains is the record, because members are entitled
 * to see what they did and deleting history to tidy a deprecation would be
 * the wrong answer twice over.
 *
 * Anything live is a transaction, and lives at /purchase/:txnId.
 */
export default function OrdersPage() {
  const { t, tPlural } = useT()
  const [params, setParams] = useSearchParams()
  const placed = Number(params.get('placed') || 0)
  const paid = params.get('paid')

  const [tab, setTab] = useState<Tab>('buying')
  const [buying, setBuying] = useState<Order[] | null>(null)
  const [selling, setSelling] = useState<Order[] | null>(null)
  const [people, setPeople] = useState<Record<string, PublicProfile>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [mine, sales] = await Promise.all([fetchMyOrders(), fetchSalesOrders()])
    setBuying(mine)
    setSelling(sales)
    const ids = [...mine.map((o) => o.seller_id), ...sales.map((o) => o.buyer_id)]
    if (ids.length) setPeople(await fetchPublicProfiles(ids))
  }, [])

  useEffect(() => { void load() }, [load])

  // After a Paystack redirect (?paid), the webhook flips the order to in_escrow
  // a moment later — refetch a few times so the status updates without a reload.
  useEffect(() => {
    if (!paid) return
    let n = 0
    const t = setInterval(() => {
      n += 1
      void load()
      if (n >= 5) clearInterval(t)
    }, 2500)
    return () => clearInterval(t)
  }, [paid, load])

  const list = tab === 'buying' ? buying : selling

  const dismissBanner = () => {
    params.delete('placed')
    params.delete('paid')
    setParams(params, { replace: true })
  }

  const act = async (fn: () => Promise<void>, id: string) => {
    setBusyId(id)
    setActionError(null)
    try { await fn(); await load() }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Something went wrong.') }
    finally { setBusyId(null) }
  }

  return (
    <RoleShell section="marketplace">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-emerald-800" strokeWidth={1.5} aria-hidden />
          <h1 className="text-lg font-bold text-emerald-950">{t('transaction.orderHistory')}</h1>
        </div>

        <p className="mt-1.5 rounded-lg bg-sand px-3 py-2 text-[13px] leading-snug text-emerald-900/75">
          These are orders from before Loamy moved to the transaction spine. They are kept for your
          records and can no longer be acted on. Anything live appears on its own purchase page.
        </p>

        {placed > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="flex-1">
              {tPlural('transaction.orderPlaced', placed, { count: placed })}{' '}
              {t('transaction.orderPlacedTail')}
            </p>
            <button type="button" onClick={dismissBanner} aria-label={t('transaction.dismiss')} className="text-emerald-700 hover:text-emerald-900">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {paid && (
          <div className="mt-4 flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="flex-1">
              {t('transaction.confirmingPayment')}
            </p>
            <button type="button" onClick={dismissBanner} aria-label={t('transaction.dismiss')} className="text-emerald-700 hover:text-emerald-900">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {actionError && (
          <div className="mt-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="flex-1">{actionError}</p>
            <button type="button" onClick={() => setActionError(null)} aria-label={t('transaction.dismiss')} className="text-red-600 hover:text-red-800">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="mt-4 inline-flex rounded border border-line bg-white p-0.5 text-sm">
          {([['buying', 'My orders', buying?.length], ['selling', 'Sales', selling?.length]] as const).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'rounded px-3 py-1.5 font-medium transition-colors',
                tab === key ? 'bg-emerald-800 text-white' : 'text-emerald-900/70 hover:text-emerald-900',
              )}
            >
              {label}{typeof count === 'number' && count > 0 ? ` (${count})` : ''}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {list === null ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded border border-line bg-white" aria-hidden />
            ))
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded border border-line bg-white px-4 py-14 text-center">
              <Package className="h-8 w-8 text-emerald-900/20" aria-hidden />
              <p className="text-sm text-emerald-900/60">
                {tab === 'buying' ? 'You haven’t placed any orders yet.' : 'No sales orders yet.'}
              </p>
              {tab === 'buying' && <Link to="/marketplace"><Button size="sm">{t('transaction.browseMarketplace')}</Button></Link>}
            </div>
          ) : (
            list.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                perspective={tab}
                counterparty={people[tab === 'buying' ? order.seller_id : order.buyer_id]}
              />
            ))
          )}
        </div>
      </div>
    </RoleShell>
  )
}

const FLOW = ['Placed', 'Confirmed', 'Paid', 'Released'] as const

function orderStage(status: Order['status']): number | null {
  switch (status) {
    case 'pending_seller': return 1
    case 'confirmed':
    case 'awaiting_payment': return 2
    case 'in_escrow': return 3
    case 'released':
    case 'completed': return 4
    default: return null // rejected / cancelled / refunded — no positive progress
  }
}

/** Compact 4-step timeline: Placed → Confirmed → Paid → Released. */
function OrderProgress({ status }: { status: Order['status'] }) {
  const done = orderStage(status)
  if (done === null) return null
  return (
    <div className="flex items-center border-b border-line px-3 py-2">
      {FLOW.map((label, i) => {
        const isDone = i < done
        return (
          <div key={label} className={cn('flex items-center', i < FLOW.length - 1 && 'flex-1')}>
            <span
              className={cn(
                'grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold',
                isDone ? 'bg-emerald-700 text-white' : 'bg-emerald-950/10 text-emerald-900/40',
              )}
            >
              {isDone ? '✓' : i + 1}
            </span>
            <span className={cn('ml-1.5 hidden text-[11px] font-medium sm:inline', isDone ? 'text-emerald-800' : 'text-emerald-900/40')}>
              {label}
            </span>
            {i < FLOW.length - 1 && <span className={cn('mx-1.5 h-px flex-1', i < done - 1 ? 'bg-emerald-300' : 'bg-line')} />}
          </div>
        )
      })}
    </div>
  )
}

function OrderCard({
  order,
  perspective,
  counterparty,
}: {
  order: Order
  perspective: Tab
  counterparty?: PublicProfile
}) {
  const { t, tOr } = useT()
  // chip from the lib map, words from the pack
  const meta = ORDER_STATUS_META[order.status]
  const who = perspective === 'buying' ? t('transaction.seller') : t('transaction.buyer')
  const buying = perspective === 'buying'
  return (
    <div className="overflow-hidden rounded border border-line bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-3 py-2">
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', meta.chip)}>
          {tOr(`transaction.orderStatus.${order.status}`, meta.label)}
        </span>
        <span className="text-sm text-emerald-900/70">
          {who}: <span className="font-medium text-emerald-950">{counterparty?.full_name ?? t('transaction.loamyMember')}</span>
        </span>
        <span className="ml-auto font-mono text-[11px] text-emerald-900/45">
          #{order.id.slice(0, 8)} · {formatDateShort(order.created_at)}
        </span>
      </div>

      <OrderProgress status={order.status} />

      <ul className="divide-y divide-line px-3">
        {(order.items ?? []).map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="text-emerald-950">{it.commodity}</span>
            <span className="font-mono text-xs text-emerald-900/55">
              {Number(it.quantity)} {it.unit} × {formatNaira(Number(it.unit_price))}
            </span>
            <span className="font-mono font-semibold text-emerald-950">{formatNaira(Number(it.line_total))}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-sm">
        {order.delivery_state && <span className="text-xs text-emerald-900/55">Deliver to {order.delivery_state}</span>}
        <span className="ml-auto text-emerald-900/60">{t('transaction.subtotal')}</span>
        <span className="font-mono font-semibold text-emerald-950">{formatNaira(Number(order.subtotal))}</span>
      </div>

      {(order.buyer_note || order.seller_note) && (
        <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-emerald-900/70">
          {order.buyer_note && <p><span className="font-medium">{t('transaction.buyerNote')}</span> {order.buyer_note}</p>}
          {order.seller_note && <p><span className="font-medium">{t('transaction.sellerNote')}</span> {order.seller_note}</p>}
        </div>
      )}

      {/* No lifecycle actions. This page is history.
          Every one of these used to be a live button, and "Confirm receipt &
          release" called paystack-payout, which credited the seller's Loamy
          wallet -- the custodial write this deprecation exists to stop. An
          order that is still mid-flight is finished off-platform; anything
          new is a transaction. */}
      {!['completed', 'cancelled', 'declined', 'refunded'].includes(order.status) && (
        <div className="border-t border-line px-3 py-2 text-xs text-emerald-900/60">
          {t('transaction.legacyOrder')}
        </div>
      )}

      {/* Released / completed */}
      {(order.status === 'released' || order.status === 'completed') && (
        <div className="border-t border-line px-3 py-2 text-xs font-medium text-emerald-700">
          {buying ? 'Payment released.' : 'Funds released by the buyer.'}
        </div>
      )}
    </div>
  )
}
