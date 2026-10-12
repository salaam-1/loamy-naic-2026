import { useCallback, useEffect, useState } from 'react'
import { Building2, CalendarPlus, Handshake, MapPin, Truck, Warehouse } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { NIGERIA_STATES } from '@/lib/nigeria'
import {
  fetchPublicProfiles,
  INTEREST_STATUS_META,
  type DirectoryEntry,
  type ListingInterest,
  type PublicProfile,
} from '@/lib/marketplace'
import { SERVICE_OWNER_ROLES } from '@/lib/booking'
import { cn, formatDateShort } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/EmptyState'
import { SellerCard } from '@/components/SellerCard'
import { ContactReveal } from '@/components/ContactReveal'
import { BookingRequestForm } from '@/components/BookingRequestForm'

/**
 * Warehouse & logistics directory: browsable by everyone signed in; contact
 * exchange follows the same interest→accept pattern as listings. Booking
 * workflows are a later stage — this is deliberately browse + connect only.
 */
export default function Directory() {
  const { profile } = useAuth()
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null)
  const [owners, setOwners] = useState<Record<string, PublicProfile>>({})
  const [myInterests, setMyInterests] = useState<ListingInterest[]>([])
  const [typeFilter, setTypeFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [openForm, setOpenForm] = useState<string | null>(null)
  const [bookingFor, setBookingFor] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Service owners don't book services; everyone else may.
  const canBook = profile?.platform_role != null && !SERVICE_OWNER_ROLES.includes(profile.platform_role as never)

  const load = useCallback(async () => {
    let query = supabase.from('service_directory').select('*').order('created_at', { ascending: false })
    if (typeFilter) query = query.eq('service_type', typeFilter)
    if (stateFilter) query = query.eq('state', stateFilter)
    const [{ data }, interestsRes] = await Promise.all([
      query,
      profile
        ? supabase.from('listing_interests').select('*').eq('buyer_id', profile.id).not('directory_id', 'is', null)
        : Promise.resolve({ data: [] }),
    ])
    const rows = (data as DirectoryEntry[]) ?? []
    setEntries(rows)
    setMyInterests((interestsRes.data as ListingInterest[]) ?? [])
    setOwners(await fetchPublicProfiles(rows.map((e) => e.owner_id)))
  }, [typeFilter, stateFilter, profile])

  useEffect(() => {
    void load()
  }, [load])

  async function requestContact(entry: DirectoryEntry) {
    if (!profile) return
    setError(null)
    setBusy(true)
    const { error: insErr } = await supabase.from('listing_interests').insert({
      directory_id: entry.id,
      buyer_id: profile.id,
      message: message.trim() || null,
    })
    setBusy(false)
    if (insErr) {
      setError(insErr.message)
      return
    }
    setOpenForm(null)
    setMessage('')
    await load()
  }

  // Defined once and rendered in EVERY state. RoleDashboard suppresses its own
  // page title for this section on the promise that the section always supplies
  // one; a loading or empty page is still a page, and it still needs a name.
  const heading = <h1 className="mr-auto text-lg font-semibold text-emerald-950">Service directory</h1>

  if (entries === null) {
    return (
      <div className="space-y-4">
        {heading}
        <div className="h-40 animate-pulse rounded-card bg-white" aria-label="Loading directory" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {heading}
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-40" aria-label="Filter by service type">
          <option value="">All services</option>
          <option value="warehouse">Warehouses</option>
          <option value="logistics">Logistics</option>
        </Select>
        <Select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="w-40" aria-label="Filter by state">
          <option value="">All states</option>
          {NIGERIA_STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No directory entries yet"
          body="Warehouse owners and logistics providers appear here as they register their services. Check back soon."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => {
            const Icon = entry.service_type === 'warehouse' ? Warehouse : Truck
            const isOwn = entry.owner_id === profile?.id
            const existing = myInterests.find(
              (i) => i.directory_id === entry.id && ['open', 'accepted'].includes(i.status),
            )
            return (
              <Card key={entry.id} className="flex h-full flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                    {entry.service_type}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-emerald-950">{entry.business_name}</p>
                  <p className="text-xs text-emerald-900/55">
                    {[entry.lga, entry.state].filter(Boolean).join(', ')} · joined {formatDateShort(entry.created_at)}
                  </p>
                </div>
                {entry.address && (
                  <p className="flex items-start gap-1.5 text-xs leading-relaxed text-emerald-900/60">
                    <MapPin className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-700" strokeWidth={1.5} aria-hidden />
                    {entry.address}
                  </p>
                )}
                {entry.capacity_note && <p className="text-xs leading-relaxed text-emerald-900/60">{entry.capacity_note}</p>}
                {entry.routes_note && <p className="text-xs leading-relaxed text-emerald-900/60">Routes: {entry.routes_note}</p>}
                <div className="mt-auto space-y-2.5 border-t border-emerald-950/5 pt-3">
                  <SellerCard profile={owners[entry.owner_id]} compact />
                  {isOwn ? (
                    <p className="text-[11px] text-emerald-900/45">This is your entry - edit it under My Directory Listing.</p>
                  ) : bookingFor === entry.id ? (
                    <BookingRequestForm
                      entry={entry}
                      onDone={() => { setBookingFor(null); void load() }}
                      onCancel={() => setBookingFor(null)}
                    />
                  ) : existing ? (
                    existing.status === 'accepted' ? (
                      <ContactReveal interestId={existing.id} viewer="buyer" />
                    ) : (
                      <span className={cn('inline-block rounded px-2.5 py-1 text-xs font-medium', INTEREST_STATUS_META[existing.status].chip)}>
                        {INTEREST_STATUS_META[existing.status].label}
                      </span>
                    )
                  ) : openForm === entry.id ? (
                    <div className="space-y-2">
                      <Label htmlFor={`msg-${entry.id}`}>Message</Label>
                      <Textarea id={`msg-${entry.id}`} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What do you need stored or moved?" />
                      {error && <p className="text-xs text-red-700">{error}</p>}
                      <div className="flex gap-2">
                        <Button size="sm" loading={busy} onClick={() => requestContact(entry)}>Send</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setOpenForm(null); setError(null) }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {canBook && (
                        <Button size="sm" onClick={() => { setBookingFor(entry.id); setOpenForm(null) }}>
                          <CalendarPlus className="h-3.5 w-3.5" aria-hidden /> Request booking
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => { setOpenForm(entry.id); setBookingFor(null); setMessage('') }}>
                        <Handshake className="h-3.5 w-3.5" aria-hidden /> Contact only
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
