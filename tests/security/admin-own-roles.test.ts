import { describe, expect, it } from 'vitest'
import { adminClient, makeUser } from '../helpers/supabase'

/**
 * "Which roles do I hold" must mean the caller, even for an administrator.
 *
 * THE DEFECT THIS LOCKS DOWN
 *   fetchMyRoles selected user_platform_roles with no predicate and relied on
 *   RLS to scope it. The policy is `(user_id = auth.uid()) OR loamy_is_admin()`,
 *   and the admin arm is there so the admin console can read everyone. So an
 *   administrator asking for their own roles received the entire table: 943
 *   rows across 921 accounts on staging. The role card listed strangers' roles,
 *   the switcher offered roles the admin does not hold, and MyRoles keyed ~943
 *   entries by `role`, producing the duplicate-key warnings.
 *
 * WHY THIS TEST IS HERE RATHER THAN IN A UNIT FILE
 *   The unit test (tests/unit/fetch-my-roles.test.ts) proves the query shape
 *   against a mock. Only the real database has the real policy and the real
 *   population of other users' rows, which is the entire point: the admin
 *   genuinely CAN read them, and must still get back only their own.
 *
 * NOT A CLAIM THAT RLS CHANGED
 *   The broad admin read is deliberate and is asserted here as still working.
 *   What changed is the application query, not the policy.
 */
describe('an admin asking for their own roles gets only their own', () => {
  it('confirms the admin really can see other users rows, so the test means something', async () => {
    const admin = await adminClient()
    if (!admin) return // no admin fixture on this machine; skip cleanly

    const { data: me } = await admin.auth.getUser()
    const uid = me?.user?.id
    expect(uid, 'admin fixture has no user id').toBeTruthy()

    const unfiltered = await admin
      .from('user_platform_roles')
      .select('user_id, role')
      .range(0, 999)
    expect(unfiltered.error, String(unfiltered.error?.message)).toBeFalsy()

    const others = (unfiltered.data ?? []).filter((r) => r.user_id !== uid)
    // If this is ever 0 the environment has no other accounts and the rest of
    // the file proves nothing, so say so rather than passing vacuously.
    expect(
      others.length,
      'expected other users role rows to be visible to an admin, otherwise this test is vacuous',
    ).toBeGreaterThan(0)
  })

  it('returns only the admin own rows once the query names the user', async () => {
    const admin = await adminClient()
    if (!admin) return

    const { data: me } = await admin.auth.getUser()
    const uid = me!.user!.id

    // Exactly the query fetchMyRoles now issues.
    const scoped = await admin
      .from('user_platform_roles')
      .select('user_id, role, onboarded, added_at')
      .eq('user_id', uid)
      .order('added_at', { ascending: true })

    expect(scoped.error, String(scoped.error?.message)).toBeFalsy()
    const rows = scoped.data ?? []
    expect(rows.length, 'the admin should hold at least one role').toBeGreaterThan(0)
    expect(
      rows.every((r) => r.user_id === uid),
      'a scoped query returned a row belonging to somebody else',
    ).toBe(true)

    // And it must be strictly fewer than the admin-visible set, otherwise the
    // filter is not doing anything on this environment.
    const unfiltered = await admin.from('user_platform_roles').select('user_id').range(0, 999)
    expect((unfiltered.data ?? []).length).toBeGreaterThan(rows.length)
  })

  it('shows no duplicate role values in the scoped result', async () => {
    const admin = await adminClient()
    if (!admin) return

    const { data: me } = await admin.auth.getUser()
    const uid = me!.user!.id
    const scoped = await admin
      .from('user_platform_roles')
      .select('role')
      .eq('user_id', uid)

    const roles = (scoped.data ?? []).map((r) => r.role)
    // MyRoles keys its list by `role`. Duplicates here are what produced the
    // React duplicate-key warnings once the whole table was being returned.
    expect(new Set(roles).size, 'duplicate role values would collide as React keys').toBe(roles.length)
  })

  it('is unchanged for an ordinary member, who never had the admin exception', async () => {
    const user = await makeUser('farmer', 'Farmer')

    const unfiltered = await user.client.from('user_platform_roles').select('user_id, role')
    const scoped = await user.client
      .from('user_platform_roles')
      .select('user_id, role')
      .eq('user_id', user.uid)

    expect(unfiltered.error, String(unfiltered.error?.message)).toBeFalsy()
    expect(scoped.error, String(scoped.error?.message)).toBeFalsy()
    // RLS already limited a member to their own rows, so naming the user
    // explicitly must not change what they see.
    expect((scoped.data ?? []).length).toBe((unfiltered.data ?? []).length)
    expect((scoped.data ?? []).every((r) => r.user_id === user.uid)).toBe(true)
  })

  it('still refuses one member reading another member rows', async () => {
    const a = await makeUser('farmer', 'Farmer')
    const b = await makeUser('farmer', 'Farmer')

    const peek = await a.client.from('user_platform_roles').select('user_id').eq('user_id', b.uid)
    expect(peek.error || (peek.data ?? []).length === 0, 'a member read another member roles').toBeTruthy()
  })
})
