import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ratingBars, ratingDisplay, type RatingSummary } from '@/lib/identity'

/** Five stars, filled to `value`. Presentational only. */
export function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'md' }) {
  const px = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(px, i <= Math.round(value) ? 'fill-gold-400 text-gold-400' : 'text-emerald-900/20')}
          strokeWidth={1.5}
          aria-hidden
        />
      ))}
    </span>
  )
}

/**
 * The compact rating for a card or a profile header.
 *
 * Renders no number below the server's threshold — see ratingDisplay. The
 * caption says how many more reviews are needed rather than going silent, so
 * a new seller does not look like a badly rated one.
 */
export function RatingInline({
  summary,
  className,
}: {
  summary: RatingSummary | null | undefined
  className?: string
}) {
  const d = ratingDisplay(summary)
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-emerald-900/70', className)}>
      {d.showStars && <Stars value={summary!.average!} />}
      {d.showStars && <span className="font-mono font-semibold text-emerald-950">{d.value}</span>}
      <span>{d.caption}</span>
    </span>
  )
}

/** The 5→1 breakdown, for a profile's reviews panel. */
export function RatingBreakdown({ summary }: { summary: RatingSummary | null | undefined }) {
  const bars = ratingBars(summary)
  const total = summary?.count ?? 0
  if (total === 0) return null

  return (
    <div className="space-y-1">
      {bars.map((b) => (
        <div key={b.star} className="flex items-center gap-2 text-xs">
          <span className="w-8 shrink-0 font-mono text-emerald-900/60">{b.star}★</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded bg-emerald-900/10">
            <span
              className="block h-full bg-emerald-700"
              style={{ width: `${b.percent}%` }}
              aria-hidden
            />
          </span>
          <span className="w-8 shrink-0 text-right font-mono text-emerald-900/60">{b.count}</span>
        </div>
      ))}
    </div>
  )
}
