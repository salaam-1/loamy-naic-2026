import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle, CheckCircle2, Loader2, PackageCheck, Truck, Warehouse,
} from 'lucide-react'
import {
  fetchFulfilment, fulfilmentLabel, loadingFlagLabel, whoseMove, MOVEMENT_LABEL,
  type Fulfilment, type WarehouseMovement,
} from '@/lib/fulfilment'
import { Card } from '@/components/ui/card'
import { useT } from '@/lib/i18n'
import { LoadingCard } from '@/components/fulfilment/LoadingCard'
import { TransportCard } from '@/components/fulfilment/TransportCard'
import { StorageCard } from '@/components/fulfilment/StorageCard'
import { DeliveryCard } from '@/components/fulfilment/DeliveryCard'
import { formatDateShort, formatNaira } from '@/lib/utils'

/**
 * Everything that happens to a purchase after it is agreed.
 *
 * WHY IT IS ONE PANEL
 *   Loading, transport and storage are three tables and five functions, but
 *   they are one question to the member: where are my goods and whose move is
 *   it. Splitting them across pages is how the old product ended up with a
 *   backend that worked and a member who could not reach it.
 *
 * WHAT IT NEVER DOES
 *   It computes no state. `loamy_transaction_fulfilment` reads the
 *   authoritative tables and says which side the viewer is on; a stage that
 *   has not happened is absent rather than drawn as an empty "pending" step.
 *   Every action returns a result, and a refusal is shown in the caller's own
 *   words.
 */
export function FulfilmentPanel({
  transactionId,
  onChanged,
}: {
  transactionId: string
  /** Lets the page refresh the journey tracker when a stage moves. */
  onChanged?: () => Promise<void> | void
}) {
  const { t, tOr } = useT()
  const [state, setState] = useState<Fulfilment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    const result = await fetchFulfilment(transactionId)
    setLoaded(true)
    if (!result.ok) { setError(result.error); return }
    setError(null)
    setState(result.value)
    await onChanged?.()
  }, [transactionId, onChanged])

  useEffect(() => { void reload() }, [reload])

  if (!loaded) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-emerald-900/55">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t('logistics.panel.loading')}
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="p-4">
        <p role="alert" className="flex items-start gap-1.5 text-[13px] text-rose-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      </Card>
    )
  }

  // A stranger gets no detail at all, not an empty panel that hints the
  // purchase exists.
  if (!state?.available) return null

  const move = whoseMove(state)
  const isSeller = state.transaction.viewer_role === 'seller'
  const isBuyer = state.transaction.viewer_role === 'buyer'

  return (
    <section className="space-y-3" aria-label={t('logistics.panel.fulfilment')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-emerald-950">{t('logistics.panel.fulfilment')}</h2>
        <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-medium text-emerald-900/70">
          {/* words from the pack, falling back to the lib's own English */}
          {tOr(
            `logistics.fulfilment.${state.transaction.fulfilment_state ?? 'not_started'}`,
            fulfilmentLabel(state.transaction.fulfilment_state),
          )}
        </span>
      </div>

      {/* The one thing a member most wants to know. */}
      {move && (
        <p className="rounded-lg bg-emerald-50/70 px-3 py-2 text-[13px] leading-snug text-emerald-900">
          {/* whoseMove() decides WHOSE move; these are only its words. */}
          <strong className="font-semibold">{tOr(move.actorKey, move.actor)}</strong>{' '}
          {tOr(move.actionKey, move.action, move.vars)}
        </p>
      )}

      <LoadingCard transactionId={transactionId} state={state} onChange={reload} canRecord={isSeller} />
      <TransportCard transactionId={transactionId} state={state} onChange={reload} canArrange={isBuyer} />
      <StorageCard transactionId={transactionId} state={state} onChange={reload} />

      <DeliveryCard transactionId={transactionId} state={state} onChange={reload} />

      {/* Receipts: a warehouse's own statement about stock it holds. */}
      {state.receipts.length > 0 && (
        <Card className="p-4">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-950">
            <Warehouse className="h-3.5 w-3.5 text-emerald-700" aria-hidden /> {t('logistics.panel.warehouseReceipts')}
          </h3>
          <ul className="mt-2 divide-y divide-line text-[13px]">
            {state.receipts.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <span className="text-emerald-900/80">
                  {tOr(
                    `warehouse.movement.${r.movement}`,
                    MOVEMENT_LABEL[r.movement as WarehouseMovement] ?? r.movement,
                  )} ·{' '}
                  <span className="font-mono">{Number(r.quantity).toLocaleString('en-NG')}</span>
                  {r.condition ? ` · ${r.condition}` : ''}
                </span>
                <span className="font-mono text-[11px] text-emerald-900/50">
                  {r.ref} · {formatDateShort(r.recorded_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Financing is read-only here; the bank decides it elsewhere. */}
      {state.financing && (
        <Card className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-950">
              <PackageCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden /> {t('logistics.panel.settlement')}
            </h3>
            <span className="font-mono text-[11px] text-emerald-900/50">{state.financing.ref}</span>
          </div>
          <p className="mt-1 text-[13px] text-emerald-900/75">
            {Number(state.financing.disbursed_amount) > 0
              ? t('logistics.panel.settledToSeller', {
                  amount: formatNaira(Number(state.financing.disbursed_amount)),
                })
              : t('logistics.panel.nothingSettled')}
          </p>
          {state.financing.is_sandbox && (
            <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
              {t('logistics.panel.sandboxFinancing')}
            </p>
          )}
        </Card>
      )}
    </section>
  )
}

/** Shared by the cards below: evidence gaps the server flagged. */
export function LoadingFlags({ flags }: { flags: string[] }) {
  if (!flags?.length) return null
  return (
    <ul className="mt-1.5 space-y-0.5">
      {flags.map((f) => (
        <li key={f} className="flex items-start gap-1.5 text-[12px] text-amber-800">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {loadingFlagLabel(f)}
        </li>
      ))}
    </ul>
  )
}

/** A done/next marker used across the fulfilment cards. */
export function StepMark({ done }: { done: boolean }) {
  return done
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
    : <Truck className="h-3.5 w-3.5 text-emerald-900/35" aria-hidden />
}
