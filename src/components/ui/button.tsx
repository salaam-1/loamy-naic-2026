import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Sizes are set by TAP TARGET first and density second. The old scale topped
 * out at 36px, below the 44px that a thumb on a phone reliably hits, so `md`
 * and `lg` grew. `sm` stays compact for dense admin tables, where a mouse is
 * doing the pointing.
 *
 * VARIANTS ARE A HIERARCHY, NOT A PALETTE (§57)
 *   primary    branded fill with a 6% vertical gradient, so it reads as a lit
 *              surface rather than a printed green rectangle. One per view.
 *   gold       the same treatment for the moment that matters most, used
 *              sparingly enough that it still means something.
 *   secondary  translucent over whatever it sits on, with a border. This is
 *              the one most actions should use; it integrates with the
 *              environment instead of punching a hole in it.
 *   outline    opaque white, for use over photography and coloured surfaces
 *              where translucency would leave the label unreadable.
 *   ghost      text and icon only.
 *   danger     reserved. If everything destructive is red, nothing is.
 */
/**
 * Exported so a non-<button> element -- a react-router <Link>, typically --
 * can wear the canonical sizing and variant classes instead of a copy of them.
 * Before this, hero secondary CTAs were hand-written `h-9 ... rounded` links
 * sitting beside an `h-11` Button, which is why they did not line up.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-sm font-medium transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bone disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-brand-fill text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-brand-fill-hover hover:shadow-md active:shadow-sm',
        gold:
          'bg-gold-fill text-emerald-950 shadow-sm ring-1 ring-inset ring-white/25 hover:brightness-[1.04] hover:shadow-md active:brightness-95 active:shadow-sm',
        secondary:
          'border border-clay/80 bg-white/60 text-emerald-900 backdrop-blur-[2px] hover:border-clay hover:bg-white/85 active:bg-sand',
        outline: 'border border-clay bg-white text-emerald-900 hover:bg-sand active:bg-clay/60',
        ghost: 'text-emerald-900 hover:bg-sand/80 active:bg-clay/60',
        'ghost-inverse': 'text-emerald-100 hover:bg-white/10 active:bg-white/20',
        // Over photography. `outline` is opaque white, which punches a hole in
        // a hero image; this keeps the picture visible behind the control and
        // inverts on hover. Added so hero CTAs can use the CANONICAL sizes
        // instead of hand-rolling a one-off height.
        'outline-inverse':
          'border border-white/80 bg-transparent text-white hover:bg-white hover:text-emerald-800 active:bg-white/90 focus-visible:ring-white focus-visible:ring-offset-transparent',
        danger:
          'bg-rose-600 text-white shadow-sm ring-1 ring-inset ring-white/15 hover:bg-rose-500 hover:shadow-md active:bg-rose-700',
      },
      size: {
        // THE ROOT FONT IS 15px, SO REM HEIGHTS DO NOT MEAN WHAT THEY SAY.
        //   h-8  = 2rem    = 30px
        //   h-10 = 2.5rem  = 37.5px
        //   h-11 = 2.75rem = 41.25px
        // Every one of those is under the 44px touch target, which is how the
        // language selector shipped at 41px with a class that looked correct.
        // `min-h-touch` is an absolute 44px (tailwind.config.ts) and cannot
        // drift with the root font. It is a MINIMUM, so it raises the short
        // ones and leaves anything already taller alone.
        //
        // `sm` deliberately stays at 32px: it is the dense variant for table
        // rows and inline chips, where a 44px control would break the row it
        // sits in. It is reported by scripts/verify-touch-targets.mjs rather
        // than silently exempted.
        sm: 'h-8 min-h-[32px] px-3 text-xs',
        md: 'h-10 min-h-touch px-4',
        lg: 'h-11 min-h-touch px-5 text-[15px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'
