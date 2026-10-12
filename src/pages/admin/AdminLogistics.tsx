import { useEffect, useState } from 'react'
import { Truck, Warehouse } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import { BOOKING_STATUS_META, type ServiceBooking } from '@/lib/booking'
import { cn, formatDateShort } from '@/lib/utils'
import { StatCard } from '@/components/StatCard'
import { DashboardCard } from '@/components/DashboardCard'

interface DirectoryEntry {
  id: string
  owner_id: string
  service_type: 'warehouse' | 'logistics'
  business_name: string
  state: string
  lga: string | null
  created_at: string
}

/** Logistics & shipments oversight: warehouse/logistics directory + bookings. */
export default function AdminLogistics() {
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null)
  const [bookings, setBookings] = useState<ServiceBooking[]>([])
  const [owners, setOwners] = useState<Record<string, PublicProfile>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: dir }, { data: bk }] = await Promise.all([
        supabase.from('service_directory').select('id, owner_id, service_type, business_name, state, lga, created_at').order('created_at', { ascending: false }),
        supabase.from('service_bookings').select('*').order('created_at', { ascending: false }).limit(200),
      ])
      if (cancelled) return
      const e = (dir as DirectoryEntry[]) ?? []
      setEntries(e)
      setBookings((bk as ServiceBooking[]) ?? [])
      setOwners(await fetchPublicProfiles(e.map((x) => x.owner_id)))
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const warehouses = (entries ?? []).filter((e) => e.service_type === 'warehouse').length
  const logistics = (entries ?? []).filter((e) => e.service_type === 'logistics').length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Warehouse} label="Warehouses" value={warehouses} sub="in directory" loading={!entries} />
        <StatCard icon={Truck} label="Logistics providers" value={logistics} sub="in directory" loading={!entries} />
        <StatCard icon={Truck} label="Bookings" value={bookings.length} sub="all time" loading={!entries} />
        <StatCard icon={Truck} label="Active bookings" value={bookings.filter((b) => ['requested', 'accepted'].includes(b.status)).length} sub="open / accepted" loading={!entries} />
      </div>

      <DashboardCard title="Service directory">
        {entries && entries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-2 pr-4 font-medium">Business</th>
                  <th className="py-2 pr-4 font-medium">Owner</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 font-medium">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-4 font-medium text-emerald-950">{e.business_name}</td>
                    <td className="py-2 pr-4 text-emerald-900/70">{owners[e.owner_id]?.full_name ?? '-'}</td>
                    <td className="py-2 pr-4"><span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700">{e.service_type}</span></td>
                    <td className="py-2 text-emerald-900/70">{[e.lga, e.state].filter(Boolean).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-2 text-sm text-emerald-900/55">No directory entries yet.</p>
        )}
      </DashboardCard>

      <DashboardCard title="Recent bookings">
        {bookings.length === 0 ? (
          <p className="py-2 text-sm text-emerald-900/55">No bookings yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-line">
              {bookings.slice(0, 20).map((b) => (
                <tr key={b.id}>
                  <td className="py-2 pr-4 text-emerald-900/70">{b.service_type}</td>
                  <td className="py-2 pr-4 text-emerald-900/70">{formatDateShort(b.start_date)}{b.end_date ? ` → ${formatDateShort(b.end_date)}` : ''}</td>
                  <td className="py-2"><span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', BOOKING_STATUS_META[b.status].chip)}>{BOOKING_STATUS_META[b.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DashboardCard>
    </div>
  )
}
