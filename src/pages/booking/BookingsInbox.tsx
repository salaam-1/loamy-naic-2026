import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import { BOOKING_STATUS_META, type ServiceBooking } from '@/lib/booking'
import { cn, formatDateShort } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { SellerCard } from '@/components/SellerCard'
import { ContactReveal } from '@/components/ContactReveal'
import { NoteDialog } from '@/components/NoteDialog'

/** Service owner's inbox: booking requests on their directory entry. Accept /
 * decline / mark completed; contact revealed on acceptance. No payment. */
export default function BookingsInbox() {
  const { profile } = useAuth()
  const [bookings, setBookings] = useState<ServiceBooking[] | null>(null)
  const [bookers, setBookers] = useState<Record<string, PublicProfile>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [responding, setResponding] = useState<{ b: ServiceBooking; status: 'accepted' | 'declined' } | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    // RLS returns only bookings on directory entries this owner owns.
    const { data } = await supabase
      .from('service_bookings')
      .select('*, directory:service_directory(id, business_name, service_type, state, lga, owner_id)')
      .order('created_at', { ascending: false })
    const rows = ((data as ServiceBooking[]) ?? []).filter((b) => b.directory?.owner_id === profile.id)
    setBookings(rows)
    setBookers(await fetchPublicProfiles(rows.map((b) => b.booker_id)))
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  async function respond(b: ServiceBooking, status: 'accepted' | 'declined' | 'completed') {
    // Accept / decline capture an optional note via a dialog; completed is direct.
    if (status === 'accepted' || status === 'declined') {
      setResponding({ b, status })
      return
    }
    setBusy(b.id)
    await supabase.from('service_bookings').update({ status }).eq('id', b.id)
    setBusy(null)
    await load()
  }

  async function submitResponse(note: string | null) {
    if (!responding) return
    const { b, status } = responding
    const { error } = await supabase
      .from('service_bookings')
      .update({ status, ...(note ? { owner_response: note } : {}) })
      .eq('id', b.id)
    if (error) throw new Error(error.message)
    await load()
  }

  const pending = bookings?.filter((b) => b.status === 'requested').length ?? 0

  // Defined once and rendered in EVERY state. RoleDashboard suppresses its own
  // page title for this section on the promise that the section always supplies
  // one; a loading or empty page is still a page, and it still needs a name.
  const heading = (
    <h1 className="text-base font-semibold text-emerald-950">
      Bookings
      {bookings ? <span className="font-mono text-sm font-normal text-emerald-900/50"> {bookings.length}</span> : null}
      {pending > 0 && <span className="ml-2 text-xs font-normal text-gold-600">{pending} awaiting response</span>}
    </h1>
  )

  if (bookings === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        {heading}
        <div className="h-32 animate-pulse rounded bg-white" aria-label="Loading bookings" />
      </div>
    )
  }
  if (bookings.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        {heading}
        <EmptyState
          icon={CalendarCheck}
          title="No booking requests yet"
          body="Requests for your service appear here. Publish a directory entry so members can find and book you."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {heading}
      {bookings.map((b) => {
        const meta = BOOKING_STATUS_META[b.status]
        return (
          <Card key={b.id} className="space-y-2.5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <SellerCard profile={bookers[b.booker_id]} compact />
                <p className="mt-1 text-xs text-emerald-900/55">
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700">{b.service_type}</span>
                  {' '}{formatDateShort(b.start_date)}{b.end_date ? ` → ${formatDateShort(b.end_date)}` : ''} · requested {formatDateShort(b.created_at)}
                </p>
                <p className="mt-1 text-xs italic text-emerald-900/55">“{b.details}”</p>
              </div>
              <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', meta.chip)}>{meta.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {b.status === 'requested' && (
                <>
                  <Button size="sm" disabled={busy === b.id} onClick={() => respond(b, 'accepted')}>
                    <Check className="h-3.5 w-3.5" aria-hidden /> Accept
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy === b.id} onClick={() => respond(b, 'declined')}>
                    <X className="h-3.5 w-3.5" aria-hidden /> Decline
                  </Button>
                </>
              )}
              {b.status === 'accepted' && (
                <>
                  <ContactReveal interestId={b.id} viewer="owner" variant="booking" />
                  <Button size="sm" variant="outline" disabled={busy === b.id} onClick={() => respond(b, 'completed')}>
                    Mark completed
                  </Button>
                </>
              )}
              {b.status === 'completed' && (
                <ContactReveal interestId={b.id} viewer="owner" variant="booking" />
              )}
            </div>
          </Card>
        )
      })}

      <NoteDialog
        open={!!responding}
        onClose={() => setResponding(null)}
        title={responding?.status === 'declined' ? 'Decline booking' : 'Accept booking'}
        label={responding?.status === 'declined' ? 'Reason (optional)' : 'Note to the booker (optional)'}
        placeholder={responding?.status === 'declined' ? 'Let them know why' : 'Any details for the booker'}
        submitLabel={responding?.status === 'declined' ? 'Decline' : 'Accept'}
        onSubmit={submitResponse}
      />
    </div>
  )
}
