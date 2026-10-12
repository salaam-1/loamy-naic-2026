import { describe, expect, it } from 'vitest'
import { anonClient, makeUser } from '../helpers/supabase'

/**
 * loamy_set_language, against the real database.
 *
 * The preference lives in role_details.role_data, which also carries
 * admin-granted keys. So the question this file answers is not "does it save
 * the language" but "can it be made to do anything else": set somebody else's
 * preference, grant a capability, drop a bank officer's bank, accept a locale
 * the interface cannot render, or run without a caller.
 */
describe('loamy_set_language', () => {
  it('saves the caller own language and reports it back', async () => {
    const u = await makeUser('farmer', 'Farmer')
    const { data, error } = await u.client.rpc('loamy_set_language', { p_lang: 'ha' })
    expect(error, String(error?.message)).toBeFalsy()
    expect((data as { language?: string } | null)?.language).toBe('ha')

    const { data: row } = await u.client
      .from('role_details')
      .select('role_data')
      .eq('user_id', u.uid)
      .maybeSingle()
    expect((row?.role_data as Record<string, unknown>)?.language).toBe('ha')
  })

  it('is idempotent', async () => {
    const u = await makeUser('farmer', 'Farmer')
    await u.client.rpc('loamy_set_language', { p_lang: 'fr' })
    const { error } = await u.client.rpc('loamy_set_language', { p_lang: 'fr' })
    expect(error, String(error?.message)).toBeFalsy()
    const { data: row } = await u.client
      .from('role_details').select('role_data').eq('user_id', u.uid).maybeSingle()
    expect((row?.role_data as Record<string, unknown>)?.language).toBe('fr')
  })

  it('accepts every locale the product ships, and only those', async () => {
    const u = await makeUser('farmer', 'Farmer')
    for (const lang of ['en', 'ha', 'ig', 'yo', 'fr']) {
      const { error } = await u.client.rpc('loamy_set_language', { p_lang: lang })
      expect(error, `${lang}: ${error?.message}`).toBeFalsy()
    }
  })

  it('REJECTS a locale the interface cannot render', async () => {
    const u = await makeUser('farmer', 'Farmer')
    for (const bad of ['de', 'zz', 'en-US', '', 'pt-BR', 'EN; drop table']) {
      const { error } = await u.client.rpc('loamy_set_language', { p_lang: bad })
      expect(error, `expected ${JSON.stringify(bad)} to be refused`).toBeTruthy()
    }
  })

  it('REJECTS an unauthenticated caller', async () => {
    const anon = anonClient()
    const { error } = await anon.rpc('loamy_set_language', { p_lang: 'ha' })
    expect(error, 'an anonymous caller set a language').toBeTruthy()
  })

  it('has no user_id parameter, so another member cannot be targeted', async () => {
    const a = await makeUser('farmer', 'Farmer')
    const b = await makeUser('farmer', 'Farmer')

    // There is no argument that names a user. Supplying one must fail outright
    // rather than be silently ignored.
    const { error } = await a.client.rpc('loamy_set_language', {
      p_lang: 'fr',
      p_user: b.uid,
    } as Record<string, unknown>)
    expect(error, 'the function accepted a caller-supplied user id').toBeTruthy()

    // And A acting normally must not have touched B.
    await a.client.rpc('loamy_set_language', { p_lang: 'fr' })
    const { data: bRow } = await b.client
      .from('role_details').select('role_data').eq('user_id', b.uid).maybeSingle()
    expect((bRow?.role_data as Record<string, unknown>)?.language ?? null).toBeNull()
  })

  it('PRESERVES every other role_data property', async () => {
    const u = await makeUser('farmer', 'Farmer')

    // Seed unrelated keys through the member's own normal write path.
    await u.client.from('role_details').upsert({
      user_id: u.uid,
      role_data: { farm_size: 12, crops: ['maize', 'rice'], onboarded_step: 'done', nested: { a: 1 } },
    })

    const { error } = await u.client.rpc('loamy_set_language', { p_lang: 'yo' })
    expect(error, String(error?.message)).toBeFalsy()

    const { data: row } = await u.client
      .from('role_details').select('role_data').eq('user_id', u.uid).maybeSingle()
    const rd = row?.role_data as Record<string, unknown>
    expect(rd.language).toBe('yo')
    expect(rd.farm_size).toBe(12)
    expect(rd.crops).toEqual(['maize', 'rice'])
    expect(rd.onboarded_step).toBe('done')
    expect(rd.nested).toEqual({ a: 1 })
  })

  it('cannot be used to grant a capability', async () => {
    const u = await makeUser('farmer', 'Farmer')
    await u.client.rpc('loamy_set_language', { p_lang: 'ig' })
    const { data: row } = await u.client
      .from('role_details').select('role_data').eq('user_id', u.uid).maybeSingle()
    const rd = (row?.role_data ?? {}) as Record<string, unknown>
    // The function writes one key. can_verify is not created, and the member is
    // not silently promoted by having chosen a language.
    expect(rd.can_verify ?? false).toBe(false)
    expect(rd.bank_id ?? null).toBeNull()
  })

  it('creates the row for a member who has none, without inventing other data', async () => {
    const u = await makeUser('farmer', 'Farmer')
    const { error } = await u.client.rpc('loamy_set_language', { p_lang: 'ha' })
    expect(error, String(error?.message)).toBeFalsy()
    const { data: row } = await u.client
      .from('role_details').select('role_data').eq('user_id', u.uid).maybeSingle()
    expect(Object.keys((row?.role_data ?? {}) as Record<string, unknown>)).toEqual(['language'])
  })

  it('still refuses one member reading another member role_details', async () => {
    const a = await makeUser('farmer', 'Farmer')
    const b = await makeUser('farmer', 'Farmer')
    await b.client.rpc('loamy_set_language', { p_lang: 'fr' })
    const peek = await a.client.from('role_details').select('role_data').eq('user_id', b.uid)
    expect(peek.error || (peek.data ?? []).length === 0, 'RLS let a member read another row').toBeTruthy()
  })
})
