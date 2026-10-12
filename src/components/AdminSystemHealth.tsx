import { useEffect, useState } from 'react'
import { CheckCircle2, CircleDashed, TriangleAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { isPaymentProviderConfigured } from '@/lib/providers/payments'
import { isKycProviderConfigured } from '@/lib/providers/kyc'
import { DashboardCard } from '@/components/DashboardCard'
import { cn } from '@/lib/utils'

type Health = 'ok' | 'warn' | 'off' | 'checking'

interface Row {
  label: string
  state: Health
  note: string
}

/**
 * HONEST system health — no invented uptime percentages. Live checks for the
 * services we can actually probe (database, auth, storage); the payment / KYC
 * provider rows read the real seam status (see src/lib/providers/*), and
 * SMTP/SMS report their true readiness. A row is green only when verified,
 * gray ("not configured") for the Phase-2 seams, gold for a launch to-do.
 */
export function AdminSystemHealth() {
  const [rows, setRows] = useState<Row[]>([
    { label: 'Database', state: 'checking', note: 'Postgres via Supabase' },
    { label: 'Authentication', state: 'checking', note: 'Supabase Auth' },
    { label: 'Storage', state: 'checking', note: 'avatars · listing-photos · evidence' },
    { label: 'Payment provider', state: 'off', note: 'Not configured - Phase 2 seam' },
    { label: 'Identity / KYC provider', state: 'off', note: 'Not configured - Phase 2 seam' },
    { label: 'Email (SMTP)', state: 'warn', note: 'Default sender - configure SMTP before launch' },
    { label: 'SMS', state: 'off', note: 'Not configured - Phase 2 enhancement' },
  ])

  useEffect(() => {
    let cancelled = false
    async function check() {
      const dbOk = !(await supabase.from('platform_config').select('id').eq('id', 1).maybeSingle()).error
      const authOk = !!(await supabase.auth.getSession()).data.session
      const storageOk = !(await supabase.storage.from('avatars').list('', { limit: 1 })).error
      if (cancelled) return
      setRows((prev) =>
        prev.map((r) => {
          if (r.label === 'Database') return { ...r, state: dbOk ? 'ok' : 'warn' }
          if (r.label === 'Authentication') return { ...r, state: authOk ? 'ok' : 'warn' }
          if (r.label === 'Storage') return { ...r, state: storageOk ? 'ok' : 'warn' }
          if (r.label === 'Payment provider') return { ...r, state: isPaymentProviderConfigured() ? 'ok' : 'off' }
          if (r.label === 'Identity / KYC provider') return { ...r, state: isKycProviderConfigured() ? 'ok' : 'off' }
          return r
        }),
      )
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <DashboardCard title="System health">
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-950">{r.label}</p>
              <p className="text-[11px] text-emerald-900/50">{r.note}</p>
            </div>
            <StatusPill state={r.state} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-emerald-900/40">
        Live readiness - not synthetic uptime. Phase-2 seams report as not configured until wired.
      </p>
    </DashboardCard>
  )
}

function StatusPill({ state }: { state: Health }) {
  if (state === 'checking') {
    return <span className="font-mono text-[11px] text-emerald-900/40">checking…</span>
  }
  const meta = {
    ok: { icon: CheckCircle2, chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', label: 'Operational' },
    warn: { icon: TriangleAlert, chip: 'bg-gold-100 text-gold-700', label: 'Attention' },
    off: { icon: CircleDashed, chip: 'bg-emerald-950/5 text-emerald-900/55', label: 'Not configured' },
  }[state]
  const Icon = meta.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', meta.chip)}>
      <Icon className="h-3.5 w-3.5" aria-hidden /> {meta.label}
    </span>
  )
}
