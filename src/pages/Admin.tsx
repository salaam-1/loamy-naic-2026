import {
  Activity, CreditCard, Download, FileBarChart, FileText, Handshake, Landmark, LayoutDashboard,
  LifeBuoy, LineChart, Megaphone, Receipt, ScrollText, Settings2, ShieldCheck, Sparkles, Store, Truck,
  UsersRound, Users, Wallet,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import AdminHome from '@/pages/admin/AdminHome'
import AdminUsers from '@/pages/admin/AdminUsers'
import AdminAudit from '@/pages/admin/AdminAudit'
import AdminAnnouncements from '@/pages/admin/AdminAnnouncements'
import AdminConfig from '@/pages/admin/AdminConfig'
import AdminFees from '@/pages/admin/AdminFees'
import AdminExports from '@/pages/admin/AdminExports'
import AdminMarketPrices from '@/pages/admin/AdminMarketPrices'
import AdminVerificationQueue from '@/pages/admin/AdminVerificationQueue'
import AdminPartners from '@/pages/admin/AdminPartners'
import AdminBankOfficers from '@/pages/admin/AdminBankOfficers'
import AdminTransactions from '@/pages/admin/AdminTransactions'
import AdminSupport from '@/pages/admin/AdminSupport'
import AdminContent from '@/pages/admin/AdminContent'
import AdminRoles from '@/pages/admin/AdminRoles'
import AdminListingsOversight from '@/pages/admin/AdminListingsOversight'
import AdminPaymentsSettlements from '@/pages/admin/AdminPaymentsSettlements'
import AdminLoansFinancing from '@/pages/admin/AdminLoansFinancing'
import AdminLogistics from '@/pages/admin/AdminLogistics'
import AdminMonitoring from '@/pages/admin/AdminMonitoring'
import AdminReports from '@/pages/admin/AdminReports'
import AdminNotifications from '@/pages/admin/AdminNotifications'
import AdminCopilot from '@/pages/admin/AdminCopilot'
import AdminAmbassadors from '@/pages/admin/AdminAmbassadors'
import type { NavItem } from '@/lib/roles'
import type { ComponentType } from 'react'

/**
 * Unified admin area (Stage 6): dashboard, user management, the operational
 * queues built in Stages 3–5, announcements, audit trail, configuration, and
 * exports. Admin GRANTS stay manual in Supabase — deliberate; no make-admin
 * control exists.
 */
// Super-admin sidebar — matches the platform design. The super admin has
// oversight of, and moderation over, everything on the platform.
const ADMIN_NAV: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, section: 'overview' },
  { label: 'User Management', icon: Users, section: 'users' },
  { label: 'Role Management', icon: UsersRound, section: 'roles' },
  { label: 'Verification Management', icon: ShieldCheck, section: 'verification', flag: 'verification_workflow' },
  { label: 'Listings & Products', icon: Store, section: 'listings-oversight', flag: 'marketplace' },
  { label: 'Orders & Transactions', icon: Receipt, section: 'transactions', flag: 'bank_portal' },
  { label: 'Payments & Settlements', icon: CreditCard, section: 'payments', flag: 'bank_portal' },
  { label: 'Loans & Financing', icon: Wallet, section: 'loans-financing', flag: 'bank_portal' },
  { label: 'Logistics & Shipments', icon: Truck, section: 'logistics', flag: 'marketplace' },
  { label: 'Ambassador Prices', icon: LineChart, section: 'price-updates' },
  { label: 'Reports & Analytics', icon: FileBarChart, section: 'reports' },
  { label: 'System Monitoring', icon: Activity, section: 'monitoring' },
  { label: 'Disputes Management', icon: LifeBuoy, section: 'support' },
  { label: 'Content Management', icon: FileText, section: 'content' },
  { label: 'Notifications', icon: Megaphone, section: 'notifications' },
  { label: 'Audit Logs', icon: ScrollText, section: 'audit' },
  { label: 'Loamy Co-pilot', icon: Sparkles, section: 'copilot' },
  { label: 'Fee Schedules', icon: Receipt, section: 'fees' },
  { label: 'System Settings', icon: Settings2, section: 'configuration' },
]

// Sections reachable by route but linked contextually (not top-level nav).
const HIDDEN_SECTIONS = new Set(['partners', 'bank-officers', 'exports', 'market-prices', 'announcements'])

const SECTIONS: Record<string, ComponentType> = {
  overview: AdminHome,
  users: AdminUsers,
  roles: AdminRoles,
  verification: AdminVerificationQueue,
  'listings-oversight': AdminListingsOversight,
  transactions: AdminTransactions,
  payments: AdminPaymentsSettlements,
  'loans-financing': AdminLoansFinancing,
  logistics: AdminLogistics,
  reports: AdminReports,
  monitoring: AdminMonitoring,
  support: AdminSupport,
  content: AdminContent,
  notifications: AdminNotifications,
  audit: AdminAudit,
  copilot: AdminCopilot,
  'price-updates': AdminAmbassadors,
  configuration: AdminConfig,
  fees: AdminFees,
  // Contextually linked, not in the sidebar:
  partners: AdminPartners,
  'bank-officers': AdminBankOfficers,
  exports: AdminExports,
  announcements: AdminAnnouncements,
  'market-prices': AdminMarketPrices,
}

// Which top-level nav item highlights when a hidden section is open.
const HIDDEN_ACTIVE: Record<string, string> = {
  partners: 'verification',
  'bank-officers': 'loans-financing',
  exports: 'reports',
  'market-prices': 'reports',
  announcements: 'notifications',
}

export default function Admin({ section = 'overview' }: { section?: string }) {
  const Section = SECTIONS[section] ?? AdminHome
  return (
    <AppShell
      nav={ADMIN_NAV}
      activeSection={HIDDEN_SECTIONS.has(section) ? HIDDEN_ACTIVE[section] ?? section : section}
      sectionHref={(s) => (s === 'overview' ? '/admin' : `/admin/${s}`)}
      roleLabel="Admin"
      pageTitle={ADMIN_NAV.find((n) => n.section === section)?.label ?? 'Admin'}
    >
      <Section />
    </AppShell>
  )
}
