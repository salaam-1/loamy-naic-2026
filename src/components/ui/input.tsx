import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        // h-10 is 37.5px at a 15px root; min-h-touch lifts the tap area to 44.
        'flex h-10 min-h-touch w-full rounded-control border border-clay bg-white px-3 py-2 text-sm text-emerald-950 transition-colors',
        'placeholder:text-emerald-900/35',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bone focus-visible:border-emerald-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
