import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ROLE_CONFIGS } from '@/lib/roles'
import { AppShell } from '@/components/layout/AppShell'

/**
 * Chrome + guard for farmer deep routes (farm detail, financing wizard, …):
 * only farmers (and admins, pending Stage 6 tooling) may enter; everyone else
 * gets the clean unauthorized-redirect home.
 */
export function FarmerShell({ section, children }: { section: string; children: ReactNode }) {
  const { profile } = useAuth()
  const config = ROLE_CONFIGS.farmer

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Loading" />
      </div>
    )
  }
  if (profile.platform_role !== 'farmer' && profile.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return (
    <AppShell
      nav={config.nav}
      activeSection={section}
      sectionHref={(s) => (s === 'overview' ? '/dashboard/farmer' : `/dashboard/farmer/${s}`)}
      roleLabel={profile.role === 'admin' ? 'Admin' : 'Farmer'}
    >
      {children}
    </AppShell>
  )
}
