import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * The contextual hero.
 *
 * WHY IT IS IMAGE-BACKED
 *   §19 and §57: a hero built from a solid panel, a heading and a button is
 *   the generic dashboard pattern. This one layers a photograph, a scrim and
 *   text, so the first thing on screen looks like agriculture rather than
 *   like software.
 *
 *   The three photographs are the ones already shipped in /public/images and
 *   credited in IMAGE-CREDITS.md. No asset was invented, and none of them is
 *   anybody's private farm: they are the same public marketing images the
 *   storefront already uses. Verification evidence and farm coordinates never
 *   appear here.
 *
 * WHY THE IMAGE IS OPTIONAL
 *   `image` can be omitted and the hero still works — it falls back to a
 *   tonal environment rather than a grey box. §6 asks for a treatment that
 *   survives having no imagery instead of a fabricated asset.
 *
 * READABILITY IS MEASURED, NOT ASSUMED
 *   The first scrim here was transparent at the top and only darkened near
 *   the bottom. It read fine over the market photograph and washed the title
 *   out completely over the sunlit farm one — 2.7:1, well under AA.
 *
 *   So the scrim now has two strengths, chosen per image, and
 *   scripts/visual-qa-home.mjs renders the real composite to a canvas,
 *   samples the pixels behind the heading and fails below 4.5:1. It reads the
 *   gradient stops from the element rather than duplicating them, so the
 *   check cannot drift away from the token. Current measurements: farmer
 *   5.4:1, trader 6.7:1, buyer 6.3:1, growth partner 7.4:1.
 */

export interface HeroFact {
  label: string
  value: string
  /** Optional emphasis for the one fact that matters most. */
  strong?: boolean
}

export function HomeHero({
  eyebrow,
  title,
  subtitle,
  facts = [],
  action,
  badge,
  image,
  imageAlt,
  scrim = 'default',
  className,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  facts?: HeroFact[]
  action?: { label: string; to: string; icon?: LucideIcon }
  badge?: { label: string; verified?: boolean }
  image?: string
  imageAlt?: string
  /**
   * How hard to darken the photograph. `strong` for bright images — measured,
   * not guessed: scripts/visual-qa-home.mjs samples the composite behind the
   * heading and fails below 4.5:1.
   */
  scrim?: 'default' | 'strong'
  className?: string
}) {
  const ActionIcon = action?.icon ?? ArrowRight
  return (
    <section
      className={cn(
        'relative isolate overflow-hidden rounded-card border border-clay',
        !image && 'bg-env-sage',
        className,
      )}
    >
      {image && (
        <>
          <img
            src={image}
            alt={imageAlt ?? ''}
            // Eager + high priority: this is the largest element above the
            // fold, so lazy-loading it would only delay the thing people came
            // to see. Everything BELOW the fold lazy-loads.
            loading="eager"
            // Spread + lowercase: React 18 does not know the camelCase
            // `fetchPriority` prop (that is React 19) and drops it with a
            // console warning on every dashboard. StorefrontHero already
            // documents this; HomeHero had the bug it warns about.
            {...{ fetchpriority: 'high' }}
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
          <div
            className={cn('absolute inset-0 -z-10', scrim === 'strong' ? 'bg-image-scrim-strong' : 'bg-image-scrim')}
            aria-hidden
          />
        </>
      )}

      <div
        className={cn(
          'flex min-h-[15rem] flex-col justify-end gap-4 p-5 sm:min-h-[17rem] sm:p-7',
          image ? 'text-white' : 'text-emerald-950',
        )}
      >
        <div className="max-w-2xl">
          <p
            className={cn(
              'text-[11px] font-semibold uppercase tracking-wider',
              image ? 'text-white/70' : 'text-emerald-700',
            )}
          >
            {eyebrow}
          </p>
          <h1
            className={cn(
              'mt-1.5 text-display-sm sm:text-display',
              image ? 'text-white' : 'text-emerald-950',
            )}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className={cn(
                'mt-2 text-sm leading-relaxed sm:text-[15px]',
                image ? 'text-white/85' : 'text-emerald-900/70',
              )}
            >
              {subtitle}
            </p>
          )}
          {badge && (
            <span className="mt-3 inline-block">
              <Badge tone={badge.verified ? 'verified' : 'neutral'} icon={badge.verified ? BadgeCheck : undefined}>
                {badge.label}
              </Badge>
            </span>
          )}
        </div>

        {facts.length > 0 && (
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {facts.map((f) => (
              <div key={f.label}>
                <dt
                  className={cn(
                    'text-[11px] font-medium',
                    image ? 'text-white/60' : 'text-emerald-900/50',
                  )}
                >
                  {f.label}
                </dt>
                <dd
                  className={cn(
                    'tabular text-sm font-semibold',
                    f.strong && 'text-base',
                    image ? 'text-white' : 'text-emerald-950',
                  )}
                >
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {action && (
          <div>
            <Link
              to={action.to}
              className={cn(
                'inline-flex h-11 min-h-touch items-center gap-2 rounded-control px-5 text-sm font-semibold transition-all',
                image
                  // Opaque over photography: a translucent control on an
                  // unpredictable image is a control nobody can read.
                  ? 'bg-white text-emerald-900 shadow-sm hover:bg-white/90 hover:shadow-md'
                  : 'bg-brand-fill text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-brand-fill-hover hover:shadow-md',
              )}
            >
              {action.label}
              <ActionIcon className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}
