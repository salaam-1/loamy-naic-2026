/**
 * The logged-out site: shell chrome, landing, marketing copy and the public
 * marketplace storefront.
 *
 * WHY THIS IS ITS OWN NAMESPACE
 *   A visitor who has not signed in still has to be able to read the product.
 *   The acceptance test for localization starts here: choose Hausa on the
 *   landing page and the public site becomes Hausa, with no account involved.
 *   Keeping public copy separate from `nav` and `marketplace` means the
 *   logged-out surface can be completed and verified on its own.
 *
 * WHAT IS NOT HERE
 *   Commodity names, seller names, listing text, prices and state names are
 *   DATA. The storefront interpolates them; it never translates them.
 */
export const publicSite = {
  // --- shell ---------------------------------------------------------------
  'public.deliverTo': 'Deliver to',
  'public.deliverToState': 'Deliver to state',
  'public.allNigeria': 'All Nigeria',
  'public.allCategories': 'All Categories',
  'public.searchCategory': 'Search category',
  'public.searchPlaceholder': 'Search for products, commodities, suppliers…',
  'public.searchPlaceholderShort': 'Search products, commodities…',
  'public.searchTheMarketplace': 'Search the marketplace',
  'public.signIn': 'Sign in',
  'public.getStarted': 'Get started',
  'public.orders': 'Orders',
  'public.menu': 'Menu',
  'public.sections': 'Sections',
  'public.footer': 'Footer',
  'public.privacyPreferences': 'Privacy preferences',

  // --- landing -------------------------------------------------------------
  'public.heroTitle': 'The Operating System for Agriculture',
  'public.heroSubtitle': "Connecting every participant in Nigeria's agricultural value chain through verified identity, financing, markets and intelligence.",
  'public.heroImageAlt': 'A farmer holding up cassava roots he has just harvested from his field',
  'public.becomeFoundingMember': 'Become a founding member',
  'public.browseMarketplace': 'Browse the marketplace',
  'public.fourPillars': 'One platform, four pillars',
  'public.howItWorks': 'How it works',
  'public.banksDecide': 'Loamy connects the chain. Banks make all financing decisions.',
  'public.whoItsFor': 'Who it is for',
  'public.fromTheMarketplace': 'From the marketplace',
  'public.browseAllListings': 'Browse all listings',
  'public.joinFoundingMember': 'Join as a founding member.',
  'public.joinBody': "Early access and priority onboarding as Loamy rolls out across Nigeria's agricultural value chain.",
  'public.about': 'About',
  'public.contact': 'Contact',

  // --- the four pillars ----------------------------------------------------
  'public.pillar.identity.title': 'Digital Identity',
  'public.pillar.identity.body': 'Every participant gets a verified Loamy ID, backed by field verification.',
  'public.pillar.financing.title': 'Financing Infrastructure',
  'public.pillar.financing.body': 'Verified profiles let partner banks assess and finance with confidence. Non-interest structures: Murabaha and Salam.',
  'public.pillar.marketplace.title': 'Marketplace',
  'public.pillar.marketplace.body': 'Verified farmers, traders, exporters and buyers, connected directly.',
  'public.pillar.intelligence.title': 'Market Intelligence',
  'public.pillar.intelligence.body': 'Real commodity reference prices by state and market.',

  // --- how it works --------------------------------------------------------
  'public.step.register.title': 'Register',
  'public.step.register.body': 'A farmer or trader signs up in two minutes.',
  'public.step.verify.title': 'Verify',
  'public.step.verify.body': 'A Growth Partner visits the farm and captures GPS-matched evidence.',
  'public.step.finance.title': 'Finance',
  'public.step.finance.body': 'The verified profile goes to a partner bank; the bank decides and disburses.',
  'public.step.sell.title': 'Sell',
  'public.step.sell.body': 'Harvest is listed to verified buyers, traders and exporters.',
  'public.step.store.title': 'Store & Move',
  'public.step.store.body': 'Warehouses and logistics providers in the same directory.',
  'public.step.history.title': 'Build history',
  'public.step.history.body': 'Every season recorded strengthens the next application.',

  // --- who it is for -------------------------------------------------------
  'public.role.farmer': 'Grow, get verified, access financing through partner banks.',
  'public.role.trader': 'Source, aggregate and trade verified commodities.',
  'public.role.exporter': 'Move verified Nigerian produce to international markets.',
  'public.role.buyer': 'Buy verified produce directly from source.',
  'public.role.input_supplier': 'Supply seeds, fertilizer and equipment to verified farmers.',
  'public.role.warehouse_owner': 'Offer verified storage capacity across the chain.',
  'public.role.logistics_provider': 'Move produce between farms, markets and ports.',
  'public.role.growth_partner': 'Onboard and verify farmers in the field.',

  // --- the standing disclaimer --------------------------------------------
  // A compliance statement, not a tagline. Every pack carries it in full or
  // falls back to English; a shortened translation is not acceptable.
  'public.disclaimer': 'Loamy is not a lender. Financing decisions are made by partner banks, and marketplace funds are held by our regulated payment partner.',
  'public.featuredListings': 'Featured listings',
  'public.seeAllListings': 'See all listings',
} as const
