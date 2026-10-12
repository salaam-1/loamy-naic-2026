import type { ComponentType } from 'react'
import type { PlatformRole } from '@/lib/types'
import {
  DIRECTORY_OWNER_ROLES,
  INTEREST_ROLES,
  MARKETPLACE_ROLES,
  SELLER_ROLES,
} from '@/lib/marketplace'
import { BOOKER_ROLES, SERVICE_OWNER_ROLES } from '@/lib/booking'
import MarketplaceHome from '@/pages/marketplace/MarketplaceHome'
import MyListings from '@/pages/marketplace/MyListings'
import MyInterests from '@/pages/marketplace/MyInterests'
import Directory from '@/pages/marketplace/Directory'
import MyDirectoryListing from '@/pages/marketplace/MyDirectoryListing'
import MyBookings from '@/pages/booking/MyBookings'
import BookingsInbox from '@/pages/booking/BookingsInbox'
import Settings from '@/pages/shared/Settings'
import Profile from '@/pages/shared/Profile'
import Support from '@/pages/shared/Support'
import Notifications from '@/pages/shared/Notifications'
import FinancialActivity from '@/pages/shared/FinancialActivity'
import MyStock from '@/pages/shared/MyStock'
import PrivacySettings from '@/pages/shared/PrivacySettings'
import OpenRfqs from '@/pages/supplier/OpenRfqs'
import TransportBoard from '@/pages/supplier/TransportBoard'
import WarehouseInbox from '@/pages/supplier/WarehouseInbox'

/** Roles that can supply a procuring company and therefore bid on open buy
 *  requests. `buyer` is the legacy half of the merged Trader & Buyer desk. */
const SUPPLIER_BID_ROLES: PlatformRole[] = ['farmer', 'trader', 'buyer', 'exporter', 'warehouse_owner']

export interface SharedSection {
  cmp: ComponentType
  /** When set, only these roles may open the section (others get redirected). */
  roles?: PlatformRole[]
}

/**
 * Sections shared across role dashboards. Marketplace sections are role-gated
 * per the brief: sellers = farmer/trader/input supplier; interest-senders =
 * buyer/trader/exporter (+ farmer, for inputs); directory browse = everyone.
 */
export const SHARED_SECTIONS: Record<string, SharedSection> = {
  marketplace: { cmp: MarketplaceHome, roles: MARKETPLACE_ROLES },
  'my-listings': { cmp: MyListings, roles: SELLER_ROLES },
  // Batches can only be created from a harvest on a farm the caller owns, so
  // today this is a farmer surface. It is registered for SELLER_ROLES because
  // a batch stays visible to whoever holds it after a sale.
  'my-stock': { cmp: MyStock, roles: SELLER_ROLES },
  'my-interests': { cmp: MyInterests, roles: INTEREST_ROLES },
  directory: { cmp: Directory },
  'my-directory-listing': { cmp: MyDirectoryListing, roles: DIRECTORY_OWNER_ROLES },
  'my-bookings': { cmp: MyBookings, roles: BOOKER_ROLES },
  'service-bookings': { cmp: BookingsInbox, roles: SERVICE_OWNER_ROLES },
  'open-rfqs': { cmp: OpenRfqs, roles: SUPPLIER_BID_ROLES },
  'transport-board': { cmp: TransportBoard, roles: ['logistics_provider'] },
  'warehouse-inbox': { cmp: WarehouseInbox, roles: ['warehouse_owner'] },
  // P0-1: the custodial Wallet was replaced by a non-custodial ledger view.
  // The section key stays `wallet` so existing links keep working.
  wallet: { cmp: FinancialActivity },
  profile: { cmp: Profile },
  support: { cmp: Support },
  settings: { cmp: Settings },
  // Every role: privacy is not a feature of one dashboard.
  privacy: { cmp: PrivacySettings },
  notifications: { cmp: Notifications },
}

/**
 * Sections whose component already renders its own <h1>, usually a title plus a
 * subtitle that says more than a nav label could. The shell must NOT add a
 * second heading for these, or the page shows its title twice and reports two
 * h1s.
 *
 * tests/components/ux-refine-role-aware.test.tsx checks this set against the
 * components themselves, so adding an <h1> to a section without listing it here
 * fails the build rather than quietly duplicating the title.
 */
export const SECTIONS_WITH_OWN_HEADING = new Set<string>([
  // Registered sections whose component renders its own <h1>.
  'directory',
  'my-bookings',
  'my-interests',
  'my-listings',
  'my-stock',
  'privacy',
  'service-bookings',
  'wallet',
  // Rendered inline by RoleDashboard rather than through this registry.
  'intelligence',
  'invite',
])
