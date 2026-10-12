import { useT } from '@/lib/i18n'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Plus, UserRoundCog } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ROLE_CONFIGS } from '@/lib/roles'
import { addRole, addableRoles, switchableRoles } from '@/lib/userRoles'
import { isPlatformRole, type PlatformRole } from '@/lib/types'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

/**
 * Multi-role accounts: the roles this login holds, plus adding another.
 *
 * Adding is two steps on purpose — loamy_add_role records the entitlement, then
 * the onboarding form collects that role's details and switches into it. A role
 * left without details still works; the switcher just marks it "set up".
 */
export function MyRoles() {
  const { t } = useT()
  const { profile, heldRoles, refreshRoles, switchRole } = useAuth()
  const navigate = useNavigate()
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const active = isPlatformRole(profile?.platform_role) ? profile.platform_role : null
  const held = switchableRoles(heldRoles)
  const available = addableRoles(heldRoles)

  async function onAdd() {
    if (!isPlatformRole(choice)) {
      setMsg({ ok: false, text: 'Choose a role to add.' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await addRole(choice)
      await refreshRoles()
      // Straight into that role's detail form, which switches on save.
      navigate(`/onboarding?role=${choice}`)
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not add that role.' })
      setBusy(false)
    }
  }

  async function onSwitch(role: PlatformRole) {
    setBusy(true)
    setMsg(null)
    try {
      await switchRole(role)
      navigate(`/dashboard/${role}`, { replace: true })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not switch role.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardCard title={t('settings.yourRoles')}>
      <p className="text-xs leading-relaxed text-emerald-900/60">
        One login, one Digital ID. Add another role - a trader who also runs a
        warehouse, say - and switch between them from the header. Your profile,
        wallet and referrals are shared across all of them.
      </p>

      <ul className="mt-3 divide-y divide-line">
        {held.map((r) => {
          const cfg = ROLE_CONFIGS[r.role]
          const Icon = cfg.icon
          const isActive = r.role === active
          return (
            <li key={r.role} className="flex items-center gap-3 py-2.5">
              <Icon className="h-4 w-4 shrink-0 text-emerald-700" strokeWidth={1.5} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-emerald-950">{cfg.label}</p>
                {!r.onboarded && (
                  <p className="text-[11px] text-amber-700">{t('settings.detailsNotFilled')}</p>
                )}
              </div>
              {isActive ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                  <Check className="h-3.5 w-3.5" aria-hidden /> Active
                </span>
              ) : (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onSwitch(r.role)}>
                  Switch
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {available.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <Label htmlFor="add-role">{t('settings.addAnotherRole')}</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            <Select
              id="add-role"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="min-w-48 flex-1"
            >
              <option value="">{t('auth.selectRole')}</option>
              {available.map((slug) => (
                <option key={slug} value={slug}>{ROLE_CONFIGS[slug].label}</option>
              ))}
            </Select>
            {/* Default size, not sm: this sits beside a 40px select, and at
                sm it was a 30px target. */}
            <Button loading={busy} onClick={onAdd}>
              <Plus className="h-4 w-4" aria-hidden /> Add role
            </Button>
          </div>
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-emerald-900/50">
            <UserRoundCog className="mt-px h-3 w-3 shrink-0" aria-hidden />
            You’ll fill in a few details for the new role, then land on its dashboard.
          </p>
        </div>
      )}

      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={
            msg.ok
              ? 'mt-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800'
              : 'mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700'
          }
        >
          {msg.text}
        </p>
      )}
    </DashboardCard>
  )
}
