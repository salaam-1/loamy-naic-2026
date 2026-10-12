/**
 * Navigation labels, keyed by the section slug they belong to.
 *
 * WHY KEYED BY SECTION
 *   src/lib/roles.ts declares nav items as data, with a literal `label`. The
 *   section slug is the stable identity; the label is the presentation. Keying
 *   on the slug means AppShell resolves `nav.<section>` at render and the data
 *   file stops carrying English.
 *
 * Role display names live in roles.ts (the pack), not here: several sections
 * share a slug with a role landing page, and conflating them would make a
 * nav label change silently rename a role.
 */
export const nav = {
  'nav.overview': 'Dashboard',
  'nav.marketplace': 'Marketplace',
  'nav.discover': 'Discover',
  'nav.trace': 'Trace',
  'nav.messages': 'Messages',
  'nav.intelligence': 'Intelligence',
  'nav.invite': 'Invite & Benefits',
  'nav.profile': 'Profile',
  'nav.support': 'Support',
  'nav.settings': 'Settings',
  'nav.privacy': 'Privacy',
  'nav.wallet': 'Financial Activity',
  'nav.financing': 'Financing',
  'nav.transactions': 'Transactions',
  'nav.saved': 'Saved Listings',
  'nav.directory': 'Directory',
  'nav.reports': 'Reports',
  'nav.analytics': 'Analytics',
  'nav.compliance': 'Compliance',
  'nav.contracts': 'Contracts',
  'nav.team': 'Team',
  'nav.company': 'Company',

  // selling and stock
  'nav.my-listings': 'My Listings',
  'nav.my-stock': 'My Stock',
  'nav.my-interests': 'My Interests',
  'nav.my-farm': 'My Farm',
  'nav.my-business': 'My Business',
  'nav.my-network': 'My Network',
  'nav.my-directory-listing': 'My Directory Listing',

  // procurement
  'nav.rfqs': 'Buy Requests',
  'nav.open-rfqs': 'Open Buy Requests',
  'nav.inspections': 'Inspections',

  // logistics and storage
  'nav.logistics': 'Logistics',
  'nav.my-fleet': 'My Fleet',
  'nav.transport-board': 'Transport Jobs',
  'nav.delivery-requests': 'Delivery Requests',
  'nav.my-warehouses': 'My Warehouses',
  'nav.warehouse-inbox': 'Reservations',
  'nav.storage-requests': 'Storage Requests',
  'nav.my-bookings': 'My Bookings',
  'nav.service-bookings': 'Bookings',

  // growth partner
  'nav.onboard': 'Onboard a Farmer',
  'nav.my-farmers': 'My Farmers',
  'nav.field-ops': 'Field Ops',
  'nav.verification-tasks': 'Verification Tasks',
  'nav.earnings': 'Earnings',
  'nav.price-updates': 'Price Updates',

  // exporter
  'nav.export-hub': 'Export Hub',

  // grouping headings used by the shell
  /* The PRIMARY TABS, keyed by the tab names in src/lib/navigation.ts.
   *
   * The four keys below this block (`trade`, `operations`, `money`,
   * `account`) do not match any tab the shell actually renders, so every
   * sidebar group heading silently fell back to its English. They are kept
   * because other surfaces may still reference them, but these are the ones
   * the shell reads. */
  'nav.group.home': 'Home',
  'nav.group.homeDescription': 'What needs you today',
  'nav.group.marketplace': 'Market',
  'nav.group.marketplaceDescription': 'Buy and sell commodities',
  'nav.group.activity': 'Activity',
  'nav.group.activityDescription': 'Transactions, financing, verification, movement',
  'nav.group.intelligence': 'Intelligence',
  'nav.group.intelligenceDescription': 'Prices, trends and weather',
  'nav.group.profile': 'Profile',
  'nav.group.profileDescription': 'Your identity and settings',

  // --- the 404 page ---------------------------------------------------------
  'notifications.noneYet': 'No notifications yet. Platform updates will land here.',
  'notifications.viewAll': 'View all notifications',
  'roles.addARole': 'Add a role',

  'notFound.title': 'Page not found',
  'notFound.body': 'The page you\u2019re looking for doesn\u2019t exist or has moved.',
  'notFound.back': 'Back to your dashboard',

  'nav.group.trade': 'Trade',
  'nav.group.operations': 'Operations',
  'nav.group.money': 'Money',
  'nav.group.account': 'Account',
} as const
