import { type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Badges and status pills.
 *
 * Deliberately NOT named LoamyBadge. The repository already names its
 * primitives plainly — Card, Button, EmptyState — and introducing a second,
 * prefixed convention beside them is exactly the fragmentation §45 warns
 * about. One naming scheme, extended.
 *
 * `tone` is semantic, never literal. Call sites say what a thing MEANS
 * (`verified`, `pending`, `blocked`) and the design system decides the
 * colour. A component that takes `color="green"` puts the meaning in the
 * caller, which is how two screens end up disagreeing about what green is.
 */
export type Tone =
  | 'neutral'
  | 'verified'
  | 'pending'
  | 'attention'
  | 'blocked'
  | 'info'
  | 'financing'
  | 'marketplace'
  | 'logistics'
  | 'warehouse'
  | 'intelligence'
  | 'premium'

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-sand text-emerald-900/70 ring-clay',
  verified: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  attention: 'bg-amber-50 text-amber-800 ring-amber-200',
  blocked: 'bg-rose-50 text-rose-700 ring-rose-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  // Domain tones. Financing and marketplace are distinct on purpose: a
  // buyer scanning a list needs to tell "money" from "goods" at a glance.
  financing: 'bg-violet-50 text-violet-800 ring-violet-200',
  marketplace: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  logistics: 'bg-sky-50 text-sky-800 ring-sky-200',
  warehouse: 'bg-stone-100 text-stone-700 ring-stone-300',
  intelligence: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  premium: 'bg-gold-50 text-gold-700 ring-gold-200',
}

export function Badge({
  children,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  children: ReactNode
  tone?: Tone
  icon?: LucideIcon
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        TONE_CLASS[tone],
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  )
}

/**
 * A status with a dot. The dot carries the tone so the label never has to be
 * colour alone — someone who cannot distinguish the hues still reads the
 * word, which is the whole point.
 */
const DOT_CLASS: Record<Tone, string> = {
  neutral: 'bg-emerald-900/30',
  verified: 'bg-emerald-600',
  pending: 'bg-amber-500',
  attention: 'bg-amber-500',
  blocked: 'bg-rose-500',
  info: 'bg-sky-500',
  financing: 'bg-violet-500',
  marketplace: 'bg-emerald-600',
  logistics: 'bg-sky-500',
  warehouse: 'bg-stone-500',
  intelligence: 'bg-indigo-500',
  premium: 'bg-gold-400',
}

export function StatusPill({
  label,
  tone = 'neutral',
  pulse,
  className,
}: {
  label: string
  tone?: Tone
  /** Only for states that are genuinely in motion right now. */
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset',
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASS[tone], pulse && 'animate-pulse')} aria-hidden />
      {label}
    </span>
  )
}
