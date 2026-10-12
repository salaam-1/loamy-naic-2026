import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Boxes, Compass, Pencil, ShieldCheck, Store, Tags, UserRound,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { PublicShell } from '@/pages/public/PublicShell'
import { Card } from '@/components/ui/card'
import { Skeleton, SkeletonRow, LoadingRegion } from '@/components/ui/skeleton'
import { RatingBreakdown, RatingInline, Stars } from '@/components/Rating'
import { ListingImage } from '@/components/ListingImage'
import { ProfileHero, CommodityChip } from '@/components/profile/ProfileHero'
import { ShareProfile } from '@/components/profile/ShareProfile'
import { Price, Quantity } from '@/components/Money'
import { Section } from '@/components/home/HomeSections'
import { handle, ratingDisplay, type RatingSummary } from '@/lib/identity'
import { ROLE_CONFIGS } from '@/lib/roles'
import { isPlatformRole } from '@/lib/types'
import { formatDateShort } from '@/lib/utils'

/**
 * The public identity page — /u/:username.
 *
 * EVERYTHING COMES FROM ONE GATE
 *   loamy_profile_by_username decides what a given viewer may see and returns
 *   `found: false` for a profile that exists but may not be seen, exactly as
 *   for one that does not exist. This page does not try to distinguish the
 *   two either: doing so would turn the 404 into a membership oracle.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY
 *   No internal user id. The payload has never exposed one, and listings were
 *   added to the function itself (migration 20260921100001) rather than
 *   returning an id so the client could fetch them — saving a join is not
 *   worth handing every anonymous visitor a stable identifier for a member.
 *
 *   No financing, no bank details, no coordinates, no counterparties, no
 *   verification evidence. The function returns counts, not rows.
 *
 * FACTS, NOT JUDGEMENTS
 *   Verified / completed transactions / rating / active listings are facts
 *   the backend computes. There is no trust score, no "top seller" and no
 *   recommendation, because Loamy does not compute any of those.
 */

interface ProfileListing {
  id: string
  commodity: string
  listing_type: 'commodity' | 'input'
  quantity: number
  unit: string
  price_per_unit: number
  currency: string
  state: string | null
  lga: string | null
  photos: string[] | null
  created_at: string
}

interface PublicProfileData {
  found: boolean
  username: string
  display_name: string
  headline: string | null
  bio: string | null
  avatar_url: string | null
  state: string | null
  category: string | null
  roles: string[]
  verified_badge: boolean
  member_since: string
  is_self: boolean
  visibility: string
  active_listings: number
  completed_transactions: number
  commodities: string[]
  states_served: string[]
  listings: ProfileListing[]
}

interface Review {
  ref: string
  rating: number
  quality: number | null
  communication: number | null
  timeliness: number | null
  comment: string | null
  response: string | null
  responded_at: string | null
  reviewer_label: string
  reviewer_state: string | null
  created_at: string
}

export default function PublicProfile() {
  const { username = '' } = useParams()
  const { session, profile: me } = useAuth()
  const [profile, setProfile] = useState<PublicProfileData | null | 'missing'>(null)
  const [summary, setSummary] = useState<RatingSummary | null>(null)
  const [reviews, setReviews] = useState<Review[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setProfile(null)
    setReviews(null)
    setSummary(null)

    supabase.rpc('loamy_profile_by_username', { p_username: username }).then(({ data }) => {
      if (cancelled) return
      const p = data as PublicProfileData | null
      setProfile(p?.found ? p : 'missing')
    })

    supabase.rpc('loamy_profile_reviews', { p_username: username, p_limit: 20 }).then(({ data }) => {
      if (cancelled) return
      const r = data as { found: boolean; items: Review[] } | null
      setReviews(r?.found && Array.isArray(r.items) ? r.items : [])
    })

    return () => { cancelled = true }
  }, [username])

  // The rating summary needs the subject's id, which the public payload
  // deliberately does not carry. It comes from the members-only handle view,
  // so a signed-out visitor simply sees the reviews without the histogram.
  useEffect(() => {
    if (!session || profile === null || profile === 'missing') return
    let cancelled = false
    supabase.from('loamy_profile_handles').select('id').eq('username', profile.username).maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.id) return
        supabase.rpc('loamy_rating_summary', { p_user: data.id }).then(({ data: s }) => {
          if (!cancelled) setSummary(s as RatingSummary)
        })
      })
    return () => { cancelled = true }
  }, [session, profile])

  // ---- Loading ------------------------------------------------------------
  if (profile === null) {
    return (
      <PublicShell>
        <LoadingRegion label="Loading profile" className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
          {/* Sized to the hero it replaces, so nothing jumps when it lands —
              and deliberately blank: showing a name before the profile has
              loaded would mean showing the wrong one for a moment. */}
          <Skeleton className="h-52 w-full rounded-card sm:h-56" />
          <div className="flex gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-24 rounded-pill" />)}
          </div>
          <Card className="p-5">{[0, 1].map((i) => <SkeletonRow key={i} />)}</Card>
        </LoadingRegion>
      </PublicShell>
    )
  }

  // ---- Not found ----------------------------------------------------------
  if (profile === 'missing') {
    return (
      <PublicShell>
        <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
          <Card variant="plain" className="flex flex-col items-center gap-3 p-8 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-sand text-emerald-700">
              <UserRound className="h-6 w-6" strokeWidth={1.5} aria-hidden />
            </span>
            <h1 className="text-[17px] font-semibold tracking-tight text-emerald-950">
              Profile not found
            </h1>
            <p className="max-w-sm text-[14px] leading-relaxed text-emerald-900/60">
              There is no public Loamy profile at {handle(username)}. It may never have existed, or
              it may not be public.
            </p>
            {!session && (
              <p className="text-[13px] text-emerald-900/55">
                Some profiles are visible to signed-in members only.{' '}
                <Link
                  to="/login"
                  className="-my-2 inline-block rounded py-2 font-medium text-emerald-700 hover:text-emerald-800"
                >
                  Sign in
                </Link>
              </p>
            )}
            <Link
              to="/marketplace"
              className="mt-1 inline-flex h-10 items-center gap-2 rounded-control bg-brand-fill px-4 text-[13px] font-semibold text-white shadow-sm ring-1 ring-inset ring-white/10 hover:shadow-md"
            >
              <Compass className="h-4 w-4" aria-hidden /> Explore the marketplace
            </Link>
          </Card>
        </div>
      </PublicShell>
    )
  }

  // ---- Profile ------------------------------------------------------------
  const isOwner = profile.is_self
  const listings = Array.isArray(profile.listings) ? profile.listings : []
  const commodities = Array.isArray(profile.commodities) ? profile.commodities : []
  const roleLabels = (Array.isArray(profile.roles) ? profile.roles : [])
    .filter(isPlatformRole)
    .map((r) => ROLE_CONFIGS[r].label)

  // Only facts that exist. A member with no completed deals shows no
  // "0 transactions" stat -- a zero reads as a judgement it has not earned.
  const stats: { label: string; value: string }[] = []
  if (profile.completed_transactions > 0) {
    stats.push({
      label: profile.completed_transactions === 1 ? 'Completed transaction' : 'Completed transactions',
      value: String(profile.completed_transactions),
    })
  }
  if (profile.active_listings > 0) {
    stats.push({
      label: profile.active_listings === 1 ? 'Active listing' : 'Active listings',
      value: String(profile.active_listings),
    })
  }
  // Only when the SERVER publishes an average. Below its minimum count it
  // withholds one deliberately -- three five-star reviews from a seller's own
  // network is not a 5.0 -- so the hero shows the review count instead of a
  // number the backend refused to stand behind.
  const rating = ratingDisplay(summary)
  if (summary && summary.count > 0) {
    stats.push(
      rating.showStars
        ? { label: `From ${summary.count} rating${summary.count === 1 ? '' : 's'}`, value: rating.value }
        : { label: summary.count === 1 ? 'Review' : 'Reviews', value: String(summary.count) },
    )
  }

  const ownerBase = me?.platform_role ? `/dashboard/${me.platform_role}` : '/dashboard/farmer'

  return (
    <PublicShell>
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
        <ProfileHero
          displayName={profile.display_name}
          username={profile.username}
          headline={profile.headline}
          verified={profile.verified_badge}
          roles={roleLabels}
          state={profile.state}
          memberSinceIso={profile.member_since}
          stats={stats}
          avatarUrl={profile.avatar_url}
          actions={
            <div className="flex flex-col gap-2">
              <ShareProfile username={profile.username} displayName={profile.display_name} />
              {isOwner && (
                <Link
                  to={`${ownerBase}/settings`}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-control border border-clay bg-white/80 px-4 text-[13px] font-semibold text-emerald-900 hover:bg-white"
                >
                  <Pencil className="h-4 w-4" aria-hidden /> Edit profile
                </Link>
              )}
            </div>
          }
        />

        {/* Owner-only: what a visitor sees, and how to change it. */}
        {isOwner && (
          <Card variant="inset" className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-[13px] text-emerald-900/70">
              <span className="font-medium text-emerald-950">This is your public profile.</span>{' '}
              {profile.visibility === 'public'
                ? 'Anyone with the link can see it.'
                : profile.visibility === 'members'
                  ? 'Only signed-in Loamy members can see it.'
                  : 'It is private - only you and Loamy administrators can see it.'}
            </p>
            <Link
              to={`${ownerBase}/settings`}
              className="-my-2 touch-target rounded py-2 text-[13px] font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Change visibility →
            </Link>
          </Card>
        )}

        {profile.bio && (
          <Section title="About">
            <p className="max-w-3xl whitespace-pre-line text-[15px] leading-relaxed text-emerald-900/75">
              {profile.bio}
            </p>
          </Section>
        )}

        {commodities.length > 0 && (
          <Section title="Trades in" hint={isOwner ? 'From your active listings' : 'From their active listings'}>
            <div className="flex flex-wrap gap-2">
              {commodities.map((c) => <CommodityChip key={c} commodity={c} />)}
            </div>
          </Section>
        )}

        {/* Active listings. The same public rows the marketplace shows. */}
        <Section
          title="Active listings"
          hint={listings.length > 0 ? `${profile.active_listings} on the marketplace` : undefined}
          action={listings.length > 0 ? { label: 'All listings', to: '/marketplace' } : undefined}
        >
          {listings.length === 0 ? (
            <Card variant="plain" className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sand text-emerald-700">
                <Tags className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-emerald-950">No active listings</p>
                <p className="mt-0.5 text-[13px] text-emerald-900/60">
                  {isOwner
                    ? 'Nothing of yours is on the marketplace right now.'
                    : `${profile.display_name} has nothing listed right now.`}
                </p>
              </div>
              <Link
                to={isOwner ? `${ownerBase}/my-listings/new` : '/marketplace'}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-control border border-clay bg-white px-4 text-[13px] font-semibold text-emerald-900 hover:bg-sand"
              >
                {isOwner ? <><Store className="h-4 w-4" aria-hidden /> Create a listing</>
                  : <><Compass className="h-4 w-4" aria-hidden /> Explore marketplace</>}
              </Link>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((l) => (
                <Link
                  key={l.id}
                  to={`/marketplace/${l.id}`}
                  className="group flex flex-col overflow-hidden rounded-card border border-clay bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <ListingImage
                    path={l.photos?.[0]}
                    listingType={l.listing_type}
                    alt={l.commodity}
                    className="h-36"
                  />
                  <div className="flex flex-1 flex-col gap-1.5 p-4">
                    <p className="font-semibold tracking-tight text-emerald-950">{l.commodity}</p>
                    <Quantity value={Number(l.quantity)} unit={l.unit} size="sm" />
                    <Price amount={Number(l.price_per_unit)} per={l.unit} size="sm" />
                    <p className="mt-auto pt-1 text-[11px] text-emerald-900/45">
                      {[l.lga, l.state].filter(Boolean).join(', ') || 'Nigeria'} ·{' '}
                      {formatDateShort(l.created_at)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* Reviews. Anonymous publicly, by design. */}
        <Section
          title="Reviews"
          hint={summary && summary.count > 0 ? undefined : 'From completed transactions only'}
        >
          {summary && summary.count > 0 && (
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <p className="tabular text-display-sm text-emerald-950">{rating.value}</p>
                  {rating.showStars && summary.average !== null && <Stars value={summary.average} />}
                  <p className="mt-1 text-[12px] text-emerald-900/55">{rating.caption}</p>
                </div>
                <div className="min-w-[12rem] flex-1">
                  <RatingBreakdown summary={summary} />
                </div>
              </div>
            </Card>
          )}

          {reviews === null ? (
            <Card className="p-5">{[0, 1].map((i) => <SkeletonRow key={i} />)}</Card>
          ) : reviews.length === 0 ? (
            <Card variant="plain" className="flex items-start gap-3 p-5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sand text-emerald-700">
                <ShieldCheck className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              </span>
              <div>
                <p className="text-[14px] font-medium text-emerald-950">No reviews yet</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-emerald-900/60">
                  A review can only be left by someone who completed a transaction here, which is
                  why there are none to show rather than many that mean nothing.
                </p>
              </div>
            </Card>
          ) : (
            <ul className="space-y-4">
              {reviews.map((r) => (
                <li key={r.ref} className="border-b border-clay/70 pb-4 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* A single review's own score is a fact with no
                        threshold attached, so the stars render directly.
                        RatingInline is for AGGREGATES, where the server may
                        withhold the average. */}
                    <Stars value={r.rating} />
                    {/* reviewer_label is the anonymised label the backend
                        chose. There is no avatar, no link and no id — the
                        review is anonymous publicly and stays that way. */}
                    <span className="text-[12px] text-emerald-900/55">
                      {r.reviewer_label}
                      {r.reviewer_state ? ` · ${r.reviewer_state}` : ''}
                    </span>
                    <span className="text-[11px] text-emerald-900/40">{formatDateShort(r.created_at)}</span>
                  </div>
                  {r.comment && (
                    <p className="mt-2 text-[14px] leading-relaxed text-emerald-900/75">{r.comment}</p>
                  )}
                  {r.response && (
                    <div className="mt-2 border-l-2 border-emerald-700 bg-sand/50 px-3 py-2">
                      <p className="text-[11px] font-medium text-emerald-900/60">
                        Response from {profile.display_name}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-emerald-900/75">{r.response}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* The identity graph entry point — only where it is public. */}
        {profile.states_served.length > 0 && (
          <Section title="Operates in">
            <div className="flex flex-wrap gap-2">
              {profile.states_served.filter(Boolean).map((s) => (
                <span
                  key={s}
                  className="inline-flex h-9 min-h-touch items-center rounded-pill border border-clay/80 bg-white/70 px-3.5 text-[13px] text-emerald-900"
                >
                  {s}
                </span>
              ))}
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-emerald-900/45">
              <Boxes className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              States where this member currently has stock listed. Exact farm and warehouse
              locations are never shown publicly.
            </p>
          </Section>
        )}
      </div>
    </PublicShell>
  )
}
