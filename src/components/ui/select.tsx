import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          // h-10 is 37.5px at a 15px root; min-h-touch lifts the tap area to 44.
          'flex h-10 min-h-touch w-full appearance-none rounded-control border border-clay bg-white px-3 py-2 pr-9 text-sm text-emerald-950 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bone focus-visible:border-emerald-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-900/40"
        aria-hidden
      />
    </div>
  ),
)
Select.displayName = 'Select'
