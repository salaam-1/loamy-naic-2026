import { useState } from 'react'
import { Package, Sprout } from 'lucide-react'
import { listingPhotoUrl } from '@/lib/marketplace'
import { cn } from '@/lib/utils'

/**
 * Listing photo with a clean flat placeholder — never renders an <img> with an
 * empty/undefined src, and falls back to the placeholder if a real photo fails
 * to load (onError). Placeholder is a muted emerald panel + a monochrome icon.
 */
export function ListingImage({
  path,
  listingType,
  alt,
  className,
}: {
  /** Storage path in the public listing-photos bucket (or undefined). */
  path?: string | null
  listingType?: 'commodity' | 'input'
  alt?: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const Icon = listingType === 'input' ? Package : Sprout
  const showImg = !!path && !failed

  return (
    <div className={cn('flex items-center justify-center overflow-hidden bg-emerald-50', className)}>
      {showImg ? (
        <img
          src={listingPhotoUrl(path)}
          alt={alt ?? ''}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="h-8 w-8 text-emerald-700/30" strokeWidth={1.5} aria-hidden />
      )}
    </div>
  )
}
