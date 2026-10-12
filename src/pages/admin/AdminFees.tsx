import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, Info, Plus, Power, Receipt, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { FEE_LABEL, type FeePayer, type FeeScope } from '@/lib/fees'
import { endFeeRule, restoreFeeRule } from '@/lib/feeAdmin'
import { FeeRuleDialog, type FeeRuleSummary } from '@/pages/admin/FeeRuleDialog'
import { Price } from '@/components/Money'
import { DashboardCard } from '@/components/DashboardCard'
import { Badge, StatusPill } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { SkeletonRow } from '@/components/ui/skeleton'
import { cn, formatDateShort } from '@/lib/utils'

/**
 * Fee schedules — the authoritative fee configuration.
 *
 * WHY THIS SCREEN EXISTS
 *   The fee system was entirely backend. `fee_schedules` had no UI at all,
 *   while AdminConfig offered a "Marketplace platform fee" field that writes
 *   `platform_config.platform_fee_bps` — a value migration 20260919280001
 *   reduced to a labelled FALLBACK, used only when a transaction has no fee
 *   snapshot. So the one fee control an administrator had did not set the fee
 *   that gets charged. Two competing systems, and the visible one was the
 *   wrong one.
 *
 * WHAT A RULE ACTUALLY NEEDS
 *   A percentage is not a fee. `loamy_resolve_fee` picks the MOST SPECIFIC
 *   active rule for a scope, so a rule has to say what it is calculated
 *   against (basis + value), who pays it, when it applies (effective window),
 *   and optionally which transaction type, role or commodity group narrows
 *   it. All of that is editable here because all of it changes the money.
 *
 * IMMUTABILITY
 *   Editing a rule cannot change history: `loamy_snapshot_transaction_fee`
 *   freezes the resolved rule onto the transaction when it reaches
 *   `accepted`, and settlement reads the snapshot. This screen therefore
 *   ENDS a rule rather than editing its rate — superseding leaves the audit
 *   trail intact, and an edited rate would silently rewrite what future
 *   resolutions produce with no record of what changed.
 */

interface FeeSchedule {
  id: string
  ref: string | null
  scope: FeeScope
  transaction_type: string | null
  user_role: string | null
  commodity_group: string | null
  basis: 'bps' | 'flat'
  value: number
  payer: FeePayer
  min_fee: number | null
  max_fee: number | null
  active: boolean
  effective_from: string
  effective_to: string | null
  note: string | null
  created_at: string
}

const SCOPES: FeeScope[] = [
  'marketplace_transaction', 'financing_facilitation', 'logistics',
  'warehouse', 'verification', 'verification_commission', 'withdrawal',
]

const PAYERS: FeePayer[] = ['buyer', 'seller', 'split', 'platform']

/** Where the money lands. Stated because §5 asks, and because it is not obvious. */
const REVENUE_NOTE: Record<FeeScope, string> = {
  marketplace_transaction: 'Deducted at escrow release and posted to platform revenue in the double-entry ledger.',
  financing_facilitation: 'Charged against the financing facilitation, not the loan principal.',
  logistics: 'Charged on the transport engagement the member accepted.',
  warehouse: 'Charged on the storage engagement the member accepted.',
  verification: 'Charged to whoever requested the inspection.',
  verification_commission: 'Paid OUT to the Growth Partner who did the field work, as a partner earning. This is a cost, not revenue.',
  withdrawal: 'Applied when a payout leaves the platform.',
}

const BLANK = {
  scope: 'marketplace_transaction' as FeeScope,
  basis: 'bps' as 'bps' | 'flat',
  value: '',
  payer: 'buyer' as FeePayer,
  min_fee: '',
  max_fee: '',
  transaction_type: '',
  effective_from: new Date().toISOString().slice(0, 10),
  note: '',
}

export default function AdminFees() {
  const [rows, setRows] = useState<FeeSchedule[] | null>(null)
  const [form, setForm] = useState(BLANK)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('fee_schedules')
      .select('id, ref, scope, transaction_type, user_role, commodity_group, basis, value, payer, min_fee, max_fee, active, effective_from, effective_to, note, created_at')
      .order('scope', { ascending: true })
      .order('effective_from', { ascending: false })
      .range(0, 199)
    if (err) setError(err.message)
    setRows((data as FeeSchedule[]) ?? [])
  }, [])

  useEffect(() => { void load() }, [load])

  async function create(e: FormEvent) {
    e.preventDefault()
    setError(null); setNotice(null)
    const value = Number(form.value)
    if (!Number.isFinite(value) || value < 0) return setError('Rate must be zero or more.')
    const min = form.min_fee === '' ? null : Number(form.min_fee)
    const max = form.max_fee === '' ? null : Number(form.max_fee)
    if (max !== null && min !== null && max < min) {
      return setError('Maximum fee cannot be lower than the minimum.')
    }
    // Caught here because the live schedule already contains one: a flat rule
    // of ₦7,500 capped at ₦5,000, which can only ever charge ₦5,000. The cap
    // silently made the rate meaningless.
    if (max !== null && form.basis === 'flat' && value > max) {
      return setError(`A flat fee of ${value} capped at ${max} can only ever charge ${max}. Set the cap above the rate, or remove it.`)
    }

    setBusy('create')
    const { error: err } = await supabase.from('fee_schedules').insert({
      scope: form.scope,
      basis: form.basis,
      value,
      payer: form.payer,
      min_fee: min,
      max_fee: max,
      transaction_type: form.transaction_type.trim() || null,
      effective_from: new Date(form.effective_from).toISOString(),
      note: form.note.trim() || null,
      active: true,
    })
    setBusy(null)
    if (err) return setError(err.message)
    setForm(BLANK); setCreating(false)
    setNotice('Rule created. It applies to transactions accepted from now on; nothing already accepted changes.')
    await load()
  }

  /**
   * Ending and reinstating a rule.
   *
   * WHAT CHANGED, AND WHY
   *   This used to be a single onClick that ran
   *   `supabase.from('fee_schedules').update({active:false, effective_to:now})`
   *   straight against production. On 2026-09-21 a misclick ended the ₦2,500
   *   Growth Partner commission for farm verification that way: instantly,
   *   silently, with no reason recorded and no audit row. Every approved farm
   *   verification afterwards accrued nothing.
   *
   *   The table no longer accepts UPDATE or DELETE from any client. Both
   *   actions now go through security-definer RPCs that require a written
   *   reason and write an audit row, and neither can be reached without
   *   confirming in a dialog that names the rule, the rate and — for a rule
   *   Loamy pays out — who stops being paid.
   *
   *   Ending is deliberately not a delete and not a rate edit: a fee rule is
   *   a historical fact about a period, and settlement reconciliation has to
   *   be able to find the rule that was in force.
   */
  const [pending, setPending] = useState<{ rule: FeeRuleSummary; mode: 'end' | 'restore' } | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)

  function ask(row: FeeSchedule, mode: 'end' | 'restore') {
    setError(null); setNotice(null); setDialogError(null)
    setPending({
      rule: {
        id: row.id, ref: row.ref, scope: row.scope,
        transaction_type: row.transaction_type,
        basis: row.basis, value: row.value, payer: row.payer,
        effective_from: row.effective_from, effective_to: row.effective_to,
        active: row.active,
      },
      mode,
    })
  }

  async function confirm(reason: string) {
    if (!pending) return
    setDialogError(null)
    setBusy(pending.rule.id)

    if (pending.mode === 'end') {
      const result = await endFeeRule(pending.rule.id, reason)
      setBusy(null)
      if (!result.ok) { setDialogError(result.error); return }
      setPending(null)
      setNotice(result.ended
        ? `${result.ref ?? 'Rule'} ended. Anything already accepted keeps the fee it was quoted, and you can reinstate this rule at the same terms.`
        : `${result.ref ?? 'That rule'} was already ended. Nothing changed.`)
    } else {
      const result = await restoreFeeRule(pending.rule.id, reason)
      setBusy(null)
      if (!result.ok) { setDialogError(result.error); return }
      setPending(null)
      setNotice(result.restored
        ? `${result.restoredFrom ?? 'Rule'} reinstated as ${result.newRef} at the same terms, effective now.`
        : result.reason === 'still_in_force'
          ? `${result.ref ?? 'That rule'} is already in force. Nothing changed.`
          : `An equivalent rule (${result.ref}) is already in force, so nothing was created.`)
    }
    await load()
  }

  function rate(r: FeeSchedule): string {
    if (r.basis === 'bps') return `${Number((r.value / 100).toFixed(2))}%`
    return `₦${r.value.toLocaleString('en-NG')} flat`
  }

  /** Configuration that cannot do what it says. Surfaced, not silently fixed. */
  function misconfigured(r: FeeSchedule): string | null {
    if (r.max_fee !== null && r.basis === 'flat' && r.value > r.max_fee) {
      return `Flat rate ₦${r.value.toLocaleString('en-NG')} is capped at ₦${r.max_fee.toLocaleString('en-NG')}, so it can only ever charge ₦${r.max_fee.toLocaleString('en-NG')}.`
    }
    if (r.min_fee !== null && r.max_fee !== null && r.min_fee > r.max_fee) {
      return 'Minimum fee is above the maximum, so this rule cannot resolve sensibly.'
    }
    return null
  }

  const byScope = (s: FeeScope) => (rows ?? []).filter((r) => r.scope === s)

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {pending && (
        <FeeRuleDialog
          rule={pending.rule}
          mode={pending.mode}
          busy={busy === pending.rule.id}
          error={dialogError}
          onConfirm={confirm}
          onCancel={() => { setPending(null); setDialogError(null) }}
        />
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-display-sm text-emerald-950">
            <Receipt className="h-5 w-5 text-emerald-700" strokeWidth={1.5} aria-hidden />
            Fee schedules
          </h1>
          <p className="mt-0.5 text-sm text-emerald-900/60">
            The authoritative source for every fee Loamy charges.
          </p>
        </div>
        <Button onClick={() => { setCreating((v) => !v); setError(null) }}>
          <Plus className="h-4 w-4" aria-hidden /> New rule
        </Button>
      </div>

      <Card variant="plain" className="flex items-start gap-2.5 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
        <p className="text-[13px] leading-relaxed text-emerald-900/70">
          <span className="font-medium text-emerald-950">How a fee becomes money.</span>{' '}
          These rules are read by <code className="font-mono text-[12px]">loamy_resolve_fee</code>, which
          picks the most specific active rule for a scope. Checkout shows the buyer that estimate. When a
          seller accepts, the rule is frozen onto the transaction as a snapshot, and settlement charges the
          snapshot - so changing a rule here never alters a deal that has already been accepted.
        </p>
      </Card>

      {notice && <p className="rounded-card bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{notice}</p>}
      {error && <p className="rounded-card bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}

      {creating && (
        <DashboardCard title="New fee rule">
          <form onSubmit={create} className="space-y-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="f_scope">Applies to *</Label>
                <Select id="f_scope" value={form.scope} onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value as FeeScope }))}>
                  {SCOPES.map((s) => <option key={s} value={s}>{FEE_LABEL[s]}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="f_basis">Calculated as *</Label>
                <Select id="f_basis" value={form.basis} onChange={(e) => setForm((p) => ({ ...p, basis: e.target.value as 'bps' | 'flat' }))}>
                  <option value="bps">Percentage of the amount</option>
                  <option value="flat">Fixed naira amount</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="f_value">
                  {form.basis === 'bps' ? 'Rate (basis points · 100 = 1%)' : 'Amount (₦)'} *
                </Label>
                <Input id="f_value" type="number" min={0} step="any" value={form.value} onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} />
                {form.basis === 'bps' && form.value !== '' && Number.isFinite(Number(form.value)) && (
                  <p className="mt-1 text-[11px] text-emerald-900/50">
                    = {Number((Number(form.value) / 100).toFixed(2))}% of the amount
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="f_payer">Paid by *</Label>
                <Select id="f_payer" value={form.payer} onChange={(e) => setForm((p) => ({ ...p, payer: e.target.value as FeePayer }))}>
                  {PAYERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
                {form.payer === 'split' && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    The schedule carries no split ratio, so checkout currently charges the whole amount to
                    the buyer.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="f_min">Minimum fee (₦, optional)</Label>
                <Input id="f_min" type="number" min={0} step="any" value={form.min_fee} onChange={(e) => setForm((p) => ({ ...p, min_fee: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="f_max">Maximum fee (₦, optional)</Label>
                <Input id="f_max" type="number" min={0} step="any" value={form.max_fee} onChange={(e) => setForm((p) => ({ ...p, max_fee: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="f_txn">Only for transaction type (optional)</Label>
                <Input id="f_txn" value={form.transaction_type} onChange={(e) => setForm((p) => ({ ...p, transaction_type: e.target.value }))} placeholder="e.g. marketplace" />
              </div>
              <div>
                <Label htmlFor="f_from">Effective from *</Label>
                <Input id="f_from" type="date" value={form.effective_from} onChange={(e) => setForm((p) => ({ ...p, effective_from: e.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="f_note">Note</Label>
                <Input id="f_note" value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} placeholder="Why this rule exists" />
              </div>
            </div>
            <p className="rounded-lg border-l-2 border-emerald-700 bg-sand/60 px-3 py-2 text-[12px] leading-relaxed text-emerald-900/75">
              {REVENUE_NOTE[form.scope]}
            </p>
            <div className="flex gap-2">
              <Button type="submit" loading={busy === 'create'}>Create rule</Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </form>
        </DashboardCard>
      )}

      {rows === null ? (
        <DashboardCard title="Current rules">
          {[0, 1, 2].map((i) => <SkeletonRow key={i} />)}
        </DashboardCard>
      ) : (
        SCOPES.map((scope) => {
          const list = byScope(scope)
          const live = list.filter((r) => r.active && (!r.effective_to || new Date(r.effective_to) > new Date()))
          return (
            <DashboardCard key={scope} title={FEE_LABEL[scope]}>
              {list.length === 0 ? (
                <p className="py-2 text-[13px] text-emerald-900/55">
                  No rule configured, so no {FEE_LABEL[scope].toLowerCase()} is charged.
                </p>
              ) : (
                <ul className="divide-y divide-clay">
                  {list.map((r) => {
                    const problem = misconfigured(r)
                    const isLive = live.some((l) => l.id === r.id)
                    return (
                      <li key={r.id} className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold tabular text-emerald-950">{rate(r)}</span>
                          <Badge tone="neutral">paid by {r.payer}</Badge>
                          {isLive
                            ? <StatusPill label="In force" tone="verified" />
                            : <StatusPill label={r.active ? 'Scheduled' : 'Ended'} tone="neutral" />}
                          {r.ref && <span className="text-[11px] text-emerald-900/40">{r.ref}</span>}
                          {isLive ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="ml-auto"
                              loading={busy === r.id}
                              onClick={() => ask(r, 'end')}
                            >
                              <Power className="h-3.5 w-3.5" aria-hidden /> End rule
                            </Button>
                          ) : !r.active ? (
                            /* The way back. An ended rule is not a dead row:
                               it can be reinstated at the same terms, which
                               is what makes an accidental end recoverable. */
                            <Button
                              size="sm"
                              variant="outline"
                              className="ml-auto"
                              loading={busy === r.id}
                              onClick={() => ask(r, 'restore')}
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reinstate
                            </Button>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[12px] text-emerald-900/55">
                          From {formatDateShort(r.effective_from)}
                          {r.effective_to ? ` to ${formatDateShort(r.effective_to)}` : ''}
                          {r.transaction_type ? ` · only ${r.transaction_type}` : ''}
                          {r.min_fee !== null ? ` · min ₦${r.min_fee.toLocaleString('en-NG')}` : ''}
                          {r.max_fee !== null ? ` · max ₦${r.max_fee.toLocaleString('en-NG')}` : ''}
                        </p>
                        {r.note && <p className="mt-0.5 text-[12px] italic text-emerald-900/45">{r.note}</p>}
                        {problem && (
                          <p className={cn(
                            'mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900',
                          )}>
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            {problem}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {live.length > 1 && (
                <p className="mt-2 text-[11px] text-amber-700">
                  {live.length} rules are in force for this scope. The most specific one wins; if they are
                  equally specific, the most recent effective date does.
                </p>
              )}
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-emerald-900/45">
                <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                {REVENUE_NOTE[scope]}
              </p>
            </DashboardCard>
          )
        })
      )}
    </div>
  )
}
