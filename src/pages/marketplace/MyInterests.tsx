import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Handshake } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  INTEREST_STATUS_META,
  type ListingInterest,
} from '@/lib/marketplace'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { ContactReveal } from '@/components/ContactReveal'
import { RecordSettlement } from '@/components/RecordSettlement'

/**
 * Buyer workspace: sent interests with statuses; post-acceptance contact
 * reveal; mark-concluded. The no-payment replacement for "orders".
 */
export default function MyInterests() {
  const { profile } = useAuth()
  const [interests, setInterests] = useState<ListingInterest[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('listing_interests')
      .select('*, listing:listings(*), directory:service_directory(*)')
      .eq('buyer_id', profile.id)
      .order('created_at', { ascending: false })
    setInterests((data as ListingInterest[]) ?? [])
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  async function setStatus(i: ListingInterest, status: 'withdrawn' | 'concluded_externally') {
    setBusy(i.id)
    await supabase.from('listing_interests').update({ status }).eq('id', i.id)
    setBusy(null)
    await load()
  }

  const role = profile?.platform_role

  // Defined once and rendered in EVERY state. RoleDashboard suppresses its own
  // page title for this section on the promise that the section always supplies
  // one; a loading or empty page is still a page, and it still needs a name.
  const heading = (
    <h1 className="text-lg font-semibold text-emerald-950">
      My interests
      {interests ? <span className="text-sm font-normal text-emerald-900/50"> ({interests.length})</span> : null}
    </h1>
  )

  if (interests === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {heading}
        <div className="h-40 animate-pulse rounded-card bg-white" aria-label="Loading interests" />
      </div>
    )
  }

  if (interests.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {heading}
        <EmptyState
          icon={Handshake}
          title="No interests yet"
          body="Browse the marketplace and express interest in a listing. When the seller accepts, you exchange contacts and conclude the deal directly through your bank."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {heading}
      {interests.map((i) => {
        const meta = INTEREST_STATUS_META[i.status]
        const label = i.listing?.commodity ?? i.directory?.business_name ?? 'Listing unavailable'
        const unit = i.listing?.unit ?? 'kg'
        return (
          <Card key={i.id} className="space-y-2.5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-emerald-950">
                  {i.listing ? (
                    <Link to={`/dashboard/${role}/marketplace/listing/${i.listing.id}`} className="hover:text-emerald-700">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                  {i.directory && (
                    <span className="ml-2 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                      {i.directory.service_type}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-emerald-900/55">
                  {i.quantity_wanted ? `Wanted ${Number(i.quantity_wanted)} ${unit} · ` : ''}
                  {i.listing ? `${formatNaira(Number(i.listing.price_per_unit))}/${i.listing.unit} · ` : ''}
                  sent {formatDateShort(i.created_at)}
                </p>
                {i.message && <p className="mt-1 text-xs italic text-emerald-900/55">“{i.message}”</p>}
                {i.seller_response && (
                  <p className="mt-1 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                    Seller: {i.seller_response}
                  </p>
                )}
              </div>
              <span className={cn('rounded px-2.5 py-1 text-xs font-medium', meta.chip)}>{meta.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {i.status === 'open' && (
                <Button size="sm" variant="outline" disabled={busy === i.id} onClick={() => setStatus(i, 'withdrawn')}>
                  Withdraw
                </Button>
              )}
              {i.status === 'accepted' && (
                <>
                  <ContactReveal interestId={i.id} viewer="buyer" />
                  <Button size="sm" variant="outline" disabled={busy === i.id} onClick={() => setStatus(i, 'concluded_externally')}>
                    Mark concluded
                  </Button>
                </>
              )}
              {i.status === 'concluded_externally' && (
                <RecordSettlement interestId={i.id} onDone={() => void load()} />
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
