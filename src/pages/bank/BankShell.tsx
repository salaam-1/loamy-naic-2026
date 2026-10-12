import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity, BellRing, Banknote, CalendarClock, FileText, LayoutDashboard, ListChecks,
  MessageSquare, Receipt, Settings, ShieldCheck, Users, Wallet,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AppShell } from '@/components/layout/AppShell'
import type { NavItem } from '@/lib/roles'
import { useT } from '@/lib/i18n'

/**
 * Bank portal chrome. Full lending sidebar. Servicing figures are
 * bank-confirmed records — no approve/decline, no fund custody on Loamy.
 * Messaging is a platform-wide unbuilt feature (honest placeholder).
 */
const BANK_NAV: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, section: 'overview' },
  { label: 'Loan Applications', icon: ListChecks, section: 'pipeline' },
  { label: 'Loans', icon: Wallet, section: 'loans' },
  { label: 'Customers', icon: Users, section: 'customers' },
  { label: 'Collateral', icon: ShieldCheck, section: 'collateral' },
  { label: 'Disbursements', icon: Banknote, section: 'disbursements' },
  { label: 'Repayments', icon: CalendarClock, section: 'repayments' },
  { label: 'Transactions', icon: Receipt, section: 'transactions' },
  { label: 'Reports', icon: FileText, section: 'reports' },
  { label: 'Risk & Compliance', icon: ShieldCheck, section: 'risk' },
  { label: 'Alerts', icon: BellRing, section: 'alerts' },
  { label: 'Monitoring', icon: Activity, section: 'monitoring' },
  { label: 'Messages', icon: MessageSquare, section: 'messages' },
  { label: 'Settings', icon: Settings, section: 'settings' },
]

export function BankShell({ section, children }: { section: string; children: ReactNode }) {
  const { t } = useT()
  const [overdue, setOverdue] = useState(0)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('loamy_mark_overdue_repayments').then(async () => {
      const { count } = await supabase.from('repayment_schedule').select('id', { count: 'exact', head: true }).eq('status', 'overdue')
      if (!cancelled) setOverdue(count ?? 0)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <AppShell
      nav={BANK_NAV}
      activeSection={section}
      sectionHref={(s) => (s === 'overview' ? '/bank' : `/bank/${s}`)}
      roleLabel={t('bank.roleOfficer')}
      pageTitle={BANK_NAV.find((n) => n.section === section)?.label ?? 'Dashboard'}
      badges={{ alerts: overdue }}
    >
      {children}
    </AppShell>
  )
}
