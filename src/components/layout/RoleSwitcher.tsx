import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, CircleAlert, Plus } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ROLE_CONFIGS } from '@/lib/roles'
import { switchableRoles } from '@/lib/userRoles'
import { isPlatformRole, type PlatformRole } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * Active-role switcher for multi-role accounts. One login can hold several
 * roles; this changes which dashboard the account is currently working in.
 *
 * The switch itself is a server RPC that re-checks the account actually holds
 * the role — this menu is convenience, never the authorisation.
 */
export function RoleSwitcher({ roleLabel }: { roleLabel: string }) {
  const { t } = useT()
  const { profile, heldRoles, switchRole } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<PlatformRole | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const options = switchableRoles(heldRoles)
  const active = isPlatformRole(profile?.platform_role) ? profile.platform_role : null

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // A single-role account gets the plain label it always had.
  if (options.length < 2) {
    return <span className="block text-[10px] text-emerald-900/50">{roleLabel}</span>
  }

  async function pick(role: PlatformRole) {
    if (role === active) {
      setOpen(false)
      return
    }
    setBusy(role)
    setError(null)
    try {
      await switchRole(role)
      setOpen(false)
      navigate(`/dashboard/${role}`, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch role.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        /* The rendered text is 10px, so the BUTTON was a 13px target. Padding
           takes the real hit area to ~33px while the equal negative margin
           keeps the avatar cluster exactly where it was — measured, not
           assumed: scripts/visual-qa-home.mjs fails any control under 32px. */
        className="-my-3 flex items-center gap-0.5 rounded px-1 py-3 text-[10px] text-emerald-900/50 hover:bg-sand/70 hover:text-emerald-800"
      >
        {roleLabel}
        <ChevronDown className="h-3 w-3" strokeWidth={2} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-60 rounded border border-line bg-white py-1 shadow-card-hover"
        >
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900/40">
            Switch role
          </p>
          {options.map((held) => {
            const cfg = ROLE_CONFIGS[held.role]
            const Icon = cfg.icon
            const isActive = held.role === active
            return (
              <button
                key={held.role}
                type="button"
                role="menuitem"
                disabled={busy !== null}
                onClick={() => pick(held.role)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-50',
                  isActive ? 'bg-emerald-50 text-emerald-950' : 'text-emerald-900/80 hover:bg-emerald-50/60',
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-emerald-700" strokeWidth={1.5} aria-hidden />
                <span className="flex-1 truncate">{cfg.label}</span>
                {busy === held.role ? (
                  <span className="text-[10px] text-emerald-900/45">switching…</span>
                ) : isActive ? (
                  <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
                ) : !held.onboarded ? (
                  <span className="text-[10px] text-amber-700">set up</span>
                ) : null}
              </button>
            )
          })}

          <div className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                navigate(`/dashboard/${active ?? 'farmer'}/settings`)
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-emerald-700 hover:bg-emerald-50/60"
            >
              <Plus className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden /> {t('roles.addARole')}
            </button>
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-1.5 px-3 pb-2 pt-1 text-[11px] text-red-700">
              <CircleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden /> {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
