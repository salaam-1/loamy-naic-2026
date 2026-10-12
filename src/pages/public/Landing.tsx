import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, BadgeCheck, Landmark, LineChart, Mail, Phone, Store,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { PublicListing } from '@/lib/marketplace'
import { PILLARS, ROLES, STEPS, DISCLAIMER_KEY } from '@/pages/public/copy'
import { useT } from '@/lib/i18n'
import { PublicShell } from '@/pages/public/PublicShell'
import { SectionHeading } from '@/pages/public/SectionHeading'
import { ListingImage } from '@/components/ListingImage'
import { VerifiedTag } from '@/components/VerifiedTag'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'

const PILLAR_ICON = { BadgeCheck, Landmark, Store, LineChart }

/**
 * Public marketing landing (route: /). Dark → light → dark: emerald hero and
 * footer bookend the light middle. Flat and dense — no gradients, no glass,
 * no glows, no fabricated stats/logos/testimonials.
 */
/**
 * How many listings the homepage shows, and the columns it reads.
 *
 * THE LIMIT IS THE POINT, NOT THE SLICE
 *   The homepage is a shop window, not the shop. A visitor must reach the
 *   footer without scrolling past the catalogue, and that has to be true when
 *   the marketplace holds fifty listings and when it holds fifty thousand.
 *   So the bound lives in the QUERY: six rows cross the wire, and there is
 *   nothing on the client to slice. Full browsing, search, filtering and
 *   pagination are the marketplace's job.
 *
 *   Exported so tests/unit/homepage-bounded.test.ts can assert the bound
 *   rather than trusting a number typed into a chain.
 */
export const HOMEPAGE_PREVIEW_LIMIT = 6

/** The nine fields the preview card actually renders. */
export const HOMEPAGE_PREVIEW_COLUMNS =
  'id, commodity, listing_type, quantity, unit, price_per_unit, state, photos, created_at, seller_verified'

export default function Landing() {
  const { t } = useT()
  const [preview, setPreview] = useState<PublicListing[] | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('loamy_public_listings')
      // Named columns, not `*`. The view is wide and this card shows nine
      // fields; selecting the rest ships seller metadata to an anonymous
      // visitor's browser for no reason.
      .select(HOMEPAGE_PREVIEW_COLUMNS)
      // Newest first, with `id` breaking ties. `created_at` alone is not a
      // total order -- two listings written in the same transaction share a
      // timestamp -- and without a tiebreaker Postgres may return them in
      // either order, so the homepage could reshuffle between loads with no
      // data having changed.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(HOMEPAGE_PREVIEW_LIMIT)
      .then(({ data }) => {
        if (!cancelled) setPreview((data as PublicListing[]) ?? [])
      })
    return () => { cancelled = true }
  }, [])

  return (
    <PublicShell>
      {/* Hero — deep emerald, full-bleed */}
      <section className="bg-emerald-800">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-8 sm:px-6 sm:py-10 md:grid-cols-[1.05fr_0.95fr] md:py-14">
          {/* The hero settles in by itself a beat after load -- no click, no
              loading-screen feel. `rise-in` is the existing house animation
              (opacity + 6px); only the duration and the stagger are tuned here.
              `backwards` fill holds the start frame during the delay, so
              nothing flashes in and then jumps back out.

              Under prefers-reduced-motion the global rule in index.css
              collapses BOTH duration and delay, so the content is simply there
              on load rather than hidden waiting for a timer. */}
          <div>
            <h1 className="animate-rise-in text-3xl font-bold -tracking-[0.01em] text-white [animation-duration:420ms] [animation-fill-mode:backwards] sm:text-4xl">
              {t('public.heroTitle')}
            </h1>
            <p className="mt-3 max-w-xl animate-rise-in text-[15px] leading-relaxed text-[#C9D6CF] [animation-delay:90ms] [animation-duration:420ms] [animation-fill-mode:backwards]">
              {t('public.heroSubtitle')}
            </p>
            <div className="mt-5 flex animate-rise-in flex-wrap gap-2.5 [animation-delay:180ms] [animation-duration:420ms] [animation-fill-mode:backwards]">
              <Link to="/signup"><Button size="lg" variant="gold">{t('public.becomeFoundingMember')} <ArrowRight className="h-4 w-4" aria-hidden /></Button></Link>
              {/* Canonical size `lg`, same as the primary beside it. */}
              <Link to="/marketplace" className={cn(buttonVariants({ variant: 'outline-inverse', size: 'lg' }))}>
                {t('public.browseMarketplace')}
              </Link>
            </div>
            <p className="mt-5 max-w-lg animate-rise-in text-[12px] leading-relaxed text-[#9FB5AC] [animation-delay:270ms] [animation-duration:420ms] [animation-fill-mode:backwards]">{t(DISCLAIMER_KEY)}</p>
          </div>
          {/* Real photograph, panel inside the emerald - lighter-emerald border, no overlay. */}
          <div className="aspect-[4/3] overflow-hidden rounded border border-[#0C6650] bg-emerald-700">
            <img
              src="/images/hero-farmer.jpg"
              alt={t('public.heroImageAlt')}
              className="h-full w-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        </div>
      </section>

      {/* Pillars - light band */}
      <section id="platform" className="border-b border-[#D5DEDA] bg-[#EEF2F0]">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <SectionHeading>{t('public.fourPillars')}</SectionHeading>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((p) => {
              const Icon = PILLAR_ICON[p.icon as keyof typeof PILLAR_ICON]
              return (
                <a key={p.key} href="#how-it-works" className="rounded border border-[#D5DEDA] bg-white p-3.5 transition-colors hover:bg-[#EEF2F0]">
                  <h3 className="flex items-center gap-2 font-semibold text-emerald-950">
                    <Icon className="h-5 w-5 shrink-0 text-emerald-800" strokeWidth={1.5} aria-hidden />
                    {t(`public.pillar.${p.key}.title`)}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-snug text-[#2E3A35]">{t(`public.pillar.${p.key}.body`)}</p>
                </a>
              )
            })}
          </div>
        </div>
      </section>

      {/* How it works - white */}
      <section id="how-it-works" className="border-b border-[#D5DEDA] bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <SectionHeading>{t('public.howItWorks')}</SectionHeading>
          <ol className="mt-5 grid gap-px overflow-hidden rounded border border-[#D5DEDA] bg-[#D5DEDA] md:grid-cols-6">
            {STEPS.map((s) => (
              <li key={s.n} className="bg-white p-3.5">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-800 font-mono text-[13px] font-semibold text-white">{s.n}</span>
                <h3 className="mt-2.5 text-[13px] font-semibold text-emerald-950">{t(`public.step.${s.key}.title`)}</h3>
                <p className="mt-1 text-[12px] leading-snug text-[#5F6B65]">{t(`public.step.${s.key}.body`)}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[13px] font-medium text-[#2E3A35]">{t('public.banksDecide')}</p>
        </div>
      </section>

      {/* Who it's for - light band, dense table */}
      <section className="border-b border-[#D5DEDA] bg-[#EEF2F0]">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <SectionHeading>{t('public.whoItsFor')}</SectionHeading>
          <div className="mt-5 overflow-hidden rounded border border-[#D5DEDA] bg-white">
            <table className="w-full text-left text-sm">
              <tbody>
                {ROLES.map((role, i) => (
                  <tr key={role} className={i % 2 ? 'bg-[#EEF2F0]' : ''}>
                    <td className="w-44 border-b border-[#D5DEDA] px-4 py-2.5 font-semibold text-emerald-800">{t(`role.${role}`)}</td>
                    <td className="border-b border-[#D5DEDA] px-4 py-2.5 text-[#2E3A35]">{t(`public.role.${role}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Marketplace preview - white; hidden entirely when fewer than 3 active listings */}
      {preview && preview.length >= 3 && (
        <section id="marketplace" className="border-b border-[#D5DEDA] bg-white">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <div className="flex items-end justify-between gap-3">
              <SectionHeading>{t('public.featuredListings')}</SectionHeading>
              <Link
                to="/marketplace"
                className="touch-target text-sm font-semibold text-emerald-700 hover:text-emerald-800"
              >
                {t('public.seeAllListings')} →
              </Link>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {preview.map((l) => (
                <Link key={l.id} to={`/marketplace/${l.id}`} className="overflow-hidden rounded border border-[#D5DEDA] bg-white transition-colors hover:bg-[#EEF2F0]">
                  <ListingImage path={l.photos?.[0]} listingType={l.listing_type} alt={l.commodity} className="h-32" />
                  <div className="space-y-1 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-emerald-950">{l.commodity}</p>
                      <VerifiedTag verified={l.seller_verified} />
                    </div>
                    <p className="font-mono text-[13px] font-semibold text-emerald-800">{formatNaira(Number(l.price_per_unit))}<span className="text-xs font-normal text-[#5F6B65]">/{l.unit}</span></p>
                    <p className="text-xs text-[#5F6B65]">{Number(l.quantity)} {l.unit} · {l.state} · {formatDateShort(l.created_at)}</p>
                  </div>
                </Link>
              ))}
            </div>
            {/* Repeated below the cards: a visitor who has read the six and
                wants more should not have to scroll back up to find the way
                through. */}
            <div className="mt-5">
              <Link
                to="/marketplace"
                className="inline-flex min-h-touch items-center gap-1.5 rounded-control border border-clay bg-white px-4 text-sm font-semibold text-emerald-800 transition-colors hover:bg-sand"
              >
                {t('public.seeAllListings')} →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Founding member CTA - the third dark moment, darker emerald */}
      <section className="bg-[#093328]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-12 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <SectionHeading dark>{t('public.joinFoundingMember')}</SectionHeading>
            <p className="mt-2 max-w-xl text-[15px] text-[#C9D6CF]">{t('public.joinBody')}</p>
          </div>
          <Link to="/signup"><Button size="lg" variant="gold">{t('public.getStarted')} <ArrowRight className="h-4 w-4" aria-hidden /></Button></Link>
        </div>
      </section>

      {/* About + Contact — light band */}
      <section id="about" className="bg-[#EEF2F0]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-2">
          <div>
            <SectionHeading>{t('public.about')}</SectionHeading>
            <p className="mt-3 text-[15px] leading-relaxed text-[#2E3A35]">
              Loamy is built by Braventi Techworks, the technology subsidiary of Braventi Holdings.
              We build the digital identity, verification and market infrastructure that connects
              Nigerian agriculture to finance and markets.
            </p>
            <a href="https://braventiholdings.com.ng" target="_blank" rel="noreferrer" className="mt-2.5 inline-block text-sm font-semibold text-emerald-700 hover:text-emerald-800">braventiholdings.com.ng →</a>
          </div>
          <div id="contact">
            <SectionHeading>{t('public.contact')}</SectionHeading>
            <div className="mt-3 space-y-2 text-sm">
              <a href="mailto:braventitechnologies@gmail.com" className="flex items-center gap-2 text-[#2E3A35] hover:text-emerald-800">
                <Mail className="h-4 w-4" strokeWidth={1.5} aria-hidden /> braventitechnologies@gmail.com
              </a>
              <a href="tel:+2347042768655" className="flex items-center gap-2 font-mono text-[#2E3A35] hover:text-emerald-800">
                <Phone className="h-4 w-4" strokeWidth={1.5} aria-hidden /> +234 704 276 8655
              </a>
            </div>
          </div>
        </div>
      </section>
    </PublicShell>
  )
}
