import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * A password field you can check before submitting.
 *
 * Composed from the existing `Input` rather than being a second input
 * component — same height, same border, same focus ring, so nothing about the
 * form's rhythm changes.
 *
 * WHY IT EXISTS
 *   Typing a password blind on a phone keyboard is the most common reason a
 *   sign-in fails for a reason that has nothing to do with the account. Loamy's
 *   members are frequently on small screens in bright sunlight.
 *
 * ACCESSIBILITY
 *   The toggle is a real button with an accessible name that states what it
 *   will do next, and `aria-pressed` reports the current state. It is 40px, so
 *   it is a comfortable target, and `tabIndex={-1}` keeps it out of the tab
 *   order between the field and the submit button — reached deliberately, not
 *   by accident, which is the behaviour people expect from a reveal control.
 */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false)

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-11', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          tabIndex={-1}
          className="absolute right-0 top-0 flex h-10 w-10 min-h-touch min-w-touch items-center justify-center rounded-control text-emerald-900/45 transition-colors hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          {visible
            ? <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            : <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        </button>
      </div>
    )
  },
)
PasswordInput.displayName = 'PasswordInput'
