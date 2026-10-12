import { useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Hammer, LifeBuoy, Settings as SettingsIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { PROCUREMENT_ROLES, ROLE_CONFIGS, type StatDef } from '@/lib/roles'
import { isPlatformRole } from '@/lib/types'
import { AppShell } from '@/components/layout/AppShell'
import { FullScreenLoader } from '@/routes/guards'
import Home from '@/pages/shared/Home'
import { EmptyState } from '@/components/EmptyState'
import { FARMER_SECTIONS } from '@/pages/farmer'
import { PARTNER_SECTIONS } from '@/pages/partner'
import { PROCESSOR_SECTIONS } from '@/pages/processor'
import { SECTIONS_WITH_OWN_HEADING, SHARED_SECTIONS } from '@/pages/shared/sections'
import { ActivityStrip } from '@/pages/shared/ActivityStrip'
import InviteBenefits from '@/pages/shared/InviteBenefits'
import MarketIntelligence from '@/pages/shared/MarketIntelligence'

interface LiveData {
  roleData: Record<string, unknown>
  unread: number
  loading: boolean
}

/**
 * Stage 1 role dashboard shell: AppShell chrome, role-specific nav (un-built
 * features hidden behind feature flags), a stat-card row wired to REAL
 * queries (zeros for new users — correct, never seeded), and a designed
 * empty state for what's coming.
 */
export default function RoleDashboard() {
  const { role: roleParam, section: sectionParam } = useParams()
  const { profile, flagEnabled } = useAuth()
  const [live, setLive] = useState<LiveData>({ roleData: {}, unread: 0, loading: true })

  const validRole = isPlatformRole(roleParam) ? roleParam : null
  const config = validRole ? ROLE_CONFIGS[validRole] : null
  const section = sectionParam ?? 'overview'
  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!profile) return
      const [detailsRes, unreadRes] = await Promise.all([
        supabase.from('role_details').select('role_data').eq('user_id', profile.id).maybeSingle(),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false),
      ])
      if (cancelled) return
      setLive({
        roleData: (detailsRes.data?.role_data as Record<string, unknown>) ?? {},
        unread: unreadRes.count ?? 0,
        loading: false,
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [profile])

  const statValues = useMemo(() => {
    if (!config || !profile) return []
    return config.stats.map((stat: StatDef) => {
      let value: string | number = 0
      switch (stat.source) {
        case 'role_data_number': {
          const n = Number(live.roleData[stat.roleDataKey ?? ''] ?? 0)
          value = Number.isFinite(n) ? n : 0
          if (stat.unit && value !== 0) value = `${value} ${stat.unit}`
          break
        }
        case 'role_data_count': {
          const v = live.roleData[stat.roleDataKey ?? '']
          value = Array.isArray(v) ? v.length : 0
          break
        }
        case 'referrals':
          value = profile.referral_count ?? 0
          break
        case 'unread_notifications':
          value = live.unread
          break
        case 'member_since':
          value = new Date(profile.created_at).toLocaleDateString('en-NG', {
            month: 'short',
            year: 'numeric',
          })
          break
      }
      return { ...stat, value }
    })
  }, [config, profile, live])

  // Unknown role slug in the URL → 404.
  if (!validRole || !config) return <Navigate to="/404" replace />

  // Wait for the profile before judging the role. RequireAuth releases as
  // soon as the SESSION exists; the profile arrives a tick later, so a null
  // profile here means "not known yet", not "wrong role".
  //
  // Without this, every hard load of a dashboard deep link bounced: the
  // redirect below saw an undefined platform_role, sent the user to "/",
  // which routes a signed-in member back to their own dashboard — so
  // /dashboard/trader/settings silently became /dashboard/trader. Only
  // in-app Link navigation worked, because the profile was already resolved
  // by then. Same defect as the one fixed in RequireAdmin; this is its
  // other half, and it was breaking the /u/:username → Edit profile journey.
  if (!profile) return <FullScreenLoader />

  // Clean unauthorized-redirect: a user may only view their OWN role's
  // dashboard (admins may view any while Stage 6 tooling is pending).
  if (!isAdmin && profile.platform_role !== validRole) {
    return (
      <Navigate
        to={isPlatformRole(profile.platform_role) ? `/dashboard/${profile.platform_role}` : '/'}
        replace
      />
    )
  }

  // Built sections render real pages: farmer-specific (Stage 2) and shared
  // marketplace/settings/notifications (Stage 3, role-gated). 'notifications'
  // has no nav item (reached from the bell) but is valid for every role.
  const shared = SHARED_SECTIONS[section]
  const sharedAllowed =
    shared && (!shared.roles || (validRole !== null && shared.roles.includes(validRole)))
  const builtSection =
    (validRole === 'farmer' ? FARMER_SECTIONS[section] : undefined) ??
    (validRole === 'growth_partner' ? PARTNER_SECTIONS[section] : undefined) ??
    (validRole && PROCUREMENT_ROLES.includes(validRole) ? PROCESSOR_SECTIONS[section] : undefined) ??
    (sharedAllowed ? shared.cmp : undefined)

  // A shared section that exists but is not for this role → clean redirect home.
  if (shared && !sharedAllowed) return <Navigate to={`/dashboard/${validRole}`} replace />

  const knownSections = new Set(config.nav.map((n) => n.section))
  if (!knownSections.has(section) && !builtSection) return <Navigate to="/404" replace />

  // Sections whose feature flag is off are unreachable even by direct URL.
  const sectionNav = config.nav.find((n) => n.section === section)
  if (sectionNav?.flag && !flagEnabled(sectionNav.flag)) {
    return <Navigate to={`/dashboard/${validRole}`} replace />
  }

  return (
    <AppShell
      nav={config.nav}
      activeSection={section}
      sectionHref={(s) => (s === 'overview' ? `/dashboard/${validRole}` : `/dashboard/${validRole}/${s}`)}
      roleLabel={isAdmin ? 'Admin' : config.label}
      // The shell owns the page heading, EXCEPT where the page already has a
      // better one: the overview (HomeHero) and the sections listed in
      // SECTIONS_WITH_OWN_HEADING, which render a title plus a subtitle.
      pageTitle={
        section === 'overview' || SECTIONS_WITH_OWN_HEADING.has(section)
          ? undefined
          : sectionNav?.label
      }
    >
      {builtSection ? (
        (() => {
          const Built = builtSection
          return <Built />
        })()
      ) : section === 'overview' ? (
        /* Phase 3: Home is now a composed, role-aware experience reading live
           tables rather than four stat cards fed from onboarding self-reports
           in role_details.role_data. See src/pages/shared/Home.tsx. */
        <Home role={validRole} />
      ) : section === 'support' ? (
        <EmptyState
          icon={LifeBuoy}
          title="Support"
          body="Dedicated in-app support is on its way. For now, reach the Loamy team by email and we'll respond quickly."
          action={{ label: 'Email support', onClick: () => (window.location.href = 'mailto:support@loamy.ng') }}
        />
      ) : section === 'intelligence' ? (
        <MarketIntelligence />
      ) : section === 'invite' ? (
        <InviteBenefits />
      ) : section === 'settings' ? (
        <EmptyState
          icon={SettingsIcon}
          title="Settings"
          body="Profile and account settings arrive in an upcoming release. Your signup details and digital ID are already saved."
        />
      ) : (
        <EmptyState
          icon={Hammer}
          title={`${sectionNav?.label ?? 'This feature'} is being built`}
          body="This part of the platform is arriving in an upcoming release. You'll be notified here the moment it opens."
        />
      )}
    </AppShell>
  )
}
