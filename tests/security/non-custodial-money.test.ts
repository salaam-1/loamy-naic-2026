import { beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * THE NON-CUSTODIAL BOUNDARY, enforced rather than documented.
 *
 * Wave 1 QA found a `wallet_entries` row written by the LIVE product on
 * 2026-09-21: kind 'order_settlement', "Marketplace order … released by the
 * buyer". The custodial wallet MODULE had been deleted; four deployed edge
 * functions still wrote the TABLE, because a grep of src/ cannot see them.
 *
 * A grep is not an invariant. These tests assert the guarantee at the only
 * place it cannot be bypassed -- the database -- and then walk the real
 * purchase lifecycle to prove it creates no balance.
 *
 * HISTORY IS NOT DELETED. Existing rows must still be readable: they are
 * financial records, and removing them to make a test green would be the
 * worst possible response to having found them.
 */

let BUYER: TestUser
let SELLER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
const QTY = 4
const PRICE = 90_000

let listingId = ''
let txnId = ''
let historicalCount = 0

beforeAll(async () => {
  admin = await adminClient()
  BUYER = await makeUser('trader', 'Trader')
  SELLER = await makeUser('farmer', 'Farmer')

  const listing = await SELLER.client.from('listings').insert({
    seller_id: SELLER.uid, commodity: 'Maize', listing_type: 'commodity',
    quantity_kg: 100, unit: 'tonne', price_per_unit: PRICE,
    state: 'Benue', lga: 'Makurdi', status: 'active',
  }).select('id').single()
  if (listing.error || !listing.data) {
    throw new Error(`setup listing: ${listing.error?.message ?? 'no row returned'}`)
  }
  listingId = listing.data.id

  const txn = await BUYER.client.rpc('loamy_propose_transaction', {
    p_listing_id: listingId, p_quantity: QTY,
  })
  if (txn.error || !txn.data) throw new Error(`setup transaction: ${txn.error?.message}`)
  txnId = txn.data as string

  if (admin) {
    const { count } = await admin.from('wallet_entries').select('id', { count: 'exact', head: true })
    historicalCount = count ?? 0
  }
}, 300_000)

describe('1 — the wallet table is closed to new writes', () => {
  it('refuses an INSERT from an ordinary member', async () => {
    const { error } = await BUYER.client.from('wallet_entries').insert({
      user_id: BUYER.uid, direction: 'credit', amount: 1000,
      kind: 'escrow_release', reference: `test:${RUN}`,
    })
    expect(error, 'a member created a wallet balance').toBeTruthy()
  })

  it('refuses an INSERT from an ADMIN', async () => {
    if (!admin) return
    // The heart of it. The four writers ran as service_role, and RLS would
    // not have stopped them -- a BEFORE trigger does.
    const { data: me } = await admin.auth.getUser()
    const { error } = await admin.from('wallet_entries').insert({
      user_id: me.user!.id, direction: 'credit', amount: 1000,
      kind: 'order_settlement', reference: `test-admin:${RUN}`,
    })
    expect(error, 'an admin created a wallet balance').toBeTruthy()
    expect(error!.message).toMatch(/closed|not a custodian|ledger_entries/i)
  })

  it('refuses a withdrawal request', async () => {
    const { error } = await BUYER.client.from('wallet_withdrawals').insert({
      user_id: BUYER.uid, amount: 500, status: 'pending', reference: `wd:${RUN}`,
    })
    expect(error, 'a withdrawal was requested against a balance that does not exist').toBeTruthy()
  })

  it('leaves a historical record unchanged when an UPDATE is attempted', async () => {
    if (!admin || historicalCount === 0) return
    const { data: row } = await admin.from('wallet_entries')
      .select('id, amount').limit(1).maybeSingle()
    if (!row) return

    await admin.from('wallet_entries').update({ amount: 1 }).eq('id', row.id)

    // Asserting the OUTCOME, not the mechanism: with no UPDATE policy
    // PostgREST matches zero rows and reports no error, so an error check
    // would pass for the wrong reason. What matters is that the number did
    // not move.
    const { data: after } = await admin.from('wallet_entries')
      .select('amount').eq('id', row.id).single()
    expect(Number(after!.amount), 'a historical wallet amount was edited')
      .toBe(Number(row.amount))
  })

  it('refuses a DELETE, so history cannot be erased', async () => {
    if (!admin || historicalCount === 0) return
    const { data: row } = await admin.from('wallet_entries').select('id').limit(1).maybeSingle()
    if (!row) return
    await admin.from('wallet_entries').delete().eq('id', row.id)
    const { count } = await admin.from('wallet_entries').select('id', { count: 'exact', head: true })
    expect(count, 'historical wallet records were deleted').toBe(historicalCount)
  })
})

describe('2 — history is retained and readable', () => {
  it('keeps every row that already existed', async () => {
    if (!admin) return
    const { count } = await admin.from('wallet_entries').select('id', { count: 'exact', head: true })
    // The fix is to stop NEW writes, never to tidy away the evidence.
    expect(count).toBe(historicalCount)
  })

  it('still lets a member read their own history', async () => {
    const { error } = await BUYER.client.from('wallet_entries').select('id').limit(1)
    expect(error, 'a member could not read their own financial history').toBeFalsy()
  })
})

describe('3 — the real purchase lifecycle creates no balance', () => {
  it('created a transaction, not an order', async () => {
    const { data: t } = await BUYER.client.from('transactions')
      .select('id, ref, status').eq('id', txnId).single()
    expect(t!.ref).toMatch(/^TXN-/)

    const { data: orders } = await BUYER.client.from('orders')
      .select('id').eq('listing_id', listingId)
    expect(orders ?? [], 'checkout created a deprecated order row').toHaveLength(0)
  })

  it('leaves the wallet untouched through the whole lifecycle', async () => {
    if (!admin) return
    // Loading -> transport -> the states a purchase actually moves through.
    await SELLER.client.rpc('loamy_record_loading', {
      p_transaction_id: txnId, p_stage: 'scheduled',
    })
    await SELLER.client.rpc('loamy_record_loading', {
      p_transaction_id: txnId, p_stage: 'completed', p_quantity: QTY,
    })
    await BUYER.client.rpc('loamy_request_transport_for_transaction', {
      p_transaction_id: txnId, p_mode: 'external', p_external_provider: `Own lorry ${RUN}`,
    })

    const { count } = await admin.from('wallet_entries').select('id', { count: 'exact', head: true })
    expect(count, 'the purchase lifecycle created a wallet entry').toBe(historicalCount)
  })

  it('records money movement in the LEDGER, which is double-entry', async () => {
    if (!admin) return
    // Not an assertion about this purchase -- nothing has settled -- but
    // about where money is recorded at all. Every entry group must balance.
    const { data: entries } = await admin.from('ledger_entries')
      .select('entry_group, amount').limit(400)
    const groups = new Map<string, number>()
    for (const e of entries ?? []) {
      groups.set(e.entry_group, (groups.get(e.entry_group) ?? 0) + Number(e.amount))
    }
    const unbalanced = [...groups.entries()].filter(([, sum]) => Math.abs(sum) > 0.01)
    expect(unbalanced, 'a ledger entry group does not balance').toHaveLength(0)
  })
})

describe('4 — no WITHDRAWABLE member balance exists', () => {
  it('keeps the memorandum accounts unowned', async () => {
    if (!admin) return
    // partner_funding and external_settlement record money Loamy never
    // touches. An owner on either would turn a memorandum into a claim.
    const { data } = await admin.from('ledger_accounts')
      .select('account_type, owner_id')
      .in('account_type', ['partner_funding', 'external_settlement'])
    for (const a of data ?? []) {
      expect(a.owner_id, `${a.account_type} has an owner`).toBeNull()
    }
  })

  it('offers no way to turn a ledger position into cash', async () => {
    // A `member_receivable` balance is NOT custody -- it is an accounting
    // position recording what is owed once an institution settles. The
    // custodial line is crossed by a WITHDRAWABLE balance, and both tables
    // that could represent one now refuse every write (see section 1).
    const { error: w } = await BUYER.client.from('wallet_withdrawals').insert({
      user_id: BUYER.uid, amount: 1, status: 'pending', reference: `w4:${RUN}`,
    })
    expect(w, 'a member could request a payout of a ledger position').toBeTruthy()
  })

  it('shows a signed-out visitor no wallet history at all', async () => {
    const { data } = await anonClient().from('wallet_entries').select('id').limit(1)
    expect(data ?? []).toHaveLength(0)
  })
})
