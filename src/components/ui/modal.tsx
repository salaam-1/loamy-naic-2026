import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Modal dialog — a bottom sheet on phones, a centred dialog from `sm` up.
 *
 * WHY THE TWO SHAPES
 *   A centred dialog on a phone puts its actions in the middle of the screen,
 *   out of thumb reach, and its top edge under the notch. A sheet rising from
 *   the bottom puts the primary action where the thumb already is. This is
 *   the same component, not a second mobile implementation, so the two can
 *   never drift.
 *
 * FOCUS
 *   Focus moves in on open and returns to whatever opened it on close — a
 *   keyboard user who dismisses a dialog should be back where they were, not
 *   at the top of the document. Tab is trapped, because this one IS modal:
 *   everything behind it is inert, so letting focus wander there would mean
 *   typing into fields nobody can see.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  /** Optional sub-heading, wired to aria-describedby. */
  description?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus the panel itself, not its first control: announcing the title
    // before the first field tells a screen-reader user what they are in.
    panelRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      restoreTo.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const width = size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-emerald-950/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? 'modal-description' : undefined}
        className={cn(
          'relative z-10 max-h-[90dvh] w-full overflow-y-auto border border-clay bg-white shadow-lg focus-visible:outline-none',
          'animate-slide-up rounded-t-card sm:animate-rise-in sm:rounded-card',
          width,
        )}
      >
        {/* Grab handle: a phone affordance, hidden once the sheet becomes a
            dialog, where it would read as decoration. */}
        <div className="flex justify-center pt-2 sm:hidden" aria-hidden>
          <span className="h-1 w-9 rounded-full bg-clay" />
        </div>

        <div className="flex items-start justify-between gap-3 border-b border-clay px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-emerald-950">{title}</h2>
            {description && (
              <p id="modal-description" className="mt-0.5 text-[13px] leading-snug text-emerald-900/60">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 min-h-touch min-w-touch shrink-0 items-center justify-center rounded-control text-emerald-900/50 transition-colors hover:bg-sand hover:text-emerald-900"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
