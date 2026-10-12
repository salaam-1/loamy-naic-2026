import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { BOOKING_STATUS_META, type ServiceBooking } from '@/lib/booking'
import { cn, formatDateShort } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { ContactReveal } from '@/components/ContactReveal'

/** Booker's view: booking requests they sent, with status, contact reveal on
 * acceptance, and cancel. No payment anywhere — arrangements conclude off-platform. */
export default function MyBookings() {
  const { profile } = useAuth()
  const [bookings, setBookings] = useState<ServiceBooking[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('service_bookings')
      .select('*, directory:service_directory(id, business_name, service_type, state, lga, owner_id)')
      .eq('booker_id', profile.id)
      .order('created_at', { ascending: false })
    setBookings((data as ServiceBooking[]) ?? [])
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  async function cancel(b: ServiceBooking) {
    setBusy(b.id)
    await supabase.from('service_bookings').update({ status: 'cancelled' }).eq('id', b.id)
    setBusy(null)
    await load()
  }

  const role = profile?.platform_role

  // Defined once and rendered in EVERY state. RoleDashboard suppresses its own
  // page title for this section on the promise that the section always supplies
  // one; a loading or empty page is still a page, and it still needs a name.
  const heading = (
    <h1 className="text-base font-semibold text-emerald-950">
      My bookings
      {bookings ? <span className="font-mono text-sm font-normal text-emerald-900/50"> {bookings.length}</span> : null}
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
          icon={CalendarClock}
          title="No bookings yet"
          body="Request a warehouse or logistics booking from the directory."
          action={{ label: 'Open directory', onClick: () => { window.location.href = `/dashboard/${role}/directory` } }}
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
          <Card key={b.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-emerald-950">
                  {b.directory?.business_name ?? 'Service'}
                  <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700">{b.service_type}</span>
                </p>
                <p className="mt-0.5 text-xs text-emerald-900/55">
                  {formatDateShort(b.start_date)}{b.end_date ? ` → ${formatDateShort(b.end_date)}` : ''}
                  {b.directory ? ` · ${[b.directory.lga, b.directory.state].filter(Boolean).join(', ')}` : ''}
                </p>
                <p className="mt-1 text-xs italic text-emerald-900/55">“{b.details}”</p>
                {b.owner_response && (
                  <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">Owner: {b.owner_response}</p>
                )}
              </div>
              <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', meta.chip)}>{meta.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(b.status === 'accepted' || b.status === 'completed') && (
                <ContactReveal interestId={b.id} viewer="booker" variant="booking" />
              )}
              {(b.status === 'requested' || b.status === 'accepted') && (
                <Button size="sm" variant="outline" disabled={busy === b.id} onClick={() => cancel(b)}>Cancel</Button>
              )}
            </div>
          </Card>
        )
      })}
      <p className="text-[11px] text-emerald-900/45">
        Browse more services in the <Link to={`/dashboard/${role}/directory`} className="font-medium text-emerald-700">directory</Link>.
      </p>
    </div>
  )
}
