import { afterAll, describe, expect, it } from 'vitest'
import { createdEmails, makeUser } from '../helpers/supabase'

/**
 * Regression guard for the Phase 0 hardening.
 *
 * Locking platform_role behind an RPC changed the write path that every new
 * signup goes through. If loamy_set_initial_role does not work, onboarding is
 * broken for every new member — a worse outcome than the escalation it closes.
 * These tests exist so that failure mode can never ship silently.
 */

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('onboarding can still set a first role', () => {
  it('loamy_set_initial_role completes onboarding for a fresh account', async () => {
    const u = await makeUser('farmer', 'Farmer')

    const { error } = await u.client.rpc('loamy_set_initial_role', { p_role: 'warehouse_owner' })
    expect(error, `onboarding RPC failed: ${error?.message}`).toBeFalsy()

    const { data } = await u.client
      .from('profiles')
      .select('platform_role, category, onboarding_complete')
      .eq('id', u.uid)
      .maybeSingle()

    expect(data?.platform_role).toBe('warehouse_owner')
    expect(data?.category).toBe('Warehouse Owner')
    expect(data?.onboarding_complete).toBe(true)
  }, 120_000)

  it('records the chosen role as held, so the switcher sees it', async () => {
    const u = await makeUser('trader', 'Trader')
    await u.client.rpc('loamy_set_initial_role', { p_role: 'trader' })

    const { data } = await u.client.from('user_platform_roles').select('role')
    expect((data ?? []).map((r) => r.role)).toContain('trader')
  }, 120_000)

  it('refuses a second use once onboarding is complete', async () => {
    const u = await makeUser('farmer', 'Farmer')
    await u.client.rpc('loamy_set_initial_role', { p_role: 'farmer' })

    // Must not double as a free role switch.
    const { error } = await u.client.rpc('loamy_set_initial_role', { p_role: 'exporter' })
    expect(error, 'initial-role RPC worked twice').toBeTruthy()

    const { data } = await u.client.from('profiles').select('platform_role').eq('id', u.uid).maybeSingle()
    expect(data?.platform_role).toBe('farmer')
  }, 120_000)

  it('refuses the operational bank role', async () => {
    const u = await makeUser('farmer', 'Farmer')
    const { error } = await u.client.rpc('loamy_set_initial_role', { p_role: 'bank' })
    expect(error).toBeTruthy()
  }, 120_000)

  it('add-then-switch still works after the lock', async () => {
    const u = await makeUser('trader', 'Trader')
    await u.client.rpc('loamy_set_initial_role', { p_role: 'trader' })

    const add = await u.client.rpc('loamy_add_role', { p_role: 'warehouse_owner' })
    expect(add.error, `add failed: ${add.error?.message}`).toBeFalsy()

    const sw = await u.client.rpc('loamy_switch_role', { p_role: 'warehouse_owner' })
    expect(sw.error, `switch failed: ${sw.error?.message}`).toBeFalsy()

    const { data } = await u.client.from('profiles').select('platform_role').eq('id', u.uid).maybeSingle()
    expect(data?.platform_role).toBe('warehouse_owner')
  }, 120_000)
})
