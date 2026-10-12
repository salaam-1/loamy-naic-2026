import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface LogoProps {
  /** 'dark' = for LIGHT surfaces (emerald wordmark); 'light' = for DARK/emerald
   * surfaces (white wordmark). Default 'dark' since most surfaces are light. */
  tone?: 'light' | 'dark'
  withTagline?: boolean
  /**
   * Extra classes for the tagline line.
   *
   * The tagline is ~190px of 10px type, which makes the whole lockup about
   * 235px wide. In a header that is fine from `sm` up and impossible at 390px,
   * where it leaves too little room for the account controls beside it. The
   * caller decides, so every other surface keeps the tagline at every width.
   */
  taglineClassName?: string
  className?: string
}

export function Logo({ tone = 'dark', withTagline = false, taglineClassName, className }: LogoProps) {
  const { t } = useT()
  const onDark = tone === 'light'
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Brand sprout mark. The mark is full-colour (green + gold), so on dark/
          emerald surfaces it sits on a white tile to stay legible; on light
          surfaces it renders bare. */}
      {onDark ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white p-1">
          <img src="/images/logo-mark.png" alt="" className="h-full w-full object-contain" />
        </span>
      ) : (
        <img src="/images/logo-mark.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
      )}
      <span className="leading-tight">
        <span
          className={cn(
            'block text-lg font-bold -tracking-[0.01em]',
            onDark ? 'text-white' : 'text-emerald-800',
          )}
        >
          Loamy
        </span>
        {withTagline && (
          <span
            className={cn(
              'block text-[10px] font-medium tracking-wide',
              onDark ? 'text-emerald-100/70' : 'text-emerald-900/55',
              taglineClassName,
            )}
          >
            {t('auth.tagline')}
          </span>
        )}
      </span>
    </div>
  )
}
