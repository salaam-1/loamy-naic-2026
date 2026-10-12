import { useCallback, useEffect, useState } from 'react'
import { Landmark, Loader2, ShieldCheck } from 'lucide-react'
import { fetchEscrowForAward, fundEscrow, refundEscrow, releaseEscrow, type EscrowTransaction } from '@/lib/escrow'
import { formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Escrow status as a member reads it. The key is the DB value; the English is
 * the fallback. Keep "funded" and "released" far apart in every language: the
 * first says the payment partner is holding the money, the second says the
 * supplier has it.
 */
const STATUS_LABEL: Record<EscrowTransaction['status'], string> = {
  initiated: 'Awaiting funding', funded: 'Funded - held by our payment partner',
  released: 'Released to supplier', partially_released: 'Partially released',
  refunded: 'Refunded', disputed: 'Disputed',
}

/**
 * Per-award escrow control. Funds are held by our payment partner (Paystack),
 * never by Loamy. Funding opens the partner's hosted flow; release/refund is
 * permission-gated (Finance Officer / Procurement Director) and only allowed
 * after inspection is accepted (enforced server-side).
 */
export default function AwardEscrow({ awardId, awardStatus, canSettle }: {
  awardId: string
  awardStatus: string
  canSettle: boolean
}) {
  const { t, tOr } = useT()
  const errorText = useErrorText()
  const statusLabel = (st: EscrowTransaction['status']) =>
    tOr(`processor.escrowStatus.${st}`, STATUS_LABEL[st])
  const [esc, setEsc] = useState<EscrowTransaction | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partial, setPartial] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setEsc(await fetchEscrowForAward(awardId)) }
    catch (e) { setError(errorText(e, 'processor.escrow.couldNotLoad', 'Could not load escrow.')) }
    finally { setLoading(false) }
  }, [awardId])

  useEffect(() => { void load() }, [load])

  async function onFund() {
    setBusy(true); setError(null)
    try { const url = await fundEscrow(awardId); window.location.assign(url) }
    catch (e) { setError(errorText(e, 'processor.escrow.couldNotStartFunding', 'Could not start funding.')); setBusy(false) }
  }

  async function onRelease(amount?: number) {
    setBusy(true); setError(null)
    try {
      const r = await releaseEscrow(awardId, amount)
      if (r.status === 'no_recipient') setError(t('processor.escrow.noRecipient'))
      setPartial(''); await load()
    } catch (e) { setError(errorText(e, 'processor.escrow.couldNotRelease', 'Could not release.')) }
    finally { setBusy(false) }
  }

  async function onRefund() {
    setBusy(true); setError(null)
    try { await refundEscrow(awardId); await load() }
    catch (e) { setError(errorText(e, 'processor.escrow.couldNotRefund', 'Could not refund.')) }
    finally { setBusy(false) }
  }

  if (loading) return <p className="flex items-center gap-1 text-[12px] text-emerald-900/45"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {t('processor.escrow.loading')}</p>

  const inspected = awardStatus === 'inspected' || awardStatus === 'delivered' || awardStatus === 'completed'
  const remaining = esc ? esc.amount - esc.released_amount : 0

  return (
    <div className="border-t border-line pt-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-emerald-900/70">
          <Landmark className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          {esc
            ? t('processor.escrow.labelWithStatus', { status: statusLabel(esc.status) })
            : t('processor.escrow.label')}
        </span>
        {!esc && canSettle && (
          <Button size="sm" variant="outline" onClick={onFund} disabled={busy}>{busy ? t('processor.escrow.starting') : t('processor.escrow.fund')}</Button>
        )}
      </div>

      {esc && (
        <div className="mt-1.5 text-[12px] text-emerald-900/60">
          <div className="flex justify-between"><span>{t('processor.escrow.amount')}</span><span className="font-mono">{formatNaira(esc.amount)}</span></div>
          {esc.released_amount > 0 && <div className="flex justify-between"><span>{t('processor.escrow.released')}</span><span className="font-mono">{formatNaira(esc.released_amount)}</span></div>}
          {esc.status === 'funded' && (
            <p className="mt-1 inline-flex items-center gap-1 text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {t('processor.escrow.heldByPartner')}</p>
          )}
        </div>
      )}

      {/* Release / refund actions — only after inspection accepted, settle role. */}
      {esc && canSettle && (esc.status === 'funded' || esc.status === 'partially_released') && (
        <div className="mt-2">
          {!inspected ? (
            <p className="text-[12px] text-emerald-900/50">{t('processor.escrow.releaseAfterInspection')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => onRelease()} disabled={busy}>{t('processor.escrow.release', { amount: formatNaira(remaining) })}</Button>
              <div className="flex items-center gap-1">
                <Input type="number" min="0" max={remaining} value={partial} onChange={(e) => setPartial(e.target.value)}
                  placeholder={t('processor.escrow.partialPlaceholder')} className="h-8 min-h-touch w-24 text-[13px]" />
                <Button size="sm" variant="outline" disabled={busy || !partial || Number(partial) <= 0} onClick={() => onRelease(Number(partial))}>{t('processor.escrow.releasePart')}</Button>
              </div>
              <button onClick={onRefund} disabled={busy} className="text-[12px] text-red-700 hover:underline disabled:opacity-50">{t('processor.escrow.refund')}</button>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-[12px] text-red-700">{error}</p>}
    </div>
  )
}
