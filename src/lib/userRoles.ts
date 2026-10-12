import { supabase } from '@/lib/supabase'
import { ROLE_CONFIGS } from '@/lib/roles'
import { isPlatformRole, type PlatformRole } from '@/lib/types'

/**
 * Multi-role accounts. One login can hold several roles (trader + warehouse
 * owner, say); `profiles.platform_role` stays the ACTIVE one, and everything
 * here goes through the SECURITY DEFINER RPCs added in 20260919100005 — the
 * client never writes user_platform_roles or platform_role directly, so a
 * switch is always checked against the roles the account actually holds.
 */

export interface HeldRole {
  role: PlatformRole
  onboarded: boolean
  added_at: string
}

/**
 * The roles THIS account holds.
 *
 * WHY THE FILTER IS EXPLICIT
 *   This used to select the table with no predicate and let RLS scope it. That
 *   is wrong, because the policy on user_platform_roles is
 *
 *       (user_id = auth.uid()) OR loamy_is_admin()
 *
 *   The admin arm exists so the admin console can read everyone's roles. It was
 *   never meant to answer "which roles do I hold", but that is what this query
 *   asked, so an administrator loaded every row in the table as their own: on
 *   staging, 943 rows across 921 accounts. The visible symptoms were an admin
 *   role card listing strangers' roles, a role switcher offering roles the
 *   admin does not hold, and React duplicate-key warnings from MyRoles keying
 *   a list of ~943 entries by `role`.
 *
 *   The predicate is now stated here rather than inferred from a policy written
 *   for a different purpose. RLS still applies underneath and still refuses
 *   another user's rows to a non-admin; this only stops the query from asking
 *   for rows it never wanted. Admin authorization is untouched, and the admin
 *   console keeps its own broader reads.
 */
export async function fetchMyRoles(): Promise<HeldRole[]> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth?.user?.id
  // Signed out: no roles, and no reason to ask the database.
  if (!uid) return []

  const { data, error } = await supabase
    .from('user_platform_roles')
    .select('role, onboarded, added_at')
    .eq('user_id', uid)
    .order('added_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as { role: string; onboarded: boolean; added_at: string }[])
    .filter((r): r is HeldRole => isPlatformRole(r.role))
}

/**
 * Choose the FIRST role, at onboarding. Separate from switchRole because
 * platform_role is no longer client-writable (Phase 0 hardening,
 * 20260919110001) — this RPC is the only path that may set it initially, and
 * it refuses once onboarding is complete.
 */
export async function setInitialRole(role: PlatformRole): Promise<void> {
  const { error } = await supabase.rpc('loamy_set_initial_role', { p_role: role })
  if (error) throw new Error(error.message)
}

/** Add a role to this account. Does not switch into it. */
export async function addRole(role: PlatformRole): Promise<void> {
  const { error } = await supabase.rpc('loamy_add_role', { p_role: role })
  if (error) throw new Error(error.message)
}

/** Mark a held role's detail form as completed. */
export async function markRoleOnboarded(role: PlatformRole): Promise<void> {
  const { error } = await supabase.rpc('loamy_mark_role_onboarded', { p_role: role })
  if (error) throw new Error(error.message)
}

/** Make `role` the active one. Rejected server-side unless the account holds it. */
export async function switchRole(role: PlatformRole): Promise<void> {
  const { error } = await supabase.rpc('loamy_switch_role', { p_role: role })
  if (error) throw new Error(error.message)
}

/**
 * Roles worth showing in a switcher. Trader and Buyer are one merged dashboard,
 * so an account holding both would otherwise see the same entry twice — the
 * canonical `trader` wins and the legacy `buyer` row is folded into it.
 */
export function switchableRoles(held: HeldRole[]): HeldRole[] {
  const hasTrader = held.some((r) => r.role === 'trader')
  return held.filter((r) => !(r.role === 'buyer' && hasTrader))
}

/** Roles the account does NOT hold yet, offered on "Add a role". */
export function addableRoles(held: HeldRole[]): PlatformRole[] {
  const holds = new Set(held.map((r) => r.role))
  // `buyer` is never offered: it is the legacy half of Trader & Buyer.
  return (Object.keys(ROLE_CONFIGS) as PlatformRole[])
    .filter((slug) => slug !== 'buyer' && !holds.has(slug))
    .filter((slug) => !(slug === 'trader' && holds.has('buyer')))
}
