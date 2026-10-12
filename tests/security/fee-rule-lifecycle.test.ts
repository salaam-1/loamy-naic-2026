import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * FEE RULE LIFECYCLE — the guard added after an accidental production change.
 *
 * On 2026-09-21 the ₦2,500 Growth Partner commission for farm verification
 * was ended by a misclick in the admin fee surface: one `onClick`, one direct
 * `update({active:false, effective_to:now})`, instant, silent, unaudited.
 * Every approved farm verification afterwards accrued nothing.
 *
 * These tests hold the two properties that make that impossible to repeat:
 * the table no longer accepts direct mutation from any client, and both
 * lifecycle operations demand a written reason and leave an audit row.
 *
 * This file creates its OWN rule in a scope it invents nothing about, ends it
 * and reinstates it. It never touches a commercial rule.
 */

let MEMBER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
const NOTE = `Fee lifecycle test ${RUN}`

let ruleId = ''
let ruleRef = ''
/** The rule created by a restore, cleaned up alongside the original. */
let restoredId = ''

beforeAll(async () => {
  admin = await adminClient()
  MEMBER = await makeUser('trader', 'Trader')
  if (!admin) return

  const { data: me } = await admin.auth.getUser()
  const { data, error } = await admin.from('fee_schedules').insert({
    // A withdrawal-scope rule: nothing in the product resolves this scope, so
    // the test cannot alter what any member is charged.
    scope: 'withdrawal',
    transaction_type: `test_${RUN}`,
    basis: 'flat', value: 123, payer: 'platform',
    note: NOTE, created_by: me.user!.id,
  }).select('id, ref').single()
  if (error) throw new Error(`could not create the test rule: ${error.message}`)
  ruleId = data!.id
  ruleRef = data!.ref
}, 180_000)

afterAll(async () => {
  if (!admin) return
  /**
   * END the test rules; do not try to delete them.
   *
   * This migration removed the DELETE policy, so `.delete()` now matches zero
   * rows and fails silently -- which would leave this run's rules IN FORCE,
   * the exact pollution that once accumulated 38 live test rules. Ending them
   * through the RPC makes them inert: an ended rule resolves for nothing.
   */
  const { data: live } = await admin.from('fee_schedules')
    .select('id, note').eq('scope', 'withdrawal').eq('active', true)
  for (const r of live ?? []) {
    const mine = r.note === NOTE || String(r.note ?? '').startsWith(`Reinstates ${ruleRef}`)
    if (!mine) continue
    await admin.rpc('loamy_end_fee_rule', {
      p_rule_id: r.id, p_reason: `Test ${RUN} cleanup. Never a commercial rule.`,
    })
  }
}, 60_000)

describe('1 — the table no longer accepts direct mutation', () => {
  it('refuses an ordinary member ending a rule by UPDATE', async () => {
    const { data } = await MEMBER.client.from('fee_schedules')
      .update({ active: false }).eq('id', ruleId).select('id')
    expect(data ?? [], 'a member deactivated a fee rule').toHaveLength(0)
  })

  it('refuses even an ADMIN ending a rule by UPDATE', async () => {
    if (!admin) return
    // The heart of the fix. The UPDATE policy was removed entirely, so the
    // browser path that caused the incident no longer exists for anyone.
    const { data } = await admin.from('fee_schedules')
      .update({ active: false, effective_to: new Date().toISOString() })
      .eq('id', ruleId).select('id')
    expect(data ?? [], 'an admin mutated a fee rule directly from the client').toHaveLength(0)

    const { data: row } = await admin.from('fee_schedules')
      .select('active, effective_to').eq('id', ruleId).single()
    expect(row!.active, 'the direct update took effect').toBe(true)
    expect(row!.effective_to).toBeNull()
  })

  it('refuses a DELETE, so history cannot be erased', async () => {
    if (!admin) return
    await admin.from('fee_schedules').delete().eq('id', ruleId)
    const { data } = await admin.from('fee_schedules').select('id').eq('id', ruleId)
    expect(data ?? [], 'a fee rule was deleted').toHaveLength(1)
  })

  it('still lets any member READ the schedule', async () => {
    const { error } = await MEMBER.client.from('fee_schedules').select('scope').limit(1)
    expect(error, 'a member could not read the fee schedule').toBeFalsy()
  })

  it('shows a signed-out visitor nothing', async () => {
    const { data } = await anonClient().from('fee_schedules').select('id').limit(1)
    expect(data ?? []).toHaveLength(0)
  })
})

describe('2 — only an admin may end a rule, and only with a reason', () => {
  it('refuses an ordinary member', async () => {
    const { error } = await MEMBER.client.rpc('loamy_end_fee_rule', {
      p_rule_id: ruleId, p_reason: 'I would like to.',
    })
    expect(error, 'a member ended a fee rule').toBeTruthy()
    expect(error!.message).toMatch(/administrative/i)
  })

  it('refuses a signed-out caller', async () => {
    const { error } = await anonClient().rpc('loamy_end_fee_rule', {
      p_rule_id: ruleId, p_reason: 'x',
    })
    expect(error).toBeTruthy()
  })

  it('refuses an empty reason', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_end_fee_rule', { p_rule_id: ruleId, p_reason: '' })
    expect(error, 'a rule was ended with no reason').toBeTruthy()
  })

  it('refuses a whitespace reason', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_end_fee_rule', { p_rule_id: ruleId, p_reason: '   ' })
    expect(error).toBeTruthy()
  })

  it('leaves the rule in force after every refusal', async () => {
    if (!admin) return
    const { data } = await admin.from('fee_schedules')
      .select('active, effective_to').eq('id', ruleId).single()
    expect(data!.active).toBe(true)
    expect(data!.effective_to).toBeNull()
  })
})

describe('3 — a confirmed end works, once', () => {
  it('ends the rule and names the money it switched off', async () => {
    if (!admin) return
    const { data, error } = await admin.rpc('loamy_end_fee_rule', {
      p_rule_id: ruleId, p_reason: `Ending the ${RUN} test rule.`,
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, unknown>
    expect(r.ended).toBe(true)
    expect(Number(r.value)).toBe(123)
    expect(r.ref).toBe(ruleRef)
  })

  it('stops the rule resolving', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_resolve_fee', {
      p_scope: 'withdrawal', p_amount: 0, p_transaction_type: `test_${RUN}`,
    })
    expect((data as Record<string, unknown>).resolved).toBe(false)
  })

  it('is idempotent, so a double-click cannot move effective_to twice', async () => {
    if (!admin) return
    const { data: first } = await admin.from('fee_schedules')
      .select('effective_to').eq('id', ruleId).single()

    const { data, error } = await admin.rpc('loamy_end_fee_rule', {
      p_rule_id: ruleId, p_reason: 'A second click.',
    })
    expect(error).toBeFalsy()
    expect((data as Record<string, unknown>).ended).toBe(false)
    expect((data as Record<string, unknown>).reason).toBe('already_ended')

    const { data: second } = await admin.from('fee_schedules')
      .select('effective_to').eq('id', ruleId).single()
    // Rewriting when a rule stopped applying would corrupt reconciliation.
    expect(second!.effective_to).toBe(first!.effective_to)
  })

  it('wrote an audit row naming the rule, the amount and the reason', async () => {
    if (!admin) return
    const { data } = await admin.from('audit_events')
      .select('event_type, detail, actor_id')
      .eq('event_type', 'fee_rule_ended').eq('subject_id', ruleId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    expect(data, 'ending a fee rule left no audit trail').toBeTruthy()
    const d = data!.detail as Record<string, unknown>
    expect(d.ref).toBe(ruleRef)
    expect(Number(d.value)).toBe(123)
    expect(String(d.reason)).toMatch(new RegExp(RUN))
    // The actor is server-derived; the client never names who did it.
    expect(data!.actor_id).toBeTruthy()
  })
})

describe('4 — an ended rule can be reinstated, as a new period', () => {
  it('refuses an ordinary member', async () => {
    const { error } = await MEMBER.client.rpc('loamy_restore_fee_rule', {
      p_rule_id: ruleId, p_reason: 'Please.',
    })
    expect(error, 'a member reinstated a fee rule').toBeTruthy()
  })

  it('refuses an empty reason', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_restore_fee_rule', { p_rule_id: ruleId, p_reason: ' ' })
    expect(error).toBeTruthy()
  })

  it('creates a NEW rule and leaves the ended one untouched', async () => {
    if (!admin) return
    const { data: before } = await admin.from('fee_schedules').select('*').eq('id', ruleId).single()

    const { data, error } = await admin.rpc('loamy_restore_fee_rule', {
      p_rule_id: ruleId, p_reason: 'Ended by mistake. Not a pricing change.',
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, unknown>
    expect(r.restored).toBe(true)
    expect(r.restored_from).toBe(ruleRef)
    restoredId = r.new_id as string

    const { data: after } = await admin.from('fee_schedules').select('*').eq('id', ruleId).single()
    // The closed period is a historical fact and must survive the repair.
    expect(after, 'the restore rewrote the ended rule').toEqual(before)
  })

  it('copies every commercial term verbatim, so a restore is not a rate change', async () => {
    if (!admin || !restoredId) return
    const { data: src } = await admin.from('fee_schedules')
      .select('scope, transaction_type, user_role, commodity_group, basis, value, payer, min_fee, max_fee')
      .eq('id', ruleId).single()
    const { data: neu } = await admin.from('fee_schedules')
      .select('scope, transaction_type, user_role, commodity_group, basis, value, payer, min_fee, max_fee')
      .eq('id', restoredId).single()
    expect(neu).toEqual(src)
  })

  it('starts NOW and is never backdated', async () => {
    if (!admin || !restoredId) return
    const { data: src } = await admin.from('fee_schedules')
      .select('effective_from, effective_to').eq('id', ruleId).single()
    const { data: neu } = await admin.from('fee_schedules')
      .select('effective_from, effective_to, created_by').eq('id', restoredId).single()

    expect(new Date(neu!.effective_from).getTime())
      .toBeGreaterThan(new Date(src!.effective_to as string).getTime())
    expect(new Date(neu!.effective_from).getTime())
      .toBeGreaterThan(new Date(src!.effective_from).getTime())
    expect(neu!.effective_to).toBeNull()
    // Attribution the accidental end never had.
    expect(neu!.created_by, 'the restored rule has no attribution').toBeTruthy()
  })

  it('resolves again', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_resolve_fee', {
      p_scope: 'withdrawal', p_amount: 0, p_transaction_type: `test_${RUN}`,
    })
    const f = data as Record<string, unknown>
    expect(f.resolved).toBe(true)
    expect(Number(f.fee)).toBe(123)
  })

  it('refuses to create a second identical rule on a second click', async () => {
    if (!admin) return
    const { data, error } = await admin.rpc('loamy_restore_fee_rule', {
      p_rule_id: ruleId, p_reason: 'A second click.',
    })
    expect(error).toBeFalsy()
    expect((data as Record<string, unknown>).restored).toBe(false)
    expect((data as Record<string, unknown>).reason).toBe('equivalent_rule_already_in_force')
  })

  it('refuses to restore a rule that is still in force', async () => {
    if (!admin || !restoredId) return
    const { data } = await admin.rpc('loamy_restore_fee_rule', {
      p_rule_id: restoredId, p_reason: 'x',
    })
    expect((data as Record<string, unknown>).restored).toBe(false)
    expect((data as Record<string, unknown>).reason).toBe('still_in_force')
  })

  it('recorded the outage window in the audit trail', async () => {
    if (!admin || !restoredId) return
    const { data } = await admin.from('audit_events')
      .select('detail').eq('event_type', 'fee_rule_restored').eq('subject_id', restoredId)
      .maybeSingle()
    expect(data, 'reinstating a fee rule left no audit trail').toBeTruthy()
    const d = data!.detail as Record<string, unknown>
    expect(d.restored_from).toBe(ruleRef)
    // How long no rule was in force -- the measurable part of the incident.
    expect(d.gap_from).toBeTruthy()
    expect(d.gap_to).toBeTruthy()
  })
})

describe('5 — the commercial commission rules are intact', () => {
  it.each([
    ['farm_verification', 2500],
    ['farmer_verification', 1500],
    ['commodity_verification', 4000],
    ['batch_verification', 4000],
    ['loading_verification', 3500],
    ['market_price_collection', 800],
  ])('pays %s at the agreed rate', async (taskType, expected) => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_resolve_fee', {
      p_scope: 'verification_commission', p_amount: 0, p_transaction_type: taskType,
    })
    const f = data as Record<string, unknown>
    expect(f.resolved, `no active commission rule for ${taskType}`).toBe(true)
    expect(Number(f.fee), `${taskType} rate changed`).toBe(expected)
  })

  it('keeps FEE-000022 ended, with its original closed period', async () => {
    if (!admin) return
    // The accidentally-ended rule is deliberately NOT reopened: its period is
    // a fact, and the gap after it is evidence reconciliation needs.
    const { data } = await admin.from('fee_schedules')
      .select('scope, active, effective_from, effective_to, value').eq('ref', 'FEE-000022').maybeSingle()
    if (!data) return
    // A ref is only a NAME. The sequence is per-environment, so on a fresh
    // project ordinary test-created rules eventually reach FEE-000022 and this
    // assertion grabbed one of them: on staging it is a marketplace_transaction
    // export rule at 50 bps, nothing to do with the accidentally-ended
    // verification commission. Identify the rule under test by what makes it
    // that rule, and skip when the ref belongs to something else. Production
    // behaviour is unchanged.
    if (data.scope !== 'verification_commission' || Number(data.value) !== 2500) return
    expect(data.active).toBe(false)
    expect(data.effective_to).toBeTruthy()
    expect(Number(data.value)).toBe(2500)
  })

  it('serves farm_verification from a DIFFERENT, live rule', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_resolve_fee', {
      p_scope: 'verification_commission', p_amount: 0, p_transaction_type: 'farm_verification',
    })
    expect((data as Record<string, unknown>).schedule_ref).not.toBe('FEE-000022')
  })
})
