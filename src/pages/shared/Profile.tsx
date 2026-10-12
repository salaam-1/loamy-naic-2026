import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { IdCard, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ROLE_CONFIGS, type FieldDef } from '@/lib/roles'
import { isPlatformRole } from '@/lib/types'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { MultiSelectChips } from '@/components/ui/multiselect'

/**
 * Role profile editor — lets a member update the role-specific details they
 * gave at onboarding (role_details.role_data), post-onboarding. Reuses each
 * role's onboarding field definitions so there is one source of truth.
 * SECURITY-REVIEW: writes the SAME low-sensitivity keys as onboarding — never
 * BVN/NIN or financial data. RLS keeps role_details owner-only.
 */
export default function Profile() {
  const { profile } = useAuth()
  const role = isPlatformRole(profile?.platform_role) ? profile!.platform_role : null
  const config = role ? ROLE_CONFIGS[role] : null
  const fields = useMemo<FieldDef[]>(() => config?.onboarding.fields ?? [], [config])

  const [values, setValues] = useState<Record<string, string | string[]>>({})
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    supabase
      .from('role_details')
      .select('role_data')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const rd = (data?.role_data as Record<string, unknown>) ?? {}
        const next: Record<string, string | string[]> = {}
        for (const f of fields) {
          const v = rd[f.key]
          next[f.key] = Array.isArray(v) ? (v as string[]) : v == null ? '' : String(v)
        }
        setValues(next)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [profile, fields])

  function setValue(key: string, value: string | string[]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !config) return
    setMsg(null)
    const missing = fields.filter((f) => {
      if (!f.required) return false
      const v = values[f.key]
      return v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
    })
    if (missing.length > 0) {
      setMsg({ ok: false, text: `Please complete: ${missing.map((f) => f.label).join(', ')}.` })
      return
    }
    setSaving(true)
    const roleData: Record<string, unknown> = {}
    for (const f of fields) {
      const raw = values[f.key]
      if (raw === undefined || raw === '') continue
      roleData[f.key] = f.type === 'number' ? Number(raw) : raw
    }
    // Merge onto existing role_data so capability flags (e.g. can_verify) and
    // other keys are preserved.
    const { data: existing } = await supabase
      .from('role_details')
      .select('role_data')
      .eq('user_id', profile.id)
      .maybeSingle()
    const merged = { ...((existing?.role_data as Record<string, unknown>) ?? {}), ...roleData }
    const { error } = await supabase
      .from('role_details')
      .upsert({ user_id: profile.id, role_data: merged })
    setSaving(false)
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Profile details updated.' })
  }

  if (!config) {
    return <div className="mx-auto max-w-2xl text-sm text-emerald-900/60">No role profile to edit.</div>
  }

  return (
    <div className="mx-auto max-w-2xl">
      <DashboardCard title={`${config.label} profile`}>
        <p className="mb-3 flex items-center gap-1.5 text-[13px] text-emerald-900/55">
          <IdCard className="h-4 w-4" aria-hidden />
          Your name, phone, and photo live under Settings. These are your role-specific details.
        </p>
        {!loaded ? (
          <div className="h-24 animate-pulse rounded bg-emerald-50" aria-label="Loading profile" />
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {fields.map((field) => (
              <div key={field.key}>
                <Label htmlFor={`pf_${field.key}`}>
                  {field.label}
                  {field.required && <span className="text-gold-500"> *</span>}
                </Label>
                {field.type === 'text' && (
                  <Input id={`pf_${field.key}`} value={(values[field.key] as string) ?? ''} onChange={(e) => setValue(field.key, e.target.value)} placeholder={field.placeholder} />
                )}
                {field.type === 'number' && (
                  <Input id={`pf_${field.key}`} type="number" min={0} step="any" value={(values[field.key] as string) ?? ''} onChange={(e) => setValue(field.key, e.target.value)} placeholder={field.placeholder} />
                )}
                {field.type === 'select' && (
                  <Select id={`pf_${field.key}`} value={(values[field.key] as string) ?? ''} onChange={(e) => setValue(field.key, e.target.value)}>
                    <option value="" disabled>Select…</option>
                    {field.options?.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </Select>
                )}
                {field.type === 'multiselect' && field.options && (
                  <MultiSelectChips options={field.options} value={(values[field.key] as string[]) ?? []} onChange={(next) => setValue(field.key, next)} />
                )}
              </div>
            ))}
            {msg && (
              <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'rounded bg-emerald-50 px-2.5 py-1.5 text-sm text-emerald-800' : 'rounded bg-red-50 px-2.5 py-1.5 text-sm text-red-700'}>
                {msg.text}
              </p>
            )}
            <Button type="submit" loading={saving}>
              <Save className="h-4 w-4" aria-hidden /> Save details
            </Button>
          </form>
        )}
      </DashboardCard>
    </div>
  )
}
