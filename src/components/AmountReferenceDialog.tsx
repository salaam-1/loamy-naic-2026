import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Reusable in-app dialog for recording a money amount (+ optional bank
 * reference) — the app-quality replacement for window.prompt in the settlement
 * and repayment flows. Validates the amount, and SURFACES the submit error
 * instead of swallowing it. `onSubmit` should throw on failure.
 */
export function AmountReferenceDialog({
  open,
  onClose,
  title,
  amountLabel,
  defaultAmount,
  hint,
  submitLabel = 'Record',
  allowZero = false,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  amountLabel: string
  defaultAmount?: number | string
  hint?: string
  submitLabel?: string
  allowZero?: boolean
  onSubmit: (amount: number, reference: string | null) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setAmount(defaultAmount != null ? String(defaultAmount) : '')
      setReference('')
      setError(null)
      setBusy(false)
    }
  }, [open, defaultAmount])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const n = Number(amount)
    if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) {
      setError('Enter a valid amount.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(n, reference.trim() || null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this. Please try again.')
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="ard-amount">{amountLabel}</Label>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-emerald-900/45">₦</span>
            <Input
              id="ard-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="pl-6"
              autoFocus
            />
          </div>
          {hint && <p className="mt-1 text-[11px] text-emerald-900/50">{hint}</p>}
        </div>
        <div>
          <Label htmlFor="ard-ref">Bank reference (optional)</Label>
          <Input
            id="ard-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="mt-1"
            placeholder="e.g. transfer / PSP reference"
          />
        </div>
        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" loading={busy}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  )
}
