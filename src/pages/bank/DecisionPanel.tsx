import { useState } from 'react'
import { AlertCircle, ShieldAlert } from 'lucide-react'
import { recordFinancingDecision } from '@/lib/bankDecision'
import {
  DECISION_META, SANDBOX_DECISION_WARNING, LIVE_DECISION_NOTE,
  checkApprovalAmount, checkTenorDays, offeredDecisions,
  type FinancingDecision,
} from '@/lib/financingLifecycle'
import { statusMeta } from '@/lib/financingLifecycle'
import type { ApplicationBundle } from '@/lib/bank'
import { formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DashboardCard } from '@/components/DashboardCard'

/**
 * Where a bank officer actually decides.
 *
 * Until Phase 4 slice 3 this panel offered three buttons — under review,
 * request info, mark decided elsewhere — because it called
 * `loamy_bank_set_status`, which has no approve and no reject. The
 * authoritative `loamy_financing_decision` had existed since Phase 6 with
 * amount, tenor, pricing, bank reference and provenance, and no caller.
 *
 * FOUR RULES THIS COMPONENT HOLDS
 *
 * 1. THE ACTIONS COME FROM THE SERVER. `permitted_decisions` is computed by
 *    `loamy_financing_permitted_decisions` and returned in the bundle. This
 *    component renders that list and invents nothing — if the server sends
 *    none, none are offered. So Approve cannot appear on an application that
 *    is already approved, declined or terminal, and the transition table
 *    cannot drift away from the database.
 *
 * 2. A SANDBOX DECISION SAYS SO BEFORE IT IS MADE. When the institution's
 *    integration is in sandbox mode the officer is told, in the form, that
 *    what they are about to record is test data. Not in a footnote afterwards.
 *
 * 3. THE AMOUNT IS NEVER INVENTED. There is no ladder, no suggested tier and
 *    no default beyond the amount actually requested. The only rules applied
 *    are the server's own: greater than zero, and not more than requested.
 *
 * 4. A FAILURE IS SHOWN, NEVER SWALLOWED. The real error is surfaced through
 *    `errorMessage`, the form keeps what was typed, and nothing reports
 *    success that did not happen.
 */
export function DecisionPanel({
  bundle,
  onDecided,
}: {
  bundle: ApplicationBundle
  onDecided: () => Promise<void> | void
}) {
  const { t, tOr } = useT()
  const statusLabel = (st: string) => tOr(`financing.status.${st}`, statusMeta(st).label)
  const decisionLabel = (d: FinancingDecision) => tOr(`bank.decision.${d}`, DECISION_META[d].label)
  const decisionLabelLower = (d: FinancingDecision) =>
    tOr(`bank.decision.${d}Lower`, DECISION_META[d].label.toLowerCase())
  const decisionIntent = (d: FinancingDecision) =>
    tOr(`bank.decision.${d}Intent`, DECISION_META[d].intent)
  /** A validator refusal, in the member's language where the lib gave a key. */
  const checkText = (c: { message: string; messageKey?: string; vars?: Record<string, string | number> }) =>
    c.messageKey ? tOr(c.messageKey, c.message, c.vars) : c.message
  const app = bundle.application
  /**
   * The bundle is a jsonb payload, so a server that predates slice 3 returns
   * it without `bank` or `permitted_decisions`. Rather than white-screen on a
   * property of undefined, treat the unknown case the safe way round: no
   * integration mode means SANDBOX, not live, and no permitted list means no
   * actions are offered. A portal that stays silent when it cannot tell is
   * correct; one that offers Approve on a guess is not.
   */
  const bank = bundle.bank ?? {
    name: null, ref: null, integration_mode: 'sandbox',
    is_sandbox: true, supports_supplier_direct: false,
  }
  const offered = offeredDecisions(bundle.permitted_decisions)

  const [open, setOpen] = useState<FinancingDecision | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [conditions, setConditions] = useState('')
  const [tenor, setTenor] = useState('')
  const [pricing, setPricing] = useState('')
  const [bankRef, setBankRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requested = Number(app.amount_requested)

  function start(decision: FinancingDecision) {
    setOpen(decision)
    setError(null)
    // Pre-fill with what was ASKED for. That is the only figure on record;
    // anything else would be Loamy suggesting a number to a lender.
    setAmount(DECISION_META[decision].requiresAmount ? String(requested) : '')
    setNote('')
  }

  function cancel() {
    setOpen(null)
    setError(null)
  }

  const meta = open ? DECISION_META[open] : null
  const amountCheck = meta?.requiresAmount ? checkApprovalAmount(amount, requested) : null
  const tenorCheck = checkTenorDays(tenor)
  const noteOk = !meta?.requiresNote || note.trim().length > 0
  const canSubmit =
    Boolean(meta) && noteOk && tenorCheck.ok && (!amountCheck || amountCheck.ok)

  async function submit() {
    if (!open || !meta) return
    setError(null)

    if (meta.requiresNote && !note.trim()) {
      setError(
        open === 'rejected'
          ? t('bank.decision.giveReason')
          : t('bank.decision.writeWhatYouNeed'),
      )
      return
    }
    if (amountCheck && !amountCheck.ok) {
      setError(checkText(amountCheck))
      return
    }
    if (!tenorCheck.ok) {
      setError(tenorCheck.messageKey
        ? tOr(tenorCheck.messageKey, tenorCheck.message ?? '')
        : tenorCheck.message ?? t('bank.decision.checkTenor'))
      return
    }

    setBusy(true)
    const result = await recordFinancingDecision({
      applicationId: app.id,
      decision: open,
      approvedAmount: amountCheck?.ok ? amountCheck.value : null,
      note,
      conditions,
      tenorDays: tenorCheck.value,
      pricingNote: pricing,
      bankReference: bankRef,
    })
    setBusy(false)

    if (!result.ok) {
      // Shown as the server worded it. Nothing here claims the decision was
      // recorded, and everything typed stays put.
      setError(result.error)
      return
    }

    setOpen(null)
    setNote('')
    setConditions('')
    setTenor('')
    setPricing('')
    setBankRef('')
    await onDecided()
  }

  return (
    <DashboardCard title={t('bank.decision.title')}>
      {/* Rule 2: said before the decision, not after. */}
      {bank.is_sandbox ? (
        <p
          className="mb-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900"
          data-testid="sandbox-warning"
        >
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {tOr('bank.decision.sandboxWarning', SANDBOX_DECISION_WARNING)}
        </p>
      ) : (
        <p className="mb-3 text-[12px] leading-snug text-emerald-900/60">{tOr('bank.decision.liveNote', LIVE_DECISION_NOTE)}</p>
      )}

      {offered.length === 0 ? (
        <p className="text-sm text-emerald-900/60">
          {t('bank.decision.noneOpen', { status: statusLabel(app.status) })}
        </p>
      ) : open === null ? (
        <div className="flex flex-col gap-1.5">
          {offered.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={DECISION_META[d].tone === 'primary' ? 'primary'
                : DECISION_META[d].tone === 'danger' ? 'danger' : 'outline'}
              onClick={() => start(d)}
            >
              {decisionLabel(d)}
            </Button>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-[12px] leading-snug text-emerald-900/70">{decisionIntent(open)}</p>

          {meta!.requiresAmount && (
            <div>
              <Label htmlFor="decision-amount">{t('bank.decision.approvedAmount')}</Label>
              <Input
                id="decision-amount"
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(null) }}
                aria-invalid={Boolean(amountCheck && !amountCheck.ok)}
                aria-describedby="decision-amount-help"
                className="mt-1"
              />
              <p id="decision-amount-help" className="mt-1 text-[12px]">
                {amountCheck && !amountCheck.ok ? (
                  <span className="text-amber-700">{checkText(amountCheck)}</span>
                ) : (
                  <span className="text-emerald-900/55">
                    {t('bank.decision.requestedHint', { amount: formatNaira(requested) })}
                  </span>
                )}
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="decision-note">
              {meta!.requiresNote ? t('bank.decision.messageRequired') : t('bank.decision.noteOptional')}
            </Label>
            <Textarea
              id="decision-note"
              value={note}
              onChange={(e) => { setNote(e.target.value); setError(null) }}
              aria-invalid={Boolean(meta!.requiresNote && !noteOk)}
              className="mt-1"
              placeholder={
                open === 'rejected' ? t('bank.decision.whyDeclined')
                  : open === 'additional_information_required' ? t('bank.decision.whatNeeded')
                  : t('bank.decision.optional')
              }
            />
          </div>

          {meta!.requiresAmount && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor="decision-tenor">{t('bank.decision.tenorDays')}</Label>
                  <Input
                    id="decision-tenor" type="number" min={1} step={1}
                    value={tenor}
                    onChange={(e) => { setTenor(e.target.value); setError(null) }}
                    aria-invalid={!tenorCheck.ok}
                    className="mt-1"
                    placeholder={t('bank.decision.optionalPlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="decision-bankref">{t('bank.decision.yourReference')}</Label>
                  <Input
                    id="decision-bankref"
                    value={bankRef}
                    onChange={(e) => setBankRef(e.target.value)}
                    className="mt-1"
                    placeholder={t('bank.decision.optionalPlaceholder')}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="decision-pricing">{t('bank.decision.pricing')}</Label>
                <Input
                  id="decision-pricing"
                  value={pricing}
                  onChange={(e) => setPricing(e.target.value)}
                  className="mt-1"
                  placeholder={t('bank.decision.pricingPlaceholder')}
                />
                {/* Loamy does not model interest and does not validate a rate:
                    inventing a pricing policy is precisely what it must not do. */}
                <p className="mt-1 text-[11px] text-emerald-900/50">
                  {t('bank.decision.pricingNote')}
                </p>
              </div>
              <div>
                <Label htmlFor="decision-conditions">{t('bank.decision.conditions')}</Label>
                <Textarea
                  id="decision-conditions"
                  value={conditions}
                  onChange={(e) => setConditions(e.target.value)}
                  className="mt-1"
                  placeholder={t('bank.decision.conditionsPlaceholder')}
                />
              </div>
            </>
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

          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={!canSubmit} onClick={submit}>
              {t('bank.decision.recordAction', { action: decisionLabelLower(open) })}
            </Button>
            <Button size="sm" variant="outline" onClick={cancel} disabled={busy}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </DashboardCard>
  )
}
