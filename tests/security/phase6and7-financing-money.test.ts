import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Phases 6 and 7: financing, and the money layer.
 *
 * These are the two phases where a mistake is a regulatory incident rather
 * than a bug, so the tests lean almost entirely on what must be IMPOSSIBLE:
 *
 *   - no BVN anywhere
 *   - an applicant cannot approve their own financing
 *   - a bank officer cannot see another bank's applications
 *   - no client can write a ledger entry, and no post can be unbalanced
 *   - escrow cannot be released without the buyer accepting delivery first
 */

let BUYER: TestUser
let SELLER: TestUser
let OUTSIDER: TestUser
let admin: SupabaseClient | null
let bankId = ''
let txnId = ''
let appId = ''
let escrowId = ''

beforeAll(async () => {
  BUYER = await makeUser('trader', 'Trader')
  SELLER = await makeUser('farmer', 'Farmer')
  OUTSIDER = await makeUser('trader', 'Trader')
  admin = await adminClient()

  // A sandbox bank. integration_mode defaults to 'sandbox' -- nothing live.
  if (admin) {
    const name = `Test Sandbox Bank ${Date.now().toString(36)}`
    const { data: b } = await admin.from('banks').insert({
      name, active: true, supports_supplier_direct: true, supports_account_opening: true,
      account_opening_url: 'https://example.invalid/open',
    }).select('id').single()
    bankId = b!.id
  }

  // A real accepted transaction to finance.
  const { data: farm } = await SELLER.client.from('farms').insert({
    owner_id: SELLER.uid, farm_name: 'P67 Farm', state: 'Benue', lga: 'Makurdi',
    size_hectares: 8, primary_crops: ['Maize'], ownership_type: 'owned',
  }).select('id').single()
  const { data: cycle } = await SELLER.client.from('crop_records').insert({
    farm_id: farm!.id, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single()
  const { data: harvest } = await SELLER.client.from('harvests').insert({
    production_cycle_id: cycle!.id, farm_id: farm!.id, commodity: 'Maize',
    harvest_date: '2026-09-05', quantity: 30, unit: 'tonne',
  }).select('id').single()
  const { data: batch } = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvest!.id, p_quantity: 30,
  })
  const { data: listing } = await SELLER.client.rpc('loamy_list_batch', {
    p_batch_id: batch as string, p_quantity: 20, p_price_per_unit: 500_000,
  })
  const { data: t } = await BUYER.client.rpc('loamy_propose_transaction', {
    p_listing_id: listing as string, p_quantity: 20,
  })
  txnId = t as string
  await SELLER.client.rpc('loamy_transaction_transition', {
    p_transaction_id: txnId, p_event_type: 'accept', p_machine: 'status',
  })
}, 300_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

// ---------------------------------------------------------------------------
describe('Phase 6 — no BVN, anywhere', () => {
  it('has no BVN-shaped column on any financing or bank table', async () => {
    if (!admin) return
    for (const t of ['bank_account_links', 'financing_applications', 'banks', 'financing_events']) {
      const { data } = await admin.from(t).select('*').limit(1)
      const cols = Object.keys(data?.[0] ?? {})
      for (const c of cols) {
        expect(c.toLowerCase(), `${t}.${c} looks like a BVN column`).not.toContain('bvn')
      }
    }
  })

  it('accepts only the last four digits of an account number', async () => {
    const { error } = await BUYER.client.rpc('loamy_link_bank_account', {
      p_bank_id: bankId, p_account_last4: '0123456789', p_has_account: true,
    })
    expect(error, 'a full account number was accepted').toBeTruthy()
  })

  it('links an account and records only the masked tail', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_link_bank_account', {
      p_bank_id: bankId, p_account_last4: '4321', p_has_account: true,
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.status).toBe('link_requested')
    expect(r.integration_mode).toBe('sandbox')

    const { data: link } = await BUYER.client
      .from('bank_account_links').select('account_last4, status').eq('bank_id', bankId).single()
    expect(link!.account_last4).toBe('4321')
  })

  it('routes account OPENING to the bank rather than collecting identity', async () => {
    const { data } = await SELLER.client.rpc('loamy_link_bank_account', {
      p_bank_id: bankId, p_has_account: false,
    })
    const r = data as Record<string, any>
    expect(r.status).toBe('account_opening')
    expect(r.next.action).toBe('open_account_with_bank')
    expect(r.next.url).toBeTruthy()
  })

  it('keeps a bank link private to its owner', async () => {
    const { data } = await OUTSIDER.client
      .from('bank_account_links').select('*').eq('user_id', BUYER.uid)
    expect(data ?? []).toHaveLength(0)
  })
})

describe('Phase 6 — financing inherits the transaction', () => {
  it('derives amount, seller and batch from the transaction being financed', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txnId, p_bank_id: bankId,
    })
    expect(error, error?.message).toBeFalsy()
    appId = data as string

    const { data: a } = await BUYER.client
      .from('financing_applications')
      .select('ref, amount_requested, approved_amount, seller_id, batch_id, transaction_id, status, disbursement_preference')
      .eq('id', appId).single()

    expect(a!.ref).toMatch(/^FIN-\d{6}$/)
    // 20 x 500,000 -- inherited, not typed.
    expect(Number(a!.amount_requested)).toBe(10_000_000)
    expect(a!.seller_id).toBe(SELLER.uid)
    expect(a!.transaction_id).toBe(txnId)
    expect(a!.status).toBe('submitted')
    // This sandbox bank supports supplier-direct, so it is offered.
    expect(a!.disbursement_preference).toBe('supplier_payment')
    // Nothing approved yet.
    expect(a!.approved_amount).toBeNull()
  })

  it('links the application back onto the transaction', async () => {
    const { data } = await BUYER.client
      .from('transactions').select('financing_application_id').eq('id', txnId).single()
    expect(data!.financing_application_id).toBe(appId)
  })

  it('refuses a second live application for the same purchase', async () => {
    const { error } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txnId, p_bank_id: bankId,
    })
    expect(error).toBeTruthy()
  })

  it('refuses a non-buyer applying against someone else’s purchase', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txnId, p_bank_id: bankId,
    })
    expect(error).toBeTruthy()
  })
})

describe('Phase 6 — Loamy does not decide credit', () => {
  it('refuses an applicant approving their own application', async () => {
    const { error } = await BUYER.client.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved', p_approved_amount: 10_000_000,
    })
    expect(error, 'an applicant approved their own financing').toBeTruthy()
  })

  it('refuses an applicant writing approved_amount directly', async () => {
    await BUYER.client.from('financing_applications')
      .update({ approved_amount: 10_000_000, status: 'approved' }).eq('id', appId)
    const { data } = await BUYER.client
      .from('financing_applications').select('approved_amount, status').eq('id', appId).single()
    expect(data!.approved_amount, 'approved_amount was client-writable').toBeNull()
    expect(data!.status).toBe('submitted')
  })

  it('refuses an approval that exceeds what was requested', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved', p_approved_amount: 99_000_000,
    })
    expect(error).toBeTruthy()
  })

  it('refuses an approval with no amount', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved',
    })
    expect(error).toBeTruthy()
  })

  it('records a partial approval as the bank, and keeps the three amounts apart', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'partially_approved',
      p_approved_amount: 6_000_000, p_conditions: 'Subject to stock verification',
    })
    expect(error, error?.message).toBeFalsy()

    const { data } = await BUYER.client
      .from('financing_applications')
      .select('amount_requested, approved_amount, disbursed_amount, status, conditions')
      .eq('id', appId).single()
    expect(Number(data!.amount_requested)).toBe(10_000_000)
    expect(Number(data!.approved_amount)).toBe(6_000_000)
    expect(Number(data!.disbursed_amount)).toBe(0)
    expect(data!.status).toBe('partially_approved')
  })

  it('writes an append-only financing event for the decision', async () => {
    const { data } = await BUYER.client
      .from('financing_events').select('event_type, actor_kind, amount')
      .eq('application_id', appId).eq('event_type', 'partially_approved').maybeSingle()
    expect(data, 'the decision left no event').toBeTruthy()
    expect(data!.actor_kind).toBe('bank')
  })

  it('keeps the application invisible to unrelated members and anon', async () => {
    const other = await OUTSIDER.client
      .from('financing_applications').select('*').eq('id', appId)
    expect(other.data ?? []).toHaveLength(0)

    const pub = await anonClient().from('financing_applications').select('*').limit(1)
    expect(pub.error || (pub.data ?? []).length === 0).toBeTruthy()
  })
})

describe('Phase 6 — eligibility is a recommendation, not an approval', () => {
  it('labels itself as a recommendation and carries a disclaimer', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_eligibility_signal')
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.kind).toBe('recommendation')
    expect(String(r.disclaimer)).toMatch(/not a credit decision/i)
    // A band and factors -- never a naira entitlement.
    expect(['strong', 'developing', 'limited', 'adverse']).toContain(r.band)
    expect(Array.isArray(r.factors)).toBe(true)
    expect(r.amount).toBeUndefined()
    expect(r.approved_limit).toBeUndefined()
  })

  it('is driven by configurable weights, not hard-coded tiers', async () => {
    const { data } = await BUYER.client.rpc('loamy_eligibility_signal')
    expect((data as Record<string, any>).weights_version).toBeTruthy()
  })

  it('refuses to profile another member', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_eligibility_signal', { p_user: BUYER.uid })
    expect(error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('Phase 7 — the ledger is double-entry and untouchable', () => {
  it('has no client write path to ledger entries', async () => {
    if (!admin) return
    const { data: acc } = await admin.from('ledger_accounts')
      .select('id').eq('account_type', 'platform_revenue').limit(1).single()

    const { error } = await BUYER.client.from('ledger_entries').insert({
      entry_group: '00000000-0000-0000-0000-000000000001',
      account_id: acc!.id, amount: 1_000_000, event_type: 'adjustment',
    })
    expect(error, 'a member posted a ledger entry').toBeTruthy()
  })

  it('does not expose loamy_post_ledger to members at all', async () => {
    const { error } = await BUYER.client.rpc('loamy_post_ledger', {
      p_event_type: 'adjustment', p_lines: [],
    })
    expect(error, 'a member could call the ledger poster').toBeTruthy()
  })

  it('reports a zero balance for a new member', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_ledger_balance')
    expect(error, error?.message).toBeFalsy()
    expect(Number(data)).toBe(0)
  })

  it('refuses to report another member’s balance', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_ledger_balance', { p_user: BUYER.uid })
    expect(error).toBeTruthy()
  })

  /**
   * This asserted the table was EMPTY. Emptiness was only ever a proxy for
   * the thing that matters -- that nothing writes it -- and it stopped being
   * a valid proxy on 2026-09-21, when a live edge function wrote a row.
   *
   * Deleting that row would have made this green and changed nothing: it is a
   * financial record, and the four writers would still have been live. So the
   * invariant is now asserted directly, and history is kept.
   */
  it('refuses any new write to the deprecated single-entry wallet', async () => {
    if (!admin) return
    const { data: me } = await admin.auth.getUser()
    const before = await admin.from('wallet_entries').select('*', { count: 'exact', head: true })

    const { error } = await admin.from('wallet_entries').insert({
      user_id: me.user!.id, direction: 'credit', amount: 1,
      kind: 'escrow_release', reference: `phase7-guard:${Date.now()}`,
    })
    expect(error, 'the deprecated wallet accepted a new entry').toBeTruthy()

    const after = await admin.from('wallet_entries').select('*', { count: 'exact', head: true })
    expect(after.count, 'the wallet grew').toBe(before.count)
  })

  it('retains the historical wallet rows rather than deleting them', async () => {
    if (!admin) return
    // Whatever is there is a financial record. The fix was to stop new
    // writes, never to tidy away the evidence that old ones happened.
    const { error } = await admin.from('wallet_entries').select('id').limit(1)
    expect(error, 'historical wallet rows are no longer readable').toBeFalsy()
  })

  it('has no unbalanced ledger groups', async () => {
    if (!admin) return
    const { data } = await admin.from('loamy_reconciliation_exceptions')
      .select('kind').eq('kind', 'unbalanced_group')
    expect(data ?? [], 'the ledger does not balance').toHaveLength(0)
  })
})

describe('Phase 7 — escrow is a workflow, and release is the narrow path', () => {
  it('opens against an accepted transaction', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_open_escrow', {
      p_transaction_id: txnId,
    })
    expect(error, error?.message).toBeFalsy()
    escrowId = data as string

    const { data: w } = await BUYER.client
      .from('escrow_workflows').select('ref, state, amount, released_amount').eq('id', escrowId).single()
    expect(w!.ref).toMatch(/^ESC-\d{6}$/)
    expect(w!.state).toBe('created')
    expect(Number(w!.amount)).toBe(10_000_000)
    expect(Number(w!.released_amount)).toBe(0)
  })

  it('is idempotent — opening twice returns the same escrow', async () => {
    const { data } = await BUYER.client.rpc('loamy_open_escrow', { p_transaction_id: txnId })
    expect(data).toBe(escrowId)
  })

  it('refuses a member claiming the provider funded it', async () => {
    const { error } = await BUYER.client.rpc('loamy_escrow_transition', {
      p_escrow_id: escrowId, p_event_type: 'funded',
    })
    expect(error, 'a buyer declared their own payment funded').toBeTruthy()
  })

  it('REFUSES A SHORTCUT STRAIGHT TO RELEASED', async () => {
    // The single most important refusal in the money layer.
    for (const actor of [BUYER, SELLER, OUTSIDER]) {
      const { error } = await actor.client.rpc('loamy_escrow_transition', {
        p_escrow_id: escrowId, p_event_type: 'released',
      })
      expect(error, 'escrow was released without delivery and acceptance').toBeTruthy()
    }

    const { data } = await BUYER.client
      .from('escrow_workflows').select('state, released_amount').eq('id', escrowId).single()
    expect(data!.state).toBe('created')
    expect(Number(data!.released_amount)).toBe(0)
  })

  it('refuses the seller marking the buyer’s acceptance', async () => {
    const { error } = await SELLER.client.rpc('loamy_escrow_transition', {
      p_escrow_id: escrowId, p_event_type: 'accepted',
    })
    expect(error).toBeTruthy()
  })

  it('walks the full path and posts a BALANCED release', async () => {
    if (!admin) return expect(admin).toBeNull()

    for (const ev of ['funded', 'held', 'loading', 'in_transit', 'delivered']) {
      const { error } = await admin.rpc('loamy_escrow_transition', {
        p_escrow_id: escrowId, p_event_type: ev,
      })
      expect(error, `${ev}: ${error?.message}`).toBeFalsy()
    }

    // Only the BUYER may accept.
    const accept = await BUYER.client.rpc('loamy_escrow_transition', {
      p_escrow_id: escrowId, p_event_type: 'accepted',
    })
    expect(accept.error, accept.error?.message).toBeFalsy()

    const release = await admin.rpc('loamy_escrow_transition', {
      p_escrow_id: escrowId, p_event_type: 'released',
    })
    expect(release.error, release.error?.message).toBeFalsy()

    const { data: w } = await BUYER.client
      .from('escrow_workflows').select('state, released_amount').eq('id', escrowId).single()
    expect(w!.state).toBe('released')
    expect(Number(w!.released_amount)).toBe(10_000_000)

    // The seller is now owed money, and the books balance.
    const { data: bal } = await SELLER.client.rpc('loamy_ledger_balance')
    expect(Number(bal)).toBeGreaterThan(0)

    const { data: exceptions } = await admin
      .from('loamy_reconciliation_exceptions').select('kind').eq('kind', 'unbalanced_group')
    expect(exceptions ?? [], 'release left the ledger unbalanced').toHaveLength(0)
  }, 120_000)

  it('mirrors onto the transaction PAYMENT machine only', async () => {
    const { data } = await BUYER.client
      .from('transactions').select('status, payment_state, fulfilment_state').eq('id', txnId).single()
    expect(data!.payment_state).toBe('released')
    // The agreement machine did not move on its own.
    expect(data!.status).toBe('accepted')
  })

  it('refuses to release twice', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_escrow_transition', {
      p_escrow_id: escrowId, p_event_type: 'released',
    })
    expect(error, 'escrow released twice').toBeTruthy()
  })

  it('keeps escrow private to its parties', async () => {
    const { data } = await OUTSIDER.client.from('escrow_workflows').select('*').eq('id', escrowId)
    expect(data ?? []).toHaveLength(0)
    const pub = await anonClient().from('escrow_workflows').select('*').limit(1)
    expect(pub.error || (pub.data ?? []).length === 0).toBeTruthy()
  })
})
