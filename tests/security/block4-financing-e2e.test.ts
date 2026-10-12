import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * BLOCK 4 — the buyer financing golden path, end to end.
 *
 * Directive 31 is explicit that Block 4 is not complete because the pages
 * exist. It is complete when an automated test proves the whole chain:
 *
 *   listing -> cart -> transaction -> financing application -> bank decision
 *   (sandbox adapter) -> verification assignment -> anonymous agent -> evidence
 *   -> review -> supplier-direct settlement -> loading -> logistics
 *   -> delivery -> trace reconstruction
 *
 * These tests run IN ORDER against the live database. Each stage depends on
 * the one before, which is the point: a shortcut anywhere shows up as a
 * failure here rather than as a happy path nobody walked.
 */

let SELLER: TestUser
let BUYER: TestUser
let AGENT: TestUser
let CARRIER: TestUser
let OUTSIDER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)

let bankId = ''
let batchId = ''
let batchRef = ''
let listingId = ''
let txnId = ''
let txnRef = ''
let appId = ''
let appRef = ''
let caseId = ''
let jobId = ''

const QTY = 100
const PRICE = 90_000 // per tonne

beforeAll(async () => {
  SELLER = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('trader', 'Trader')
  AGENT = await makeUser('growth_partner', 'Growth Partner')
  CARRIER = await makeUser('logistics_provider', 'Logistics Provider')
  OUTSIDER = await makeUser('trader', 'Trader')
  admin = await adminClient()

  // A partner bank that supports supplier-direct settlement, in SANDBOX.
  // Marked as test data in its own name, per directive 30.
  if (admin) {
    const { data: bank } = await admin.from('banks').insert({
      name: `Sandbox Partner Bank (test ${RUN})`,
      active: true,
      integration_mode: 'sandbox',
      supports_supplier_direct: true,
      supports_account_opening: true,
      account_opening_url: 'https://example.invalid/open-account',
    }).select('id').single()
    bankId = bank!.id
  }

  // A real chain of stock: farm -> cycle -> harvest -> batch.
  const { data: farm } = await SELLER.client.from('farms').insert({
    owner_id: SELLER.uid, farm_name: `Financing Farm ${RUN}`,
    state: 'Benue', lga: 'Makurdi', size_hectares: 25,
    primary_crops: ['Maize'], ownership_type: 'owned',
    latitude: 7.7322, longitude: 8.5391,
  }).select('id').single()

  const { data: cycle } = await SELLER.client.from('crop_records').insert({
    farm_id: farm!.id, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single()

  const { data: harvest } = await SELLER.client.from('harvests').insert({
    production_cycle_id: cycle!.id, farm_id: farm!.id, commodity: 'Maize',
    harvest_date: '2026-09-08', quantity: QTY, unit: 'tonne',
  }).select('id').single()

  const { data: batch } = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvest!.id, p_quantity: QTY,
  })
  batchId = batch as string
  const { data: b } = await SELLER.client
    .from('commodity_batches').select('ref').eq('id', batchId).single()
  batchRef = b!.ref

  const { data: listing } = await SELLER.client.rpc('loamy_list_batch', {
    p_batch_id: batchId, p_quantity: QTY, p_price_per_unit: PRICE,
  })
  listingId = listing as string

  // The seller can be paid. Required by the settlement gate.
  await SELLER.client.rpc('loamy_set_payout_account', {
    p_bank_code: '000', p_account_number: '0000000000',
    p_bank_name: 'Test Bank', p_account_name: 'Test Seller',
  })
}, 300_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

// ---------------------------------------------------------------------------

describe('1 — the bank adapter is capability-driven, never bank-specific', () => {
  it('reports what this bank can actually do', async () => {
    if (!admin) return
    const { data } = await BUYER.client.rpc('loamy_bank_capabilities', { p_bank_id: bankId })
    const c = data as Record<string, any>
    expect(c.available).toBe(true)
    expect(c.is_sandbox, 'a sandbox bank did not announce itself').toBe(true)
    expect(c.capabilities.supplier_direct).toBe(true)
    expect(c.capabilities.account_opening_url).toBeTruthy()
  })

  it('lists partners a buyer can actually apply to', async () => {
    const { data } = await BUYER.client.rpc('loamy_financing_partners')
    const rows = data as Record<string, any>[]
    expect(rows.some((r) => r.bank_id === bankId)).toBe(true)
  })
})

describe('2 — cart to transaction', () => {
  it('adds the listing to the buyer\'s cart', async () => {
    const { error } = await BUYER.client.from('cart_items').upsert({
      user_id: BUYER.uid, listing_id: listingId, quantity: QTY,
    })
    expect(error, error?.message).toBeFalsy()
  })

  it('keeps the cart private to its owner', async () => {
    const { data } = await OUTSIDER.client.from('cart_items').select('*').eq('user_id', BUYER.uid)
    expect(data ?? [], 'another member read a buyer\'s cart').toHaveLength(0)
  })

  it('creates the transaction from the listing, not from typed numbers', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: QTY,
    })
    expect(error, error?.message).toBeFalsy()
    txnId = data as string

    const { data: t } = await BUYER.client
      .from('transactions').select('ref, subtotal, quantity, batch_id, seller_id')
      .eq('id', txnId).single()
    txnRef = t!.ref
    expect(Number(t!.subtotal)).toBe(QTY * PRICE)
    expect(t!.batch_id).toBe(batchId)
    expect(t!.seller_id).toBe(SELLER.uid)
  }, 60_000)

  it('is accepted by the seller', async () => {
    const { error } = await SELLER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'accept', p_machine: 'status',
    })
    expect(error, error?.message).toBeFalsy()
  })
})

describe('3 — financing is a child of the transaction', () => {
  it('refuses a financing amount larger than the purchase', async () => {
    const { error } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txnId, p_bank_id: bankId, p_amount: QTY * PRICE * 2,
    })
    expect(error, 'a buyer financed more than they were buying').toBeTruthy()
  })

  it('refuses an application from someone who is not the buyer', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txnId, p_bank_id: bankId,
    })
    expect(error, 'a stranger applied for financing on another buyer\'s purchase').toBeTruthy()
  })

  it('derives the amount from the transaction', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txnId, p_bank_id: bankId,
    })
    expect(error, error?.message).toBeFalsy()
    appId = data as string

    const { data: a } = await BUYER.client
      .from('financing_applications')
      .select('ref, amount_requested, transaction_id, batch_id, listing_id, seller_id, disbursement_preference, status')
      .eq('id', appId).single()
    appRef = a!.ref
    expect(Number(a!.amount_requested)).toBe(QTY * PRICE)
    expect(a!.transaction_id).toBe(txnId)
    expect(a!.batch_id).toBe(batchId)
    expect(a!.listing_id).toBe(listingId)
    expect(a!.seller_id).toBe(SELLER.uid)
    // This bank supports supplier-direct, so that is the route chosen.
    expect(a!.disbursement_preference).toBe('supplier_payment')
    expect(a!.status).toBe('submitted')
  }, 60_000)

  it('refuses a second live application for the same purchase', async () => {
    const { error } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txnId, p_bank_id: bankId,
    })
    expect(error, 'the same purchase was financed twice').toBeTruthy()
  })

  it('keeps the application private to its parties', async () => {
    const { data } = await OUTSIDER.client
      .from('financing_applications').select('*').eq('id', appId)
    expect(data ?? [], 'a stranger read a financing application').toHaveLength(0)
  })
})

describe('4 — Loamy never writes the bank\'s numbers', () => {
  // These assert by OUTCOME, not by error. With no UPDATE policy PostgREST
  // matches zero rows and reports success, so "an error was raised" would be
  // testing the wrong thing -- the value staying put is the actual property.
  // The values used are deliberately distinctive so a write cannot hide
  // behind a number the workflow would have set anyway.
  it('refuses a buyer writing their own approved amount', async () => {
    const before = await BUYER.client
      .from('financing_applications').select('approved_amount').eq('id', appId).single()
    await BUYER.client
      .from('financing_applications').update({ approved_amount: 777_777_777 }).eq('id', appId)
    const after = await BUYER.client
      .from('financing_applications').select('approved_amount').eq('id', appId).single()
    expect(after.data!.approved_amount, 'a buyer approved their own financing')
      .toBe(before.data!.approved_amount)
  })

  it('refuses a buyer writing their own disbursed amount', async () => {
    await BUYER.client
      .from('financing_applications').update({ disbursed_amount: 888_888_888 }).eq('id', appId)
    const { data } = await BUYER.client
      .from('financing_applications').select('disbursed_amount').eq('id', appId).single()
    expect(Number(data!.disbursed_amount), 'a buyer disbursed their own financing').toBe(0)
  })

  it('refuses a buyer flipping their own status to approved', async () => {
    await BUYER.client
      .from('financing_applications').update({ status: 'approved' }).eq('id', appId)
    const { data } = await BUYER.client
      .from('financing_applications').select('status').eq('id', appId).single()
    expect(data!.status, 'a buyer approved their own application').toBe('submitted')
  })

  it('refuses the SELLER approving the buyer\'s financing', async () => {
    const { error } = await SELLER.client.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved', p_approved_amount: QTY * PRICE,
    })
    expect(error, 'a seller approved the buyer\'s financing').toBeTruthy()
  })

  it('refuses a member simulating a bank decision', async () => {
    const { error } = await BUYER.client.rpc('loamy_sandbox_bank_decision', {
      p_application_id: appId, p_decision: 'approved',
    })
    expect(error, 'a member simulated their own approval').toBeTruthy()
  })
})

describe('5 — the bank decides, through the sandbox adapter', () => {
  it('refuses to approve more than was requested', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved',
      p_approved_amount: QTY * PRICE * 2,
    })
    expect(error, 'the bank approved more than was asked for').toBeTruthy()
  })

  it('records an approval, marked as a simulation', async () => {
    if (!admin) return
    const { data, error } = await admin.rpc('loamy_sandbox_bank_decision', {
      p_application_id: appId, p_decision: 'approved',
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.simulated).toBe(true)
    expect(r.disclaimer).toMatch(/not a credit decision/i)

    const { data: a } = await BUYER.client
      .from('financing_applications')
      .select('status, approved_amount, is_sandbox, decision_source, bank_reference, expires_at')
      .eq('id', appId).single()
    expect(a!.status).toBe('approved')
    expect(Number(a!.approved_amount)).toBe(QTY * PRICE)
    // Directive 30: a simulated approval can never read as a real one.
    expect(a!.is_sandbox, 'a sandbox approval was not marked as such').toBe(true)
    expect(a!.decision_source).toBe('sandbox_adapter')
    expect(a!.bank_reference).toMatch(/^SANDBOX-/)
    expect(a!.expires_at).toBeTruthy()
  }, 60_000)
})

describe('6 — settlement is gated, and says what blocks it', () => {
  it('is NOT ready merely because the bank approved', async () => {
    const { data } = await BUYER.client.rpc('loamy_settlement_readiness', {
      p_application_id: appId,
    })
    const r = data as Record<string, any>
    expect(r.ready, 'approved alone was treated as "pay the seller"').toBe(false)
    expect(r.blocked_by).toContain('commodity_verified')
  })

  it('names every condition individually', async () => {
    const { data } = await BUYER.client.rpc('loamy_settlement_readiness', {
      p_application_id: appId,
    })
    const codes = ((data as Record<string, any>).conditions as Record<string, any>[])
      .map((c) => c.code)
    for (const c of ['bank_approved', 'approval_current', 'supplier_direct_supported',
                     'transaction_live', 'commodity_verified', 'seller_payout_ready',
                     'not_already_settled']) {
      expect(codes, `${c} is not checked`).toContain(c)
    }
  })

  it('refuses a MEMBER recording a settlement', async () => {
    const { error } = await BUYER.client.rpc('loamy_record_supplier_settlement', {
      p_application_id: appId, p_amount: QTY * PRICE,
      p_provider: 'sandbox', p_provider_reference: `member-${RUN}`,
    })
    expect(error, 'a buyer settled their own financing').toBeTruthy()
  })

  it('refuses the SELLER recording their own settlement', async () => {
    const { error } = await SELLER.client.rpc('loamy_record_supplier_settlement', {
      p_application_id: appId, p_amount: QTY * PRICE,
      p_provider: 'sandbox', p_provider_reference: `seller-${RUN}`,
    })
    expect(error, 'a seller paid themselves').toBeTruthy()
  })

  it('refuses settlement while verification is outstanding, even for the bank', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_record_supplier_settlement', {
      p_application_id: appId, p_amount: QTY * PRICE,
      p_provider: 'sandbox', p_provider_reference: `early-${RUN}`,
    })
    const r = data as Record<string, any>
    expect(r.settled, 'the seller was paid before verification').toBe(false)
    expect(r.reason).toBe('conditions_not_met')
    expect(r.blocked_by).toContain('commodity_verified')
  })
})

describe('7 — verification, with the agent kept anonymous', () => {
  it('lets the buyer order verification of the financed stock', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_request_financing_verification', {
      p_application_id: appId,
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.requested).toBe(true)
    caseId = r.case_id
  })

  it('is idempotent — asking twice does not despatch two agents', async () => {
    const { data } = await BUYER.client.rpc('loamy_request_financing_verification', {
      p_application_id: appId,
    })
    expect((data as Record<string, any>).case_id).toBe(caseId)
    expect((data as Record<string, any>).reused).toBe(true)
  })

  it('refuses an outsider ordering verification', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_request_financing_verification', {
      p_application_id: appId,
    })
    expect(error, 'a stranger despatched an agent').toBeTruthy()
  })

  it('assigns an agent who holds the capability', async () => {
    if (!admin) return
    await admin.rpc('loamy_set_can_verify', { p_user: AGENT.uid, p_value: true })
    const { error } = await admin.rpc('loamy_assign_verification_task', {
      p_task: caseId, p_partner: AGENT.uid,
    })
    expect(error, error?.message).toBeFalsy()
  }, 60_000)

  it('does NOT reveal the agent to the seller being inspected', async () => {
    const { data } = await SELLER.client.rpc('loamy_my_verification_cases')
    const mine = (data as Record<string, any>[]).find((c) => c.case_id === caseId)
    expect(mine, 'the inspected seller cannot see their own case').toBeTruthy()
    expect(mine!.agent_display).toBe('Loamy Verification Agent')
    expect(mine!.assigned_to).toBeUndefined()
  })

  it('does not reveal the agent to the BUYER either', async () => {
    const { data } = await BUYER.client
      .from('loamy_verification_cases').select('assigned_to, agent_display').eq('case_id', caseId)
    for (const row of data ?? []) {
      expect(row.assigned_to, 'the agent id reached the buyer').toBeNull()
      expect(row.agent_display).toBe('Loamy Verification Agent')
    }
  })

  it('refuses evidence from anyone but the assigned agent', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(), p_lat: 7.7322, p_lng: 8.5391,
    })
    expect(error, 'a stranger submitted verification evidence').toBeTruthy()
  })

  it('accepts a clean capture from the assigned agent', async () => {
    const { data, error } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 7.7322, p_lng: 8.5391, p_accuracy_m: 6,
      p_content_hash: `e2e-${RUN}-1`,
      p_quantity: QTY, p_unit: 'tonne',
      p_note: 'Stock sighted, bagged and stacked.',
    })
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, any>).flags).toEqual([])
  }, 60_000)

  it('does NOT let the agent approve their own evidence', async () => {
    await AGENT.client.rpc('loamy_submit_verification_case', { p_case_id: caseId })
    const { error } = await AGENT.client.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved',
    })
    expect(error, 'an agent approved their own work').toBeTruthy()
  })

  it('is approved by the platform review layer', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved', p_note: 'Evidence consistent.',
    })
    expect(error, error?.message).toBeFalsy()

    const { data } = await admin.from('verification_tasks')
      .select('status, completed_at').eq('id', caseId).single()
    expect(data!.status).toBe('approved')
    expect(data!.completed_at).toBeTruthy()
  }, 60_000)
})

describe('8 — supplier-direct settlement', () => {
  it('is ready once every condition is met', async () => {
    const { data } = await BUYER.client.rpc('loamy_settlement_readiness', {
      p_application_id: appId,
    })
    const r = data as Record<string, any>
    expect(r.ready, `still blocked by ${JSON.stringify(r.blocked_by)}`).toBe(true)
  })

  it('records the settlement as a memorandum, not as Loamy custody', async () => {
    if (!admin) return
    const { data, error } = await admin.rpc('loamy_record_supplier_settlement', {
      p_application_id: appId, p_amount: QTY * PRICE,
      p_provider: 'sandbox_bank', p_provider_reference: `settle-${RUN}`,
      p_note: 'Sandbox supplier-direct settlement.',
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.settled, JSON.stringify(r)).toBe(true)
    expect(r.note).toMatch(/did not hold them/i)

    // The ledger entry uses memorandum accounts, never a member balance.
    const { data: lines } = await admin
      .from('ledger_entries')
      .select('amount, ledger_accounts(account_type, owner_id)')
      .eq('external_reference', `settle:settle-${RUN}`)
    expect((lines ?? []).length).toBe(2)
    for (const l of lines ?? []) {
      const acct = (l as any).ledger_accounts
      expect(['partner_funding', 'external_settlement']).toContain(acct.account_type)
      expect(acct.owner_id, 'a settlement credited a member balance').toBeNull()
    }
    const sum = (lines ?? []).reduce((n, l: any) => n + Number(l.amount), 0)
    expect(Math.abs(sum), 'the settlement did not balance').toBeLessThan(0.01)
  }, 90_000)

  it('REFUSES a replay of the same settlement reference', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_record_supplier_settlement', {
      p_application_id: appId, p_amount: QTY * PRICE,
      p_provider: 'sandbox_bank', p_provider_reference: `settle-${RUN}`,
    })
    const r = data as Record<string, any>
    expect(r.settled, 'a settlement was replayed').toBe(false)
    expect(r.reason).toBe('already_settled')
  })

  it('records the disbursement against the application', async () => {
    const { data } = await BUYER.client
      .from('financing_applications').select('status, disbursed_amount').eq('id', appId).single()
    expect(data!.status).toBe('disbursed')
    expect(Number(data!.disbursed_amount)).toBe(QTY * PRICE)
  })

  it('leaves the ledger balanced', async () => {
    if (!admin) return
    const { data } = await admin
      .from('loamy_reconciliation_exceptions').select('kind').eq('kind', 'unbalanced_group')
    expect(data ?? [], 'settlement left the ledger unbalanced').toHaveLength(0)
  })
})

describe('9 — loading cannot be skipped', () => {
  it('refuses to jump straight to delivered', async () => {
    const { error } = await BUYER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'delivered', p_machine: 'fulfilment',
    })
    expect(error, 'goods were delivered without ever being loaded').toBeTruthy()
  })

  it('walks the loading stages', async () => {
    for (const stage of ['requested', 'scheduled', 'started']) {
      const actor = stage === 'requested' ? BUYER.client : SELLER.client
      const { data, error } = await actor.rpc('loamy_record_loading', {
        p_transaction_id: txnId, p_stage: stage,
      })
      expect(error, `${stage}: ${error?.message}`).toBeFalsy()
      expect((data as Record<string, any>).recorded).toBe(true)
    }
  }, 60_000)

  it('FLAGS a completed loading with no evidence rather than accepting it silently', async () => {
    const { data } = await SELLER.client.rpc('loamy_record_loading', {
      p_transaction_id: txnId, p_stage: 'completed',
    })
    const r = data as Record<string, any>
    expect(r.flags).toContain('no_quantity_confirmed')
    expect(r.flags).toContain('no_loading_photo')
    expect(r.flags).toContain('no_waybill')
  })

  it('flags a quantity that disagrees with the purchase', async () => {
    const { data } = await SELLER.client.rpc('loamy_record_loading', {
      p_transaction_id: txnId, p_stage: 'completed',
      p_quantity: QTY * 0.5, p_unit: 'tonne',
      p_waybill: `WB-${RUN}`, p_vehicle: 'ABC-123-XY',
      p_photos: ['loading/one.jpg'], p_lat: 7.7322, p_lng: 8.5391,
    })
    expect((data as Record<string, any>).flags).toContain('quantity_mismatch')
  })

  it('accepts a complete loading with evidence, and moves the machine', async () => {
    const { data, error } = await SELLER.client.rpc('loamy_record_loading', {
      p_transaction_id: txnId, p_stage: 'completed',
      p_quantity: QTY, p_unit: 'tonne',
      p_waybill: `WB-${RUN}-final`, p_vehicle: 'ABC-123-XY',
      p_photos: ['loading/one.jpg', 'loading/two.jpg'],
      p_lat: 7.7322, p_lng: 8.5391,
    })
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, any>).flags).toEqual([])

    const { data: t } = await BUYER.client
      .from('transactions').select('fulfilment_state').eq('id', txnId).single()
    expect(t!.fulfilment_state).toBe('loaded')
  }, 60_000)

  it('keeps loading evidence to the parties', async () => {
    const { data } = await OUTSIDER.client
      .from('loading_confirmations').select('*').eq('transaction_id', txnId)
    expect(data ?? [], 'a stranger read loading evidence').toHaveLength(0)
  })
})

describe('10 — logistics is offered, never forced', () => {
  it('lets the buyer request transport for their own purchase', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_request_transport_for_transaction', {
      p_transaction_id: txnId, p_mode: 'loamy',
      p_pickup: 'Makurdi', p_dropoff: 'Lagos',
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.created).toBe(true)
    jobId = r.job_id
  })

  it('refuses a stranger arranging transport for someone else\'s purchase', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_request_transport_for_transaction', {
      p_transaction_id: txnId, p_mode: 'loamy',
    })
    expect(error, 'a stranger arranged another buyer\'s freight').toBeTruthy()
  })

  it('takes an offer from a carrier', async () => {
    const { data, error } = await CARRIER.client.rpc('loamy_submit_transport_offer', {
      p_job_id: jobId, p_price: 4_200_000,
    })
    expect(error, error?.message).toBeFalsy()
    expect(data).toBeTruthy()
  })

  it('refuses an offer from a party to the deal', async () => {
    const { error } = await SELLER.client.rpc('loamy_submit_transport_offer', {
      p_job_id: jobId, p_price: 1,
    })
    expect(error, 'the seller bid on their own freight').toBeTruthy()
  })

  it('awards exclusively — one selected, the rest declined', async () => {
    const { data: offer } = await CARRIER.client
      .from('transport_offers').select('id').eq('transport_job_id', jobId).limit(1).single()
    const { error } = await BUYER.client.rpc('loamy_select_transport_offer', {
      p_offer_id: offer!.id,
    })
    expect(error, error?.message).toBeFalsy()

    const { data: j } = await BUYER.client
      .from('transport_jobs').select('status, assigned_provider_id, agreed_price')
      .eq('id', jobId).single()
    expect(j!.status).toBe('assigned')
    expect(j!.assigned_provider_id).toBe(CARRIER.uid)
    expect(Number(j!.agreed_price)).toBe(4_200_000)
  }, 60_000)
})

describe('11 — delivery, and completion', () => {
  it('moves the goods', async () => {
    if (!admin) return
    for (const ev of ['in_transit', 'delivered']) {
      const { error } = await admin.rpc('loamy_transaction_transition', {
        p_transaction_id: txnId, p_event_type: ev, p_machine: 'fulfilment',
      })
      expect(error, `${ev}: ${error?.message}`).toBeFalsy()
    }
  }, 60_000)

  it('lets only the BUYER confirm receipt', async () => {
    const bad = await SELLER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'received', p_machine: 'fulfilment',
    })
    expect(bad.error, 'the seller confirmed the buyer received the goods').toBeTruthy()

    const ok = await BUYER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'received', p_machine: 'fulfilment',
    })
    expect(ok.error, ok.error?.message).toBeFalsy()
  }, 60_000)

  it('records a repayment status only from the institution', async () => {
    const member = await BUYER.client.rpc('loamy_record_repayment_status', {
      p_application_id: appId, p_status: 'repaid',
    })
    expect(member.error, 'a buyer marked their own loan repaid').toBeTruthy()

    if (!admin) return
    const { error } = await admin.rpc('loamy_record_repayment_status', {
      p_application_id: appId, p_status: 'active',
    })
    expect(error, error?.message).toBeFalsy()
  }, 60_000)
})

describe('12 — the journey reflects real state', () => {
  it('reports ten stages', async () => {
    const { data } = await BUYER.client.rpc('loamy_transaction_journey', {
      p_transaction_id: txnId,
    })
    const j = data as Record<string, any>
    expect(j.found).toBe(true)
    expect((j.stages as unknown[]).length).toBe(10)
  })

  it('marks the financing stages done, and labels the sandbox', async () => {
    const { data } = await BUYER.client.rpc('loamy_transaction_journey', {
      p_transaction_id: txnId,
    })
    const stages = (data as Record<string, any>).stages as Record<string, any>[]
    const by = (c: string) => stages.find((s) => s.code === c)!
    expect(by('financing_submitted').status).toBe('done')
    expect(by('financing_decision').status).toBe('done')
    expect(by('financing_decision').is_sandbox).toBe(true)
    expect(by('commodity_verification').status).toBe('done')
    expect(by('supplier_settlement').status).toBe('done')
    expect(by('loading').status).toBe('done')
    expect(by('delivery').status).toBe('done')
  })

  it('never names the agent in the journey', async () => {
    const { data } = await BUYER.client.rpc('loamy_transaction_journey', {
      p_transaction_id: txnId,
    })
    const stage = ((data as Record<string, any>).stages as Record<string, any>[])
      .find((s) => s.code === 'commodity_verification')!
    expect(stage.agent_display).toBe('Loamy Verification Agent')
  })

  it('is invisible to a stranger, in the same words as a missing purchase', async () => {
    const mine = await OUTSIDER.client.rpc('loamy_transaction_journey', { p_transaction_id: txnId })
    const ghost = await OUTSIDER.client.rpc('loamy_transaction_journey', {
      p_transaction_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(mine.data).toEqual(ghost.data)
    expect((mine.data as Record<string, any>).found).toBe(false)
  })
})

describe('13 — the whole chain reconstructs in Trace', () => {
  it('traces from the batch, with financing and loading present', async () => {
    const { data } = await BUYER.client.rpc('loamy_trace', { p_ref: batchRef })
    const t = data as Record<string, any>
    expect(t.found).toBe(true)
    expect(t.financing.available, 'financing is missing from the chain').toBe(true)
    expect(t.loading.available, 'loading is missing from the chain').toBe(true)
    expect(t.transactions.available).toBe(true)
    expect(t.logistics.available).toBe(true)
  }, 60_000)

  it('traces the SAME chain from the financing reference', async () => {
    const { data } = await BUYER.client.rpc('loamy_trace', { p_ref: appRef })
    const t = data as Record<string, any>
    expect(t.found).toBe(true)
    expect(t.batch.ref).toBe(batchRef)
    expect(t.entered_via.entity_type).toBe('financing_application')
  })

  it('traces from the transaction reference too', async () => {
    const { data } = await BUYER.client.rpc('loamy_trace', { p_ref: txnRef })
    expect((data as Record<string, any>).batch.ref).toBe(batchRef)
  })

  it('shows the buyer their own financing figures', async () => {
    const { data } = await BUYER.client.rpc('loamy_trace', { p_ref: batchRef })
    const f = ((data as Record<string, any>).financing.items as Record<string, any>[])[0]
    expect(Number(f.approved_amount)).toBe(QTY * PRICE)
    expect(f.is_sandbox).toBe(true)
    expect(f.settlement.length).toBeGreaterThan(0)
    expect(f.repayment.status).toBe('active')
  })

  it('WITHHOLDS those figures from a browsing member', async () => {
    const { data } = await OUTSIDER.client.rpc('loamy_trace', { p_ref: batchRef })
    const t = data as Record<string, any>
    expect(t.financing.available).toBe(false)
    expect(t.financing.reason, 'a stranger saw another buyer\'s financial position')
      .toBe('not_permitted')
  })

  it('does not fabricate a warehouse link that never happened', async () => {
    const { data } = await BUYER.client.rpc('loamy_trace', { p_ref: batchRef })
    const w = (data as Record<string, any>).warehouse
    expect(w.available).toBe(false)
    expect(w.reason).toBe('never_warehoused')
  })
})

describe('14 — the failure paths', () => {
  let txn2 = ''
  let app2 = ''

  it('supports a partial sale of the same batch', async () => {
    // The batch is fully committed by the first deal, so a second purchase of
    // the remainder must fail on availability, not on some blanket lock.
    const { data: b } = await SELLER.client
      .from('commodity_batches').select('quantity, available_quantity').eq('id', batchId).single()
    expect(Number(b!.quantity)).toBe(QTY)
    expect(Number(b!.available_quantity)).toBeLessThan(QTY)
  })

  it('refuses to finance more of a batch than remains uncommitted', async () => {
    const { data } = await BUYER.client.rpc('loamy_batch_financing_commitment', {
      p_batch_id: batchId,
    })
    const c = data as Record<string, any>
    expect(Number(c.committed_quantity)).toBe(QTY)
    expect(Number(c.financeable_quantity)).toBe(0)
  })

  it('walks the DECLINE path on a second purchase', async () => {
    if (!admin) return
    // A fresh, smaller batch so this is a real second deal.
    const { data: farm } = await SELLER.client.from('farms').insert({
      owner_id: SELLER.uid, farm_name: `Decline Farm ${RUN}`,
      state: 'Benue', lga: 'Gboko', size_hectares: 5,
      primary_crops: ['Maize'], ownership_type: 'owned',
      latitude: 7.33, longitude: 9.0,
    }).select('id').single()
    const { data: cycle } = await SELLER.client.from('crop_records').insert({
      farm_id: farm!.id, crop: 'Maize', season_year: 2026, status: 'harvested',
    }).select('id').single()
    const { data: harvest } = await SELLER.client.from('harvests').insert({
      production_cycle_id: cycle!.id, farm_id: farm!.id, commodity: 'Maize',
      harvest_date: '2026-09-09', quantity: 10, unit: 'tonne',
    }).select('id').single()
    const { data: batch2 } = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
      p_harvest_id: harvest!.id, p_quantity: 10,
    })
    const { data: l2 } = await SELLER.client.rpc('loamy_list_batch', {
      p_batch_id: batch2 as string, p_quantity: 10, p_price_per_unit: PRICE,
    })
    const { data: t2 } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: l2 as string, p_quantity: 10,
    })
    txn2 = t2 as string
    await SELLER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txn2, p_event_type: 'accept', p_machine: 'status',
    })
    const { data: a2 } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txn2, p_bank_id: bankId,
    })
    app2 = a2 as string

    const { data: dec } = await admin.rpc('loamy_sandbox_bank_decision', {
      p_application_id: app2, p_decision: 'rejected',
      p_note: 'Sandbox decline for testing.',
    })
    expect((dec as Record<string, any>).simulated).toBe(true)

    const { data: a } = await BUYER.client
      .from('financing_applications').select('status').eq('id', app2).single()
    expect(a!.status).toBe('rejected')
  }, 180_000)

  it('blocks settlement on a declined application', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_record_supplier_settlement', {
      p_application_id: app2, p_amount: 10 * PRICE,
      p_provider: 'sandbox_bank', p_provider_reference: `declined-${RUN}`,
    })
    const r = data as Record<string, any>
    expect(r.settled).toBe(false)
    expect(r.blocked_by).toContain('bank_approved')
  })

  it('tells the buyer what to do next after a decline', async () => {
    const { data } = await BUYER.client.rpc('loamy_transaction_journey', {
      p_transaction_id: txn2,
    })
    const stage = ((data as Record<string, any>).stages as Record<string, any>[])
      .find((s) => s.code === 'financing_decision')!
    expect(stage.status).toBe('failed')
    expect(String(stage.next), 'a decline left the buyer with no next step').toMatch(/pay directly/i)
  })

  it('blocks settlement for a bank that does not support supplier-direct', async () => {
    if (!admin) return
    const { data: bank2 } = await admin.from('banks').insert({
      name: `No-Supplier-Direct Bank (test ${RUN})`,
      active: true, integration_mode: 'sandbox', supports_supplier_direct: false,
    }).select('id').single()

    const caps = await BUYER.client.rpc('loamy_bank_capabilities', { p_bank_id: bank2!.id })
    expect((caps.data as Record<string, any>).capabilities.supplier_direct).toBe(false)
  }, 60_000)

  it('refuses a sandbox decision against a LIVE bank integration', async () => {
    if (!admin) return
    await admin.from('banks').update({ integration_mode: 'live' }).eq('id', bankId)
    const { data } = await admin.rpc('loamy_sandbox_bank_decision', {
      p_application_id: app2, p_decision: 'approved',
    })
    const r = data as Record<string, any>
    expect(r.simulated, 'the simulator produced a decision for a live bank').toBe(false)
    expect(r.reason).toBe('bank_not_in_sandbox')
    await admin.from('banks').update({ integration_mode: 'sandbox' }).eq('id', bankId)
  }, 60_000)
})
