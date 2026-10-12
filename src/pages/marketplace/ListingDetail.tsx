import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Handshake, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  fetchPublicProfiles,
  listingPhotoUrl,
  INTEREST_ROLES,
  INTEREST_STATUS_META,
  type Listing,
  type ListingInterest,
  type PublicProfile,
} from '@/lib/marketplace'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { ListingImage } from '@/components/ListingImage'
import { RoleShell } from '@/pages/shared/RoleShell'
import { MarketPricesPanel } from '@/components/MarketPricesPanel'
import { SellerCard } from '@/components/SellerCard'
import { useT } from '@/lib/i18n'
import { BuyBox } from '@/components/BuyBox'
import { RelatedListings } from '@/components/RelatedListings'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DashboardCard } from '@/components/DashboardCard'

export default function ListingDetail() {
  const { t } = useT()
  const { listingId } = useParams()
  const { profile } = useAuth()
  const [listing, setListing] = useState<Listing | null | 'missing'>(null)
  const [seller, setSeller] = useState<PublicProfile | undefined>()
  const [photoIndex, setPhotoIndex] = useState(0)
  const [myInterest, setMyInterest] = useState<ListingInterest | null>(null)
  const [qty, setQty] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    if (!listingId || !profile) return
    const [listingRes, interestRes] = await Promise.all([
      supabase.from('listings').select('*').eq('id', listingId).maybeSingle(),
      supabase
        .from('listing_interests')
        .select('*')
        .eq('listing_id', listingId)
        .eq('buyer_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const l = listingRes.data as Listing | null
    setListing(l ?? 'missing')
    setMyInterest((interestRes.data as ListingInterest) ?? null)
    if (l) {
      const profiles = await fetchPublicProfiles([l.seller_id])
      setSeller(profiles[l.seller_id])
    }
  }, [listingId, profile])

  useEffect(() => {
    void load()
  }, [load])

  async function expressInterest(e: FormEvent) {
    e.preventDefault()
    if (!profile || !listing || listing === 'missing') return
    setError(null)
    setSending(true)
    const { error: insErr } = await supabase.from('listing_interests').insert({
      listing_id: listing.id,
      buyer_id: profile.id,
      quantity_wanted: qty === '' ? null : Number(qty),
      message: message.trim() || null,
    })
    setSending(false)
    if (insErr) {
      setError(insErr.message)
      return
    }
    setQty('')
    setMessage('')
    await load()
  }

  const role = profile?.platform_role
  const isOwn = listing !== null && listing !== 'missing' && listing.seller_id === profile?.id
  // Buyers/traders/exporters express interest in anything; farmers in INPUTS only.
  const canExpress =
    role &&
    role !== 'bank' &&
    INTEREST_ROLES.includes(role) &&
    listing !== null &&
    listing !== 'missing' &&
    !isOwn &&
    (role !== 'farmer' || listing.listing_type === 'input')

  return (
    <RoleShell section="marketplace">
      {listing === null ? (
        <div className="h-40 animate-pulse rounded-card bg-white" aria-label={t('marketplace.loadingListing')} />
      ) : listing === 'missing' ? (
        <Card className="p-8 text-center text-sm text-emerald-900/60">
          {t('marketplace.listingNoLongerAvailable')}
        </Card>
      ) : (
        <div className="space-y-4">
          <Link
            to={`/dashboard/${role}/marketplace`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('marketplace.backToMarketplace')}
          </Link>

          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              {/* Photos */}
              <Card className="overflow-hidden">
                <ListingImage path={listing.photos[photoIndex] ?? listing.photos[0]} listingType={listing.listing_type} alt={listing.commodity} className="h-72" />
                {listing.photos.length > 1 && (
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
                  <div>
                    <h1 className="text-xl font-bold text-emerald-950">{listing.commodity}</h1>
                    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-900/55">
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {[listing.lga, listing.state].filter(Boolean).join(', ')} · listed {formatDateShort(listing.created_at)}
                      {listing.available_from ? ` · available from ${formatDateShort(listing.available_from)}` : ''}
                    </p>
                  </div>
                  <span className="rounded bg-emerald-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                    {listing.listing_type}
                  </span>
                </div>
                <p className="font-mono text-xl font-semibold text-emerald-800">
                  {formatNaira(Number(listing.price_per_unit))}
                  <span className="text-sm font-normal text-emerald-900/50">/{listing.unit}</span>
                </p>
                <p className="text-sm text-emerald-900/70">
                  {t('marketplace.quantityAvailableLabel')}{' '}
                  <span className="font-semibold">{Number(listing.quantity_kg)} {listing.unit}</span>
                </p>
                {listing.description && (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-emerald-900/70">{listing.description}</p>
                )}
              </Card>
            </div>

            <div className="space-y-4">
              {!isOwn && (
                <BuyBox
                  listingId={listing.id}
                  unit={listing.unit}
                  price={Number(listing.price_per_unit)}
                  availableQty={Number(listing.quantity_kg)}
                />
              )}

              <DashboardCard title={t('marketplace.seller')}>
                <SellerCard profile={seller} />
                <p className="mt-3 text-xs leading-relaxed text-emerald-900/50">
                  {t('marketplace.contactAfterAccept')}
                </p>
              </DashboardCard>

              {isOwn ? (
                <Card className="p-4 text-sm text-emerald-900/60">
                  {t('marketplace.thisIsYourListing')}{' '}
                  <Link to={`/dashboard/${role}/my-listings`} className="font-semibold text-emerald-700">
                    {t('marketplace.myListings')}
                  </Link>.
                </Card>
              ) : myInterest && ['open', 'accepted'].includes(myInterest.status) ? (
                <DashboardCard title={t('marketplace.yourInterest')}>
                  <span className={cn('rounded px-2.5 py-1 text-xs font-medium', INTEREST_STATUS_META[myInterest.status].chip)}>
                    {INTEREST_STATUS_META[myInterest.status].label}
                  </span>
                  <p className="mt-3 text-xs text-emerald-900/55">
                    {t('marketplace.trackItUnder')}{' '}
                    <Link to={`/dashboard/${role}/my-interests`} className="font-semibold text-emerald-700">
                      {t('marketplace.myInterests')}
                    </Link>.
                  </p>
                </DashboardCard>
              ) : canExpress ? (
                <DashboardCard title={t('marketplace.expressInterest')}>
                  <p className="mb-2.5 text-xs leading-relaxed text-emerald-900/55">
                    {t('marketplace.preferToNegotiate')}{' '}
                    {t('marketplace.settleOnBankRails')}
                  </p>
                  <form onSubmit={expressInterest} className="space-y-3" noValidate>
                    <div>
                      <Label htmlFor="qty">{t('marketplace.quantityWanted', { unit: listing.unit })}</Label>
                      <Input id="qty" type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`e.g. ${Number(listing.quantity_kg)}`} />
                    </div>
                    <div>
                      <Label htmlFor="msg">{t('marketplace.messageToSeller')}</Label>
                      <Textarea id="msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('marketplace.introduceYourself')} />
                    </div>
                    {error && <p className="text-xs text-red-700">{error}</p>}
                    <Button type="submit" className="w-full" loading={sending}>
                      <Handshake className="h-4 w-4" aria-hidden /> {t('marketplace.expressInterest')}
                    </Button>
                    <p className="text-[11px] leading-relaxed text-emerald-900/45">
                      {t('marketplace.noPaymentOnLoamy')}
                    </p>
                  </form>
                </DashboardCard>
              ) : (
                <Card className="p-4 text-xs leading-relaxed text-emerald-900/55">
                  {role === 'farmer'
                    ? t('marketplace.farmersInputListings')
                    : t('marketplace.roleBrowsesOnly')}
                </Card>
              )}

              <MarketPricesPanel commodity={listing.listing_type === 'commodity' ? listing.commodity : undefined} />
            </div>
          </div>

          <RelatedListings
            commodity={listing.commodity}
            excludeId={listing.id}
            linkTo={(lid) => `/dashboard/${role}/marketplace/listing/${lid}`}
          />
        </div>
      )}
    </RoleShell>
  )
}
