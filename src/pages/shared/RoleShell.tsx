import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ROLE_CONFIGS } from '@/lib/roles'
import { isPlatformRole, type PlatformRole } from '@/lib/types'
import { AppShell } from '@/components/layout/AppShell'

/**
 * Generic chrome + guard for deep routes shared across roles (listing detail,
 * listing editor, …). Renders the SIGNED-IN user's own role nav regardless of
 * the :role URL segment; `allowedRoles` gives a clean unauthorized-redirect.
 */
export function RoleShell({
  section,
  allowedRoles,
  children,
}: {
  section: string
  allowedRoles?: PlatformRole[]
  children: ReactNode
}) {
  const { profile } = useAuth()

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Loading" />
      </div>
    )
  }

  const role = profile.platform_role
  const isAdmin = profile.role === 'admin'
  if (!isPlatformRole(role)) return <Navigate to={isAdmin ? '/admin' : '/'} replace />
  if (allowedRoles && !allowedRoles.includes(role) && !isAdmin) {
    return <Navigate to={`/dashboard/${role}`} replace />
  }

  const config = ROLE_CONFIGS[role]
  return (
    <AppShell
      nav={config.nav}
      activeSection={section}
      sectionHref={(s) => (s === 'overview' ? `/dashboard/${role}` : `/dashboard/${role}/${s}`)}
      roleLabel={isAdmin ? 'Admin' : config.label}
    >
      {children}
    </AppShell>
  )
}
