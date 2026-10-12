import { cn } from '@/lib/utils'

/**
 * Loading placeholders.
 *
 * The rule these follow: a skeleton must occupy the SAME space as the content
 * it stands in for. A placeholder of the wrong height is worse than a
 * spinner, because the page jumps when the data lands and whatever the person
 * was about to tap moves out from under their finger.
 *
 * `aria-hidden` throughout, with one live label on the container — a screen
 * reader should hear "loading listings", not fourteen empty boxes.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-control', className)} aria-hidden />
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  )
}

/** Matches the marketplace commodity card: image block, title, meta, price. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-card border border-clay bg-white', className)} aria-hidden>
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-5 w-1/3" />
      </div>
    </div>
  )
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 py-3', className)} aria-hidden>
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-6 w-16" />
    </div>
  )
}

/**
 * Wrap a skeleton group so assistive technology hears one message.
 * `label` should name the content, not the act: "Loading listings".
 */
export function LoadingRegion({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div role="status" aria-live="polite" aria-busy className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
