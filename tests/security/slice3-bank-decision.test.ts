import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * PHASE 4 SLICE 3 — the bank financing decision, as a real bank officer.
 *
 * The existing Block 4 and Phase 6 suites drive the decision as ADMIN. That
 * proved the function works; it did not prove a bank officer can reach it, or
 * that one bank is walled off from another. Both are what this slice changed,
 * so both are tested here from the officer's own session.
 *
 * The ordering is deliberate: the tests walk one application through the
 * lifecycle, because a transition table is only true if you can actually walk
 * it.
 */

let BUYER: TestUser
let SELLER: TestUser
let OUTSIDER: TestUser
let officerA: SupabaseClient
let officerB: SupabaseClient
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)

let bankA = ''
let bankB = ''
let listingId = ''
let txnId = ''
let appId = ''
/** A second application, used for the reject path and the retry rule. */
let app2Id = ''
let txn2Id = ''

const QTY = 10
const PRICE = 90_000
const REQUESTED = QTY * PRICE

/** An officer is a profile with platform_role 'bank' plus a bank_id. */
async function makeOfficer(bankId: string, label: string): Promise<SupabaseClient> {
  const u = await makeUser('trader', 'Trader')
  if (!admin) throw new Error('admin required to create a bank officer')
  const { error } = await admin.rpc('loamy_setup_bank_officer', { p_user: u.uid, p_bank: bankId })
  if (error) throw new Error(`setup_bank_officer(${label}): ${error.message}`)
  // The role change lands on the profile, so the session must be renewed for
  // loamy_officer_bank() to see it.
  const fresh = anonClient()
  await fresh.auth.signInWithPassword({ email: u.email, password: u.password })
  return fresh
}

beforeAll(async () => {
  admin = await adminClient()
  if (!admin) return

  BUYER = await makeUser('trader', 'Trader')
  SELLER = await makeUser('farmer', 'Farmer')
  OUTSIDER = await makeUser('trader', 'Trader')

  const mk = async (name: string) => {
    const { data } = await admin!.from('banks').insert({
      name: `${name} (test ${RUN})`, active: true,
      integration_mode: 'sandbox', supports_supplier_direct: true,
    }).select('id').single()
    return data!.id as string
  }
  bankA = await mk('Slice3 Bank A')
  bankB = await mk('Slice3 Bank B')

  officerA = await makeOfficer(bankA, 'A')
  officerB = await makeOfficer(bankB, 'B')

  // quantity_kg, not quantity. The insert used the wrong column name and was
  // unasserted, so the whole suite failed later with "Cannot read properties
  // of null" and said nothing about why.
  const listingRes = await SELLER.client.from('listings').insert({
    seller_id: SELLER.uid, commodity: 'Maize', listing_type: 'commodity',
    quantity_kg: 500, unit: 'tonne', price_per_unit: PRICE,
    state: 'Benue', lga: 'Makurdi', status: 'active',
  }).select('id').single()
  if (listingRes.error || !listingRes.data) {
    throw new Error(`setup listing: ${listingRes.error?.message ?? 'no row returned'}`)
  }
  listingId = listingRes.data.id

  const mkTxn = async () => {
    const { data } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: QTY,
    })
    return data as string
  }
  txnId = await mkTxn()

  const { data: a } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
    p_transaction_id: txnId, p_bank_id: bankA,
  })
  appId = a as string
}, 300_000)

afterAll(async () => {
  if (!admin) return
  // Leave no test banks behind. Applications cascade from the bank row.
  await admin.from('banks').delete().in('id', [bankA, bankB].filter(Boolean))
})

describe('1 — the officer can see the application at all', () => {
  it('lets bank A read its own application', async () => {
    if (!admin) return
    const { data } = await officerA.from('financing_applications')
      .select('id, status, bank_id').eq('id', appId).maybeSingle()
    expect(data, 'bank A could not see its own application').toBeTruthy()
    expect(data!.status).toBe('submitted')
  })

  it('does NOT let bank B read bank A’s application', async () => {
    if (!admin) return
    // The one boundary in this area that would be a regulatory incident.
    const { data } = await officerB.from('financing_applications').select('*').eq('id', appId)
    expect(data ?? [], 'bank B read bank A’s application').toHaveLength(0)
  })

  it('does NOT let an unrelated member read it', async () => {
    if (!admin) return
    const { data } = await OUTSIDER.client.from('financing_applications').select('*').eq('id', appId)
    expect(data ?? []).toHaveLength(0)
  })

  it('does NOT let the seller read the buyer’s financing', async () => {
    if (!admin) return
    const { data } = await SELLER.client.from('financing_applications').select('*').eq('id', appId)
    expect(data ?? [], 'the seller saw the buyer’s financing position').toHaveLength(0)
  })

  it('lets the applicant read their own', async () => {
    if (!admin) return
    const { data } = await BUYER.client.from('financing_applications')
      .select('id').eq('id', appId).maybeSingle()
    expect(data).toBeTruthy()
  })

  it('shows nothing to a signed-out visitor', async () => {
    const { data } = await anonClient().from('financing_applications').select('*').eq('id', appId)
    expect(data ?? []).toHaveLength(0)
  })
})

describe('2 — the bundle carries what the portal has to show', () => {
  it('gives bank A the application ref, the transaction and the bank mode', async () => {
    if (!admin) return
    const { data, error } = await officerA.rpc('loamy_application_bundle', { p_app: appId })
    expect(error, error?.message).toBeFalsy()
    const b = data as Record<string, any>
    expect(b.application.ref, 'the bundle carried no business reference').toMatch(/^FIN-/)
    expect(b.transaction, 'the bundle carried no transaction context').toBeTruthy()
    expect(b.transaction.ref).toMatch(/^TXN-/)
    expect(b.transaction.commodity).toBe('Maize')
    expect(b.bank.integration_mode).toBe('sandbox')
    expect(b.bank.is_sandbox).toBe(true)
  })

  it('exposes no internal user id', async () => {
    if (!admin) return
    const { data } = await officerA.rpc('loamy_application_bundle', { p_app: appId })
    const json = JSON.stringify(data)
    expect(json, 'the bundle leaked the applicant id').not.toContain(BUYER.uid)
    expect(json, 'the bundle leaked the seller id').not.toContain(SELLER.uid)
  })

  it('exposes no BVN or NIN, because no such column exists', async () => {
    if (!admin) return
    const { data } = await officerA.rpc('loamy_application_bundle', { p_app: appId })
    expect(JSON.stringify(data)).not.toMatch(/\bbvn\b|\bnin\b/i)
  })

  it('refuses the bundle to bank B', async () => {
    if (!admin) return
    const { error } = await officerB.rpc('loamy_application_bundle', { p_app: appId })
    expect(error, 'bank B pulled bank A’s bundle').toBeTruthy()
  })

  it('refuses the bundle to the applicant', async () => {
    if (!admin) return
    const { error } = await BUYER.client.rpc('loamy_application_bundle', { p_app: appId })
    expect(error, 'the applicant pulled the bank’s own bundle').toBeTruthy()
  })
})

describe('3 — permitted decisions are the server’s, not the client’s', () => {
  it('offers the full review set on a submitted application', async () => {
    if (!admin) return
    const { data } = await officerA.rpc('loamy_financing_permitted_decisions', { p_status: 'submitted' })
    expect(data).toEqual(expect.arrayContaining(['under_review', 'approved', 'rejected']))
  })

  it('offers NOTHING once approved', async () => {
    if (!admin) return
    const { data } = await officerA.rpc('loamy_financing_permitted_decisions', { p_status: 'approved' })
    expect(data).toEqual([])
  })

  it.each(['rejected', 'expired', 'cancelled', 'disbursed', 'completed', 'draft', 'decided_external'])(
    'offers nothing for %s', async (status) => {
      if (!admin) return
      const { data } = await officerA.rpc('loamy_financing_permitted_decisions', { p_status: status })
      expect(data).toEqual([])
    })

  it('matches what the bundle advertises', async () => {
    if (!admin) return
    const { data } = await officerA.rpc('loamy_application_bundle', { p_app: appId })
    const b = data as Record<string, any>
    const { data: direct } = await officerA.rpc('loamy_financing_permitted_decisions', {
      p_status: b.application.status,
    })
    expect(b.permitted_decisions).toEqual(direct)
  })
})

describe('4 — nobody but the assigned bank decides', () => {
  it('refuses the applicant', async () => {
    if (!admin) return
    const { error } = await BUYER.client.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved', p_approved_amount: REQUESTED,
    })
    expect(error, 'a buyer approved their own financing').toBeTruthy()
  })

  it('refuses the seller', async () => {
    if (!admin) return
    const { error } = await SELLER.client.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved', p_approved_amount: REQUESTED,
    })
    expect(error, 'a seller approved the buyer’s financing').toBeTruthy()
  })

  it('refuses an unrelated member', async () => {
    if (!admin) return
    const { error } = await OUTSIDER.client.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved', p_approved_amount: REQUESTED,
    })
    expect(error).toBeTruthy()
  })

  it('refuses a DIFFERENT bank', async () => {
    if (!admin) return
    const { error } = await officerB.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved', p_approved_amount: REQUESTED,
    })
    expect(error, 'bank B decided bank A’s application').toBeTruthy()
    expect(error!.message).toMatch(/assigned bank/i)
  })

  it('refuses a member simulating a decision through the sandbox adapter', async () => {
    if (!admin) return
    const { error } = await BUYER.client.rpc('loamy_sandbox_bank_decision', {
      p_application_id: appId, p_decision: 'approved',
    })
    expect(error, 'a member simulated their own approval').toBeTruthy()
  })
})

describe('5 — the applicant cannot write the decision directly', () => {
  it('refuses a client-written status', async () => {
    if (!admin) return
    await BUYER.client.from('financing_applications').update({ status: 'approved' }).eq('id', appId)
    const { data } = await BUYER.client.from('financing_applications')
      .select('status').eq('id', appId).single()
    expect(data!.status, 'a buyer set their own status').not.toBe('approved')
  })

  it('refuses a client-written approved_amount', async () => {
    if (!admin) return
    await BUYER.client.from('financing_applications')
      .update({ approved_amount: 999_999_999 }).eq('id', appId)
    const { data } = await BUYER.client.from('financing_applications')
      .select('approved_amount').eq('id', appId).single()
    expect(data!.approved_amount).toBeNull()
  })

  it('refuses a client-written decision_source and is_sandbox', async () => {
    if (!admin) return
    await BUYER.client.from('financing_applications')
      .update({ decision_source: 'bank_api', is_sandbox: false }).eq('id', appId)
    const { data } = await BUYER.client.from('financing_applications')
      .select('decision_source, is_sandbox').eq('id', appId).single()
    expect(data!.decision_source, 'a buyer forged decision provenance').toBeNull()
  })

  it('refuses a client-written bank_id', async () => {
    if (!admin) return
    await BUYER.client.from('financing_applications').update({ bank_id: bankB }).eq('id', appId)
    const { data } = await BUYER.client.from('financing_applications')
      .select('bank_id').eq('id', appId).single()
    expect(data!.bank_id, 'a buyer reassigned their application to another bank').toBe(bankA)
  })

  it('refuses a changed requested amount after submission', async () => {
    if (!admin) return
    await BUYER.client.from('financing_applications')
      .update({ amount_requested: 50_000_000 }).eq('id', appId)
    const { data } = await BUYER.client.from('financing_applications')
      .select('amount_requested').eq('id', appId).single()
    expect(Number(data!.amount_requested)).toBe(REQUESTED)
  })
})

describe('6 — the lifecycle, walked by the officer', () => {
  it('A. submitted -> under_review', async () => {
    if (!admin) return
    const { error } = await officerA.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'under_review',
    })
    expect(error, error?.message).toBeFalsy()
    const { data } = await officerA.from('financing_applications')
      .select('status').eq('id', appId).single()
    expect(data!.status).toBe('under_review')
  })

  it('B. under_review -> information requested, with the note ON THE ROW', async () => {
    if (!admin) return
    const { error } = await officerA.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'additional_information_required',
      p_note: 'Send the most recent offtake agreement.',
    })
    expect(error, error?.message).toBeFalsy()
    const { data } = await officerA.from('financing_applications')
      .select('status, decision_note').eq('id', appId).single()
    expect(data!.status).toBe('additional_information_required')
    // The legacy loamy_bank_set_status sent this to a notification only and
    // persisted nothing, so the application itself carried no record.
    expect(data!.decision_note).toMatch(/offtake agreement/)
  })

  it('and the APPLICANT can see it', async () => {
    if (!admin) return
    const { data } = await BUYER.client.from('financing_applications')
      .select('status, decision_note').eq('id', appId).single()
    expect(data!.status).toBe('additional_information_required')
    expect(data!.decision_note).toMatch(/offtake agreement/)
  })

  it('C. information requested -> back to under_review', async () => {
    if (!admin) return
    const { error } = await officerA.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'under_review',
    })
    expect(error, error?.message).toBeFalsy()
  })

  it('refuses an approval that exceeds what was requested', async () => {
    if (!admin) return
    const { error } = await officerA.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved', p_approved_amount: REQUESTED + 1,
    })
    expect(error, 'the bank approved more than was asked for').toBeTruthy()
  })

  it('refuses an approval with no amount', async () => {
    if (!admin) return
    const { error } = await officerA.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved',
    })
    expect(error).toBeTruthy()
  })

  it('refuses an invented decision value', async () => {
    if (!admin) return
    const { error } = await officerA.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'blessed', p_approved_amount: 1,
    })
    expect(error).toBeTruthy()
  })

  it('refuses an invented provenance', async () => {
    if (!admin) return
    const { error } = await officerA.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved',
      p_approved_amount: REQUESTED, p_source: 'trust_me',
    })
    expect(error, 'a caller invented a decision source').toBeTruthy()
  })

  it('D. under_review -> approved, with terms and server-derived provenance', async () => {
    if (!admin) return
    const { error } = await officerA.rpc('loamy_financing_decision', {
      p_application_id: appId, p_decision: 'approved',
      p_approved_amount: REQUESTED, p_tenor_days: 90,
      p_pricing_note: 'Murabaha mark-up as per facility letter',
      p_bank_reference: `SL3-${RUN}`,
      p_conditions: 'Subject to stock verification',
    })
    expect(error, error?.message).toBeFalsy()

    const { data } = await officerA.from('financing_applications')
      .select('status, approved_amount, tenor_days, pricing_note, bank_reference, conditions, decision_source, is_sandbox, decided_at, reviewed_by')
      .eq('id', appId).single()
    expect(data!.status).toBe('approved')
    expect(Number(data!.approved_amount)).toBe(REQUESTED)
    expect(data!.tenor_days).toBe(90)
    expect(data!.bank_reference).toBe(`SL3-${RUN}`)
    expect(data!.conditions).toMatch(/stock verification/)
    // Never sent by the client; derived from the session and the bank row.
    expect(data!.decision_source).toBe('bank_officer')
    expect(data!.is_sandbox, 'a sandbox bank produced an unlabelled decision').toBe(true)
    expect(data!.decided_at).toBeTruthy()
    expect(data!.reviewed_by, 'the actor was not recorded').toBeTruthy()
  })

  it('keeps the bank’s own decision visible to it afterwards', async () => {
    if (!admin) return
    // The defect this slice fixed: the Stage 5 select policy listed four
    // statuses, so approving made the row vanish from its own bank.
    const { data } = await officerA.from('financing_applications')
      .select('id, status').eq('id', appId).maybeSingle()
    expect(data, 'the application disappeared from its own bank after approval').toBeTruthy()
    expect(data!.status).toBe('approved')
  })

  it('keeps it in the pipeline too', async () => {
    if (!admin) return
    const { data } = await officerA.rpc('loamy_bank_pipeline')
    const row = (data as Record<string, any>[]).find((r) => r.id === appId)
    expect(row, 'the decided application dropped out of the pipeline').toBeTruthy()
    expect(row!.status).toBe('approved')
    expect(row!.ref).toMatch(/^FIN-/)
    expect(row!.is_sandbox).toBe(true)
    expect(Number(row!.approved_amount)).toBe(REQUESTED)
  })

  it('E. offers no further decision once approved', async () => {
    if (!admin) return
    const { data } = await officerA.rpc('loamy_application_bundle', { p_app: appId })
    expect((data as Record<string, any>).permitted_decisions).toEqual([])
  })

  it('still keeps bank B out after the decision', async () => {
    if (!admin) return
    const { data } = await officerB.from('financing_applications').select('*').eq('id', appId)
    expect(data ?? []).toHaveLength(0)
  })
})

describe('7 — the decision leaves exactly one audit event each time', () => {
  it('writes one financing event per decision, in order', async () => {
    if (!admin) return
    const { data } = await officerA.from('financing_events')
      .select('event_type, actor_kind, previous_status, new_status, amount')
      .eq('application_id', appId).order('occurred_at', { ascending: true })
    const types = (data ?? []).map((e) => e.event_type)
    expect(types).toEqual([
      'submitted', 'under_review', 'additional_information_required',
      'under_review', 'approved',
    ])
    const approval = (data ?? []).find((e) => e.event_type === 'approved')!
    expect(approval.actor_kind).toBe('bank')
    expect(Number(approval.amount)).toBe(REQUESTED)
  })

  it('records the provenance and the sandbox flag on the event', async () => {
    if (!admin) return
    const { data } = await officerA.from('financing_events')
      .select('detail').eq('application_id', appId).eq('event_type', 'approved').single()
    const d = data!.detail as Record<string, unknown>
    expect(d.source).toBe('bank_officer')
    expect(d.is_sandbox).toBe(true)
  })

  it('lets the applicant read their own trail', async () => {
    if (!admin) return
    const { data } = await BUYER.client.from('financing_events')
      .select('event_type').eq('application_id', appId)
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('keeps the trail from bank B', async () => {
    if (!admin) return
    const { data } = await officerB.from('financing_events').select('*').eq('application_id', appId)
    expect(data ?? []).toHaveLength(0)
  })
})

describe('8 — a draft was never submitted and cannot be decided', () => {
  it('refuses a decision on a draft', async () => {
    if (!admin) return
    const { data: draft } = await BUYER.client.from('financing_applications').insert({
      applicant_id: BUYER.uid, bank_id: bankA, product_type: 'commodity_purchase',
      structure: 'murabaha', amount_requested: 100_000,
      purpose: 'Slice 3 draft guard', status: 'draft',
    }).select('id').single()
    if (!draft) return
    const { error } = await officerA.rpc('loamy_financing_decision', {
      p_application_id: draft.id, p_decision: 'approved', p_approved_amount: 100_000,
    })
    expect(error, 'a never-submitted draft was approved').toBeTruthy()
    expect(error!.message).toMatch(/not been submitted/i)
    await BUYER.client.from('financing_applications').delete().eq('id', draft.id)
  })
})

describe('9 — one active application per transaction', () => {
  it('refuses a second live application while one is approved', async () => {
    if (!admin) return
    const { error } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txnId, p_bank_id: bankB,
    })
    expect(error, 'a second bank was engaged on an approved transaction').toBeTruthy()
  })

  it('allows another bank AFTER a rejection', async () => {
    if (!admin) return
    // A fresh transaction, rejected by bank A, then offered to bank B.
    const { data: t2 } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: QTY + 1,
    })
    txn2Id = t2 as string
    const { data: a2 } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txn2Id, p_bank_id: bankA,
    })
    app2Id = a2 as string

    const { error: rejErr } = await officerA.rpc('loamy_financing_decision', {
      p_application_id: app2Id, p_decision: 'rejected',
      p_note: 'Outside current commodity exposure.',
    })
    expect(rejErr, rejErr?.message).toBeFalsy()

    const { error: retryErr } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txn2Id, p_bank_id: bankB,
    })
    expect(retryErr, 'a rejected buyer could not approach another bank').toBeFalsy()
  }, 120_000)

  it('shows the applicant the rejection and its reason', async () => {
    if (!admin) return
    const { data } = await BUYER.client.from('financing_applications')
      .select('status, decision_note').eq('id', app2Id).single()
    expect(data!.status).toBe('rejected')
    expect(data!.decision_note).toMatch(/commodity exposure/)
  })
})

describe('10 — financing never creates a second transaction', () => {
  it('leaves exactly one transaction behind the approved application', async () => {
    if (!admin) return
    const { data: app } = await officerA.from('financing_applications')
      .select('transaction_id').eq('id', appId).single()
    expect(app!.transaction_id).toBe(txnId)

    const { data: linked } = await BUYER.client.from('financing_applications')
      .select('id').eq('transaction_id', txnId)
    expect(linked ?? [], 'more than one application attached to one transaction').toHaveLength(1)
  })

  it('leaves the transaction itself singular and unduplicated', async () => {
    if (!admin) return
    const { data: txns } = await BUYER.client.from('transactions')
      .select('id').eq('listing_id', listingId).eq('quantity', QTY)
    expect(txns ?? [], 'the financing decision created a duplicate transaction').toHaveLength(1)
  })

  it('points the transaction back at its application', async () => {
    if (!admin) return
    const { data } = await BUYER.client.from('transactions')
      .select('financing_application_id').eq('id', txnId).single()
    expect(data!.financing_application_id).toBe(appId)
  })
})

/**
 * 11 - activation, which is where the decision lifecycle met a function that
 * had never heard of it.
 *
 * `loamy_activate_facility` predates slice 3 and accepted only
 * `decided_external`, so every application decided INSIDE Loamy ended
 * `approved` and was refused by the very button the bank portal offers for it.
 * These walk the real states: approved activates, a second call is idempotent,
 * another bank's officer cannot, and a declined application never can.
 */
describe('11 - a decided application activates into a facility', () => {
  let facilityId = ''

  it('refuses an officer of a DIFFERENT bank', async () => {
    if (!admin) return
    const { error } = await officerB.rpc('loamy_activate_facility', {
      p_application: appId, p_principal: REQUESTED,
    })
    expect(error, 'another bank activated a facility on this application').toBeTruthy()
    expect(error!.message).toMatch(/not found for your bank/i)
  })

  it('activates an APPROVED application, which used to be refused', async () => {
    if (!admin) return
    const { data, error } = await officerA.rpc('loamy_activate_facility', {
      p_application: appId, p_principal: REQUESTED, p_sector: 'Agriculture Production',
    })
    expect(error, error?.message).toBeFalsy()
    expect(data, 'no facility id returned').toBeTruthy()
    facilityId = data as string
  })

  it('records the facility against the right bank and borrower', async () => {
    if (!admin || !facilityId) return
    const { data } = await admin
      .from('facilities').select('application_id, bank_id, principal').eq('id', facilityId).single()
    expect(data!.application_id).toBe(appId)
    expect(data!.bank_id).toBe(bankA)
    expect(Number(data!.principal)).toBe(REQUESTED)
  })

  it('is idempotent: a second call returns the SAME facility', async () => {
    if (!admin || !facilityId) return
    const { data, error } = await officerA.rpc('loamy_activate_facility', {
      p_application: appId, p_principal: REQUESTED,
    })
    expect(error, error?.message).toBeFalsy()
    expect(data).toBe(facilityId)
  })

  it('creates no second facility row for the same application', async () => {
    if (!admin) return
    const { count } = await admin
      .from('facilities').select('id', { count: 'exact', head: true }).eq('application_id', appId)
    expect(count).toBe(1)
  })

  it('REFUSES a declined application, and says what state it is in', async () => {
    if (!admin || !app2Id) return
    const { error } = await officerA.rpc('loamy_activate_facility', {
      p_application: app2Id, p_principal: 50_000,
    })
    expect(error, 'a declined application opened a facility').toBeTruthy()
    expect(error!.message).toMatch(/approved application/i)
    expect(error!.message).toMatch(/rejected/i)
  })

  it('refuses a negative principal', async () => {
    if (!admin) return
    const { error } = await officerA.rpc('loamy_activate_facility', {
      p_application: appId, p_principal: -1,
    })
    expect(error).toBeTruthy()
  })

  it('refuses a member who is not a bank officer at all', async () => {
    if (!admin) return
    const { error } = await OUTSIDER.client.rpc('loamy_activate_facility', {
      p_application: appId, p_principal: REQUESTED,
    })
    expect(error, 'a non-officer activated a facility').toBeTruthy()
    expect(error!.message).toMatch(/bank officers only/i)
  })
})
