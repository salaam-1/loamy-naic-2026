import { forwardRef, type LabelHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('block text-sm font-medium text-emerald-950 mb-1.5', className)}
      {...props}
    />
  ),
)
Label.displayName = 'Label'
