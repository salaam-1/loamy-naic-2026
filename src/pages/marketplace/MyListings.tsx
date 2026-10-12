import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Pencil, Plus, Tags, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  fetchPublicProfiles,
  listingPhotoUrl,
  INTEREST_STATUS_META,
  LISTING_STATUS_META,
  type Listing,
  type ListingInterest,
  type PublicProfile,
} from '@/lib/marketplace'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { SellerCard } from '@/components/SellerCard'
import { ListingImage } from '@/components/ListingImage'
import { ContactReveal } from '@/components/ContactReveal'
import { RecordSettlement } from '@/components/RecordSettlement'
import { NoteDialog } from '@/components/NoteDialog'

/**
 * Seller workspace: own listings (all statuses), status toggles, and the
 * per-listing interests inbox with accept/decline → contact reveal →
 * mark-concluded. Deals conclude off-platform on bank rails.
 */
export default function MyListings() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [interests, setInterests] = useState<ListingInterest[]>([])
  const [buyers, setBuyers] = useState<Record<string, PublicProfile>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [responding, setResponding] = useState<{ interest: ListingInterest; status: 'accepted' | 'declined' } | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    const { data: mine } = await supabase
      .from('listings')
      .select('*')
      .eq('seller_id', profile.id)
      .order('created_at', { ascending: false })
    const rows = (mine as Listing[]) ?? []
    setListings(rows)
    if (rows.length > 0) {
      const { data: ints } = await supabase
        .from('listing_interests')
        .select('*')
        .in('listing_id', rows.map((l) => l.id))
        .order('created_at', { ascending: false })
      const interestRows = (ints as ListingInterest[]) ?? []
      setInterests(interestRows)
      setBuyers(await fetchPublicProfiles(interestRows.map((i) => i.buyer_id)))
    } else {
      setInterests([])
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  async function setStatus(listing: Listing, status: Listing['status']) {
    setBusy(listing.id)
    await supabase.from('listings').update({ status }).eq('id', listing.id)
    setBusy(null)
    await load()
  }

  async function removeListing(listing: Listing) {
    if (!window.confirm(`Delete "${listing.commodity}" permanently?`)) return
    await supabase.from('listings').delete().eq('id', listing.id)
    await load()
  }

  function respond(interest: ListingInterest, status: 'accepted' | 'declined') {
    setResponding({ interest, status })
  }

  async function submitResponse(note: string | null) {
    if (!responding) return
    const { interest, status } = responding
    const { error } = await supabase
      .from('listing_interests')
      .update({ status, seller_response: note })
      .eq('id', interest.id)
    if (error) throw new Error(error.message)
    await load()
  }

  async function conclude(interest: ListingInterest) {
    setBusy(interest.id)
    await supabase
      .from('listing_interests')
      .update({ status: 'concluded_externally' })
      .eq('id', interest.id)
    setBusy(null)
    await load()
  }

  const role = profile?.platform_role

  // Defined once and rendered in EVERY state. RoleDashboard suppresses its own
  // page title for this section on the promise that the section always supplies
  // one; a loading or empty page is still a page, and it still needs a name.
  const heading = (
    <h1 className="text-lg font-semibold text-emerald-950">
      My listings
      {listings ? <span className="text-sm font-normal text-emerald-900/50"> ({listings.length})</span> : null}
    </h1>
  )

  if (listings === null) {
    return (
      <div className="space-y-4">
        {heading}
        <div className="h-40 animate-pulse rounded-card bg-white" aria-label="Loading listings" />
      </div>
    )
  }

  if (listings.length === 0) {
    return (
      <div className="space-y-4">
        {heading}
        <EmptyState
          icon={Tags}
          title="Create your first listing"
          body="List your produce or inputs with photos and a price. Buyers express interest - you accept, exchange contacts, and conclude through your bank. No payments happen on Loamy."
          action={{ label: 'Create listing', onClick: () => navigate(`/dashboard/${role}/my-listings/new`) }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {heading}
        <Button onClick={() => navigate(`/dashboard/${role}/my-listings/new`)}>
          <Plus className="h-4 w-4" aria-hidden /> New listing
        </Button>
      </div>

      <div className="space-y-4">
        {listings.map((l) => {
          const listingInterests = interests.filter((i) => i.listing_id === l.id)
          const openCount = listingInterests.filter((i) => i.status === 'open').length
          const meta = LISTING_STATUS_META[l.status]
          return (
            <Card key={l.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <ListingImage path={l.photos[0]} listingType={l.listing_type} className="h-16 w-16 shrink-0 rounded" />
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-emerald-950">
                      {l.commodity}
                      <span className={cn('rounded px-2 py-0.5 text-[11px] font-medium', meta.chip)}>{meta.label}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-900/55">
                      {Number(l.quantity_kg)} {l.unit} · {formatNaira(Number(l.price_per_unit))}/{l.unit} · {l.state} · {formatDateShort(l.created_at)}
                    </p>
                    {openCount > 0 && (
                      <p className="mt-1 text-xs font-semibold text-gold-600">
                        {openCount} open interest{openCount > 1 ? 's' : ''} awaiting your response
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {l.status === 'active' && (
                    <Button size="sm" variant="outline" disabled={busy === l.id} onClick={() => setStatus(l, 'paused')}>Pause</Button>
                  )}
                  {l.status === 'paused' && (
                    <Button size="sm" variant="outline" disabled={busy === l.id} onClick={() => setStatus(l, 'active')}>Activate</Button>
                  )}
                  {(l.status === 'active' || l.status === 'paused') && (
                    <Button size="sm" variant="outline" disabled={busy === l.id} onClick={() => setStatus(l, 'sold')}>Mark sold</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/dashboard/${role}/my-listings/${l.id}/edit`)} aria-label="Edit listing">
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeListing(l)} aria-label="Delete listing">
                    <Trash2 className="h-3.5 w-3.5 text-red-500" aria-hidden />
                  </Button>
                </div>
              </div>

              {listingInterests.length > 0 && (
                <div className="mt-4 space-y-3 border-t border-emerald-950/5 pt-4">
                  {listingInterests.map((i) => {
                    const iMeta = INTEREST_STATUS_META[i.status]
                    return (
                      <div key={i.id} className="rounded-lg border border-emerald-100 p-3.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <SellerCard profile={buyers[i.buyer_id]} compact />
                            <p className="mt-1.5 text-xs text-emerald-900/60">
                              {i.quantity_wanted ? `Wants ${Number(i.quantity_wanted)} ${l.unit}` : 'Quantity not specified'} · {formatDateShort(i.created_at)}
                            </p>
                            {i.message && <p className="mt-1 text-xs italic text-emerald-900/55">“{i.message}”</p>}
                          </div>
                          <span className={cn('rounded px-2.5 py-1 text-xs font-medium', iMeta.chip)}>{iMeta.label}</span>
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          {i.status === 'open' && (
                            <>
                              <Button size="sm" disabled={busy === i.id} onClick={() => respond(i, 'accepted')}>
                                <Check className="h-3.5 w-3.5" aria-hidden /> Accept
                              </Button>
                              <Button size="sm" variant="outline" disabled={busy === i.id} onClick={() => respond(i, 'declined')}>
                                <X className="h-3.5 w-3.5" aria-hidden /> Decline
                              </Button>
                            </>
                          )}
                          {i.status === 'accepted' && (
                            <>
                              <ContactReveal interestId={i.id} viewer="seller" />
                              <Button size="sm" variant="outline" disabled={busy === i.id} onClick={() => conclude(i)}>
                                Mark concluded
                              </Button>
                            </>
                          )}
                          {i.status === 'concluded_externally' && (
                            <RecordSettlement interestId={i.id} onDone={() => void load()} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      <NoteDialog
        open={!!responding}
        onClose={() => setResponding(null)}
        title={responding?.status === 'declined' ? 'Decline interest' : 'Accept interest'}
        label={responding?.status === 'declined' ? 'Reason (optional)' : 'Note to the buyer (optional)'}
        placeholder={responding?.status === 'declined' ? 'Let them know why' : 'Any details for the buyer'}
        submitLabel={responding?.status === 'declined' ? 'Decline' : 'Accept'}
        onSubmit={submitResponse}
      />
    </div>
  )
}
