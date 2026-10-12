/**
 * Role display names and the role dashboards.
 *
 * SEPARATE FROM nav.ts ON PURPOSE
 *   Several role landing pages share a slug with a nav section ('my-farm' is
 *   both the Farmer landing and the My Farm nav item). Keying them together
 *   would mean renaming a nav item silently renamed a role, which is a
 *   different concept with different consequences.
 *
 * A role name is a platform concept, not a job title the member chose, so it IS
 * interface copy and is translated. The member's own business name is data and
 * is not.
 */
export const roles = {
  'role.farmer': 'Farmer',
  'role.trader': 'Trader & Buyer',
  'role.buyer': 'Buyer',
  'role.input_supplier': 'Input Supplier',
  'role.growth_partner': 'Growth Partner',
  'role.logistics_provider': 'Logistics Provider',
  'role.warehouse_owner': 'Warehouse Owner',
  'role.processor': 'Processor',
  'role.exporter': 'Exporter',
  'role.bank': 'Partner Bank',
  'role.admin': 'Admin',

  'role.switch': 'Switch role',
  'role.switchAria': 'Switch your active role',
  'role.addRole': 'Add a role',
  'role.active': 'Active',
  'role.detailsIncomplete': 'Details not filled in yet.',

  'dashboard.digitalId': 'Loamy Digital ID',
  'dashboard.viewPublicProfile': 'View public profile',
  'dashboard.loadingHome': 'Loading your home',
  'dashboard.activeDeal': 'Active deal',
  'dashboard.farms': 'Farms',
  'dashboard.fieldVerified': 'Field-verified',
  'dashboard.liveListings': 'Live listings',
  'dashboard.dealsInProgress': 'Deals in progress',
  'dashboard.financingOpen': 'Financing open',
  'dashboard.yieldHistory': 'Yield history',
  'dashboard.noHarvestYet': 'No harvest recorded yet',
  'dashboard.marketToday': 'Market today',
  'dashboard.nothingHappenedYet': 'Nothing has happened yet',
  'dashboard.title': 'Dashboard',
  'dashboard.welcome': 'Welcome back, {name}',
  'dashboard.quickActions': 'Quick actions',
  'dashboard.recentActivity': 'Recent activity',
  'dashboard.nothingYet': 'Nothing here yet',

  'farmer.myStock': 'My Stock',
  'farmer.myStockHint': 'Batches you hold. Each one carries its origin, so a buyer can check where it came from instead of taking your word for it.',
  'farmer.registerFarm': 'Register your first farm',
  'farmer.harvest': 'Harvest',
  'farmer.recordHarvest': 'Record a harvest',

  'partner.onboardFarmer': 'Onboard a Farmer',
  'partner.myFarmers': 'My Farmers',
  'partner.earnings': 'Earnings',
  'partner.earningsNote': 'Tracked only: payouts happen off-platform during the pilot.',

  'bank.pipeline': 'Loan Applications',
  'bank.customers': 'Customers',
  'bank.riskCompliance': 'Risk & Compliance',
  'bank.alerts': 'Alerts',
  'bank.monitoring': 'Monitoring',

  'admin.userManagement': 'User Management',
  'admin.roleManagement': 'Role Management',
  'admin.systemMonitoring': 'System Monitoring',
  'admin.reportsAnalytics': 'Reports & Analytics',
} as const
