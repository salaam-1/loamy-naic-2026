import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * Seller verification indicator. Shows the emerald "Verified" badge ONLY for a
 * truly verified seller; an unverified seller gets a muted plain label, never a
 * badge (C2: never show a badge for an unverified seller).
 */
export function VerifiedTag({ verified, className }: { verified: boolean; className?: string }) {
  const { t } = useT()
  if (verified) {
    return (
      <span className={cn('inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200', className)}>
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> {t('verification.verified')}
      </span>
    )
  }
  return <span className={cn('text-[11px] text-emerald-900/40', className)}>{t('verification.unverified')}</span>
}
