import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * In-app dialog for confirming an action with an optional (or required) note —
 * the app-quality replacement for window.prompt on note-capture flows (payout
 * note, decline reason, resolution note). `onSubmit` should throw on failure so
 * the error surfaces here.
 */
export function NoteDialog({
  open,
  onClose,
  title,
  label,
  placeholder,
  submitLabel = 'Confirm',
  required = false,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  label: string
  placeholder?: string
  submitLabel?: string
  required?: boolean
  onSubmit: (note: string | null) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setNote(''); setError(null); setBusy(false) }
  }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (required && !note.trim()) { setError('This note is required.'); return }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(note.trim() || null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete this. Please try again.')
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="note-dialog-field">{label}</Label>
          <Textarea
            id="note-dialog-field"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={placeholder}
            className="mt-1"
            autoFocus
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
