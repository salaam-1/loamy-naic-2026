import { useState } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { fulfilmentLabel, type Fulfilment } from '@/lib/fulfilment'
import { Card } from '@/components/ui/card'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

/**
 * Delivery — and the buyer's confirmation that the goods actually arrived.
 *
 * TWO DIFFERENT CLAIMS, BY TWO DIFFERENT PEOPLE
 *   The carrier says `delivered`. The buyer says `received`. They are not the
 *   same statement and Loamy keeps them apart: a carrier marking a job
 *   delivered is a claim about what they did, and settlement conditions turn
 *   on the buyer's own confirmation. Collapsing the two would let one party
 *   close a purchase on the other's behalf.
 *
 * NOTHING IS INFERRED
 *   `fulfilment_state` comes from the transaction's own state machine via
 *   `loamy_transaction_transition`. This card offers the confirmation only
 *   when the state actually permits it, and shows the server's refusal
 *   verbatim when it does not.
 */
export function DeliveryCard({
  transactionId,
  state,
  onChange,
}: {
  transactionId: string
  state: Fulfilment
  onChange: () => Promise<void> | void
}) {
  const { t } = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fulfilment = state.transaction.fulfilment_state
  const isBuyer = state.transaction.viewer_role === 'buyer'
  const carrierSaysDelivered =
    state.transport?.status === 'delivered' || fulfilment === 'delivered'
  const received = fulfilment === 'received'

  // Only the buyer confirms, and only once the goods are said to be there.
  const canConfirm = isBuyer && carrierSaysDelivered && !received

  // Nothing to say yet: the goods are still moving and neither claim exists.
  if (!carrierSaysDelivered && !received) return null

  async function confirm() {
    setBusy(true); setError(null)
    const { error: rpcError } = await supabase.rpc('loamy_transaction_transition', {
      p_transaction_id: transactionId,
      p_event_type: 'received',
      p_machine: 'fulfilment',
    })
    setBusy(false)
    if (rpcError) {
      setError(errorMessage(rpcError, 'That confirmation could not be recorded.'))
      return
    }
    await onChange()
  }

  return (
    <Card className="p-4">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-950">
        <CheckCircle2
          className={received ? 'h-3.5 w-3.5 text-emerald-600' : 'h-3.5 w-3.5 text-emerald-900/35'}
          aria-hidden
        />
        {t('logistics.delivery.title')}
      </h3>

      <p className="mt-1 text-[13px] text-emerald-900/75">
        {received
          ? 'You confirmed receipt of these goods.'
          : canConfirm
            ? 'The carrier has marked this delivered. Confirm you have received the goods - settlement depends on your confirmation, not the carrier’s.'
            : isBuyer
              ? `Current state: ${fulfilmentLabel(fulfilment)}.`
              : 'Waiting for the buyer to confirm receipt.'}
      </p>

      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {canConfirm && (
        <Button size="sm" className="mt-3" loading={busy} onClick={confirm}>
          {t('logistics.delivery.confirmReceipt')}
        </Button>
      )}
    </Card>
  )
}
