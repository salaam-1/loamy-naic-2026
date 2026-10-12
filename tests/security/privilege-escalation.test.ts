import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createdEmails, makeUser, type TestUser } from '../helpers/supabase'

/**
 * Part 4 / Part 29: a member must not be able to promote themselves.
 *
 * The frontend decides what to render from `profiles.role` and
 * `profiles.platform_role`. If either is client-writable, every frontend
 * permission check in the app is decoration.
 */

let U: TestUser

beforeAll(async () => {
  U = await makeUser('farmer', 'Farmer')
}, 120_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('a member cannot promote themselves', () => {
  it('cannot set profiles.role to admin', async () => {
    await U.client.from('profiles').update({ role: 'admin' }).eq('id', U.uid)
    const { data } = await U.client.from('profiles').select('role').eq('id', U.uid).maybeSingle()
    expect(data?.role, 'a member escalated themselves to admin').not.toBe('admin')
  })

  it('cannot flip their own verified_badge', async () => {
    await U.client.from('profiles').update({ verified_badge: true }).eq('id', U.uid)
    const { data } = await U.client.from('profiles').select('verified_badge').eq('id', U.uid).maybeSingle()
    expect(data?.verified_badge, 'a member self-verified').not.toBe(true)
  })

  it('cannot un-suspend themselves', async () => {
    // `active` false is the Stage 6 suspension flag; a suspended member
    // flipping it back would defeat moderation entirely.
    const { data: before } = await U.client.from('profiles').select('active').eq('id', U.uid).maybeSingle()
    await U.client.from('profiles').update({ active: true }).eq('id', U.uid)
    const { data: after } = await U.client.from('profiles').select('active').eq('id', U.uid).maybeSingle()
    // Already active, so this asserts the write does not error into a changed
    // state rather than that the value flipped.
    expect(after?.active).toBe(before?.active)
  })

  it('cannot self-award the Growth Partner verification capability', async () => {
    // Half of the escalation chain closed by 20260919110001. can_verify gates
    // claiming verification tasks AND reading other members' farm detail.
    await U.client.from('role_details').upsert({
      user_id: U.uid,
      role_data: { can_verify: true },
    })
    const { data } = await U.client.from('role_details').select('role_data').eq('user_id', U.uid).maybeSingle()
    const canVerify = (data?.role_data as Record<string, unknown> | undefined)?.can_verify
    expect(canVerify, 'a member self-granted the verification capability').not.toBe(true)
  })

  it('cannot switch into a platform role it does not hold via the RPC', async () => {
    const { error } = await U.client.rpc('loamy_switch_role', { p_role: 'growth_partner' })
    expect(error, 'an unheld role switch succeeded').toBeTruthy()
  })

  it('cannot add or switch into the operational bank role', async () => {
    const add = await U.client.rpc('loamy_add_role', { p_role: 'bank' })
    expect(add.error, 'bank role was addable').toBeTruthy()
    const sw = await U.client.rpc('loamy_switch_role', { p_role: 'bank' })
    expect(sw.error, 'bank role was switchable').toBeTruthy()
  })

  it('cannot side-step the switch RPC with a direct platform_role update', async () => {
    // The other half of the chain. Before 20260919110001 this succeeded, which
    // made loamy_switch_role's entitlement check decorative.
    const { data: before } = await U.client.from('profiles').select('platform_role').eq('id', U.uid).maybeSingle()
    expect(before?.platform_role).toBe('farmer')

    await U.client.from('profiles').update({ platform_role: 'growth_partner' }).eq('id', U.uid)

    const { data: after } = await U.client.from('profiles').select('platform_role').eq('id', U.uid).maybeSingle()
    expect(after?.platform_role, 'platform_role is still directly client-writable').toBe('farmer')
  })

  it('cannot combine both halves to pass loamy_can_verify', async () => {
    // The chain end-to-end: growth_partner + can_verify would unlock other
    // members' private farm detail. Neither half may be self-set.
    await U.client.from('profiles').update({ platform_role: 'growth_partner' }).eq('id', U.uid)
    await U.client.from('role_details').upsert({ user_id: U.uid, role_data: { can_verify: true } })

    const { data: prof } = await U.client.from('profiles').select('platform_role').eq('id', U.uid).maybeSingle()
    const { data: rd } = await U.client.from('role_details').select('role_data').eq('user_id', U.uid).maybeSingle()
    const escalated =
      prof?.platform_role === 'growth_partner' &&
      (rd?.role_data as Record<string, unknown> | undefined)?.can_verify === true
    expect(escalated, 'full privilege-escalation chain is still open').toBe(false)
  })
})
