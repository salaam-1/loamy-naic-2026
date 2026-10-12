import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Landmark, UserRoundPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { NIGERIA_STATES } from '@/lib/nigeria'
import { cn, formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

interface Bank {
  id: string
  name: string
  active: boolean
}

interface OfficerRow {
  id: string
  full_name: string | null
  created_at: string
  bank_id?: string
  active: boolean
}

/**
 * Bank officer lifecycle — ADMIN ONLY. There is no self-signup path for
 * banks: the account is created here (isolated client, admin session
 * untouched) and assigned to a bank via the security-definer setup function.
 */
export default function AdminBankOfficers() {
  const [banks, setBanks] = useState<Bank[]>([])
  const [officers, setOfficers] = useState<OfficerRow[] | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [stateName, setStateName] = useState('Lagos')
  const [bankId, setBankId] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [banksRes, officersRes] = await Promise.all([
      supabase.from('banks').select('*').order('name'),
      supabase.from('profiles').select('id, full_name, created_at').eq('platform_role', 'bank'),
    ])
    const bankRows = (banksRes.data as Bank[]) ?? []
    setBanks(bankRows)
    if (!bankId && bankRows[0]) setBankId(bankRows[0].id)

    // role_details was read whole, every row for every member on the platform,
    // to look up a handful of bank officers. Ask for the officers' rows only:
    // the officer list is already filtered to platform_role 'bank', so the set
    // of ids is small and known before this runs.
    const officerIds = ((officersRes.data as { id: string }[]) ?? []).map((o) => o.id)
    const detailsRes = officerIds.length
      ? await supabase.from('role_details').select('user_id, role_data').in('user_id', officerIds)
      : { data: [] as { user_id: string; role_data: Record<string, unknown> }[] }
    const details = new Map(
      ((detailsRes.data as { user_id: string; role_data: Record<string, unknown> }[]) ?? []).map((d) => [d.user_id, d.role_data]),
    )
    setOfficers(
      ((officersRes.data as { id: string; full_name: string | null; created_at: string }[]) ?? []).map((o) => ({
        ...o,
        bank_id: details.get(o.id)?.bank_id as string | undefined,
        active: details.get(o.id)?.active !== false,
      })),
    )
  }, [bankId])

  useEffect(() => {
    void load()
  }, [load])

  async function createOfficer(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (password.length < 8) return setMsg({ ok: false, text: 'Starting password must be at least 8 characters.' })
    if (!bankId) return setMsg({ ok: false, text: 'Select a bank.' })
    setBusy('create')

    // Isolated client — the admin session is never touched. No category is
    // sent: bank officers are not portal members and never appear at signup.
    const officerClient = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data, error } = await officerClient.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          platform_role: 'bank',
          // Officer duty location (portal schema requires a state; no category —
          // bank officers are not agricultural participants).
          state: stateName,
        },
      },
    })
    if (error || !data.user) {
      setBusy(null)
      return setMsg({ ok: false, text: error?.message ?? 'Could not create the account.' })
    }
    await officerClient.auth.signOut()

    const { error: setupErr } = await supabase.rpc('loamy_setup_bank_officer', {
      p_user: data.user.id,
      p_bank: bankId,
    })
    setBusy(null)
    if (setupErr) return setMsg({ ok: false, text: `Account created but assignment failed: ${setupErr.message}` })
    setMsg({ ok: true, text: `Officer account created and assigned. Share the starting password securely; they should change it after first login.` })
    setFullName(''); setEmail(''); setPhone(''); setPassword('')
    await load()
  }

  async function toggleActive(o: OfficerRow) {
    setBusy(o.id)
    const { error } = await supabase.rpc('loamy_set_bank_officer_active', {
      p_user: o.id,
      p_active: !o.active,
    })
    setBusy(null)
    if (error) setMsg({ ok: false, text: error.message })
    await load()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <DashboardCard title="Create bank officer">
        <form onSubmit={createOfficer} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="bo_name">Full name</Label>
              <Input id="bo_name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="bo_email">Email</Label>
              <Input id="bo_email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="bo_phone">Phone</Label>
              <Input id="bo_phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="bo_bank">Bank</Label>
              <Select id="bo_bank" value={bankId} onChange={(e) => setBankId(e.target.value)}>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="bo_state">Duty state</Label>
              <Select id="bo_state" value={stateName} onChange={(e) => setStateName(e.target.value)}>
                {NIGERIA_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="bo_pw">Starting password (officer changes it after first login)</Label>
              <Input id="bo_pw" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'rounded bg-emerald-50 px-2.5 py-1.5 text-sm text-emerald-800' : 'rounded bg-red-50 px-2.5 py-1.5 text-sm text-red-700'}>
              {msg.text}
            </p>
          )}
          <Button type="submit" size="sm" loading={busy === 'create'}>
            <UserRoundPlus className="h-4 w-4" aria-hidden /> Create officer
          </Button>
        </form>
      </DashboardCard>

      <DashboardCard title={`Officers (${officers?.length ?? 0})`}>
        {officers === null ? (
          <div className="h-16 animate-pulse rounded bg-emerald-50" aria-label="Loading officers" />
        ) : officers.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-emerald-900/55">
            <Landmark className="h-4 w-4" aria-hidden /> No bank officers yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="py-2 pr-4 font-medium">Officer</th>
                <th className="py-2 pr-4 font-medium">Bank</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {officers.map((o) => (
                <tr key={o.id}>
                  <td className="py-2 pr-4 font-medium text-emerald-950">{o.full_name ?? '-'}</td>
                  <td className="py-2 pr-4 text-emerald-900/70">
                    {banks.find((b) => b.id === o.bank_id)?.name ?? '-'}
                  </td>
                  <td className="py-2 pr-4 text-emerald-900/70">{formatDateShort(o.created_at)}</td>
                  <td className="py-2 pr-4">
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', o.active ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200')}>
                      {o.active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="outline" loading={busy === o.id} onClick={() => toggleActive(o)}>
                      {o.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DashboardCard>
    </div>
  )
}
