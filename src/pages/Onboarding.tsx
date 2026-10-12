import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ROLE_CONFIGS, SIGNUP_ROLE_CONFIGS, type FieldDef } from '@/lib/roles'
import { isPlatformRole, type PlatformRole } from '@/lib/types'
import { markRoleOnboarded, setInitialRole } from '@/lib/userRoles'
import { ACTIONABLE_REFUSALS, attributionRefusal } from '@/lib/referrals'
import { AuthLayout } from '@/pages/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { MultiSelectChips } from '@/components/ui/multiselect'
import { cn } from '@/lib/utils'

/**
 * First login after signup: a short role-details form that writes
 * role_details.role_data (jsonb) and flips profiles.onboarding_complete.
 * Members whose portal category didn't map to a canonical role pick their
 * role here first.
 *
 * It doubles as the ADD-A-ROLE form for multi-role accounts: `?role=<slug>`
 * collects that role's details, marks it onboarded, and switches into it. In
 * that mode role_data is MERGED, never replaced — a trader who adds a
 * warehouse must not lose their trading details.
 */
export default function Onboarding() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { profile, refreshProfile, refreshRoles, switchRole } = useAuth()
  const [chosenRole, setChosenRole] = useState<PlatformRole | null>(null)
  const [values, setValues] = useState<Record<string, string | string[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [referralNote, setReferralNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  // Claim any pending referral for THIS account (server-side guards:
  // self-attribution only, once, within the programme's window).
  //
  // The result is READ. loamy_record_referral delegates to
  // loamy_attribute_referral and returns {attributed, reason, message}; this
  // call used to be fire-and-forget, so a member whose code was wrong, stale
  // or their own was told nothing and the referrer silently never appeared.
  // Only a refusal the member can act on is shown -- "no active programme"
  // is not their problem and saying so would just be noise on the first
  // screen they ever see.
  useEffect(() => {
    const ref = localStorage.getItem('loamy_ref')
    if (!ref || !profile) return
    // Removed first: a failed attribution must not retry on every render.
    localStorage.removeItem('loamy_ref')
    void (async () => {
      const { data, error: refErr } = await supabase.rpc('loamy_record_referral', {
        p_ref_code: ref,
        p_method: 'referral_link',
      })
      if (refErr) return
      const r = (data ?? {}) as { attributed?: boolean; reason?: string }
      if (r.attributed) {
        setReferralNote({ tone: 'ok', text: 'Your referrer has been recorded.' })
      } else if (ACTIONABLE_REFUSALS.includes(r.reason ?? '')) {
        setReferralNote({ tone: 'warn', text: attributionRefusal(r.reason) })
      }
    })()
  }, [profile])

  // ?role= puts the form in add-a-role mode for an account that already has one.
  const roleParam = params.get('role')
  const addingRole: PlatformRole | null = isPlatformRole(roleParam) ? roleParam : null

  const activeRole: PlatformRole | null =
    addingRole ??
    (isPlatformRole(profile?.platform_role) ? profile!.platform_role : chosenRole)

  const config = activeRole ? ROLE_CONFIGS[activeRole] : null

  const missingRequired = useMemo(() => {
    if (!config) return []
    return config.onboarding.fields.filter((f) => {
      if (!f.required) return false
      const v = values[f.key]
      return v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
    })
  }, [config, values])

  if (profile?.platform_role === 'bank') {
    return <Navigate to="/bank" replace />
  }
  if (!addingRole && profile?.onboarding_complete && isPlatformRole(profile.platform_role)) {
    return <Navigate to={`/dashboard/${profile.platform_role}`} replace />
  }

  function setValue(key: string, value: string | string[]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !config || !activeRole) return
    setError(null)
    if (missingRequired.length > 0) {
      setError(`Please complete: ${missingRequired.map((f) => f.label).join(', ')}.`)
      return
    }
    setSubmitting(true)

    // Coerce number fields; keep everything else as entered.
    // SECURITY-REVIEW: role_data may only ever contain the keys defined in
    // src/lib/roles.ts onboarding fields — business/farm details, never
    // BVN/NIN/bank data. This loop is the single write path.
    const roleData: Record<string, unknown> = {}
    for (const field of config.onboarding.fields) {
      const raw = values[field.key]
      if (raw === undefined || raw === '') continue
      roleData[field.key] = field.type === 'number' ? Number(raw) : raw
    }

    // role_details holds ONE blob per account. Adding a second role merges into
    // it rather than overwriting the first role's answers.
    let merged = roleData
    if (addingRole) {
      const { data: existing } = await supabase
        .from('role_details')
        .select('role_data')
        .eq('user_id', profile.id)
        .maybeSingle()
      merged = { ...((existing?.role_data as Record<string, unknown>) ?? {}), ...roleData }
    }

    const { error: detailsError } = await supabase
      .from('role_details')
      .upsert({ user_id: profile.id, role_data: merged })
    if (detailsError) {
      setSubmitting(false)
      setError(detailsError.message)
      return
    }

    try {
      if (addingRole) {
        // The RPCs own platform_role here: switching is server-checked against
        // the roles the account actually holds.
        await markRoleOnboarded(addingRole)
        await switchRole(addingRole)
        await refreshRoles()
      } else {
        // platform_role is not client-writable any more; the RPC owns it.
        await setInitialRole(activeRole)
        await refreshProfile()
        await refreshRoles()
      }
    } catch (err) {
      setSubmitting(false)
      setError(err instanceof Error ? err.message : 'Could not finish setup.')
      return
    }

    setSubmitting(false)
    navigate(`/dashboard/${activeRole}`, { replace: true })
  }

  // Step 0 — role picker (only when the account has no recognised role yet).
  if (!config) {
    return (
      <AuthLayout
        wide
        title={`Welcome, ${profile?.full_name?.split(' ')[0] ?? 'member'}`}
        subtitle="First, tell us how you participate in Nigerian agriculture."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {SIGNUP_ROLE_CONFIGS.map((r) => {
            const Icon = r.icon
            const selected = chosenRole === r.slug
            return (
              <button
                key={r.slug}
                type="button"
                onClick={() => setChosenRole(r.slug)}
                aria-pressed={selected}
                className={cn(
                  'rounded-card border p-4 text-left transition-colors',
                  selected
                    ? 'border-emerald-800 bg-emerald-50 ring-1 ring-emerald-800'
                    : 'border-emerald-100 bg-white hover:border-emerald-300 hover:bg-emerald-50/50',
                )}
              >
                <Icon className="h-5 w-5 text-emerald-700" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-emerald-950">{r.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-emerald-900/55">{r.tagline}</p>
              </button>
            )
          })}
        </div>
        <p className="mt-5 text-center text-xs text-emerald-900/45">
          Pick the role that best describes you - you can refine details on the next step.
        </p>
      </AuthLayout>
    )
  }

  const roleCameFromPicker = !addingRole && !isPlatformRole(profile?.platform_role)

  return (
    <AuthLayout
      wide
      title={addingRole ? `Add your ${config.label.toLowerCase()} role` : `Set up your ${config.label.toLowerCase()} profile`}
      subtitle={config.onboarding.intro}
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {config.onboarding.fields.map((field: FieldDef) => (
          <div key={field.key}>
            <Label htmlFor={field.key}>
              {field.label}
              {field.required && <span className="text-gold-500"> *</span>}
            </Label>
            {field.type === 'text' && (
              <Input
                id={field.key}
                value={(values[field.key] as string) ?? ''}
                onChange={(e) => setValue(field.key, e.target.value)}
                placeholder={field.placeholder}
              />
            )}
            {field.type === 'number' && (
              <Input
                id={field.key}
                type="number"
                min={0}
                step="any"
                value={(values[field.key] as string) ?? ''}
                onChange={(e) => setValue(field.key, e.target.value)}
                placeholder={field.placeholder}
              />
            )}
            {field.type === 'select' && (
              <Select
                id={field.key}
                value={(values[field.key] as string) ?? ''}
                onChange={(e) => setValue(field.key, e.target.value)}
              >
                <option value="" disabled>
                  Select…
                </option>
                {field.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            )}
            {field.type === 'multiselect' && field.options && (
              <MultiSelectChips
                options={field.options}
                value={(values[field.key] as string[]) ?? []}
                onChange={(next) => setValue(field.key, next)}
              />
            )}
          </div>
        ))}

        {/* Whether the referrer on the link was actually recorded. Said once,
            quietly, and never as an error the member has to clear. */}
        {referralNote && (
          <p className={cn(
            'rounded-lg px-3 py-2 text-sm',
            referralNote.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800',
          )}>
            {referralNote.text}
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={submitting}>
          {addingRole ? `Add ${config.label} role` : 'Finish setup'}
        </Button>

        {addingRole && (
          <p className="text-center text-xs text-emerald-900/50">
            Same login, same Digital ID - you can switch between your roles from the
            header at any time.
          </p>
        )}

        {roleCameFromPicker && (
          <button
            type="button"
            onClick={() => {
              setChosenRole(null)
              setValues({})
              setError(null)
            }}
            className="w-full text-center text-xs font-medium text-emerald-700 hover:text-emerald-800"
          >
            &larr; Choose a different role
          </button>
        )}
      </form>
    </AuthLayout>
  )
}
