import { useState } from 'react'
import { Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { downloadCsv } from '@/lib/csv'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'

/**
 * Admin CSV exports. Personal identifiers are limited to name + Digital ID +
 * state; every export is audit-logged.
 */
const EXPORTS: { kind: string; label: string; run: () => Promise<void> }[] = [
  {
    kind: 'users',
    label: 'Users - name, Digital ID, role, state, badge, status, joined',
    run: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, digital_id, platform_role, state, verified_badge, active, created_at')
        .order('created_at')
      await downloadCsv('users',
        ['full_name', 'digital_id', 'platform_role', 'state', 'verified_badge', 'active', 'created_at'],
        (data ?? []).map((r) => [r.full_name, r.digital_id, r.platform_role, r.state, r.verified_badge, r.active, r.created_at]))
    },
  },
  {
    kind: 'applications',
    label: 'Financing applications - status, amount, product (no drafts)',
    run: async () => {
      const { data } = await supabase
        .from('financing_applications')
        .select('id, product_type, structure, amount_requested, status, created_at, updated_at')
        .neq('status', 'draft')
        .order('created_at')
      await downloadCsv('applications',
        ['id', 'product_type', 'structure', 'amount_requested', 'status', 'created_at', 'updated_at'],
        (data ?? []).map((r) => [r.id, r.product_type, r.structure, r.amount_requested, r.status, r.created_at, r.updated_at]))
    },
  },
  {
    kind: 'verifications',
    label: 'Verification tasks - type, status, timestamps (no evidence)',
    run: async () => {
      const { data } = await supabase
        .from('verification_tasks')
        .select('id, task_type, status, priority, created_at, completed_at')
        .order('created_at')
      await downloadCsv('verifications',
        ['id', 'task_type', 'status', 'priority', 'created_at', 'completed_at'],
        (data ?? []).map((r) => [r.id, r.task_type, r.status, r.priority, r.created_at, r.completed_at]))
    },
  },
  {
    kind: 'listings',
    label: 'Marketplace listings - commodity, quantity, price, state, status',
    run: async () => {
      const { data } = await supabase
        .from('listings')
        .select('id, listing_type, commodity, quantity_kg, unit, price_per_unit, state, status, created_at')
        .order('created_at')
      await downloadCsv('listings',
        ['id', 'listing_type', 'commodity', 'quantity_kg', 'unit', 'price_per_unit', 'state', 'status', 'created_at'],
        (data ?? []).map((r) => [r.id, r.listing_type, r.commodity, r.quantity_kg, r.unit, r.price_per_unit, r.state, r.status, r.created_at]))
    },
  },
  {
    kind: 'partner-earnings',
    label: 'Partner earnings - type, amount, status (tracked, paid off-platform)',
    run: async () => {
      const { data } = await supabase
        .from('partner_earnings')
        .select('id, partner_id, earning_type, amount, status, created_at')
        .order('created_at')
      await downloadCsv('partner-earnings',
        ['id', 'partner_id', 'earning_type', 'amount', 'status', 'created_at'],
        (data ?? []).map((r) => [r.id, r.partner_id, r.earning_type, r.amount, r.status, r.created_at]))
    },
  },
]

export default function AdminExports() {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function run(exp: (typeof EXPORTS)[number]) {
    setMsg(null)
    setBusy(exp.kind)
    try {
      await exp.run()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Export failed')
    }
    setBusy(null)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <DashboardCard title="CSV exports">
        <p className="mb-3 text-[13px] text-emerald-900/55">
          Each export is audit-logged. Personal identifiers are limited to name, Digital ID, and
          state.
        </p>
        {msg && <p className="mb-2 rounded bg-red-50 px-2.5 py-1.5 text-sm text-red-700">{msg}</p>}
        <ul className="divide-y divide-line">
          {EXPORTS.map((exp) => (
            <li key={exp.kind} className="flex items-center justify-between gap-3 py-2">
              <p className="text-sm text-emerald-950">{exp.label}</p>
              <Button size="sm" variant="outline" loading={busy === exp.kind} onClick={() => void run(exp)}>
                <Download className="h-3.5 w-3.5" aria-hidden /> Export
              </Button>
            </li>
          ))}
        </ul>
      </DashboardCard>
    </div>
  )
}
