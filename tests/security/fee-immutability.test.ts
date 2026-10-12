import { beforeAll, describe, expect, it } from 'vitest'
import { adminClient, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * FEE IMMUTABILITY — a fee schedule change must not rewrite history.
 *
 * WHAT THIS TESTS, AND WHY IT DOES NOT MUTATE THE LIVE SCHEDULE
 *
 *   The obvious test is: accept a transaction, change the rate, check the
 *   transaction is unchanged. That test would be WRONG to run here, because
 *   `fee_schedules` is global — flipping a live rate, even briefly, changes
 *   what every real member is quoted while the test runs. Production is not
 *   a test environment (§50).
 *
 *   The guarantee does not need that. Immutability rests on two properties
 *   which can each be proven directly:
 *
 *     1. `loamy_fee_from_snapshot` is IMMUTABLE and reads only the snapshot
 *        it is handed. It never queries fee_schedules. So a settlement that
 *        honours a snapshot cannot be affected by a later rate change,
 *        whatever that change is.
 *
 *     2. A snapshot captures everything needed to recompute the fee without
 *        the schedule: basis, value, min, max, payer and the schedule ref.
 *        A snapshot missing any of those would force a fallback to live
 *        config, which is the leak this is guarding.
 *
 *   Proving (1) with a synthetic snapshot whose rate differs from every live
 *   rule is a stronger test than mutating global state, and it is safe.
 */

let USER: TestUser
let admin: SupabaseClient | null

beforeAll(async () => {
  USER = await makeUser('farmer', 'Farmer')
  admin = await adminClient()
}, 120_000)

describe('a frozen fee is computed from the snapshot, never from the live schedule', () => {
  it('honours a snapshot rate that no live rule matches', async () => {
    // 777bps is deliberately a rate nothing in the schedule uses. If the
    // function consulted fee_schedules, this would come back as the live
    // marketplace rate instead.
    const snapshot = {
      resolved: true, basis: 'bps', value: 777,
      min_fee: null, max_fee: null, payer: 'buyer', schedule_ref: 'FEE-SYNTHETIC',
    }
    const { data, error } = await USER.client.rpc('loamy_fee_from_snapshot', {
      p_snapshot: snapshot,
      p_amount: 1_000_000,
    })
    expect(error, error?.message).toBeFalsy()
    expect(Number(data)).toBe(77_700)
  })

  it('gives the same answer regardless of what the live schedule says now', async () => {
    // The live marketplace rule resolves to something; the snapshot must not
    // move toward it.
    const live = await USER.client.rpc('loamy_resolve_fee', {
      p_scope: 'marketplace_transaction', p_amount: 1_000_000,
      p_transaction_type: 'marketplace', p_user_role: null,
      p_partner_id: null, p_commodity_group: null,
    })
    const liveFee = Number((live.data as { fee?: number } | null)?.fee ?? 0)

    const { data } = await USER.client.rpc('loamy_fee_from_snapshot', {
      p_snapshot: { resolved: true, basis: 'bps', value: 777, payer: 'buyer' },
      p_amount: 1_000_000,
    })
    expect(Number(data)).toBe(77_700)
    // Guard against a schedule that happens to be 777bps making this vacuous.
    expect(Number(data)).not.toBe(liveFee)
  })

  it('honours a frozen flat fee', async () => {
    const { data } = await USER.client.rpc('loamy_fee_from_snapshot', {
      p_snapshot: { resolved: true, basis: 'flat', value: 12_345, payer: 'buyer' },
      p_amount: 9_999_999,
    })
    expect(Number(data)).toBe(12_345)
  })

  it('honours the frozen floor and ceiling, not a current one', async () => {
    const capped = await USER.client.rpc('loamy_fee_from_snapshot', {
      p_snapshot: { resolved: true, basis: 'bps', value: 1000, max_fee: 5_000, payer: 'buyer' },
      p_amount: 1_000_000,
    })
    expect(Number(capped.data)).toBe(5_000)

    const floored = await USER.client.rpc('loamy_fee_from_snapshot', {
      p_snapshot: { resolved: true, basis: 'bps', value: 1, min_fee: 2_500, payer: 'buyer' },
      p_amount: 1_000,
    })
    expect(Number(floored.data)).toBe(2_500)
  })

  it('returns null for a transaction that never froze a rule', async () => {
    // Null is the signal that makes settlement fall back EXPLICITLY and
    // record that it did, rather than silently charging a live rate.
    for (const snapshot of [null, {}, { resolved: false, reason: 'no_rule', fee: 0 }]) {
      const { data } = await USER.client.rpc('loamy_fee_from_snapshot', {
        p_snapshot: snapshot, p_amount: 1_000_000,
      })
      expect(data, `snapshot ${JSON.stringify(snapshot)} should not produce a fee`).toBeNull()
    }
  })
})

describe('a snapshot carries everything needed to stand alone', () => {
  it('captures basis, value, payer and the schedule reference', async () => {
    const { data } = await USER.client.rpc('loamy_resolve_fee', {
      p_scope: 'marketplace_transaction', p_amount: 1_000_000,
      p_transaction_type: 'marketplace', p_user_role: null,
      p_partner_id: null, p_commodity_group: null,
    })
    const r = data as Record<string, unknown> | null
    if (!r || r.resolved !== true) {
      // No marketplace rule configured. That is a valid state -- no fee is
      // charged -- and there is nothing to freeze.
      expect(r?.resolved).toBe(false)
      return
    }
    // Each of these is required to recompute the fee later without the
    // schedule. A snapshot missing one forces a fallback to live config.
    for (const key of ['basis', 'value', 'payer', 'schedule_ref', 'schedule_id', 'resolved_at']) {
      expect(r[key], `snapshot must carry ${key}`).not.toBeUndefined()
    }
  })
})

describe('accepted transactions keep the economics they were quoted', () => {
  it('every accepted transaction that has a snapshot carries a resolvable one', async () => {
    if (!admin) return
    const { data } = await admin
      .from('transactions')
      .select('id, ref, status, subtotal, fee_snapshot')
      .not('fee_snapshot', 'is', null)
      .order('created_at', { ascending: false })
      .range(0, 49)

    const rows = (data ?? []) as { ref: string; subtotal: number; fee_snapshot: Record<string, unknown> }[]
    if (rows.length === 0) return // nothing accepted yet; nothing to assert

    for (const row of rows) {
      const snap = row.fee_snapshot
      if (snap?.resolved !== true) continue
      // The stored snapshot must still compute. A snapshot that cannot be
      // recomputed is a transaction whose economics are unreconstructable.
      const { data: fee, error } = await admin!.rpc('loamy_fee_from_snapshot', {
        p_snapshot: snap, p_amount: row.subtotal,
      })
      expect(error, `${row.ref}: ${error?.message}`).toBeFalsy()
      expect(Number(fee), `${row.ref} snapshot did not recompute`).not.toBeNaN()
      expect(snap.schedule_ref ?? snap.schedule_id, `${row.ref} snapshot has no schedule reference`).toBeTruthy()
    }
  }, 60_000)
})

describe('the schedule itself is not writable by a member', () => {
  it('refuses a member trying to give themselves a zero fee', async () => {
    const { error } = await USER.client.from('fee_schedules').insert({
      scope: 'marketplace_transaction', basis: 'bps', value: 0, payer: 'buyer',
    })
    expect(error, 'a member must not be able to write a fee rule').toBeTruthy()
  })

  it('refuses a member ending an existing rule', async () => {
    const { data: rules } = await USER.client.from('fee_schedules').select('id').limit(1)
    const id = (rules as { id: string }[] | null)?.[0]?.id
    expect(id, 'no fee rule was readable, so this asserts nothing').toBeTruthy()
    const { data: after } = await USER.client
      .from('fee_schedules').update({ active: false }).eq('id', id).select('id')
    // No UPDATE policy means zero rows match rather than an error raised.
    expect(after ?? []).toHaveLength(0)
  })
})
