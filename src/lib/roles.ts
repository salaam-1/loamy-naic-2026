import {
  Compass,
  Radar,
  Route,
  UserPlus,
  BarChart3,
  Bookmark,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FileText,
  Globe2,
  Handshake,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  Network,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sprout,
  Store,
  Tags,
  Tractor,
  Truck,
  UserRound,
  Users,
  Receipt,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { COMMODITIES, NIGERIA_STATES } from './nigeria'
import { BOOKER_ROLES, SERVICE_OWNER_ROLES } from './booking'
import type { PlatformRole } from './types'

export interface NavItem {
  label: string
  icon: LucideIcon
  /** Section segment under /dashboard/{role}. 'overview' is the dashboard itself. */
  section: string
  /**
   * Feature-flag key in platform_config.flags. When set, the item is HIDDEN
   * unless the flag is explicitly true. Un-built features (later stages) all
   * carry a flag key — absent keys read as false, so Stage 1 deploys safely.
   */
  flag?: string
  /**
   * Per-user capability gate (on top of the flag). 'can_verify' = admin-granted
   * Growth Partner verification capability; item hidden without it.
   */
  capability?: 'can_verify'
  /**
   * An absolute app path, for the handful of tools that are not sections of a
   * role dashboard because they are cross-role by nature (Trace). When set,
   * `section` is used only as a key and for active-state matching.
   */
  href?: string
}

export interface StatDef {
  label: string
  sub: string
  icon: LucideIcon
  /** Where the (real) value comes from. All sources start at zero/empty for new users. */
  source: 'role_data_number' | 'role_data_count' | 'referrals' | 'unread_notifications' | 'member_since'
  roleDataKey?: string
  unit?: string
}

export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'multiselect'
  options?: readonly string[]
  placeholder?: string
  required?: boolean
}

export interface RoleConfig {
  slug: PlatformRole
  label: string
  icon: LucideIcon
  /** One-liner used on the role picker and dashboard empty state. */
  tagline: string
  nav: NavItem[]
  stats: StatDef[]
  onboarding: { intro: string; fields: FieldDef[] }
  emptyState: { title: string; body: string }
}

// Items every role shares. Support/Settings are Stage 1 nav placeholders
// (they render a designed placeholder page, nothing more — per the brief).
const COMMON_TAIL: NavItem[] = [
  // Trace is deliberately cross-role: a farmer, a buyer, a warehouse operator
  // and an admin all need the same explorer, and what each may see is decided
  // per batch by loamy_trace_scope rather than by which dashboard they are in.
  { label: 'Discover', icon: Compass, section: 'discover', href: '/discover', flag: 'marketplace' },
  { label: 'Trace', icon: Route, section: 'trace', href: '/trace' },
  { label: 'Messages', icon: MessageSquare, section: 'messages', flag: 'messaging' },
  // Block 6: every member can invite. Deliberately NOT called Earnings --
  // that word belongs to the Growth Partner commission surface, and
  // mixing them tells members they are owed money they are not.
  // Block 7: aggregate market intelligence. Every figure on it carries its
  // classification, population and period; suppressed results say so.
  { label: 'Intelligence', icon: BarChart3, section: 'intelligence' },
  { label: 'Invite & Benefits', icon: UserPlus, section: 'invite' },
  { label: 'Profile', icon: UserRound, section: 'profile' },
  { label: 'Support', icon: LifeBuoy, section: 'support' },
  { label: 'Settings', icon: Settings, section: 'settings' },
  // Every role, like Settings. Privacy controls that only some dashboards
  // carry are not privacy controls.
  { label: 'Privacy', icon: ShieldCheck, section: 'privacy' },
]

// Service bookings (behind the service_booking flag): the two owner roles get
// the inbox; the booker roles get "My Bookings".
const myBookingsItem: NavItem = { label: 'My Bookings', icon: CalendarClock, section: 'my-bookings', flag: 'service_booking' }
const bookingsInboxItem: NavItem = { label: 'Bookings', icon: CalendarCheck, section: 'service-bookings', flag: 'service_booking' }

const dashboardItem: NavItem = { label: 'Dashboard', icon: LayoutDashboard, section: 'overview' }

// Marketplace items (Stage 3, live behind the now-true `marketplace` flag).
const marketplaceItem: NavItem = { label: 'Marketplace', icon: Store, section: 'marketplace', flag: 'marketplace' }
const myListingsItem: NavItem = { label: 'My Listings', icon: Tags, section: 'my-listings', flag: 'marketplace' }
const myInterestsItem: NavItem = { label: 'My Interests', icon: Handshake, section: 'my-interests', flag: 'marketplace' }
const directoryItem: NavItem = { label: 'Directory', icon: Building2, section: 'directory', flag: 'marketplace' }
const myDirectoryListingItem: NavItem = {
  label: 'My Directory Listing', icon: ClipboardList, section: 'my-directory-listing', flag: 'marketplace',
}

const STORAGE_TYPES = ['Dry storage', 'Cold storage', 'Silo', 'Open yard'] as const
const VEHICLE_TYPES = ['Pickup / van', 'Flatbed truck', 'Box truck', 'Refrigerated truck', 'Trailer'] as const
const EXPORT_MARKETS = ['West Africa (ECOWAS)', 'Europe', 'Middle East', 'Asia', 'North America', 'Other Africa'] as const
const PARTNER_TYPES = ['Cooperative', 'Farmers association', 'NGO / development org', 'Extension service', 'Community leader'] as const
const INPUT_CATEGORIES = ['Seeds & seedlings', 'Fertilizer', 'Crop protection', 'Equipment & tools', 'Irrigation', 'Packaging'] as const
const PURCHASE_FREQUENCY = ['Weekly', 'Monthly', 'Quarterly', 'Seasonally'] as const

// ---------------------------------------------------------------------------
// Trader & Buyer — ONE merged dashboard. `trader` is the canonical slug (the
// only one offered at signup); `buyer` is kept as a legacy slug so accounts
// created before the merge keep working, and both render this same config.
// Anything either side could do, both can now do.
//
// Built as a factory rather than a shared object: the nav-assembly passes at
// the bottom of this file splice into cfg.nav, so each slug needs its OWN
// array or those items would be inserted twice.
// ---------------------------------------------------------------------------
function traderBuyerConfig(slug: 'trader' | 'buyer'): RoleConfig {
  return {
    slug,
    label: 'Trader & Buyer',
    icon: Store,
    tagline: 'Buy verified produce and sell, aggregate, and trade it - one desk for both sides of the deal.',
    nav: [
      dashboardItem,
      { label: 'My Business', icon: Boxes, section: 'my-business', flag: 'my_business' },
      marketplaceItem,
      myListingsItem,
      myInterestsItem,
      directoryItem,
      // From the former Buyer dashboard. Not built yet — own (false) flag.
      { label: 'Saved Listings', icon: Bookmark, section: 'saved', flag: 'saved_listings' },
      { label: 'Financing', icon: Landmark, section: 'financing', flag: 'financing_applications' },
      { label: 'Reports', icon: BarChart3, section: 'reports', flag: 'reports' },
      ...COMMON_TAIL,
    ],
    stats: [
      { label: 'Commodities', sub: 'you trade and buy', icon: Boxes, source: 'role_data_count', roleDataKey: 'commodities' },
      { label: 'Years Active', sub: 'in the trade', icon: BarChart3, source: 'role_data_number', roleDataKey: 'years_active' },
      { label: 'Notifications', sub: 'unread', icon: MessageSquare, source: 'unread_notifications' },
      { label: 'Referrals', sub: 'members you brought in', icon: Users, source: 'referrals' },
    ],
    onboarding: {
      intro: 'Tell us about your business - what you buy, what you sell, or both - so we can match you with the right commodities and counterparties.',
      fields: [
        { key: 'business_name', label: 'Business / organization name', type: 'text', placeholder: 'e.g. Danladi Commodities', required: true },
        { key: 'commodities', label: 'Commodities you trade or buy', type: 'multiselect', options: COMMODITIES, required: true },
        { key: 'years_active', label: 'Years active', type: 'number', placeholder: 'e.g. 5', required: true },
        { key: 'purchase_frequency', label: 'How often do you buy?', type: 'select', options: PURCHASE_FREQUENCY },
        { key: 'lga', label: 'Local Government Area (LGA)', type: 'text', placeholder: 'e.g. Kano Municipal' },
      ],
    },
    emptyState: {
      title: 'Your trading desk is being prepared',
      body: 'The marketplace, orders and bank financing arrive in upcoming releases. Your profile is active now.',
    },
  }
}

export const ROLE_CONFIGS: Record<PlatformRole, RoleConfig> = {
  farmer: {
    slug: 'farmer',
    label: 'Farmer',
    icon: Sprout,
    tagline: 'Grow, get verified, and access Shariah-compliant financing through partner banks.',
    nav: [
      dashboardItem,
      // My Farm and Financing are BUILT (Stage 2) — no feature flag. Other
      // roles' Financing stays behind the still-false global flag until their
      // stages arrive.
      { label: 'My Farm', icon: Tractor, section: 'my-farm' },
      // Harvest -> batch -> traceable listing. Without this the batch spine
      // (trace, verified supply, financing against stock) had no entry point.
      { label: 'My Stock', icon: Boxes, section: 'my-stock' },
      { label: 'Financing', icon: Landmark, section: 'financing' },
      marketplaceItem,
      myListingsItem,
      myInterestsItem, // farmers buy INPUTS from suppliers
      directoryItem,
      { label: 'Reports', icon: BarChart3, section: 'reports', flag: 'reports' },
      ...COMMON_TAIL,
    ],
    stats: [
      { label: 'Farm Size', sub: 'hectares on record', icon: Tractor, source: 'role_data_number', roleDataKey: 'farm_size_ha', unit: 'ha' },
      { label: 'Crops Grown', sub: 'primary crops listed', icon: Sprout, source: 'role_data_count', roleDataKey: 'primary_crops' },
      { label: 'Notifications', sub: 'unread', icon: MessageSquare, source: 'unread_notifications' },
      { label: 'Referrals', sub: 'members you brought in', icon: Users, source: 'referrals' },
    ],
    onboarding: {
      intro: 'Tell us about your farm so your dashboard, and later your financing profile, reflect your real operation.',
      fields: [
        { key: 'farm_name', label: 'Farm name', type: 'text', placeholder: 'e.g. Alheri Farms', required: true },
        { key: 'farm_size_ha', label: 'Farm size (hectares)', type: 'number', placeholder: 'e.g. 2.5', required: true },
        { key: 'primary_crops', label: 'Primary crops', type: 'multiselect', options: COMMODITIES, required: true },
        { key: 'lga', label: 'Local Government Area (LGA)', type: 'text', placeholder: 'e.g. Zaria', required: true },
      ],
    },
    emptyState: {
      title: 'Your farm hub is being prepared',
      body: 'Farm records, bank financing and the marketplace arrive in upcoming releases. Your profile and digital ID are active now.',
    },
  },

  trader: traderBuyerConfig('trader'),

  // Legacy slug from before the merge — same dashboard, same features.
  buyer: traderBuyerConfig('buyer'),

  exporter: {
    slug: 'exporter',
    label: 'Exporter',
    icon: Globe2,
    tagline: 'Move verified Nigerian produce to international markets - source at scale, compare supplier bids, and settle securely.',
    nav: [
      dashboardItem,
      { label: 'Export Hub', icon: Globe2, section: 'export-hub', flag: 'export_hub' },
      // Procurement suite — the same one processors run. An exporter is a bulk
      // off-taker too: they post buy requests, rank bids, award, and settle.
      { label: 'Company', icon: Building2, section: 'company' },
      { label: 'Team', icon: Users, section: 'team' },
      { label: 'Buy Requests', icon: ClipboardList, section: 'rfqs' },
      { label: 'Contracts', icon: FileText, section: 'contracts' },
      { label: 'Inspections', icon: ShieldCheck, section: 'inspections' },
      { label: 'Logistics', icon: Truck, section: 'logistics' },
      { label: 'Analytics', icon: BarChart3, section: 'analytics' },
      marketplaceItem,
      myInterestsItem,
      directoryItem,
      { label: 'Compliance', icon: ShieldCheck, section: 'compliance', flag: 'verification_workflow' },
      { label: 'Financing', icon: Landmark, section: 'financing', flag: 'financing_applications' },
      { label: 'Reports', icon: BarChart3, section: 'reports', flag: 'reports' },
      ...COMMON_TAIL,
    ],
    stats: [
      { label: 'Export Commodities', sub: 'in your portfolio', icon: Boxes, source: 'role_data_count', roleDataKey: 'commodities' },
      { label: 'Target Markets', sub: 'destination regions', icon: Globe2, source: 'role_data_count', roleDataKey: 'markets' },
      { label: 'Notifications', sub: 'unread', icon: MessageSquare, source: 'unread_notifications' },
      { label: 'Referrals', sub: 'members you brought in', icon: Users, source: 'referrals' },
    ],
    onboarding: {
      intro: 'Tell us about your export business - commodities, markets, and experience. You can register your company next to start posting buy requests.',
      fields: [
        { key: 'business_name', label: 'Business name', type: 'text', placeholder: 'e.g. Sahel Exports Ltd', required: true },
        { key: 'commodities', label: 'Commodities you export', type: 'multiselect', options: COMMODITIES, required: true },
        { key: 'markets', label: 'Destination markets', type: 'multiselect', options: EXPORT_MARKETS, required: true },
        { key: 'years_active', label: 'Years exporting', type: 'number', placeholder: 'e.g. 3' },
      ],
    },
    emptyState: {
      title: 'Your export hub is being prepared',
      body: 'Sourcing from verified producers, bulk buy requests with supplier bidding, export compliance tooling, and trade documentation arrive across upcoming releases. Register your company to start procuring.',
    },
  },

  warehouse_owner: {
    slug: 'warehouse_owner',
    label: 'Warehouse Owner',
    icon: Warehouse,
    tagline: 'Offer verified storage capacity to farmers, traders, and exporters.',
    nav: [
      dashboardItem,
      myDirectoryListingItem,
      directoryItem,
      { label: 'My Warehouses', icon: Warehouse, section: 'my-warehouses', flag: 'my_warehouses' },
      // Booking workflows come later — own (false) flag, not the marketplace flag.
      { label: 'Storage Requests', icon: ClipboardList, section: 'storage-requests', flag: 'storage_requests' },
      { label: 'Reports', icon: BarChart3, section: 'reports', flag: 'reports' },
      ...COMMON_TAIL,
    ],
    stats: [
      { label: 'Storage Capacity', sub: 'tonnes on record', icon: Warehouse, source: 'role_data_number', roleDataKey: 'capacity_tonnes', unit: 't' },
      { label: 'Storage Types', sub: 'offered', icon: Boxes, source: 'role_data_count', roleDataKey: 'storage_types' },
      { label: 'Notifications', sub: 'unread', icon: MessageSquare, source: 'unread_notifications' },
      { label: 'Referrals', sub: 'members you brought in', icon: Users, source: 'referrals' },
    ],
    onboarding: {
      intro: 'Tell us about your storage facilities so demand can be matched to your capacity when storage requests open.',
      fields: [
        { key: 'business_name', label: 'Business name', type: 'text', placeholder: 'e.g. Kaduna AgriStore', required: true },
        { key: 'capacity_tonnes', label: 'Total capacity (tonnes)', type: 'number', placeholder: 'e.g. 500', required: true },
        { key: 'storage_types', label: 'Storage types offered', type: 'multiselect', options: STORAGE_TYPES, required: true },
        { key: 'lga', label: 'Primary location (LGA)', type: 'text', placeholder: 'e.g. Chikun' },
      ],
    },
    emptyState: {
      title: 'Your storage hub is being prepared',
      body: 'Storage requests and utilisation reporting arrive in upcoming releases. Your warehouse profile is active now.',
    },
  },

  logistics_provider: {
    slug: 'logistics_provider',
    label: 'Logistics Provider',
    icon: Truck,
    tagline: 'Move produce reliably between farms, warehouses, markets, and ports.',
    nav: [
      dashboardItem,
      myDirectoryListingItem,
      directoryItem,
      { label: 'My Fleet', icon: Truck, section: 'my-fleet', flag: 'my_fleet' },
      // Booking workflows come later — own (false) flag, not the marketplace flag.
      { label: 'Delivery Requests', icon: ClipboardList, section: 'delivery-requests', flag: 'delivery_requests' },
      { label: 'Reports', icon: BarChart3, section: 'reports', flag: 'reports' },
      ...COMMON_TAIL,
    ],
    stats: [
      { label: 'Fleet Size', sub: 'vehicles on record', icon: Truck, source: 'role_data_number', roleDataKey: 'fleet_size' },
      { label: 'Coverage', sub: 'states served', icon: Globe2, source: 'role_data_count', roleDataKey: 'coverage_states' },
      { label: 'Notifications', sub: 'unread', icon: MessageSquare, source: 'unread_notifications' },
      { label: 'Referrals', sub: 'members you brought in', icon: Users, source: 'referrals' },
    ],
    onboarding: {
      intro: 'Tell us about your fleet and coverage so delivery requests can reach you when logistics opens.',
      fields: [
        { key: 'business_name', label: 'Business name', type: 'text', placeholder: 'e.g. Arewa Haulage', required: true },
        { key: 'fleet_size', label: 'Fleet size (vehicles)', type: 'number', placeholder: 'e.g. 4', required: true },
        { key: 'vehicle_types', label: 'Vehicle types', type: 'multiselect', options: VEHICLE_TYPES, required: true },
        { key: 'coverage_states', label: 'States you cover', type: 'multiselect', options: NIGERIA_STATES, required: true },
      ],
    },
    emptyState: {
      title: 'Your logistics hub is being prepared',
      body: 'Delivery requests, route management, and delivery reporting arrive in upcoming releases. Your logistics profile is already active.',
    },
  },

  growth_partner: {
    slug: 'growth_partner',
    label: 'Growth Partner',
    icon: Network,
    tagline: 'Bring your network - cooperatives, associations, and communities - onto Loamy.',
    nav: [
      dashboardItem,
      { label: 'Onboard a Farmer', icon: Users, section: 'onboard', flag: 'verification_workflow' },
      { label: 'My Farmers', icon: Sprout, section: 'my-farmers', flag: 'verification_workflow' },
      { label: 'Verification Tasks', icon: ShieldCheck, section: 'verification-tasks', flag: 'verification_workflow', capability: 'can_verify' },
      // Block 5: the operational board -- open work, my work, earnings,
      // performance, service area. Capability-gated like the task list.
      { label: 'Field Ops', icon: Radar, section: 'field-ops', capability: 'can_verify' },
      { label: 'Price Updates', icon: BarChart3, section: 'price-updates' },
      // Commodity inspections for processor awards (launches with the suite).
      { label: 'Inspections', icon: ClipboardCheck, section: 'inspections', flag: 'processor_procurement' },
      { label: 'Earnings', icon: ClipboardList, section: 'earnings', flag: 'verification_workflow' },
      { label: 'My Network', icon: Network, section: 'my-network', flag: 'my_network' },
      directoryItem,
      { label: 'Reports', icon: BarChart3, section: 'reports', flag: 'reports' },
      ...COMMON_TAIL,
    ],
    stats: [
      { label: 'Referrals', sub: 'members you brought in', icon: Users, source: 'referrals' },
      { label: 'Network Size', sub: 'people you represent', icon: Network, source: 'role_data_number', roleDataKey: 'network_size' },
      { label: 'Notifications', sub: 'unread', icon: MessageSquare, source: 'unread_notifications' },
      { label: 'Member Since', sub: 'on Loamy', icon: ClipboardList, source: 'member_since' },
    ],
    onboarding: {
      intro: 'Tell us about the network you represent so we can support your onboarding drives.',
      fields: [
        { key: 'organization_name', label: 'Organization name', type: 'text', placeholder: 'e.g. Kano Maize Growers Co-op', required: true },
        { key: 'partner_type', label: 'Partner type', type: 'select', options: PARTNER_TYPES, required: true },
        { key: 'network_size', label: 'Approximate network size (people)', type: 'number', placeholder: 'e.g. 250', required: true },
        { key: 'lga', label: 'Primary location (LGA)', type: 'text', placeholder: 'e.g. Dawakin Kudu' },
      ],
    },
    emptyState: {
      title: 'Your growth hub is being prepared',
      body: 'Network onboarding tools, referral tracking, and impact reporting arrive in upcoming releases. Your partner profile is already active.',
    },
  },

  input_supplier: {
    slug: 'input_supplier',
    label: 'Input Supplier',
    icon: Package,
    tagline: 'Supply seeds, fertilizer, equipment, and other inputs to verified farmers.',
    nav: [
      dashboardItem,
      marketplaceItem,
      myListingsItem, // input suppliers list their products here
      directoryItem,
      { label: 'Financing', icon: Landmark, section: 'financing', flag: 'financing_applications' },
      { label: 'Reports', icon: BarChart3, section: 'reports', flag: 'reports' },
      ...COMMON_TAIL,
    ],
    stats: [
      { label: 'Product Categories', sub: 'you supply', icon: Boxes, source: 'role_data_count', roleDataKey: 'product_categories' },
      { label: 'Years Active', sub: 'supplying inputs', icon: BarChart3, source: 'role_data_number', roleDataKey: 'years_active' },
      { label: 'Notifications', sub: 'unread', icon: MessageSquare, source: 'unread_notifications' },
      { label: 'Referrals', sub: 'members you brought in', icon: Users, source: 'referrals' },
    ],
    onboarding: {
      intro: 'Tell us what you supply so farmers can find you when the input marketplace opens.',
      fields: [
        { key: 'business_name', label: 'Business name', type: 'text', placeholder: 'e.g. AgroPlus Inputs', required: true },
        { key: 'product_categories', label: 'Product categories', type: 'multiselect', options: INPUT_CATEGORIES, required: true },
        { key: 'years_active', label: 'Years active', type: 'number', placeholder: 'e.g. 6' },
        { key: 'lga', label: 'Primary location (LGA)', type: 'text', placeholder: 'e.g. Ilorin West' },
      ],
    },
    emptyState: {
      title: 'Your supply hub is being prepared',
      body: 'Product listings, farmer orders, and inventory tools arrive in upcoming releases. Your supplier profile is already active.',
    },
  },

  processor: {
    slug: 'processor',
    label: 'Processor',
    icon: Factory,
    tagline: 'For processors, millers, and large off-takers - source verified produce at scale, compare supplier bids, and settle securely.',
    nav: [
      dashboardItem,
      { label: 'Company', icon: Building2, section: 'company' },
      { label: 'Team', icon: Users, section: 'team' },
      // Buy Requests is the hub: reviewing bids, awarding, and funding/releasing
      // escrow all happen inside a request's detail — no separate nav items.
      { label: 'Buy Requests', icon: ClipboardList, section: 'rfqs' },
      { label: 'Contracts', icon: FileText, section: 'contracts' },
      { label: 'Inspections', icon: ShieldCheck, section: 'inspections' },
      { label: 'Logistics', icon: Truck, section: 'logistics' },
      marketplaceItem,
      // Analytics — built in Part 9, reachable now.
      { label: 'Analytics', icon: BarChart3, section: 'analytics' },
      ...COMMON_TAIL,
    ],
    stats: [
      { label: 'Buy Requests', sub: 'you have posted', icon: ClipboardList, source: 'role_data_count', roleDataKey: 'commodities' },
      { label: 'Notifications', sub: 'unread', icon: MessageSquare, source: 'unread_notifications' },
      { label: 'Referrals', sub: 'members you brought in', icon: Users, source: 'referrals' },
      { label: 'Member Since', sub: 'on Loamy', icon: ClipboardList, source: 'member_since' },
    ],
    onboarding: {
      intro: 'Tell us what your business processes or off-takes so the right verified suppliers can reach you. You will register your company next.',
      fields: [
        { key: 'company_name', label: 'Company name', type: 'text', placeholder: 'e.g. Sunrise Flour Mills Ltd', required: true },
        { key: 'commodities', label: 'Commodities you buy', type: 'multiselect', options: COMMODITIES, required: true },
        { key: 'monthly_volume_tonnes', label: 'Typical monthly volume (tonnes)', type: 'number', placeholder: 'e.g. 400' },
        { key: 'lga', label: 'Head office (LGA)', type: 'text', placeholder: 'e.g. Kano Municipal' },
      ],
    },
    emptyState: {
      title: 'Your procurement hub is being prepared',
      body: 'Bulk buy requests, supplier bidding, awards, contracts, inspection, and secure settlement arrive across upcoming releases. Register your company to get started.',
    },
  },
}

/**
 * Roles that run the company-backed procurement suite (post buy requests, rank
 * bids, award, contract, inspect, settle). Processors were first; exporters are
 * bulk off-takers too and run exactly the same flow. The SQL side is
 * company-membership based, not role based, so nothing else needs gating.
 */
export const PROCUREMENT_ROLES: PlatformRole[] = ['processor', 'exporter']

// Suppliers to a procuring company (farmers, traders/buyers, exporters,
// warehouse owners) get an "Open Buy Requests" board to bid on their RFQs.
// Behind supplier_bidding.
const SUPPLIER_BID_ROLES: PlatformRole[] = ['farmer', 'trader', 'buyer', 'exporter', 'warehouse_owner']
const openRfqsItem: NavItem = { label: 'Open Buy Requests', icon: ClipboardList, section: 'open-rfqs', flag: 'supplier_bidding' }
for (const slug of SUPPLIER_BID_ROLES) {
  const cfg = ROLE_CONFIGS[slug]
  cfg.nav.splice(cfg.nav.length - COMMON_TAIL.length, 0, openRfqsItem)
}

// Logistics providers bid on processor transport jobs; warehouse owners receive
// storage reservations. Both launch with the processor suite.
ROLE_CONFIGS.logistics_provider.nav.splice(
  ROLE_CONFIGS.logistics_provider.nav.length - COMMON_TAIL.length, 0,
  { label: 'Transport Jobs', icon: Truck, section: 'transport-board', flag: 'processor_procurement' },
)
ROLE_CONFIGS.warehouse_owner.nav.splice(
  ROLE_CONFIGS.warehouse_owner.nav.length - COMMON_TAIL.length, 0,
  { label: 'Reservations', icon: Warehouse, section: 'warehouse-inbox', flag: 'processor_procurement' },
)

// Every member has a wallet: escrow releases land there and they withdraw to
// their bank from it. Added to every role rather than listed nine times.
// P0-1: NOT a wallet. Loamy holds no member funds; this is a ledger-derived
// activity view. The section key is unchanged so existing links still work.
const walletItem: NavItem = { label: 'Financial Activity', icon: Receipt, section: 'wallet' }
for (const cfg of Object.values(ROLE_CONFIGS)) {
  cfg.nav.splice(cfg.nav.length - COMMON_TAIL.length, 0, walletItem)
}

// Insert the booking nav item just before the COMMON_TAIL block for each role
// (owners → inbox, bookers → my-bookings; growth_partner books nothing).
for (const cfg of Object.values(ROLE_CONFIGS)) {
  const item = SERVICE_OWNER_ROLES.includes(cfg.slug)
    ? bookingsInboxItem
    : BOOKER_ROLES.includes(cfg.slug)
      ? myBookingsItem
      : null
  if (item) cfg.nav.splice(cfg.nav.length - COMMON_TAIL.length, 0, item)
}

export const ALL_ROLE_CONFIGS = Object.values(ROLE_CONFIGS)

/**
 * Roles offered on the signup / role-picker surfaces. `buyer` is omitted: it is
 * the legacy half of the merged Trader & Buyer dashboard, so listing it would
 * show the same option twice. Existing buyer accounts are untouched.
 */
export const SIGNUP_ROLE_CONFIGS = ALL_ROLE_CONFIGS.filter((r) => r.slug !== 'buyer')

/**
 * Institutional and back-office accounts, as opposed to marketplace members.
 *
 * A bank officer and a platform administrator both work INSIDE Loamy on other
 * people's business. They have a profile, settings, security and notifications
 * like anyone else, but the public marketplace identity system (a claimable
 * @handle, a discoverable public profile) exists so buyers and sellers can find
 * each other. It means nothing for an institution and, on a bank screen, it
 * reads as though the officer is being offered a shopfront.
 *
 * The two signals are the same ones `RequireBank` already uses, deliberately:
 * `platform_role === 'bank'` is the institutional role, and `role === 'admin'`
 * is the platform-administrator flag, which sits on top of whatever platform
 * role the person also holds.
 *
 * Note the asymmetry with the database. `loamy_set_username` refuses
 * platform_role 'bank' outright, because a bank officer is never a marketplace
 * participant. It does NOT refuse the admin flag, because an administrator may
 * legitimately also be a farmer or a buyer; for them this is a presentation
 * choice on the admin surface, not an authorization rule.
 */
export function isInstitutionalProfile(
  profile: { platform_role?: string | null; role?: string | null } | null | undefined,
): boolean {
  if (!profile) return false
  return profile.platform_role === 'bank' || profile.role === 'admin'
}
