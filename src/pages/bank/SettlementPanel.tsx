import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Banknote, ShieldAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { blockingConditions, type Readiness } from '@/lib/financing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DashboardCard } from '@/components/DashboardCard'
import { formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'

/**
 * Supplier-direct settlement — the institution's move, and the end of the
 * fulfilment spine.
 *
 * WHAT LOAMY IS NOT DOING HERE
 *   Holding money. This RECORDS that the institution paid the seller
 *   directly, against a reference the institution supplies.
 *   `loamy_record_supplier_settlement` writes a MEMORANDUM pair across
 *   `partner_funding` and `external_settlement` — neither leg is a member
 *   balance, and nothing in this flow creates one. Loamy is not a custodian
 *   and this panel must never read as though it were.
 *
 * EVERY GATE IS THE SERVER'S
 *   The function re-runs `loamy_settlement_readiness` before writing
 *   anything, so a settlement cannot be forced past an unmet condition by
 *   calling it directly. This panel shows those conditions so the officer can
 *   see what is outstanding rather than being told "not ready" with no
 *   reason. It weakens nothing: the readiness gate is displayed, not
 *   evaluated, here.
 *
 * REPLAY IS REFUSED HONESTLY
 *   A reference already recorded comes back `already_settled` rather than as
 *   an error a caller would retry — retrying a settlement blindly is how a
 *   seller gets paid twice.
 */
export function SettlementPanel({
  applicationId,
  approvedAmount,
  disbursedAmount,
  isSandbox,
  bankName,
  onSettled,
}: {
  applicationId: string
  approvedAmount: number | null
  disbursedAmount: number
  isSandbox: boolean
  bankName: string | null
  onSettled: () => Promise<void> | void
}) {
  const { t, tOr } = useT()
  const errorText = useErrorText()
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadReadiness = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('loamy_settlement_readiness', {
      p_application_id: applicationId,
    })
    if (err) { setError(errorText(err, 'bank.settlement.couldNotRead', 'The settlement conditions could not be read.')); return }
    setReadiness(data as Readiness)
  }, [applicationId])

  useEffect(() => { void loadReadiness() }, [loadReadiness])

  const settled = Number(disbursedAmount) > 0
  const blockers = blockingConditions(readiness)
  const ready = Boolean(readiness?.ready)

  async function settle() {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('bank.settlement.enterAmount'))
      return
    }
    if (approvedAmount != null && value > Number(approvedAmount)) {
      setError(`A settlement cannot exceed the ${formatNaira(Number(approvedAmount))} approved.`)
      return
    }
    if (!reference.trim()) {
      setError(t('bank.settlement.enterReference'))
      return
    }

    setBusy(true); setError(null); setNotice(null)
    const { data, error: err } = await supabase.rpc('loamy_record_supplier_settlement', {
      p_application_id: applicationId,
      p_amount: value,
      // Provenance is the institution's, never invented here. In sandbox the
      // provider is named as such so the record cannot read as a real rail.
      p_provider: isSandbox ? 'sandbox_bank' : (bankName ?? 'bank'),
      p_provider_reference: reference.trim(),
      p_note: note.trim() || null,
    })
    setBusy(false)

    if (err) { setError(errorText(err, 'bank.settlement.couldNotRecord', 'The settlement could not be recorded.')); return }

    const r = data as Record<string, unknown>
    if (!r?.settled) {
      // A refusal the server explains: conditions not met, or a replayed
      // reference. Neither is a success and neither is hidden.
      setError(
        r?.reason === 'already_settled'
          ? t('bank.settlement.duplicateReference')
          : r?.reason === 'conditions_not_met'
            ? t('bank.settlement.conditionsNotMetYet')
            : t('bank.settlement.couldNotRecord'),
      )
      await loadReadiness()
      return
    }

    setOpen(false); setAmount(''); setReference(''); setNote('')
    setNotice(t('bank.settlement.recordedNotice'))
    await loadReadiness()
    await onSettled()
  }

  return (
    <DashboardCard title={t('bank.settlement.title')}>
      {isSandbox && (
        <p className="mb-2.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('bank.settlement.sandboxNote')}
        </p>
      )}

      {settled ? (
        <p className="text-sm text-emerald-900/80">
          {t('bank.settlement.settledToSeller', { amount: formatNaira(Number(disbursedAmount)) })}
        </p>
      ) : (
        <p className="text-sm text-emerald-900/75">
          {t('bank.settlement.institutionPaysDirect')}
        </p>
      )}

      {/* The gate, shown rather than merely enforced. */}
      {!settled && readiness && !ready && (
        <div className="mt-2.5 rounded-lg bg-sand p-3">
          <p className="text-[12px] font-medium text-emerald-900">{t('bank.settlement.outstandingBefore')}</p>
          <ul className="mt-1 space-y-0.5">
            {blockers.length > 0 ? blockers.map((b) => (
              <li key={b.code} className="flex items-start gap-1.5 text-[12px] text-emerald-900/75">
                <span aria-hidden>·</span>{tOr(`bank.condition.${b.code}`, b.english)}
              </li>
            )) : (
              <li className="text-[12px] text-emerald-900/75">
                {readiness.reason ?? t('bank.settlement.conditionsNotMet')}
              </li>
            )}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{error}
        </p>
      )}
      {notice && (
        <p className="mt-2.5 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">{notice}</p>
      )}

      {!settled && ready && (
        open ? (
          <div className="mt-3 space-y-2.5">
            <div>
              <Label htmlFor="stl-amount">{t('bank.settlement.amountPaid')}</Label>
              <Input id="stl-amount" type="number" step="any" min={0} value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(null) }} className="mt-1" />
              {approvedAmount != null && (
                <p className="mt-1 text-[11px] text-emerald-900/50">
                  Approved: {formatNaira(Number(approvedAmount))}. A settlement cannot exceed it.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="stl-ref">{t('bank.settlement.yourReference')}</Label>
              <Input id="stl-ref" value={reference} className="mt-1"
                onChange={(e) => { setReference(e.target.value); setError(null) }} />
              <p className="mt-1 text-[11px] text-emerald-900/50">
                {t('bank.settlement.referenceHint')}
              </p>
            </div>
            <div>
              <Label htmlFor="stl-note">{t('bank.settlement.note')}</Label>
              <Textarea id="stl-note" value={note} onChange={(e) => setNote(e.target.value)}
                className="mt-1" placeholder={t('bank.settlement.notePlaceholder')} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" loading={busy} onClick={settle}>{t('bank.settlement.record')}</Button>
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => { setOpen(false); setError(null) }}>{t('common.cancel')}</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" className="mt-3" onClick={() => {
            setOpen(true); setError(null)
            if (approvedAmount != null) setAmount(String(approvedAmount))
          }}>
            <Banknote className="h-3.5 w-3.5" aria-hidden /> {t('bank.settlement.record')}
          </Button>
        )
      )}
    </DashboardCard>
  )
}
