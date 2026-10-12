import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { languageFromRoleData } from '@/lib/userLanguage'
import type { Locale } from '@/lib/i18n/types'
import {
  DEFAULT_FLAGS,
  normalizeRole,
  type FeatureFlags,
  type PlatformRole,
  type Profile,
} from '@/lib/types'
import { fetchMyRoles, switchRole as switchRoleRpc, type HeldRole } from '@/lib/userRoles'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  flags: FeatureFlags
  /** Growth Partner verification capability (role_data.can_verify, admin-granted). */
  canVerify: boolean
  /**
   * The member's SAVED interface language, or null when they have never chosen
   * one. Null is meaningful: it means resolve from the device and the browser.
   * A member who has not chosen does not get one written to their account.
   */
  languagePreference: Locale | null
  /**
   * Every role this account holds. `profile.platform_role` is the ACTIVE one;
   * the rest are what the switcher can move to.
   */
  heldRoles: HeldRole[]
  /** Switch the active role (server-checked against heldRoles). */
  switchRole: (role: PlatformRole) => Promise<void>
  /** Re-read the held-roles list, e.g. after adding one. */
  refreshRoles: () => Promise<void>
  /** flag lookup — absent keys are false, so un-built features stay hidden */
  flagEnabled: (key: string | undefined) => boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const DEV_FLAG_KEY = 'loamy.dev.flags'

/**
 * Developer-only flag overrides, resolved once per page load from the URL and
 * from this origin's storage.
 *
 * WHY THE URL AND NOT JUST STORAGE
 *   localStorage is scoped per ORIGIN, and a dev server's origin changes every
 *   time the port does. An override typed into :5174 is simply not there on
 *   :5300, with no error and nothing on screen to say so -- which is how the
 *   Loam launcher came to look as though it had disappeared. A query parameter
 *   travels with the link, so enabling the flag does not depend on remembering
 *   which port's console it was typed into.
 *
 * WHY IT CANNOT REACH PRODUCTION
 *   `import.meta.env.DEV` is false in `vite build`, so this whole function is
 *   dead code in any deployed bundle and Vite drops it. Nothing served from a
 *   build can be switched on from the address bar.
 */
function readDevFlags(): FeatureFlags {
  if (!import.meta.env.DEV || typeof window === 'undefined') return {}

  let overrides: FeatureFlags = {}
  try {
    const raw = localStorage.getItem(DEV_FLAG_KEY)
    if (raw) overrides = JSON.parse(raw) as FeatureFlags
  } catch {
    overrides = {}
  }

  // `?loam=1` turns it on for this origin and remembers it; `?loam=0` pins it
  // off. Only keys the platform already declares are accepted, so a typo in
  // the address bar cannot invent a flag that no code reads.
  const params = new URLSearchParams(window.location.search)
  let changed = false
  for (const key of Object.keys(DEFAULT_FLAGS)) {
    const value = params.get(key)
    if (value === null) continue
    overrides[key] = !(value === '0' || value === 'false')
    changed = true
  }
  if (changed) {
    try {
      localStorage.setItem(DEV_FLAG_KEY, JSON.stringify(overrides))
    } catch {
      /* storage disabled - the override still applies to this page load */
    }
  }

  return overrides
}

// SECURITY-REVIEW: every read here goes through RLS with the signed-in user's
// JWT. The profile select below intentionally names its columns instead of
// `*` so bvn_encrypted / nin_encrypted are never fetched into the browser,
// even after those columns start holding data in a future stage.
const PROFILE_COLUMNS =
  'id, digital_id, full_name, phone, category, state, role, founding_member, ' +
  'referral_count, profile_completion, created_at, platform_role, ' +
  'onboarding_complete, avatar_url, active, bvn_verified, nin_verified, ' +
  // Block 1 — public identity. The column list is explicit on purpose: a
  // select('*') here would start shipping whatever a future migration adds.
  'username, username_changed_at, headline, bio, profile_visibility'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS)
  const [canVerify, setCanVerify] = useState(false)
  const [heldRoles, setHeldRoles] = useState<HeldRole[]>([])
  const [languagePreference, setLanguagePreference] = useState<Locale | null>(null)

  const loadProfile = useCallback(async (activeSession: Session | null) => {
    if (!activeSession) {
      setProfile(null)
      return
    }
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', activeSession.user.id)
      .maybeSingle()

    if (error || !data) {
      setProfile(null)
      return
    }

    let loaded = data as unknown as Profile

    // Safety net for accounts created before the migrations ran, or whose
    // portal `category` used a spelling the SQL backfill did not recognise:
    // derive platform_role from signup metadata / category and persist it.
    if (!loaded.platform_role) {
      const derived =
        normalizeRole(activeSession.user.user_metadata?.platform_role as string) ??
        normalizeRole(activeSession.user.user_metadata?.category as string) ??
        normalizeRole(loaded.category)
      if (derived) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ platform_role: derived })
          .eq('id', loaded.id)
        if (!updateError) loaded = { ...loaded, platform_role: derived }
      }
    }

    setProfile(loaded)

    // Which roles this account holds (multi-role accounts).
    setHeldRoles(await fetchMyRoles().catch(() => []))

    // One read of role_details serves both the verification capability and the
    // saved language. It used to run only for Growth Partners; the language
    // preference belongs to every account, so the read is unconditional and the
    // capability is still derived exactly as before.
    const { data: details } = await supabase
      .from('role_details')
      .select('role_data')
      .eq('user_id', loaded.id)
      .maybeSingle()
    const roleData = details?.role_data as Record<string, unknown> | undefined
    setCanVerify(loaded.platform_role === 'growth_partner' && roleData?.can_verify === true)
    setLanguagePreference(languageFromRoleData(roleData))
  }, [])

  const loadFlags = useCallback(async () => {
    const { data } = await supabase
      .from('platform_config')
      .select('flags')
      .eq('id', 1)
      .maybeSingle()
    if (data?.flags && typeof data.flags === 'object') {
      setFlags({ ...DEFAULT_FLAGS, ...(data.flags as FeatureFlags) })
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setSession(data.session)
      await Promise.all([loadProfile(data.session), data.session ? loadFlags() : Promise.resolve()])
      if (!cancelled) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (cancelled) return
      setSession(newSession)
      if (event === 'SIGNED_OUT') {
        setProfile(null)
        setFlags(DEFAULT_FLAGS)
        setCanVerify(false)
        setHeldRoles([])
        // Dropping the account preference on sign-out is what stops a previous
        // member's language outranking the device choice of whoever signs in
        // next. The local choice remains and resolution falls back to it.
        setLanguagePreference(null)
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        await Promise.all([loadProfile(newSession), loadFlags()])
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadProfile, loadFlags])

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await loadProfile(data.session)
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const refreshRoles = useCallback(async () => {
    setHeldRoles(await fetchMyRoles().catch(() => []))
  }, [])

  const switchRole = useCallback(async (role: PlatformRole) => {
    await switchRoleRpc(role)
    const { data } = await supabase.auth.getSession()
    await loadProfile(data.session)
  }, [loadProfile])

  /**
   * A developer-only flag override, for running an unreleased surface against
   * a real dataset without changing that environment's configuration.
   *
   * WHY IT EXISTS
   *   Seeing Loam against production data required `platform_config.flags.loam`
   *   to be true on the production project. That is a write to live
   *   configuration, shared by every member, purely so one developer can look
   *   at something locally -- and it becomes live-affecting the moment the
   *   branch deploys. This keeps the decision on the machine that needs it.
   *
   * HOW TO SET IT
   *   Append `?loam=1` to any dev URL. It is remembered for that origin, so
   *   later navigation keeps it; `?loam=0` pins it off again. Writing
   *   `loamy.dev.flags` in the console still works and means the same thing.
   *
   * WHY IT IS STATE
   *   Resolved once, at mount. Reading storage during render made the override
   *   invisible to React: nothing it returned could ever cause a re-render, so
   *   a flag set after load appeared to do nothing at all.
   */
  const [devOverrides] = useState<FeatureFlags>(readDevFlags)

  const flagEnabled = useCallback(
    (key: string | undefined) => {
      if (key === undefined) return true
      const override = devOverrides[key]
      return typeof override === 'boolean' ? override : flags[key] === true
    },
    [flags, devOverrides],
  )

  return (
    <AuthContext.Provider
      value={{
        loading, session, profile, flags, canVerify, heldRoles, languagePreference,
        flagEnabled, refreshProfile, refreshRoles, switchRole, signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
