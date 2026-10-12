import { BadgeCheck, CircleDashed, Clock3, XCircle } from 'lucide-react'
import { VERIFICATION_META, type VerificationStatus } from '@/lib/farming'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

const ICONS: Record<VerificationStatus, typeof BadgeCheck> = {
  unverified: CircleDashed,
  pending: Clock3,
  verified: BadgeCheck,
  rejected: XCircle,
}

/** Trust-layer badge: shows a farm's honest verification state, never faked. */
export function VerificationBadge({
  status,
  className,
}: {
  status: VerificationStatus
  className?: string
}) {
  const { tOr } = useT()
  const meta = VERIFICATION_META[status]
  const Icon = ICONS[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium',
        meta.chip,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {tOr(`farm.status.${status}`, meta.label)}
    </span>
  )
}
