import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MapPinned, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { NIGERIA_STATES } from '@/lib/nigeria'
import { PAYOUT_COPY, type PartnerAssignment, type PartnerEarning } from '@/lib/partner'
import { fetchPublicProfiles, type PublicProfile } from '@/lib/marketplace'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { SellerCard } from '@/components/SellerCard'
import { NoteDialog } from '@/components/NoteDialog'

interface PartnerRow {
  id: string
  full_name: string | null
  state: string | null
  can_verify: boolean
}

/**
 * Partner management: grant/revoke the can_verify capability (via the
 * admin-only security-definer function), territory assignments, partner
 * rates, and marking earnings paid AFTER the off-platform payout.
 * No payment execution exists anywhere.
 */
export default function AdminPartners() {
  const [partners, setPartners] = useState<PartnerRow[] | null>(null)
  const [assignments, setAssignments] = useState<PartnerAssignment[]>([])
  const [profiles, setProfiles] = useState<Record<string, PublicProfile>>({})
  const [earnings, setEarnings] = useState<PartnerEarning[]>([])
  const [rates, setRates] = useState<{ onboarding: string; verification: string }>({ onboarding: '', verification: '' })
  const [terrPartner, setTerrPartner] = useState('')
  const [terrState, setTerrState] = useState('')
  const [terrLgas, setTerrLgas] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [payingEarning, setPayingEarning] = useState<PartnerEarning | null>(null)

  const load = useCallback(async () => {
    const [profilesRes, detailsRes, assignRes, earnRes, cfgRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, state').eq('platform_role', 'growth_partner'),
      supabase.from('role_details').select('user_id, role_data'),
      supabase.from('partner_assignments').select('*').order('created_at', { ascending: false }),
      supabase.from('partner_earnings').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('platform_config').select('partner_rates').eq('id', 1).maybeSingle(),
    ])
    const details = new Map(
      ((detailsRes.data as { user_id: string; role_data: Record<string, unknown> }[]) ?? []).map((d) => [d.user_id, d.role_data]),
    )
    const rows = ((profilesRes.data as { id: string; full_name: string | null; state: string | null }[]) ?? []).map((p) => ({
      ...p,
      can_verify: details.get(p.id)?.can_verify === true,
    }))
    setPartners(rows)
    const assigns = (assignRes.data as PartnerAssignment[]) ?? []
    setAssignments(assigns)
    const earns = (earnRes.data as PartnerEarning[]) ?? []
    setEarnings(earns)
    setProfiles(
      await fetchPublicProfiles([
        ...rows.map((r) => r.id),
        ...assigns.map((a) => a.partner_id),
        ...earns.map((e) => e.partner_id),
      ]),
    )
    const pr = cfgRes.data?.partner_rates as Record<string, number> | undefined
    if (pr) setRates({ onboarding: String(pr.onboarding ?? ''), verification: String(pr.verification ?? '') })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleCanVerify(partner: PartnerRow) {
    setBusy(partner.id)
    const { error } = await supabase.rpc('loamy_set_can_verify', {
      p_user: partner.id,
      p_value: !partner.can_verify,
    })
    setBusy(null)
    if (error) setMsg(error.message)
    await load()
  }

  async function addAssignment(e: FormEvent) {
    e.preventDefault()
    if (!terrPartner || !terrState) return
    setBusy('territory')
    const lgas = terrLgas.split(',').map((s) => s.trim()).filter(Boolean)
    const { error } = await supabase.from('partner_assignments').insert({
      partner_id: terrPartner,
      state: terrState,
      lgas,
    })
    setBusy(null)
    if (error) setMsg(error.message)
    setTerrLgas('')
    await load()
  }

  async function removeAssignment(id: string) {
    await supabase.from('partner_assignments').delete().eq('id', id)
    await load()
  }

  async function saveRates(e: FormEvent) {
    e.preventDefault()
    setBusy('rates')
    const { error } = await supabase
      .from('platform_config')
      .update({
        partner_rates: {
          onboarding: Number(rates.onboarding) || 0,
          verification: Number(rates.verification) || 0,
        },
      })
      .eq('id', 1)
    setBusy(null)
    setMsg(error ? error.message : 'Rates updated - applied at accrual time going forward.')
  }

  function markPaid(earning: PartnerEarning) {
    setPayingEarning(earning)
  }

  if (partners === null) {
    return <div className="h-40 animate-pulse rounded-card bg-white" aria-label="Loading partners" />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {msg && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>
      )}

      <DashboardCard title={`Growth partners (${partners.length})`}>
        {partners.length === 0 ? (
          <p className="py-4 text-sm text-emerald-900/50">No growth partners registered yet.</p>
        ) : (
          <ul className="divide-y divide-emerald-950/5">
            {partners.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <SellerCard profile={profiles[p.id]} />
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium',
                      p.can_verify
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-emerald-950/5 text-emerald-900/55',
                    )}
                  >
                    {p.can_verify ? 'Can verify' : 'Onboarding only'}
                  </span>
                  <Button size="sm" variant="outline" loading={busy === p.id} onClick={() => toggleCanVerify(p)}>
                    {p.can_verify ? <ShieldOff className="h-3.5 w-3.5" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
                    {p.can_verify ? 'Revoke' : 'Grant verification'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>

      <DashboardCard title="Territory assignments">
        <form onSubmit={addAssignment} className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" noValidate>
          <div>
            <Label htmlFor="tp">Partner</Label>
            <Select id="tp" value={terrPartner} onChange={(e) => setTerrPartner(e.target.value)}>
              <option value="" disabled>Select…</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name ?? p.id.slice(0, 8)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tst">State</Label>
            <Select id="tst" value={terrState} onChange={(e) => setTerrState(e.target.value)}>
              <option value="" disabled>Select…</option>
              {NIGERIA_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tlga">LGAs (comma-separated, blank = whole state)</Label>
            <Input id="tlga" value={terrLgas} onChange={(e) => setTerrLgas(e.target.value)} placeholder="e.g. Zaria, Sabon Gari" />
          </div>
          <div className="flex items-end">
            <Button type="submit" size="sm" loading={busy === 'territory'}>
              <MapPinned className="h-3.5 w-3.5" aria-hidden /> Assign
            </Button>
          </div>
        </form>
        {assignments.length === 0 ? (
          <p className="text-sm text-emerald-900/50">No territories assigned yet.</p>
        ) : (
          <ul className="divide-y divide-emerald-950/5">
            {assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <p className="text-sm text-emerald-950">
                  {profiles[a.partner_id]?.full_name ?? '-'} → <span className="font-medium">{a.state}</span>
                  <span className="text-xs text-emerald-900/50">
                    {' '}{a.lgas.length ? `(${a.lgas.join(', ')})` : '(whole state)'}
                  </span>
                </p>
                <button type="button" onClick={() => removeAssignment(a.id)} className="rounded-md p-1.5 text-emerald-900/35 hover:bg-red-50 hover:text-red-600" aria-label="Remove assignment">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>

      {/* Partner rates moved to /admin/configuration (Stage 6). */}
      <DashboardCard title="Earnings ledger">
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{PAYOUT_COPY} Mark an
          earning paid only AFTER the off-platform payout is done.</p>
        {earnings.length === 0 ? (
          <p className="text-sm text-emerald-900/50">No earnings accrued yet.</p>
        ) : (
          <ul className="divide-y divide-emerald-950/5">
            {earnings.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm text-emerald-950">
                    {profiles[e.partner_id]?.full_name ?? '-'} · {e.earning_type} · {formatNaira(Number(e.amount))}
                  </p>
                  <p className="text-[11px] text-emerald-900/45">
                    {formatDateShort(e.created_at)}{e.paid_note ? ` · ${e.paid_note}` : ''}
                  </p>
                </div>
                {e.status === 'accrued' ? (
                  <Button size="sm" variant="outline" loading={busy === e.id} onClick={() => markPaid(e)}>
                    Mark paid externally
                  </Button>
                ) : (
                  <span className="rounded bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                    Paid externally
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>

      <NoteDialog
        open={!!payingEarning}
        onClose={() => setPayingEarning(null)}
        title="Mark earning paid externally"
        label="Payout note (optional)"
        placeholder="e.g. bank transfer reference"
        submitLabel="Mark paid"
        onSubmit={async (note) => {
          if (!payingEarning) return
          const { error } = await supabase
            .from('partner_earnings')
            .update({ status: 'paid_externally', paid_note: note })
            .eq('id', payingEarning.id)
          if (error) throw new Error(error.message)
          await load()
        }}
      />
    </div>
  )
}
