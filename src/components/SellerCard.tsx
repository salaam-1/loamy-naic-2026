import { BadgeCheck, CircleDashed } from 'lucide-react'
import type { PublicProfile } from '@/lib/marketplace'
import { initials } from '@/lib/utils'

/**
 * The ONLY seller identity surface on marketplace cards: display name,
 * category, state, verification badge. Never phone/email — contact flows
 * through the interest→accept exchange.
 */
export function SellerCard({ profile, compact }: { profile?: PublicProfile; compact?: boolean }) {
  if (!profile) return <span className="text-xs text-emerald-900/40">Seller unavailable</span>
  return (
    <div className="flex items-center gap-2.5">
      {profile.avatar_url ? (
        <img src={profile.avatar_url} alt="" className={compact ? 'h-6 w-6 rounded-full object-cover' : 'h-9 w-9 rounded-full object-cover'} />
      ) : (
        <span
          className={
            compact
              ? 'flex h-6 w-6 items-center justify-center rounded-full bg-emerald-800 text-[10px] font-bold text-white'
              : 'flex h-9 w-9 items-center justify-center rounded-full bg-emerald-800 text-xs font-bold text-white'
          }
        >
          {initials(profile.full_name)}
        </span>
      )}
      <div className="min-w-0">
        <p className={compact ? 'flex items-center gap-1 truncate text-xs font-medium text-emerald-950' : 'flex items-center gap-1.5 truncate text-sm font-semibold text-emerald-950'}>
          {profile.full_name ?? 'Loamy member'}
          {profile.verified_badge ? (
            <BadgeCheck className={compact ? 'h-3.5 w-3.5 shrink-0 text-emerald-600' : 'h-4 w-4 shrink-0 text-emerald-600'} aria-label="Verified" />
          ) : (
            <CircleDashed className={compact ? 'h-3 w-3 shrink-0 text-emerald-900/25' : 'h-3.5 w-3.5 shrink-0 text-emerald-900/25'} aria-label="Not yet verified" />
          )}
        </p>
        {!compact && (
          <p className="truncate text-xs text-emerald-900/50">
            {[profile.category, profile.state].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  )
}
