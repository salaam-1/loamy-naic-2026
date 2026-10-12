import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * The Loamy surface.
 *
 * WHY `variant` EXISTS (§57)
 *   Every card being the same solid rectangle is what makes an interface read
 *   as a dashboard. The variants here are not decoration — each one says
 *   something different about the content:
 *
 *     elevated  the default. A lit panel: near-white gradient, hairline
 *               border, one step of elevation. Use it unless there is a
 *               reason not to.
 *     plain     Level 1. Translucent, so the page environment and its grain
 *               show through. For grouping that should not compete with the
 *               content inside it.
 *     inset     recedes instead of rising. Summary strips, sub-rows, the
 *               thing that belongs to the surface behind it.
 *     floating  Level 3. Translucent with backdrop blur, for surfaces that
 *               sit over scrolling content.
 *     image     a photographic anchor with a scrim. The caller supplies the
 *               picture; this supplies the overlay and the clipping.
 *
 *   `inset` is deliberately not a colour prop. A caller that can pass
 *   `bg-emerald-50` will, and then two screens disagree about what an inset
 *   row looks like.
 *
 * `interactive` is separate from variant so that every clickable card in the
 * product lifts by the same amount, and so a non-clickable card cannot
 * acquire a hover state — a small lie that makes people click things that do
 * nothing.
 */
export type CardVariant = 'elevated' | 'plain' | 'inset' | 'floating' | 'image'

const VARIANT_CLASS: Record<CardVariant, string> = {
  elevated: 'surface-2',
  plain: 'surface-1',
  inset: 'surface-inset',
  floating: 'surface-3',
  image: 'image-surface border border-clay',
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  interactive?: boolean
  /** @deprecated Use `variant="inset"`. Kept so existing call sites compile. */
  inset?: boolean
}

export function Card({ className, variant, interactive, inset, ...props }: CardProps) {
  const resolved: CardVariant = variant ?? (inset ? 'inset' : 'elevated')
  return (
    <div
      className={cn(
        VARIANT_CLASS[resolved],
        interactive &&
          'cursor-pointer transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md focus-within:-translate-y-0.5 focus-within:shadow-md',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-5 pb-3', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[15px] font-semibold tracking-tight text-emerald-950', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}
