import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { isPlatformRole } from '@/lib/types'

/** Shared by the route guards and RoleDashboard, so 'waiting for the
 *  profile' looks the same wherever it happens. */
export function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Loading" />
    </div>
  )
}

/** Full-screen block for suspended accounts (Stage 6). Server-side, the
 * security-definer action paths refuse the account too. */
function DeactivatedScreen() {
  const { signOut } = useAuth()
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-sm rounded border border-line bg-white p-5 text-center">
        <p className="text-sm font-semibold text-emerald-950">Account deactivated</p>
        <p className="mt-1 text-[13px] text-emerald-900/60">
          This account has been deactivated by the Loamy team. Contact support to resolve it.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-4 rounded bg-emerald-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

/** Blocks a route until there is a signed-in session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace />
  if (profile && profile.active === false) return <DeactivatedScreen />
  return <>{children}</>
}

/** Bank-portal routes: bank officers (and admins) only. */
export function RequireBank({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <FullScreenLoader />
  if (profile.active === false) return <DeactivatedScreen />
  if (profile.platform_role !== 'bank' && profile.role !== 'admin') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

/** Admin-only routes; non-admins are cleanly redirected home. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace />
  // Wait for the profile before judging the role. `loading` covers the
  // SESSION; the profile arrives on a later tick, so a null profile here
  // means "not known yet", not "not an admin".
  //
  // Without this, every hard load of an admin deep link bounced: an admin
  // opening /admin/users was sent to "/", which routes a signed-in user to
  // their dashboard, which is /admin -- so the section silently vanished and
  // it looked like the route did not exist. Only in-app Link navigation
  // worked, because the profile was already resolved by then. RequireBank
  // directly above already had this guard; RequireAdmin did not.
  if (!profile) return <FullScreenLoader />
  if (profile.active === false) return <DeactivatedScreen />
  if (profile.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

/** Routes signed-out users to login; signed-in users to "/" for role routing,
 * or to a safe same-origin `?redirect=` path when present (marketplace gate). */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth()
  if (loading) return <FullScreenLoader />
  if (session) {
    const redirect = new URLSearchParams(window.location.search).get('redirect')
    // Only allow same-origin absolute paths (no protocol-relative //host).
    const safe = redirect && /^\/(?!\/)/.test(redirect) ? redirect : '/'
    return <Navigate to={safe} replace />
  }
  return <>{children}</>
}

/**
 * The role router at "/": admins → /admin; incomplete onboarding (or an
 * unrecognised role) → /onboarding; everyone else → their role dashboard.
 */
export function HomeRedirect() {
  const { loading, session, profile } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <FullScreenLoader />
  if (profile.role === 'admin') return <Navigate to="/admin" replace />
  if (profile.platform_role === 'bank') return <Navigate to="/bank" replace />
  if (!isPlatformRole(profile.platform_role) || !profile.onboarding_complete) {
    return <Navigate to="/onboarding" replace />
  }
  return <Navigate to={`/dashboard/${profile.platform_role}`} replace />
}
