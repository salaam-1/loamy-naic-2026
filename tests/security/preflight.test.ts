import { describe, expect, it } from 'vitest'
import { adminClient, anonClient, makeUser } from '../helpers/supabase'

/**
 * PREFLIGHT — the suite cannot go green without actually running.
 *
 * WHY THIS FILE EXISTS
 *   `adminClient()` returns null rather than throwing, so admin-scoped tests
 *   can skip on a machine without the admin fixture instead of reporting a
 *   false security failure. That is a reasonable design and it stays.
 *
 *   Its cost is that `if (!admin) return` appears ~150 times across the
 *   suite. If the admin account ever fails to sign in -- a rate limit, a
 *   rotated password, a network blip -- every one of those tests PASSES
 *   without asserting anything, and the run reports green while having
 *   verified nothing about admin authority, bank isolation or fee governance.
 *
 *   Slice 3 showed how expensive that is in practice: a wrong column name in
 *   one `beforeAll` skipped 55 tests, and among them was the assertion that
 *   the application bundle exposes no internal user id. The bundle HAD
 *   started leaking the seller's id. Two defects, each hiding the other,
 *   behind a green tick.
 *
 *   So the skip stays, but it can no longer be silent: if the admin fixture
 *   is unavailable, THIS fails, and the run is red no matter how many
 *   individual tests skipped themselves.
 *
 * WHAT THIS IS NOT
 *   It is not a weakening. It adds assertions; it removes none.
 */

describe('preflight — the fixtures the suite depends on', () => {
  it('can sign in as the admin fixture', async () => {
    const admin = await adminClient()
    expect(
      admin,
      'The admin fixture could not sign in. ~150 tests across this suite ' +
      'begin with `if (!admin) return` and will have skipped SILENTLY, so a ' +
      'green run would mean nothing. Check the credentials in ' +
      'tests/helpers/supabase.ts and the Supabase auth rate limit.',
    ).toBeTruthy()
  })

  it('has a working admin session, not merely a client object', async () => {
    const admin = await adminClient()
    if (!admin) return   // already reported above; do not double-report
    const { data, error } = await admin.auth.getUser()
    expect(error, error?.message).toBeFalsy()
    expect(data.user, 'the admin client has no session').toBeTruthy()
  })

  it('confirms the admin fixture really is an admin', async () => {
    const admin = await adminClient()
    if (!admin) return
    const { data: me } = await admin.auth.getUser()
    const { data: profile } = await admin.from('profiles')
      .select('role').eq('id', me.user!.id).maybeSingle()
    // An "admin" that is not one would make every negative authorisation
    // test pass for the wrong reason.
    expect(profile?.role, 'the admin fixture is not an admin').toBe('admin')
  })

  it('can create an ordinary member', async () => {
    const user = await makeUser('trader', 'Trader')
    expect(user.uid, 'makeUser returned no id').toBeTruthy()
    const { data } = await user.client.from('profiles')
      .select('id, platform_role').eq('id', user.uid).maybeSingle()
    expect(data, 'a freshly created member has no profile row').toBeTruthy()
    expect(data!.platform_role).toBe('trader')
  })

  it('has an anon client that is genuinely signed out', async () => {
    // If this were somehow authenticated, every "shows a signed-out visitor
    // nothing" assertion would be testing the wrong thing.
    const { data } = await anonClient().auth.getUser()
    expect(data.user, 'the anon client is signed in').toBeNull()
  })
})
