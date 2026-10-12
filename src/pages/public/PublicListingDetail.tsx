import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Handshake, MapPin, Route } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { INTEREST_ROLES, type PublicListing } from '@/lib/marketplace'
import { StockClaim } from '@/components/StockClaim'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { PublicShell } from '@/pages/public/PublicShell'
import { useT } from '@/lib/i18n'
import { ListingImage } from '@/components/ListingImage'
import { BuyBox } from '@/components/BuyBox'
import { RelatedListings } from '@/components/RelatedListings'
import { VerifiedTag } from '@/components/VerifiedTag'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Public listing detail (route: /marketplace/:id). Safe columns only. Browsing
 * is open; the Express-Interest ACTION is gated — signed-out visitors are sent
 * to signup with a redirect back to this listing. Seller contact stays hidden
 * until the seller accepts (unchanged post-acceptance disclosure rule).
 */
export default function PublicListingDetail() {
  const { t } = useT()
  const { id } = useParams()
  const navigate = useNavigate()
  const { session, profile } = useAuth()
  const [listing, setListing] = useState<PublicListing | null | 'missing'>(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [qty, setQty] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    // Explicit columns, not select('*'): the page should read what it renders
    // and nothing more. The view deliberately carries no seller user id.
    const { data, error: err } = await supabase
      .from('loamy_public_listings')
      .select([
        'id', 'listing_ref', 'commodity', 'listing_type', 'quantity', 'unit',
        'price_per_unit', 'currency', 'state', 'lga', 'photos', 'quality_grade',
        'description', 'created_at', 'seller_display_name', 'seller_category',
        'seller_verified', 'seller_username', 'claim_basis', 'batch_ref',
        'verification_status', 'origin_traced', 'origin_state',
      ].join(', '))
      .eq('id', id)
      .maybeSingle()
    if (err) {
      // A backend failure is not a missing listing. Saying "not found" for a
      // network error sends the buyer away from something that exists.
      setLoadError(err.message)
      return
    }
    setListing((data as unknown as PublicListing) ?? 'missing')
  }, [id])

  useEffect(() => { void load() }, [load])

  const role = profile?.platform_role
  const canExpress =
    session && role && role !== 'bank' &&
    INTEREST_ROLES.includes(role) &&
    listing !== null && listing !== 'missing' &&
    (role !== 'farmer' || listing.listing_type === 'input')

  async function expressInterest(e: FormEvent) {
    e.preventDefault()
    if (!session || !profile || !id) return
    setError(null)
    setBusy(true)
    const { error: insErr } = await supabase.from('listing_interests').insert({
      listing_id: id, buyer_id: profile.id,
      quantity_wanted: qty === '' ? null : Number(qty), message: message.trim() || null,
    })
    setBusy(false)
    if (insErr) { setError(insErr.message); return }
    setSent(true)
  }

  return (
    <PublicShell>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Link
          to="/marketplace"
          /* -my-2/py-2 keeps the visual position while giving the link a
             32px hit area on a phone. */
          className="-my-2 inline-flex min-h-touch items-center gap-1 rounded py-2 text-xs font-medium text-emerald-700 hover:text-emerald-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('marketplace.backToMarketplace')}
        </Link>

        {listing === null ? (
          <div className="mt-4 h-64 animate-pulse rounded border border-line bg-white" aria-hidden />
        ) : listing === 'missing' ? (
          <Card className="mt-4 p-8 text-center text-sm text-emerald-900/60">{t('marketplace.listingNoLongerAvailable')}</Card>
        ) : (
          <>
          <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <ListingImage path={listing.photos?.[photoIndex] ?? listing.photos?.[0]} listingType={listing.listing_type} alt={listing.commodity} className="h-72" />
                {listing.photos && listing.photos.length > 1 && (
                  <div className="flex gap-2 p-3">
                    {listing.photos.map((p, i) => (
                      <button key={p} type="button" onClick={() => setPhotoIndex(i)} className={cn('h-14 w-14 overflow-hidden rounded ring-2', i === photoIndex ? 'ring-emerald-600' : 'ring-transparent')}>
                        <ListingImage path={p} listingType={listing.listing_type} className="h-full w-full" />
                      </button>
                    ))}
                  </div>
                )}
              </Card>
              <Card className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h1 className="text-xl font-bold text-emerald-950">{listing.commodity}</h1>
                  <span className="rounded bg-emerald-50 px-2.5 py-1 text-[11px] font-medium uppercase text-emerald-700">{listing.listing_type}</span>
                </div>
                <p className="flex items-center gap-1 text-xs text-emerald-900/55">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />{[listing.lga, listing.state].filter(Boolean).join(', ')} · listed {formatDateShort(listing.created_at)}
                </p>
                <p className="font-mono text-2xl font-bold text-emerald-800">{formatNaira(Number(listing.price_per_unit))}<span className="text-sm font-normal text-emerald-900/50">/{listing.unit}</span></p>
                <p className="text-sm text-emerald-900/70">{t('marketplace.quantityAvailableLabel')}{' '}<span className="font-semibold">{Number(listing.quantity)} {listing.unit}</span></p>
                {listing.quality_grade && (
                  <p className="text-sm text-emerald-900/70">{t('marketplace.gradeLabel')}{' '}<span className="font-semibold">{listing.quality_grade}</span></p>
                )}
                {/* The detail page is where a remote buyer decides, so the
                    basis of the claim is spelled out rather than abbreviated. */}
                <div className="border-t border-line pt-3">
                  <StockClaim
                    claimBasis={listing.claim_basis}
                    verificationStatus={listing.verification_status}
                    originTraced={listing.origin_traced}
                    originState={listing.origin_state}
                    showHint
                  />
                  {/* A trace entry point ONLY when a real business
                      reference exists. A declared listing has no batch, so
                      there is nothing to trace and nothing is offered --
                      rather than a link that would resolve to nothing. What
                      the trace itself then shows is decided by
                      loamy_trace's own permission model, not here. */}
                  {listing.batch_ref ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-emerald-900/45">
                        Batch {listing.batch_ref}
                      </span>
                      <Link
                        to={`/trace/${encodeURIComponent(listing.batch_ref)}`}
                        className="inline-flex h-9 min-h-touch items-center gap-1.5 rounded-control border border-clay bg-white px-3 text-[12px] font-medium text-emerald-800 hover:bg-sand"
                      >
                        <Route className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                        {t('marketplace.traceThisStock')}
                      </Link>
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] leading-relaxed text-emerald-900/45">
                      {t('marketplace.sellerDeclarationNoBatch')}
                      a recorded harvest carries a batch reference you can follow.
                    </p>
                  )}
                </div>
              </Card>
            </div>

            <div className="space-y-4">
              <BuyBox
                listingId={listing.id}
                unit={listing.unit}
                price={Number(listing.price_per_unit)}
                availableQty={Number(listing.quantity)}
              />

              <Card className="p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-900/50">{t('marketplace.seller')}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  {/* Linked only when the view supplied a handle. A private
                      profile yields null, and a link to a page that will
                      correctly refuse to load is worse than plain text. */}
                  {listing.seller_username ? (
                    <Link
                      to={`/u/${listing.seller_username}`}
                      className="-my-1.5 inline-block rounded py-1.5 font-semibold text-emerald-800 underline-offset-2 hover:underline"
                    >
                      {listing.seller_display_name ?? t('marketplace.loamySeller')}
                    </Link>
                  ) : (
                    <p className="font-semibold text-emerald-950">{listing.seller_display_name ?? t('marketplace.loamySeller')}</p>
                  )}
                  <VerifiedTag verified={listing.seller_verified} />
                </div>
                {listing.seller_username && (
                  <p className="font-mono text-[11px] text-emerald-900/45">@{listing.seller_username}</p>
                )}
                <p className="mt-1 text-xs text-emerald-900/50">{listing.seller_category}{listing.state ? ` · ${listing.state}` : ''}</p>
                <p className="mt-3 text-[11px] leading-relaxed text-emerald-900/50">{t('marketplace.contactAfterAccept')}</p>
              </Card>

              {/* The gate */}
              {sent ? (
                <Card className="p-4">
                  <p className="text-sm font-semibold text-emerald-950">{t('marketplace.interestSentShort')}</p>
                  <p className="mt-1 text-xs text-emerald-900/60">{t('marketplace.trackUnderInterests')}</p>
                  <Link to={`/dashboard/${role}/my-interests`} className="mt-2 inline-block text-sm font-semibold text-emerald-700">{t('marketplace.goToMyInterests')} →</Link>
                </Card>
              ) : !session ? (
                <Card className="p-4">
                  <p className="text-sm text-emerald-900/70">{t('marketplace.createAccountToContact')}</p>
                  <Button className="mt-3 w-full" onClick={() => navigate(`/signup?redirect=${encodeURIComponent(`/marketplace/${listing.id}`)}`)}>
                    <Handshake className="h-4 w-4" aria-hidden /> {t('marketplace.expressInterest')}
                  </Button>
                  <p className="mt-2 text-center text-[11px] text-emerald-900/45">
                    {t('marketplace.alreadyMember')} <Link to={`/login?redirect=${encodeURIComponent(`/marketplace/${listing.id}`)}`} className="font-semibold text-emerald-700">{t('public.signIn')}</Link>
                  </p>
                </Card>
              ) : canExpress ? (
                <Card className="p-4">
                  <p className="text-sm font-semibold text-emerald-950">{t('marketplace.expressInterest')}</p>
                  <p className="mb-2 mt-0.5 text-xs leading-relaxed text-emerald-900/55">
                    {t('marketplace.preferToNegotiate')}
                  </p>
                  <form onSubmit={expressInterest} className="space-y-2.5" noValidate>
                    <div>
                      <Label htmlFor="qty">Quantity wanted ({listing.unit})</Label>
                      <Input id="qty" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`e.g. ${Number(listing.quantity)}`} />
                    </div>
                    <div>
                      <Label htmlFor="msg">{t('marketplace.messageToSeller')}</Label>
                      <Textarea id="msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('marketplace.introduceYourself')} />
                    </div>
                    {error && <p className="text-xs text-red-700">{error}</p>}
                    <Button type="submit" className="w-full" loading={busy}><Handshake className="h-4 w-4" aria-hidden /> {t('marketplace.sendInterest')}</Button>
                    <p className="text-[11px] leading-relaxed text-emerald-900/45">{t('marketplace.noPaymentOnLoamy')}</p>
                  </form>
                </Card>
              ) : (
                <Card className="p-4 text-xs leading-relaxed text-emerald-900/55">
                  {role === 'farmer'
                    ? t('marketplace.farmersInputListingsShort')
                    : t('marketplace.interestForBuyers')}
                </Card>
              )}
            </div>
          </div>
          <RelatedListings commodity={listing.commodity} excludeId={listing.id} linkTo={(lid) => `/marketplace/${lid}`} />
          </>
        )}
      </div>
    </PublicShell>
  )
}
