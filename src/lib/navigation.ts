import {
  BarChart3, Home, Store, UserRound, Workflow, type LucideIcon,
} from 'lucide-react'
import type { NavItem } from '@/lib/roles'

/**
 * Primary navigation: five jobs, not forty-seven sections.
 *
 * THE PROBLEM THIS SOLVES
 *   Loamy has 47 distinct dashboard sections across nine roles. The sidebar
 *   listed a role's ten-to-fifteen of them flat, which is navigable with a
 *   mouse and unusable with a thumb — and it gave no answer to "where do I go
 *   to do X", because every item had equal weight.
 *
 * WHAT THIS IS NOT
 *   It is NOT a second navigation model. Sections keep their keys, their
 *   routes and their components; this is a grouping layer over the existing
 *   per-role NavItem lists. Nothing is renamed, nothing is moved, and a role
 *   that cannot see a section still cannot see it — grouping happens after
 *   the flag and capability filtering that AppShell already does.
 *
 * THE INVARIANT
 *   Every section a role can reach must land in exactly one tab. A section
 *   that falls through the map would silently disappear from mobile
 *   navigation, which is how features become unreachable. `tabFor` therefore
 *   has a defined fallback rather than returning undefined, and a unit test
 *   asserts every key in roles.ts is mapped explicitly.
 */

export type PrimaryTab = 'home' | 'marketplace' | 'activity' | 'intelligence' | 'profile'

export const PRIMARY_TABS: PrimaryTab[] = ['home', 'marketplace', 'activity', 'intelligence', 'profile']

export const TAB_META: Record<PrimaryTab, { label: string; icon: LucideIcon; description: string }> = {
  home: { label: 'Home', icon: Home, description: 'What needs you today' },
  marketplace: { label: 'Market', icon: Store, description: 'Buy and sell commodities' },
  activity: { label: 'Activity', icon: Workflow, description: 'Transactions, financing, verification, movement' },
  intelligence: { label: 'Intelligence', icon: BarChart3, description: 'Prices, trends and weather' },
  profile: { label: 'Profile', icon: UserRound, description: 'Your identity and settings' },
}

/**
 * Section → tab.
 *
 * Grouped by the USER'S JOB rather than by which backend owns the data. A
 * farmer thinking "where is my harvest" is thinking about their farm, not
 * about the commodity_batches table — so `my-stock` sits under Market, beside
 * the listings it feeds, and `my-farm` sits under Profile, with the identity
 * it belongs to.
 */
export const SECTION_TAB: Record<string, PrimaryTab> = {
  // ---- Home: the contextual landing surface.
  overview: 'home',
  messages: 'home',

  // ---- Market: everything about goods changing hands.
  marketplace: 'marketplace',
  discover: 'marketplace',
  'my-listings': 'marketplace',
  'my-interests': 'marketplace',
  'my-stock': 'marketplace',
  saved: 'marketplace',
  directory: 'marketplace',
  'my-directory-listing': 'marketplace',
  rfqs: 'marketplace',
  'open-rfqs': 'marketplace',
  contracts: 'marketplace',
  'export-hub': 'marketplace',
  'price-updates': 'marketplace',

  // ---- Activity: work in flight. Anything with a state machine behind it.
  financing: 'activity',
  wallet: 'activity', // Financial Activity — non-custodial ledger view
  logistics: 'activity',
  'transport-board': 'activity',
  'delivery-requests': 'activity',
  'my-fleet': 'activity',
  'warehouse-inbox': 'activity',
  'storage-requests': 'activity',
  'my-warehouses': 'activity',
  inspections: 'activity',
  compliance: 'activity',
  'verification-tasks': 'activity',
  'field-ops': 'activity',
  'my-farmers': 'activity',
  onboard: 'activity',
  'my-bookings': 'activity',
  'service-bookings': 'activity',
  trace: 'activity',
  earnings: 'activity',

  // ---- Intelligence: things that inform a decision rather than progress one.
  intelligence: 'intelligence',
  analytics: 'intelligence',
  reports: 'intelligence',

  // ---- Profile: who you are, and the settings around it.
  profile: 'profile',
  'my-farm': 'profile',
  'my-business': 'profile',
  'my-network': 'profile',
  company: 'profile',
  team: 'profile',
  invite: 'profile',
  settings: 'profile',
  privacy: 'profile',
  support: 'profile',
}

/**
 * The tab a section belongs to.
 *
 * Falls back to `activity` rather than returning undefined: an unmapped
 * section is a mistake, but the consequence of that mistake should be an item
 * in a slightly odd place, not an item that vanishes from mobile.
 */
export function tabFor(section: string): PrimaryTab {
  return SECTION_TAB[section] ?? 'activity'
}

export interface TabGroup {
  tab: PrimaryTab
  label: string
  icon: LucideIcon
  items: NavItem[]
}

/**
 * Group a role's already-filtered nav into tabs.
 *
 * Order within a group follows the order in roles.ts, so a role's own sense
 * of priority survives. Empty tabs are dropped — a Growth Partner has no
 * marketplace sections, and an empty tab is worse than a missing one.
 */
export function groupNav(nav: NavItem[]): TabGroup[] {
  const groups = new Map<PrimaryTab, NavItem[]>()
  for (const item of nav) {
    const tab = tabFor(item.section)
    groups.set(tab, [...(groups.get(tab) ?? []), item])
  }
  return PRIMARY_TABS.filter((t) => (groups.get(t)?.length ?? 0) > 0).map((tab) => ({
    tab,
    label: TAB_META[tab].label,
    icon: TAB_META[tab].icon,
    items: groups.get(tab)!,
  }))
}

/**
 * Where a tab goes when tapped: its first available section.
 *
 * Deliberately the first item rather than a hard-coded landing page. A role
 * that has `my-listings` but not `marketplace` should land on the one it
 * actually has, instead of a route that redirects or 404s.
 */
export function tabLanding(group: TabGroup): NavItem | undefined {
  return group.items[0]
}
