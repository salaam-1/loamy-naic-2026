import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Landmark, MapPin, ShieldCheck } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

interface HeroCta {
  label: string
  /** A route to link to, OR an onClick handler (one of the two). */
  to?: string
  onClick?: () => void
}

/**
 * Marketplace storefront hero — a full-bleed rotating photograph with the
 * messaging laid over it.
 *
 * Each slide owns its own image, so the picture changes WITH the words instead
 * of sitting still beside them. All three <img> elements stay mounted and
 * cross-fade on opacity: that keeps every frame decoded ahead of time, so a
 * rotation never flashes a half-loaded photo.
 *
 * The photographs are real Nigerian farmers and traders (credited in the public
 * footer and public/images/IMAGE-CREDITS.md) — never stock imagery of a place
 * this platform does not operate in.
 *
 * Trust points stay honest: no fabricated statistics ("25,000+ buyers"), only
 * what is verifiably true about how Loamy works.
 */
/* The image paths are assets and stay as they are. The title, body and ALT
   become keys: alt text is interface text, and a screen-reader user is the
   only person who ever reads it, so leaving it English leaves them with an
   untranslated page. */
const SLIDES = [
  {
    titleKey: 'marketplace.hero.tradeGrowThrive',
    bodyKey: 'marketplace.hero.tradeGrowThriveBody',
    image: '/images/hero-harvest.jpg',
    altKey: 'marketplace.hero.altRice',
  },
  {
    titleKey: 'marketplace.hero.buyDirect',
    bodyKey: 'marketplace.hero.buyDirectBody',
    image: '/images/hero-market.jpg',
    altKey: 'marketplace.hero.altTraders',
  },
  {
    titleKey: 'marketplace.hero.realProduce',
    bodyKey: 'marketplace.hero.realProduceBody',
    image: '/images/hero-farmer.jpg',
    altKey: 'marketplace.hero.altCassava',
  },
]

/**
 * Claims on the public homepage. Every one has to survive contact with the
 * product.
 *
 * "No platform fees" was removed on 2026-09-20: it is false. The authoritative
 * fee schedule (fee_schedules, resolved by loamy_resolve_fee) carries a live
 * marketplace fee, and checkout now shows it. A storefront promising no fees
 * over a checkout that charges one is the worst kind of defect -- the buyer
 * only finds out at the moment they were about to trust us.
 *
 * "Fees shown upfront" is the claim the product can actually keep.
 */
const TRUST = [
  { icon: BadgeCheck, labelKey: 'marketplace.trust.verifiedSellers' },
  { icon: Landmark, labelKey: 'marketplace.trust.bankRails' },
  { icon: ShieldCheck, labelKey: 'marketplace.trust.feesUpfront' },
  { icon: MapPin, labelKey: 'marketplace.hero.nationwide' },
]

/** Honour the OS "reduce motion" setting: no autoplay, no cross-fade. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

export function StorefrontHero({
  onBrowse,
  browseLabel,
  secondary,
}: {
  onBrowse: () => void
  browseLabel?: string
  secondary: HeroCta
}) {
  const { t } = useT()
  const browseText = browseLabel ?? t('marketplace.browseListings')
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (paused || reduced) return
    const t = setInterval(() => setI((v) => (v + 1) % SLIDES.length), 6000)
    return () => clearInterval(t)
  }, [paused, reduced])

  const slide = SLIDES[i]

  return (
    <section
      className="relative flex min-h-[380px] overflow-hidden rounded border border-emerald-700 bg-emerald-800 sm:min-h-[440px] lg:min-h-[480px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Rotating photograph, cross-faded in step with the copy. */}
      {SLIDES.map((s, idx) => (
        <img
          key={s.image}
          src={s.image}
          alt={idx === i ? t(s.altKey) : ''}
          aria-hidden={idx === i ? undefined : true}
          // The first frame is the LCP element, so it loads eagerly at high
          // priority; the rest are in-viewport and follow immediately.
          // Spread + lowercase: React 18 does not know the camelCase
          // `fetchPriority` prop (that is React 19) and drops it with a warning.
          {...{ fetchpriority: idx === 0 ? 'high' : 'low' }}
          decoding="async"
          className={`absolute inset-0 z-0 h-full w-full object-cover object-center ${
            reduced ? '' : 'transition-opacity duration-700 ease-out'
          } ${idx === i ? 'opacity-100' : 'opacity-0'}`}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      ))}

      {/* Flat emerald scrim — a solid wash rather than a gradient, to stay with
          the flat palette. Kept light enough that the photograph still reads as
          a photograph; the text carries its own shadow for contrast instead of
          drowning the whole image to get there. */}
      <div className="absolute inset-0 z-0 bg-emerald-950/45" aria-hidden />

      <div className="relative z-10 flex w-full flex-col justify-center p-5 sm:p-8 lg:p-10">
        {/* Settles in automatically a beat after load. See Landing.tsx for the
            reduced-motion reasoning; the same global rule applies here. */}
        <div className="max-w-xl animate-rise-in [animation-duration:480ms] [animation-fill-mode:backwards]">
          <h2 className="text-2xl font-bold -tracking-[0.01em] text-white [text-shadow:0_2px_16px_rgba(3,25,18,0.75)] sm:text-4xl">
            {t(slide.titleKey)}
          </h2>
          <p className="mt-2.5 max-w-md text-sm leading-relaxed text-white/90 [text-shadow:0_1px_10px_rgba(3,25,18,0.8)] sm:text-base">
            {t(slide.bodyKey)}
          </p>

          {/* Both CTAs are canonical size `lg`. The secondary used to be a
              hand-written h-9 link, so it sat 8px shorter than the primary
              beside it with a different radius and text size -- the
              misalignment reported from the live product. */}
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button variant="gold" size="lg" onClick={onBrowse}>{browseText}</Button>
            {secondary.to ? (
              <Link to={secondary.to} className={cn(buttonVariants({ variant: 'outline-inverse', size: 'lg' }))}>
                {secondary.label}
              </Link>
            ) : (
              <Button variant="outline-inverse" size="lg" onClick={secondary.onClick}>
                {secondary.label}
              </Button>
            )}
          </div>

          {/* Honest trust strip — no invented numbers. */}
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
            {TRUST.map(({ icon: Icon, labelKey }) => (
              <li key={labelKey} className="flex items-center gap-1.5 text-xs font-medium text-white/90 [text-shadow:0_1px_8px_rgba(3,25,18,0.85)]">
                <Icon className="h-4 w-4 text-gold-400" strokeWidth={1.75} aria-hidden />
                {t(labelKey)}
              </li>
            ))}
          </ul>

          {/* Slide dots.

              A 6px dot is correct AS A DOT and hopeless as a target. So the
              dot is no longer the button: it is a child of one, and the
              button carries the 44px hit area. `-my-5` gives that area back
              to the layout, so the row still occupies the height of a dot
              and nothing below it moves. */}
          <div className="-mx-5 mt-6 flex" role="tablist" aria-label={t('marketplace.hero.highlightsAria')}>
            {SLIDES.map((s, idx) => (
              <button
                key={s.titleKey}
                type="button"
                role="tab"
                aria-selected={idx === i}
                aria-label={t(s.titleKey)}
                onClick={() => setI(idx)}
                className="group -my-5 flex min-h-touch min-w-touch items-center justify-center"
              >
                <span
                  aria-hidden
                  className={
                    idx === i
                      ? 'h-1.5 w-6 rounded-full bg-gold-400'
                      : 'h-1.5 w-1.5 rounded-full bg-white/50 transition-colors group-hover:bg-white/80'
                  }
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
