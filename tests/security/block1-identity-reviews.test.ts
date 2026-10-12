import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * BLOCK 1 — usernames, public profiles, ratings and reviews.
 *
 * The properties worth asserting are the refusals:
 *
 *   a username cannot be written directly, reserved, or churned
 *   a profile that exists but may not be seen looks exactly like one that
 *     does not exist
 *   a review cannot be written without a concluded deal you were party to
 *   a review never discloses its author
 */

let SELLER: TestUser
let BUYER: TestUser
let OUTSIDER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
const SELLER_HANDLE = `s_${RUN}`
const BUYER_HANDLE = `b_${RUN}`

let txnId = ''
let batchId = ''

beforeAll(async () => {
  SELLER = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('trader', 'Trader')
  OUTSIDER = await makeUser('trader', 'Trader')
  admin = await adminClient()
}, 240_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('usernames are claimed, not written', () => {
  it('refuses a direct write to profiles.username', async () => {
    const { error } = await SELLER.client
      .from('profiles').update({ username: 'straight_write' }).eq('id', SELLER.uid)
    expect(error, 'a member set their own username by writing the column').toBeTruthy()
  })

  it('claims a handle through the function', async () => {
    const { data, error } = await SELLER.client.rpc('loamy_set_username', {
      p_username: SELLER_HANDLE,
    })
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, unknown>).changed).toBe(true)
    expect((data as Record<string, unknown>).username).toBe(SELLER_HANDLE)
  })

  it('lowercases and trims what was typed', async () => {
    const { data } = await BUYER.client.rpc('loamy_set_username', {
      p_username: `  ${BUYER_HANDLE.toUpperCase()} `,
    })
    expect((data as Record<string, unknown>).username).toBe(BUYER_HANDLE)
  })

  it('refuses a handle another member holds', async () => {
    const { data } = await OUTSIDER.client.rpc('loamy_set_username', {
      p_username: SELLER_HANDLE,
    })
    expect((data as Record<string, unknown>).changed).toBe(false)
    expect((data as Record<string, unknown>).reason).toBe('taken')
  })

  it('refuses names that imply Loamy or an official function', async () => {
    for (const name of ['loamy', 'admin', 'support', 'verification', 'bank']) {
      const { data } = await OUTSIDER.client.rpc('loamy_set_username', { p_username: name })
      expect((data as Record<string, unknown>).reason, `${name} was allowed`).toBe('reserved')
    }
  })

  it('refuses malformed handles at the database, not only in the browser', async () => {
    for (const name of ['ab', 'has space', 'Has-Dash', '000982', 'x'.repeat(31)]) {
      const { data } = await OUTSIDER.client.rpc('loamy_set_username', { p_username: name })
      expect((data as Record<string, unknown>).changed, `${name} was allowed`).toBe(false)
    }
  })

  it('rate-limits a change to once every 30 days', async () => {
    const { data } = await SELLER.client.rpc('loamy_set_username', {
      p_username: `${SELLER_HANDLE}_x`,
    })
    expect((data as Record<string, unknown>).reason).toBe('rate_limited')
    expect(Number((data as Record<string, unknown>).days_remaining)).toBeGreaterThan(25)
  })

  it('reports availability without committing anything', async () => {
    const free = await OUTSIDER.client.rpc('loamy_username_available', {
      p_username: `free_${RUN}`,
    })
    expect((free.data as Record<string, unknown>).available).toBe(true)

    const { data: me } = await OUTSIDER.client
      .from('profiles').select('username').eq('id', OUTSIDER.uid).single()
    expect(me!.username, 'a availability check claimed the name').toBeNull()
  })

  it('records the claim in username_history, readable only by its owner', async () => {
    const mine = await SELLER.client.from('username_history').select('username')
    expect((mine.data ?? []).map((r) => r.username)).toContain(SELLER_HANDLE)

    const theirs = await OUTSIDER.client
      .from('username_history').select('*').eq('user_id', SELLER.uid)
    expect(theirs.data ?? [], 'another member read a handle history').toHaveLength(0)
  })
})

describe('the public profile surface', () => {
  it('is readable by signed-in members at the default visibility', async () => {
    const { data } = await BUYER.client.rpc('loamy_profile_by_username', {
      p_username: SELLER_HANDLE,
    })
    const p = data as Record<string, unknown>
    expect(p.found).toBe(true)
    expect(p.username).toBe(SELLER_HANDLE)
    expect(p.display_name).toBeTruthy()
  })

  it('defaults to members-only, so signed-out visitors see nothing', async () => {
    const { data } = await anonClient().rpc('loamy_profile_by_username', {
      p_username: SELLER_HANDLE,
    })
    expect((data as Record<string, unknown>).found,
      '353 existing profiles were exposed to the open internet by a migration').toBe(false)
  })

  it('carries no contact details, ever', async () => {
    const { data } = await BUYER.client.rpc('loamy_profile_by_username', {
      p_username: SELLER_HANDLE,
    })
    const keys = Object.keys(data as Record<string, unknown>).map((k) => k.toLowerCase())
    for (const banned of ['phone', 'email', 'digital_id', 'bvn', 'nin', 'role_data', 'referral']) {
      expect(keys.some((k) => k.includes(banned)), `${banned} leaked through the profile`).toBe(false)
    }
  })

  it('reports a hidden profile exactly like one that does not exist', async () => {
    await SELLER.client.from('profiles')
      .update({ profile_visibility: 'private' }).eq('id', SELLER.uid)

    const hidden = await BUYER.client.rpc('loamy_profile_by_username', { p_username: SELLER_HANDLE })
    const absent = await BUYER.client.rpc('loamy_profile_by_username', { p_username: `nobody_${RUN}` })

    // Identical payloads: the endpoint cannot be used to enumerate members.
    expect(hidden.data).toEqual(absent.data)
    expect((hidden.data as Record<string, unknown>).found).toBe(false)

    await SELLER.client.from('profiles')
      .update({ profile_visibility: 'members' }).eq('id', SELLER.uid)
  })

  it('still shows a private profile to its owner', async () => {
    await SELLER.client.from('profiles')
      .update({ profile_visibility: 'private' }).eq('id', SELLER.uid)
    const { data } = await SELLER.client.rpc('loamy_profile_by_username', {
      p_username: SELLER_HANDLE,
    })
    expect((data as Record<string, unknown>).found).toBe(true)
    await SELLER.client.from('profiles')
      .update({ profile_visibility: 'members' }).eq('id', SELLER.uid)
  })

  it('keeps the handle directory away from signed-out visitors', async () => {
    const pub = await anonClient().from('loamy_profile_handles').select('*').limit(1)
    expect(pub.error || (pub.data ?? []).length === 0).toBeTruthy()
  })
})

describe('reviews require a real, concluded deal', () => {
  beforeAll(async () => {
    // A genuine chain: farm -> cycle -> harvest -> batch -> listing -> deal.
    const { data: farm } = await SELLER.client.from('farms').insert({
      owner_id: SELLER.uid, farm_name: 'Review Farm', state: 'Benue', lga: 'Makurdi',
      size_hectares: 3, primary_crops: ['Maize'], ownership_type: 'owned',
      latitude: 7.73, longitude: 8.53,
    }).select('id').single()

    const { data: cycle } = await SELLER.client.from('crop_records').insert({
      farm_id: farm!.id, crop: 'Maize', season_year: 2026, status: 'harvested',
    }).select('id').single()

    const { data: harvest } = await SELLER.client.from('harvests').insert({
      production_cycle_id: cycle!.id, farm_id: farm!.id, commodity: 'Maize',
      harvest_date: '2026-09-05', quantity: 12, unit: 'tonne',
    }).select('id').single()

    const { data: batch } = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
      p_harvest_id: harvest!.id, p_quantity: 12,
    })
    batchId = batch as string

    const { data: listing } = await SELLER.client.rpc('loamy_list_batch', {
      p_batch_id: batchId, p_quantity: 12, p_price_per_unit: 90_000,
    })
    const { data: txn } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listing as string, p_quantity: 12,
    })
    txnId = txn as string
  }, 180_000)

  it('refuses a review before the goods are received', async () => {
    const { data } = await BUYER.client.rpc('loamy_submit_review', {
      p_transaction_id: txnId, p_rating: 5,
    })
    expect((data as Record<string, unknown>).submitted).toBe(false)
    expect((data as Record<string, unknown>).reason).toBe('not_concluded')
  })

  it('tells an outsider the deal does not exist, rather than that they lack access', async () => {
    const { data } = await OUTSIDER.client.rpc('loamy_can_review', { p_transaction_id: txnId })
    expect((data as Record<string, unknown>).reason).toBe('no_such_transaction')
  })

  it('refuses a direct insert into reviews entirely', async () => {
    const { error } = await BUYER.client.from('reviews').insert({
      transaction_id: txnId, reviewer_id: BUYER.uid, subject_id: SELLER.uid,
      direction: 'buyer_on_seller', rating: 5,
    })
    expect(error, 'a review was written straight into the table').toBeTruthy()
  })

  it('accepts one once the deal has actually concluded', async () => {
    await SELLER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'accept', p_machine: 'status',
    })
    for (const ev of ['loaded', 'in_transit', 'delivered']) {
      await (admin ?? SELLER.client).rpc('loamy_transaction_transition', {
        p_transaction_id: txnId, p_event_type: ev, p_machine: 'fulfilment',
      })
    }
    const recv = await BUYER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'received', p_machine: 'fulfilment',
    })
    expect(recv.error, recv.error?.message).toBeFalsy()

    const { data } = await BUYER.client.rpc('loamy_submit_review', {
      p_transaction_id: txnId, p_rating: 4, p_comment: 'Clean maize, well bagged.',
      p_quality: 4, p_communication: 5, p_timeliness: 3,
    })
    expect((data as Record<string, unknown>).submitted, JSON.stringify(data)).toBe(true)
    expect((data as Record<string, unknown>).ref).toMatch(/^REV-\d{6}$/)
  }, 120_000)

  it('refuses a second review of the same deal', async () => {
    const { data } = await BUYER.client.rpc('loamy_submit_review', {
      p_transaction_id: txnId, p_rating: 1,
    })
    expect((data as Record<string, unknown>).reason).toBe('already_reviewed')
  })

  it('refuses a rating outside 1-5', async () => {
    const { data } = await SELLER.client.rpc('loamy_submit_review', {
      p_transaction_id: txnId, p_rating: 9,
    })
    expect((data as Record<string, unknown>).submitted).toBe(false)
  })
})

describe('reviews are anonymous in public and attributed internally', () => {
  it('never discloses the author in the public feed', async () => {
    const { data } = await OUTSIDER.client.rpc('loamy_profile_reviews', {
      p_username: SELLER_HANDLE,
    })
    const items = (data as { items: Record<string, unknown>[] }).items
    expect(items.length).toBeGreaterThan(0)
    for (const r of items) {
      expect(r.reviewer_label).toBe('Verified buyer')
      const keys = Object.keys(r)
      expect(keys).not.toContain('reviewer_id')
      expect(keys).not.toContain('reviewer_name')
      expect(keys).not.toContain('transaction_id')
    }
  })

  it('does not let an outsider read the raw review rows', async () => {
    const { data } = await OUTSIDER.client
      .from('reviews').select('reviewer_id').eq('subject_id', SELLER.uid)
    expect(data ?? [], 'the raw review row leaked its author').toHaveLength(0)
  })

  it('does not let the SUBJECT of a review resolve its author through the feed', async () => {
    const { data } = await SELLER.client.rpc('loamy_profile_reviews', {
      p_username: SELLER_HANDLE,
    })
    for (const r of (data as { items: Record<string, unknown>[] }).items) {
      expect(Object.keys(r)).not.toContain('reviewer_id')
    }
  })

  it('still attributes it internally, to an administrator', async () => {
    if (!admin) return
    const { data } = await admin
      .from('reviews').select('reviewer_id, subject_id').eq('subject_id', SELLER.uid).limit(1)
    expect(data?.[0]?.reviewer_id, 'the platform cannot see who wrote a review').toBeTruthy()
  })

  it('withholds an average until there are enough reviews', async () => {
    const { data } = await BUYER.client.rpc('loamy_rating_summary', { p_user: SELLER.uid })
    const s = data as Record<string, unknown>
    expect(Number(s.count)).toBe(1)
    expect(s.has_enough).toBe(false)
    expect(s.average, 'a 1-review seller was given a rating').toBeNull()
  })

  it('lets only the person reviewed reply, and only once it is theirs', async () => {
    const bad = await OUTSIDER.client.rpc('loamy_respond_to_review', {
      p_review_id: '00000000-0000-0000-0000-000000000000', p_response: 'hi',
    })
    expect(bad.error, 'a stranger replied to a review').toBeTruthy()

    const { data: mine } = await SELLER.client
      .from('reviews').select('id').eq('subject_id', SELLER.uid).limit(1).single()
    const ok = await SELLER.client.rpc('loamy_respond_to_review', {
      p_review_id: mine!.id, p_response: 'Thank you — glad the bags held up.',
    })
    expect(ok.error, ok.error?.message).toBeFalsy()
  })

  it('refuses to hide a review without a recorded reason, and refuses members outright', async () => {
    const { data: r } = await SELLER.client
      .from('reviews').select('id').eq('subject_id', SELLER.uid).limit(1).single()

    const member = await SELLER.client.rpc('loamy_hide_review', {
      p_review_id: r!.id, p_reason: 'I did not like it',
    })
    expect(member.error, 'a member hid a review about themselves').toBeTruthy()

    if (admin) {
      const noReason = await admin.rpc('loamy_hide_review', { p_review_id: r!.id, p_reason: '  ' })
      expect(noReason.error, 'a review was hidden with no reason on record').toBeTruthy()
    }
  })
})
