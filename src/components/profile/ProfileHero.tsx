import { type ReactNode } from 'react'
import { BadgeCheck, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { handle, memberSince } from '@/lib/identity'
import { cn, initials } from '@/lib/utils'

/**
 * The identity hero.
 *
 * WHAT IT IS NOT
 *   Not a social profile header. There is no cover photo, no follower count
 *   and no vanity metric. The facts on it are the ones a counterparty needs
 *   before trading with a stranger: who, where, what they trade, how much
 *   they have completed, and whether Loamy has verified any of it.
 *
 * THE AVATAR FALLBACK
 *   Initials on a tonal panel, never a generated face. §18: a fabricated
 *   photograph of a person who does not look like that is a lie about
 *   somebody's identity, and this is an identity product.
 *
 * NO EVALUATIVE CLAIMS
 *   §25: "verified", "completed transactions" and a rating are facts. "Top
 *   seller" and "trusted" are judgements Loamy's backend does not compute, so
 *   they do not appear. The distinction is the whole point of the page.
 */
export function ProfileHero({
  displayName,
  username,
  headline,
  verified,
  roles,
  state,
  memberSinceIso,
  stats,
  avatarUrl,
  actions,
}: {
  displayName: string
  username: string
  headline?: string | null
  verified?: boolean
  roles?: string[]
  state?: string | null
  memberSinceIso?: string | null
  /** Only facts that exist. A stat with no value is omitted, not zeroed. */
  stats?: { label: string; value: string }[]
  avatarUrl?: string | null
  actions?: ReactNode
}) {
  return (
    <section className="relative isolate overflow-hidden rounded-card border border-clay bg-env-sage">
      {/* A tonal wash rather than a photograph: this is somebody's identity,
          and a stock field behind it would imply a farm we cannot vouch for. */}
      <div className="absolute inset-x-0 top-0 -z-10 h-28 bg-gradient-to-b from-emerald-800/10 to-transparent" aria-hidden />

      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:p-7">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={`${displayName} profile picture`}
            className="h-20 w-20 shrink-0 rounded-full border border-clay object-cover shadow-sm sm:h-24 sm:w-24"
          />
        ) : (
          <span
            className="grid h-20 w-20 shrink-0 place-items-center rounded-full border border-clay bg-brand-fill text-2xl font-bold text-white shadow-sm sm:h-24 sm:w-24"
            aria-hidden
          >
            {initials(displayName)}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-display-sm tracking-tight text-emerald-950">{displayName}</h1>
            {verified && (
              <Badge tone="verified" icon={BadgeCheck}>Verified</Badge>
            )}
          </div>

          <p className="mt-0.5 font-mono text-[13px] text-emerald-900/55">{handle(username)}</p>

          {headline && (
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-emerald-900/75">{headline}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-emerald-900/60">
            {roles && roles.length > 0 && (
              <span className="font-medium text-emerald-900/75">{roles.join(' · ')}</span>
            )}
            {state && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> {state}
              </span>
            )}
            {memberSinceIso && <span>Member since {memberSince(memberSinceIso)}</span>}
          </div>

          {stats && stats.length > 0 && (
            <dl className="mt-4 flex flex-wrap gap-x-7 gap-y-3 border-t border-clay/70 pt-4">
              {stats.map((s) => (
                <div key={s.label}>
                  <dd className="tabular text-lg font-semibold tracking-tight text-emerald-950">{s.value}</dd>
                  <dt className="text-[11px] font-medium text-emerald-900/50">{s.label}</dt>
                </div>
              ))}
            </dl>
          )}
        </div>

        {actions && <div className="shrink-0 sm:pt-1">{actions}</div>}
      </div>
    </section>
  )
}

/** A commodity chip that links into the public marketplace filtered by it. */
export function CommodityChip({ commodity, className }: { commodity: string; className?: string }) {
  return (
    <a
      href={`/marketplace?commodity=${encodeURIComponent(commodity)}`}
      className={cn(
        'inline-flex h-9 min-h-touch items-center rounded-pill border border-clay/80 bg-white/70 px-3.5 text-[13px] font-medium text-emerald-900 transition-colors hover:border-clay hover:bg-white',
        className,
      )}
    >
      {commodity}
    </a>
  )
}
