import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * fetchMyRoles must ask for ONE user's roles, not lean on RLS to scope it.
 *
 * THE BUG
 *   The query had no predicate. The policy on user_platform_roles is
 *   `(user_id = auth.uid()) OR loamy_is_admin()`, and the admin arm is there so
 *   the admin console can read everyone. Asking "which roles do I hold" with no
 *   filter therefore returned the whole table to an administrator: 943 rows
 *   across 921 accounts on staging. The admin role card listed strangers'
 *   roles, the role switcher offered roles the admin does not hold, and MyRoles
 *   keyed ~943 entries by `role`, which is where the duplicate-key warnings
 *   came from.
 *
 *   This file proves the query SHAPE. tests/security/admin-own-roles.test.ts
 *   proves the resulting behaviour against the real database and real policy,
 *   where the admin can genuinely see every row and must still get back only
 *   their own.
 */

let currentUser: { id: string } | null = null
const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = []
let returnedRows: unknown[] = []

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const record = { table, filters: [] as Array<[string, unknown]> }
    calls.push(record)
    const builder: Record<string, unknown> = {}
    const self = new Proxy(builder, {
      get(_t, prop) {
        if (prop === 'then') {
          return (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve({ data: returnedRows, error: null }).then(onFulfilled)
        }
        if (prop === 'eq') {
          return (col: string, val: unknown) => {
            record.filters.push([col, val])
            return self
          }
        }
        return () => self
      },
    })
    return self
  }
  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      auth: { getUser: async () => ({ data: { user: currentUser } }) },
    },
  }
})

const { fetchMyRoles } = await import('../../src/lib/userRoles')

beforeEach(() => {
  calls.length = 0
  returnedRows = []
  currentUser = { id: 'admin-uid' }
})

describe('fetchMyRoles scopes to the caller', () => {
  it('filters user_platform_roles by the authenticated user id', async () => {
    returnedRows = [{ role: 'farmer', onboarded: true, added_at: '2026-01-01' }]
    await fetchMyRoles()

    const q = calls.find((c) => c.table === 'user_platform_roles')
    expect(q, 'expected a query against user_platform_roles').toBeTruthy()
    expect(
      q!.filters,
      'the query must name the user explicitly rather than rely on the RLS admin exception',
    ).toContainEqual(['user_id', 'admin-uid'])
  })

  it('does not query at all when nobody is signed in', async () => {
    currentUser = null
    await expect(fetchMyRoles()).resolves.toEqual([])
    expect(calls.filter((c) => c.table === 'user_platform_roles')).toHaveLength(0)
  })

  it('still drops role values outside the platform vocabulary', async () => {
    returnedRows = [
      { role: 'farmer', onboarded: true, added_at: '2026-01-01' },
      { role: 'not_a_real_role', onboarded: true, added_at: '2026-01-02' },
    ]
    const held = await fetchMyRoles()
    expect(held.map((h) => h.role)).toEqual(['farmer'])
  })

  it('passes the rows it is given through unchanged otherwise', async () => {
    returnedRows = [
      { role: 'farmer', onboarded: true, added_at: '2026-01-01' },
      { role: 'buyer', onboarded: false, added_at: '2026-02-01' },
    ]
    const held = await fetchMyRoles()
    expect(held).toEqual([
      { role: 'farmer', onboarded: true, added_at: '2026-01-01' },
      { role: 'buyer', onboarded: false, added_at: '2026-02-01' },
    ])
  })
})
