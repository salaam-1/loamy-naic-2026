import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'

/**
 * Part 3 / Part 29: prove that RLS actually stops one member reading another's
 * data. Reading the policy SQL is not proof; this is.
 *
 * Two unrelated accounts are created, then A tries every private surface of B.
 * A denial here shows up either as an error or as zero rows — both are a pass,
 * a returned row is a failure.
 */

let A: TestUser
let B: TestUser

beforeAll(async () => {
  A = await makeUser('trader', 'Trader')
  B = await makeUser('farmer', 'Farmer')
}, 120_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

/** Tables where a row belongs to exactly one member. */
const OWNED_TABLES: { table: string; column: string }[] = [
  { table: 'wallet_entries', column: 'user_id' },
  { table: 'wallet_withdrawals', column: 'user_id' },
  { table: 'user_platform_roles', column: 'user_id' },
  { table: 'role_details', column: 'user_id' },
  { table: 'farms', column: 'owner_id' },
  { table: 'financing_applications', column: 'applicant_id' },
  { table: 'notifications', column: 'user_id' },
  { table: 'cart_items', column: 'user_id' },
  { table: 'wishlists', column: 'user_id' },
  { table: 'seller_payout_accounts', column: 'user_id' },
]

describe('cross-user reads are denied', () => {
  for (const { table, column } of OWNED_TABLES) {
    it(`A cannot read B's ${table}`, async () => {
      const { data, error } = await A.client.from(table).select('*').eq(column, B.uid)
      if (error) return // denial by error is fine
      expect(data ?? [], `${table} leaked ${data?.length} row(s) to another member`).toHaveLength(0)
    })
  }
})

describe('cross-user writes are denied', () => {
  it('A cannot insert a farm owned by B', async () => {
    const { error } = await A.client.from('farms').insert({
      owner_id: B.uid,
      farm_name: 'RLS probe',
      state: 'Kano',
      lga: 'Kano Municipal',
      size_hectares: 1,
      primary_crops: ['Maize'],
      ownership_type: 'owned',
    })
    expect(error, 'A was able to create a farm owned by B').toBeTruthy()
  })

  it('A cannot create a listing that sells as B', async () => {
    const { error } = await A.client.from('listings').insert({
      seller_id: B.uid,
      listing_type: 'commodity',
      commodity: 'Maize',
      quantity_kg: 1,
      unit: 'kg',
      price_per_unit: 1,
      state: 'Kano',
    })
    expect(error, 'A was able to list on behalf of B').toBeTruthy()
  })

  it('A cannot credit their own wallet', async () => {
    const { error } = await A.client.from('wallet_entries').insert({
      user_id: A.uid,
      direction: 'credit',
      amount: 1_000_000,
      kind: 'adjustment',
      reference: `rls-probe-${Date.now()}`,
    })
    expect(error, 'a member was able to write their own ledger').toBeTruthy()
  })

  it('A cannot credit B’s wallet', async () => {
    const { error } = await A.client.from('wallet_entries').insert({
      user_id: B.uid,
      direction: 'credit',
      amount: 1_000_000,
      kind: 'adjustment',
      reference: `rls-probe-b-${Date.now()}`,
    })
    expect(error).toBeTruthy()
  })
})

describe('anonymous visitors see only the public surface', () => {
  const PRIVATE = [
    'wallet_entries', 'wallet_withdrawals', 'user_platform_roles', 'farms',
    'financing_applications', 'orders', 'notifications', 'verification_tasks',
    'role_details', 'seller_payout_accounts', 'audit_events', 'companies',
  ]

  for (const table of PRIVATE) {
    it(`anon cannot read ${table}`, async () => {
      const { data, error } = await anonClient().from(table).select('*').limit(1)
      if (error) return
      expect(data ?? [], `${table} is readable while signed out`).toHaveLength(0)
    })
  }

  it('anon CAN read the intended public listings view', async () => {
    // The inverse assertion: the public storefront must keep working.
    const { error } = await anonClient().from('loamy_public_listings').select('id').limit(1)
    expect(error).toBeFalsy()
  })
})
