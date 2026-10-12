import { beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * PUBLIC PROFILE — what the RESPONSE carries, not what the UI renders.
 *
 * §26 is explicit that hiding a field in React proves nothing. Every
 * assertion here reads the raw payload from loamy_profile_by_username and
 * asserts on its keys, from five different vantage points: anonymous,
 * an unrelated member, the owner, and an admin.
 *
 * The properties that matter:
 *
 *   1. NO INTERNAL ID. The payload must never carry the subject's user id.
 *      One stable identifier is all an enumeration attack needs, and it is
 *      also what would let a client join to tables the profile deliberately
 *      summarises into counts.
 *
 *   2. NO PRIVATE DOMAIN DATA. No financing, bank account, BVN/NIN,
 *      coordinates, verification evidence or transaction counterparties --
 *      whatever the viewer's relationship to the subject.
 *
 *   3. A PRIVATE PROFILE IS INDISTINGUISHABLE FROM A MISSING ONE. Both
 *      return exactly `{found:false}`. Anything more would make the 404 an
 *      oracle for "this handle is taken".
 */

let OWNER: TestUser
let OTHER: TestUser
let anon: SupabaseClient
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
const HANDLE = `pb_${RUN}`

/** Keys that must never appear anywhere in a public profile payload. */
const FORBIDDEN = [
  'id', 'user_id', 'owner_id', 'profile_id', 'seller_id', 'buyer_id',
  'email', 'phone', 'bvn', 'nin', 'bvn_verified', 'nin_verified',
  'account_number', 'bank_code', 'bank_name',
  'latitude', 'longitude', 'coordinates', 'gps',
  'financing', 'financing_applications', 'amount_requested',
  'evidence', 'storage_path', 'content_hash', 'device_hash',
  'counterparty', 'transactions', 'subtotal', 'password', 'token',
]

function deepKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) deepKeys(v, out)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k.toLowerCase())
      deepKeys(v, out)
    }
  }
  return out
}

beforeAll(async () => {
  OWNER = await makeUser('trader', 'Trader')
  OTHER = await makeUser('buyer', 'Buyer')
  anon = anonClient()
  admin = await adminClient()

  // Two separate write paths, deliberately: the handle goes through a
  // definer function (it is globally unique and rate-limited), while
  // visibility is an ordinary owner-scoped column update under RLS.
  const { error } = await OWNER.client.rpc('loamy_set_username', { p_username: HANDLE })
  expect(error, `could not set handle: ${error?.message}`).toBeFalsy()
  await setVisibility(OWNER, 'public')
}, 180_000)

async function setVisibility(user: TestUser, visibility: 'public' | 'members' | 'private') {
  const { error } = await user.client
    .from('profiles').update({ profile_visibility: visibility }).eq('id', user.uid)
  expect(error, `could not set visibility: ${error?.message}`).toBeFalsy()
}

async function fetchAs(client: SupabaseClient, name = HANDLE) {
  const { data } = await client.rpc('loamy_profile_by_username', { p_username: name })
  return data as Record<string, unknown> | null
}

describe('a public profile is readable by everyone it should be', () => {
  it('resolves for an anonymous visitor', async () => {
    const p = await fetchAs(anon)
    expect(p?.found).toBe(true)
    expect(p?.username).toBe(HANDLE)
  })

  it('resolves for an unrelated member', async () => {
    expect((await fetchAs(OTHER.client))?.found).toBe(true)
  })

  it('tells the owner it is theirs, and nobody else', async () => {
    // The contract is TRUTHY for the owner and falsy for everyone else, not
    // strictly `false`: for an anonymous viewer the SQL compares an id to
    // NULL, so the payload carries null. Harmless in JS, and asserting the
    // contract rather than the representation is what keeps this test from
    // failing on a detail nothing depends on.
    expect((await fetchAs(OWNER.client))?.is_self).toBe(true)
    expect((await fetchAs(OTHER.client))?.is_self).toBeFalsy()
    expect((await fetchAs(anon))?.is_self).toBeFalsy()
  })

  it('is case-insensitive on the handle', async () => {
    // A shared link with different casing must not 404.
    expect((await fetchAs(anon, HANDLE.toUpperCase()))?.found).toBe(true)
  })

  it('trims surrounding whitespace', async () => {
    expect((await fetchAs(anon, `  ${HANDLE}  `))?.found).toBe(true)
  })
})

describe('the payload carries no identifier and no private data', () => {
  it.each([
    ['anonymous', () => fetchAs(anon)],
    ['unrelated member', () => fetchAs(OTHER.client)],
    ['the owner', () => fetchAs(OWNER.client)],
  ])('%s sees no forbidden key', async (_who, get) => {
    const payload = await get()
    expect(payload?.found).toBe(true)
    const keys = new Set(deepKeys(payload))
    for (const bad of FORBIDDEN) {
      expect(keys.has(bad), `payload exposed "${bad}"`).toBe(false)
    }
  })

  it('exposes no user id even to an admin', async () => {
    if (!admin) return
    // An admin has every right to the data -- through admin surfaces. This
    // function is the PUBLIC one, and widening it for admins would mean the
    // same response shape differs by caller, which is how a leak ships.
    const keys = new Set(deepKeys(await fetchAs(admin)))
    expect(keys.has('id')).toBe(false)
    expect(keys.has('user_id')).toBe(false)
  })

  it('returns counts rather than rows for transactions', async () => {
    const p = await fetchAs(anon)
    expect(typeof p?.completed_transactions).toBe('number')
    // The rows themselves, with their counterparties and amounts, are absent.
    expect(p?.transactions).toBeUndefined()
  })

  it('carries only the listing fields the marketplace already shows', async () => {
    const p = await fetchAs(anon)
    const listings = (p?.listings ?? []) as Record<string, unknown>[]
    expect(Array.isArray(listings)).toBe(true)
    const allowed = new Set([
      'id', 'commodity', 'listing_type', 'quantity', 'unit',
      'price_per_unit', 'currency', 'state', 'lga', 'photos', 'created_at',
    ])
    for (const l of listings) {
      for (const k of Object.keys(l)) {
        expect(allowed.has(k), `listing exposed "${k}"`).toBe(true)
      }
    }
  })
})

describe('a profile that may not be seen looks exactly like one that is not there', () => {
  it('reports a private profile as not found, with no extra detail', async () => {
    await setVisibility(OWNER, 'private')

    const hidden = await fetchAs(anon)
    const missing = await fetchAs(anon, `definitely-not-a-handle-${RUN}`)

    expect(hidden?.found).toBe(false)
    expect(missing?.found).toBe(false)
    // Byte-for-byte identical: any extra key would say "this handle exists".
    expect(JSON.stringify(hidden)).toBe(JSON.stringify(missing))
  })

  it('still lets the owner see their own private profile', async () => {
    expect((await fetchAs(OWNER.client))?.found).toBe(true)
  })

  it('hides a members-only profile from anonymous but not from a member', async () => {
    await setVisibility(OWNER, 'members')

    expect((await fetchAs(anon))?.found).toBe(false)
    expect((await fetchAs(OTHER.client))?.found).toBe(true)
  })
})

describe('the handle itself cannot be forged', () => {
  it('refuses a direct write to profiles.username', async () => {
    const { data: after } = await OWNER.client
      .from('profiles').update({ username: `forged_${RUN}` }).eq('id', OWNER.uid).select('username')
    // No UPDATE path for the column: zero rows matched rather than an error.
    expect(after ?? []).toHaveLength(0)
    const { data: check } = await OWNER.client
      .from('profiles').select('username').eq('id', OWNER.uid).maybeSingle()
    expect((check as { username: string } | null)?.username).toBe(HANDLE)
  })

  it('refuses a handle another member already holds', async () => {
    const { data } = await OTHER.client.rpc('loamy_set_username', { p_username: HANDLE })
    const r = data as { ok?: boolean; reason?: string } | null
    // Either a structured refusal or an outright error is acceptable; a
    // SUCCESS is not, because two members would then share one identity.
    expect(r?.ok === true, 'a second member took an existing handle').toBe(false)
  })
})

describe('reviews stay anonymous in the payload', () => {
  it('carries no reviewer identity', async () => {
    const { data } = await anon.rpc('loamy_profile_reviews', { p_username: HANDLE, p_limit: 20 })
    const r = data as { found?: boolean; items?: Record<string, unknown>[] } | null
    for (const item of r?.items ?? []) {
      const keys = new Set(Object.keys(item).map((k) => k.toLowerCase()))
      for (const bad of ['reviewer_id', 'author_id', 'user_id', 'reviewer_username', 'reviewer_avatar', 'email']) {
        expect(keys.has(bad), `review exposed "${bad}"`).toBe(false)
      }
    }
  })
})
