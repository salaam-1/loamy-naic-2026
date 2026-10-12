import type { PlatformRole } from '@/lib/types'

/** Service bookings (warehouse + logistics). NO payment fields exist — dates,
 * details, and status only; arrangements conclude off-platform. */

/** Roles that request bookings (everyone who browses the directory except the
 * two service-owner roles). */
export const BOOKER_ROLES: PlatformRole[] = ['farmer', 'trader', 'exporter', 'buyer', 'input_supplier']
export const SERVICE_OWNER_ROLES: PlatformRole[] = ['warehouse_owner', 'logistics_provider']

export type BookingStatus = 'requested' | 'accepted' | 'declined' | 'completed' | 'cancelled'

export const BOOKING_STATUS_META: Record<BookingStatus, { label: string; chip: string }> = {
  requested: { label: 'Requested', chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  accepted: { label: 'Accepted - contact available', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  declined: { label: 'Declined', chip: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  completed: { label: 'Completed', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  cancelled: { label: 'Cancelled', chip: 'bg-emerald-950/5 text-emerald-900/50' },
}

export interface ServiceBooking {
  id: string
  directory_id: string
  booker_id: string
  service_type: 'warehouse' | 'logistics'
  start_date: string
  end_date: string | null
  details: string
  status: BookingStatus
  owner_response: string | null
  created_at: string
  updated_at: string
  /** PostgREST embed of the target directory entry (nullable). */
  directory?: {
    id: string
    business_name: string
    service_type: 'warehouse' | 'logistics'
    state: string
    lga: string | null
    owner_id: string
  } | null
}
