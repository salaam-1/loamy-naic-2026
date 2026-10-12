import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { describeRate, payerConsequence } from '@/lib/feeAdmin'
import { formatDateShort } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface FeeRuleSummary {
  id: string
  ref: string | null
  scope: string
  transaction_type: string | null
  basis: string
  value: number
  payer: string
  effective_from: string
  effective_to: string | null
  active: boolean
}

/**
 * Confirming a change to a live fee rule.
 *
 * WHAT THIS PREVENTS
 *   The previous surface ended a rule on a single click. That is how the
 *   ₦2,500 Growth Partner commission was switched off on 2026-09-21: one
 *   misclick, applied instantly to production, silently, with no record of
 *   who or why. A fee rule decides what members are charged and what partners
 *   are paid, and it takes effect for everyone the moment it changes.
 *
 * FOUR DEFENCES, IN ORDER OF HOW OFTEN THEY MATTER
 *
 * 1. IT SAYS WHAT IS AFFECTED. The reference, the scope, the rate, the payer,
 *    the effective date — and, for a rule Loamy PAYS OUT, the sentence that
 *    was missing: ending it means the partner is paid nothing. "End rule"
 *    sounds like saving a member money. For a commission it is the opposite.
 *
 * 2. IT REQUIRES A REASON. Mandatory, and recorded in the audit trail. The
 *    accidental end left `created_by` null and no audit row, so afterwards
 *    the only evidence it happened at all was a timestamp.
 *
 * 3. THE CONFIRM BUTTON CANNOT BE HIT BY THE CLICK THAT OPENED THE DIALOG.
 *    It is disabled for a moment after opening, so a double-click on "End
 *    rule" lands on a dead control rather than confirming. Focus goes to the
 *    reason box, not to the destructive button.
 *
 * 4. IT IS REVERSIBLE, AND SAYS SO BEFORE YOU ACT. A rule that is ended can
 *    be reinstated as a new rule at the same terms. Knowing that beforehand
 *    is the difference between a recoverable mistake and a frightening one.
 */
export function FeeRuleDialog({
  rule,
  mode,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  rule: FeeRuleSummary
  mode: 'end' | 'restore'
  busy: boolean
  error: string | null
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  /**
   * Guards against the opening click arriving as a double-click. 400ms is
   * below the threshold at which a deliberate reader notices a delay and well
   * above the interval a stray double-click lands in.
   */
  const [armed, setArmed] = useState(false)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 400)
    // Focus the reason, never the destructive button: a stray Enter should
    // type a character, not confirm.
    reasonRef.current?.focus()
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const ending = mode === 'end'
  const canConfirm = armed && reason.trim().length > 0 && !busy
  const payout = rule.scope === 'verification_commission' || rule.payer === 'loamy'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-emerald-950/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fee-dialog-title"
      /* Backdrop dismissal waits for the same arming delay as the confirm
         button. Browser QA found that at tablet width the SECOND half of a
         double-click on "End rule" landed on the backdrop and closed the
         dialog again -- harmless, but it flashes open and shut, which invites
         another click. A double-click now always leaves the dialog open,
         waiting for a reason. */
      onClick={(e) => { if (e.target === e.currentTarget && armed && !busy) onCancel() }}
    >
      <div className="w-full max-w-lg rounded-t-card bg-white p-5 shadow-lg sm:rounded-card">
        <div className="flex items-start justify-between gap-3">
          <h2 id="fee-dialog-title" className="flex items-center gap-2 text-base font-semibold text-emerald-950">
            {ending
              ? <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
              : <RotateCcw className="h-4 w-4 text-emerald-700" aria-hidden />}
            {ending ? 'End this fee rule?' : 'Reinstate this fee rule?'}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close without changing anything"
            className="-m-1 flex h-8 w-8 min-h-touch min-w-touch items-center justify-center rounded text-emerald-900/50 hover:text-emerald-900"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Defence 1: exactly what is affected. */}
        <dl className="mt-3 space-y-1.5 rounded-lg bg-sand px-3 py-2.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-emerald-900/60">Rule</dt>
            <dd className="font-mono font-semibold text-emerald-950">{rule.ref ?? rule.id.slice(0, 8)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-emerald-900/60">Rate</dt>
            <dd className="font-mono font-semibold text-emerald-950">{describeRate(rule.basis, rule.value)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-emerald-900/60">Applies to</dt>
            <dd className="text-right text-emerald-950">
              {rule.scope.replace(/_/g, ' ')}
              {rule.transaction_type ? ` · ${rule.transaction_type.replace(/_/g, ' ')}` : ''}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-emerald-900/60">In force from</dt>
            <dd className="text-emerald-950">{formatDateShort(rule.effective_from)}</dd>
          </div>
          {rule.effective_to && (
            <div className="flex justify-between gap-3">
              <dt className="text-emerald-900/60">Ended</dt>
              <dd className="text-emerald-950">{formatDateShort(rule.effective_to)}</dd>
            </div>
          )}
        </dl>

        {/* The sentence whose absence caused the incident. */}
        {ending && (
          <p
            data-testid="consequence"
            className={payout
              ? 'mt-2.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] leading-snug text-rose-900'
              : 'mt-2.5 rounded-lg bg-sand px-3 py-2 text-[13px] leading-snug text-emerald-900/75'}
          >
            {payerConsequence(rule.scope, rule.payer)}{' '}
            {payout
              ? 'It takes effect immediately, for everyone.'
              : 'It takes effect immediately for anything accepted from now on. Nothing already accepted changes.'}
          </p>
        )}

        {!ending && (
          <p className="mt-2.5 rounded-lg bg-sand px-3 py-2 text-[13px] leading-snug text-emerald-900/75">
            This creates a <strong className="font-medium">new</strong> rule at the same terms, effective
            from now. The ended rule is left as it is, so the period it applied to - and the gap after
            it - stay on the record.
          </p>
        )}

        {/* Defence 2: a reason, always. */}
        <div className="mt-3">
          <Label htmlFor="fee-reason">
            {ending ? 'Why are you ending it? (required)' : 'Why are you reinstating it? (required)'}
          </Label>
          <Textarea
            id="fee-reason"
            ref={reasonRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1"
            placeholder={ending
              ? 'e.g. Replaced by the agreed commercial rate from 1 October.'
              : 'e.g. Ended by mistake on 21 September. Not a pricing change.'}
          />
          <p className="mt-1 text-[11px] text-emerald-900/50">
            Recorded in the audit trail against your account.
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-2.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
            {error}
          </p>
        )}

        {/* Defence 4: reversibility, stated before the act. */}
        {ending && (
          <p className="mt-2.5 text-[12px] leading-snug text-emerald-900/55">
            You can reinstate this rule afterwards at the same terms. It will start a new period
            rather than reopening this one.
          </p>
        )}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant={ending ? 'danger' : 'primary'}
            loading={busy}
            disabled={!canConfirm}
            onClick={() => onConfirm(reason)}
          >
            {ending ? 'End this rule' : 'Reinstate this rule'}
          </Button>
        </div>
      </div>
    </div>
  )
}
