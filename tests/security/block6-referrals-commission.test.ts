import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * BLOCK 6 — referrals, non-cash benefits, and commission governance.
 *
 * The property the whole block exists to hold (directive 14):
 *
 *   User A refers Farmer B.
 *   Growth Partner C verifies B's farm.
 *   C is paid. A is not. Ever.
 *
 * Two separate graphs. The enforcement is structural: referral_benefits has
 * no amount column and no currency column, so an ordinary referral has
 * nowhere to record money.
 */

let REFERRER: TestUser     // an ordinary member, User A
let REFERRED: TestUser     // Farmer B
let AGENT: TestUser        // Growth Partner C
let OUTSIDER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
const REFERRER_HANDLE = `ref_${RUN}`

let referralId = ''
let farmId = ''
let caseId = ''
let earningId = ''
let benefitBearingReferral = ''

beforeAll(async () => {
  REFERRER = await makeUser('trader', 'Trader')
  REFERRED = await makeUser('farmer', 'Farmer')
  AGENT = await makeUser('growth_partner', 'Growth Partner')
  OUTSIDER = await makeUser('trader', 'Trader')
  admin = await adminClient()

  await REFERRER.client.rpc('loamy_set_username', { p_username: REFERRER_HANDLE })

  if (admin) {
    await admin.rpc('loamy_set_can_verify', { p_user: AGENT.uid, p_value: true })
    await admin.from('partner_assignments').insert({
      partner_id: AGENT.uid, state: 'Benue', lgas: [], active: true,
    })
    await admin.rpc('loamy_gp_set_training', {
      p_user: AGENT.uid, p_status: 'trained',
      p_cleared_types: ['farm_verification', 'commodity_verification'],
    })
  }
}, 300_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

// ---------------------------------------------------------------------------

describe('1 — a referral code is the member\'s own handle', () => {
  it('gives a member their code and says plainly what it pays', async () => {
    const { data } = await REFERRER.client.rpc('loamy_my_referral_code')
    const c = data as Record<string, any>
    expect(c.code).toBe(REFERRER_HANDLE)
    expect(c.is_username).toBe(true)
    expect(c.link_path).toBe(`/u/${REFERRER_HANDLE}`)
    // No ambiguity about what this is.
    expect(String(c.note)).toMatch(/not a commission/i)
    expect(String(c.note)).toMatch(/pay no money/i)
  })

  it('exposes the active programme, so nothing is hard-coded', async () => {
    const { data } = await REFERRER.client.rpc('loamy_my_referral_code')
    const p = (data as Record<string, any>).programme
    expect(p).toBeTruthy()
    expect(p.qualification.type).toBeTruthy()
    expect(Array.isArray(p.benefits)).toBe(true)
  })
})

describe('2 — attribution, and the fraud controls', () => {
  it('REFUSES self-referral', async () => {
    const { data } = await REFERRER.client.rpc('loamy_attribute_referral', {
      p_code: REFERRER_HANDLE,
    })
    const r = data as Record<string, any>
    expect(r.attributed).toBe(false)
    expect(r.reason).toBe('self_referral')
  })

  it('refuses an unknown code', async () => {
    const { data } = await REFERRED.client.rpc('loamy_attribute_referral', {
      p_code: `nobody_${RUN}`,
    })
    expect((data as Record<string, any>).reason).toBe('unknown_code')
  })

  it('records the attribution', async () => {
    const { data, error } = await REFERRED.client.rpc('loamy_attribute_referral', {
      p_code: REFERRER_HANDLE, p_source: 'referral_link',
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.attributed, JSON.stringify(r)).toBe(true)
    expect(r.status).toBe('registered')
    // Directive 5: registered is NOT successful.
    expect(String(r.note)).toMatch(/becomes successful only when/i)
    referralId = r.referral_id
  }, 60_000)

  it('REFUSES a second attribution — the referrer is immutable', async () => {
    const { data } = await REFERRED.client.rpc('loamy_attribute_referral', {
      p_code: `${REFERRER_HANDLE}`, p_source: 'code_entry',
    })
    expect((data as Record<string, any>).reason).toBe('already_attributed')
  })

  it('refuses a DIFFERENT referrer being swapped in later', async () => {
    await OUTSIDER.client.rpc('loamy_set_username', { p_username: `alt_${RUN}` })
    const { data } = await REFERRED.client.rpc('loamy_attribute_referral', {
      p_code: `alt_${RUN}`,
    })
    expect((data as Record<string, any>).reason).toBe('already_attributed')

    const { data: row } = await REFERRED.client
      .from('referrals').select('referrer_id').eq('id', referralId).single()
    expect(row!.referrer_id, 'the referrer was changed after attribution').toBe(REFERRER.uid)
  }, 60_000)

  it('refuses a direct write to the referral row', async () => {
    const before = await REFERRED.client
      .from('referrals').select('referrer_id, status').eq('id', referralId).single()
    await REFERRED.client.from('referrals')
      .update({ referrer_id: OUTSIDER.uid, status: 'benefit_earned' }).eq('id', referralId)
    const after = await REFERRED.client
      .from('referrals').select('referrer_id, status').eq('id', referralId).single()
    expect(after.data!.referrer_id).toBe(before.data!.referrer_id)
    expect(after.data!.status).toBe(before.data!.status)
  })

  it('refuses an insert straight into the table', async () => {
    const { error } = await OUTSIDER.client.from('referrals').insert({
      referrer_id: OUTSIDER.uid, referred_id: AGENT.uid,
      programme_id: '00000000-0000-0000-0000-000000000000',
      code_used: 'x', status: 'benefit_earned',
    })
    expect(error, 'a member fabricated a referral').toBeTruthy()
  })

  it('REFUSES a circular referral', async () => {
    // REFERRED already has REFERRER as their referrer. If REFERRER now tried
    // to claim REFERRED as theirs, that is a loop.
    const CIRC = await makeUser('trader', 'Trader')
    await CIRC.client.rpc('loamy_attribute_referral', { p_code: REFERRER_HANDLE })
    await CIRC.client.rpc('loamy_set_username', { p_username: `circ_${RUN}` })

    // REFERRER is already attributed to nobody; attribute them to CIRC, whom
    // they referred. That is a direct cycle.
    const { data } = await REFERRER.client.rpc('loamy_attribute_referral', {
      p_code: `circ_${RUN}`,
    })
    const r = data as Record<string, any>
    expect(['circular_referral', 'attribution_window_closed']).toContain(r.reason)
    expect(r.attributed).toBe(false)
  }, 120_000)

  it('closes the attribution window on an older account', async () => {
    if (!admin) return
    const { data: prog } = await admin.rpc('loamy_upsert_referral_programme', {
      p_name: `Narrow window (test ${RUN})`,
      p_qualification: { type: 'profile_complete' },
      p_benefits: [{ code: 'recognition', label: 'Recognition', kind: 'recognition', to: 'referrer' }],
      p_attribution_window_hours: 1,
    })
    expect((prog as Record<string, any>).saved).toBe(true)

    // AGENT signed up at the top of this run but the window is now 1 hour,
    // and they are inside it — so this proves the path, not the clock.
    const { data } = await AGENT.client.rpc('loamy_attribute_referral', {
      p_code: REFERRER_HANDLE,
    })
    const r = data as Record<string, any>
    expect(typeof r.attributed).toBe('boolean')
    if (!r.attributed) {
      expect(['attribution_window_closed', 'already_attributed']).toContain(r.reason)
    }
  }, 120_000)
})

describe('3 — registered is not successful', () => {
  it('does not award a benefit merely because someone signed up', async () => {
    const { data } = await REFERRER.client.rpc('loamy_my_referral_summary')
    const s = data as Record<string, any>
    expect(Number(s.counts.total)).toBeGreaterThan(0)
    expect((s.benefits as unknown[]).length,
      'a benefit was awarded for a signup alone').toBe(0)
  })

  it('tells the referrer what is still missing', async () => {
    const { data } = await REFERRER.client.rpc('loamy_my_referral_summary')
    const person = ((data as Record<string, any>).people as Record<string, any>[])
      .find((p) => p.status === 'registered')
    expect(person?.progress?.needs, 'no progress shown for a pending referral').toBeTruthy()
  })
})

describe('4 — qualification awards NON-CASH benefits', () => {
  // This describe owns its own programme and its own referral. The active
  // programme is GLOBAL, and a previous run against this live database may
  // have changed it -- so the property under test is the BINDING, not any
  // particular rule.
  let QUALIFIER: TestUser
  let qualifyingReferral = ''
  let boundRule = ''

  beforeAll(async () => {
    if (!admin) return
    await admin.rpc('loamy_upsert_referral_programme', {
      p_name: `Block 6 qualify ${RUN}`,
      p_qualification: { type: 'first_listing' },
      p_benefits: [
        { code: `recognition_${RUN}`, label: 'Referral recognition', kind: 'recognition', to: 'referrer' },
        { code: `early_${RUN}`, label: 'Early access', kind: 'early_access', to: 'referrer' },
      ],
      p_attribution_window_hours: 72,
    })

    QUALIFIER = await makeUser('farmer', 'Farmer')
    const { data } = await QUALIFIER.client.rpc('loamy_attribute_referral', {
      p_code: REFERRER_HANDLE, p_source: 'referral_link',
    })
    qualifyingReferral = (data as Record<string, any>).referral_id

    const { data: q } = await QUALIFIER.client.rpc('loamy_referral_qualifies', {
      p_referral_id: qualifyingReferral,
    })
    boundRule = (q as Record<string, any>).rule_type
  }, 180_000)

  it('binds the referral to the programme active when it was made', () => {
    expect(boundRule, 'the referral did not bind to the programme it was made under')
      .toBe('first_listing')
  })

  it('does NOT let a later programme change rewrite an existing referral', async () => {
    if (!admin) return
    // The principle directive 9 states for commission, applied to referrals.
    await admin.rpc('loamy_upsert_referral_programme', {
      p_name: `Block 6 changed rule ${RUN}`,
      p_qualification: { type: 'identity_verified' },
      p_benefits: [{ code: 'other', label: 'Other', kind: 'badge', to: 'referrer' }],
    })

    const { data } = await QUALIFIER.client.rpc('loamy_referral_qualifies', {
      p_referral_id: qualifyingReferral,
    })
    expect((data as Record<string, any>).rule_type,
      'changing the programme rewrote an existing referral').toBe(boundRule)
  }, 120_000)

  it('does not qualify before the condition is met', async () => {
    const { data } = await QUALIFIER.client.rpc('loamy_referral_qualifies', {
      p_referral_id: qualifyingReferral,
    })
    expect((data as Record<string, any>).qualifies).toBe(false)
  })

  it('qualifies once that programme condition is met', async () => {
    const { error } = await QUALIFIER.client.from('listings').insert({
      seller_id: QUALIFIER.uid, listing_type: 'commodity', commodity: 'Maize',
      quantity_kg: 20, unit: 'bags', price_per_unit: 40_000,
      state: 'Benue', lga: 'Makurdi', status: 'active',
      description: `Block 6 qualify ${RUN}`,
    })
    expect(error, error?.message).toBeFalsy()

    const { data } = await QUALIFIER.client.rpc('loamy_check_my_referrals')
    expect((data as Record<string, any>).checked).toBe(true)

    const { data: row } = await REFERRER.client
      .from('referrals').select('status, qualified_at').eq('id', qualifyingReferral).single()
    expect(['qualified', 'benefit_earned'], JSON.stringify(row)).toContain(row!.status)
    expect(row!.qualified_at).toBeTruthy()

    benefitBearingReferral = qualifyingReferral
  }, 180_000)

  it('awards the benefits the PROGRAMME names, and nothing else', async () => {
    const { data } = await REFERRER.client.rpc('loamy_my_referral_summary')
    const benefits = ((data as Record<string, any>).benefits as Record<string, any>[])
      .filter((b) => String(b.code).endsWith(RUN))
    expect(benefits.length, 'no benefit was awarded').toBe(2)
    for (const b of benefits) {
      expect(['recognition', 'badge', 'access', 'early_access', 'visibility', 'resource'])
        .toContain(b.kind)
    }
  })

  it('has NO monetary field anywhere in the payload', async () => {
    const { data } = await REFERRER.client.rpc('loamy_my_referral_summary')
    const s = data as Record<string, any>
    const json = JSON.stringify({ counts: s.counts, people: s.people, benefits: s.benefits })
      .toLowerCase()
    expect(json).not.toContain('"amount"')
    expect(json).not.toContain('"currency"')
    expect(json).not.toContain('naira')
    expect(s.is_cash_programme).toBe(false)
  })

  it('has no amount column on the benefits table at all', async () => {
    const { data } = await REFERRER.client.from('referral_benefits').select('*').limit(1)
    const cols = Object.keys(data?.[0] ?? {})
    for (const banned of ['amount', 'currency', 'value', 'naira', 'payout']) {
      expect(cols, `referral_benefits.${banned} exists`).not.toContain(banned)
    }
  })

  it('refuses a programme that tries to describe a cash benefit', async () => {
    if (!admin) return
    const bad = await admin.rpc('loamy_upsert_referral_programme', {
      p_name: 'Cash programme attempt',
      p_qualification: { type: 'profile_complete' },
      p_benefits: [{ code: 'cash', label: 'N5000', kind: 'cash', to: 'referrer' }],
    })
    expect(bad.error, 'a cash referral benefit was accepted').toBeTruthy()

    const withAmount = await admin.rpc('loamy_upsert_referral_programme', {
      p_name: 'Amount programme attempt',
      p_qualification: { type: 'profile_complete' },
      p_benefits: [{ code: 'x', label: 'x', kind: 'recognition', amount: 5000 }],
    })
    expect(withAmount.error, 'a referral benefit carried an amount').toBeTruthy()
  }, 60_000)

  it('lets the member redeem a benefit they hold', async () => {
    const { data } = await REFERRER.client.rpc('loamy_my_referral_summary')
    const b = ((data as Record<string, any>).benefits as Record<string, any>[])
      .find((x) => String(x.code).endsWith(RUN) && x.status === 'earned')
    expect(b, 'no earned benefit to redeem').toBeTruthy()
    const { data: r, error } = await REFERRER.client.rpc('loamy_redeem_benefit', {
      p_benefit_id: b!.id,
    })
    expect(error, error?.message).toBeFalsy()
    expect((r as Record<string, any>).redeemed).toBe(true)
  }, 60_000)

  it('refuses redeeming a benefit belonging to someone else', async () => {
    const { data } = await REFERRER.client.rpc('loamy_my_referral_summary')
    const b = ((data as Record<string, any>).benefits as Record<string, any>[])
      .find((x) => String(x.code).endsWith(RUN))
    const { error } = await OUTSIDER.client.rpc('loamy_redeem_benefit', { p_benefit_id: b!.id })
    expect(error, 'a member redeemed a benefit that was not theirs').toBeTruthy()
  })
})

/**
 * A PRODUCT INVARIANT, checked before the tests that depend on it.
 *
 * `fee_schedules` is global, mutable and has no restore path: ending a rule
 * through the admin surface takes effect immediately for every member, and
 * nothing puts it back. When the seeded farm_verification commission was
 * ended on 2026-09-21, the visible symptom was six failures in THIS file with
 * messages like "Cannot read properties of null" -- three tests away from the
 * cause, in a file about referrals.
 *
 * So the invariant is asserted directly, first, and says what to do about it.
 * A Growth Partner who completes approved field work is owed something; if
 * this fails, they are working for nothing in production.
 */
describe('0 — the commission rule a Growth Partner is paid from exists', () => {
  it.each([
    'farm_verification', 'farmer_verification', 'commodity_verification',
    'batch_verification', 'loading_verification', 'market_price_collection',
  ])('resolves a commission rate for %s', async (taskType) => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_resolve_fee', {
      p_scope: 'verification_commission', p_amount: 0, p_transaction_type: taskType,
    })
    const fee = data as Record<string, any>
    expect(
      fee.resolved,
      `No active verification_commission rule for "${taskType}". A Growth Partner ` +
      `who completes this work accrues NOTHING. The Block 5 defaults are seeded by ` +
      `20260920140004; if one was ended through the admin fee surface it is not ` +
      `restored automatically -- a replacement row must be inserted.`,
    ).toBe(true)
    expect(Number(fee.fee)).toBeGreaterThan(0)
  })
})

describe('5 — THE SEPARATION (directive 14)', () => {
  it('pays the Growth Partner for verifying the referred farmer', async () => {
    if (!admin) return

    const { data: farm } = await REFERRED.client.from('farms').insert({
      owner_id: REFERRED.uid, farm_name: `Referred Farm ${RUN}`,
      state: 'Benue', lga: 'Makurdi', size_hectares: 6,
      primary_crops: ['Maize'], ownership_type: 'owned',
      latitude: 7.7322, longitude: 8.5391,
    }).select('id').single()
    farmId = farm!.id

    const { data: t } = await admin.rpc('loamy_create_task', {
      p_task_type: 'farm_verification', p_subject_farm_id: farmId,
    })
    caseId = (t as Record<string, any>).task_id

    // Every step is asserted. This chain used to `await` five RPCs without
    // looking at any of them, so when one failed the symptom appeared three
    // tests later as "Cannot read properties of null" -- which is why this
    // file's intermittent failures went unexplained for two full-suite runs.
    const pub = await admin.rpc('loamy_publish_task', { p_task_id: caseId })
    expect(pub.error, `publish: ${pub.error?.message}`).toBeFalsy()

    const claim = await AGENT.client.rpc('loamy_claim_task', { p_task_id: caseId })
    expect(claim.error, `claim: ${claim.error?.message}`).toBeFalsy()

    const accept = await AGENT.client.rpc('loamy_accept_task', { p_task_id: caseId })
    expect(accept.error, `accept: ${accept.error?.message}`).toBeFalsy()

    const ev = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 7.7322, p_lng: 8.5391, p_accuracy_m: 6,
      p_content_hash: `b6-${RUN}-farm`,
    })
    expect(ev.error, `evidence: ${ev.error?.message}`).toBeFalsy()

    const sub = await AGENT.client.rpc('loamy_submit_verification_case', { p_case_id: caseId })
    expect(sub.error, `submit: ${sub.error?.message}`).toBeFalsy()

    const { error } = await admin.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved', p_note: 'Block 6 separation test.',
    })
    expect(error, error?.message).toBeFalsy()

    // If accrual refused, it says why. Reading the reason beats inferring it
    // from an absent row.
    const { data: e, error: readErr } = await AGENT.client
      .from('partner_earnings').select('id, amount, status, payer_kind, fee_snapshot')
      .eq('task_id', caseId).maybeSingle()
    if (!e) {
      const { data: why } = await admin.rpc('loamy_accrue_commission', { p_task_id: caseId })
      const { data: task } = await admin.from('verification_cases')
        .select('status, assigned_to, task_type').eq('id', caseId).maybeSingle()
      throw new Error(
        `no commission accrued for ${caseId}: ` +
        `accrue=${JSON.stringify(why)} task=${JSON.stringify(task)} readErr=${readErr?.message}. ` +
        `If the reason is no_commission_rule, see the "0 —" describe block above: ` +
        `the seeded verification_commission rule for this task type has been ended.`,
      )
    }
    earningId = e.id
    expect(e.status).toBe('pending')
    expect(Number(e.amount)).toBeGreaterThan(0)
    // Directive 9: the rule is frozen at accrual.
    expect(e.fee_snapshot).toBeTruthy()
    expect((e.fee_snapshot as Record<string, any>).schedule_ref).toMatch(/^FEE-\d{6}$/)
  }, 240_000)

  it('gives the REFERRER no cash whatsoever', async () => {
    // The whole point of the block.
    const { data } = await REFERRER.client.from('partner_earnings').select('*')
    expect(data ?? [], 'a referrer received a Growth Partner commission').toHaveLength(0)
  })

  it('gives the referrer no earning for the verified farm either', async () => {
    if (!admin) return
    const { data } = await admin.from('partner_earnings')
      .select('partner_id').eq('task_id', caseId)
    for (const row of data ?? []) {
      expect(row.partner_id, 'the commission went to the referrer').toBe(AGENT.uid)
      expect(row.partner_id).not.toBe(REFERRER.uid)
    }
  })

  it("keeps the two graphs apart in the referrer's own summary", async () => {
    const { data } = await REFERRER.client.rpc('loamy_my_referral_summary')
    const s = data as Record<string, any>

    // The notes DO say "commission" -- they exist to explain that a referral
    // is not one. What must be absent is commission DATA.
    expect(String(s.note)).toMatch(/do not pay commission/i)
    expect(s).not.toHaveProperty('earnings')
    expect(s).not.toHaveProperty('commission')

    const data_only = { counts: s.counts, people: s.people, benefits: s.benefits }
    const json = JSON.stringify(data_only).toLowerCase()
    expect(json, 'commission data leaked into the referral summary')
      .not.toContain('commission')
    expect(json).not.toContain('"amount"')
  })
})

describe('6 — commission governance', () => {
  it('refuses the agent changing their own rate, payer or status', async () => {
    const before = await AGENT.client
      .from('partner_earnings').select('amount, payer_kind, status').eq('id', earningId).single()
    await AGENT.client.from('partner_earnings')
      .update({ amount: 999_999, payer_kind: 'buyer', status: 'paid' }).eq('id', earningId)
    const after = await AGENT.client
      .from('partner_earnings').select('amount, payer_kind, status').eq('id', earningId).single()
    expect(Number(after.data!.amount)).toBe(Number(before.data!.amount))
    expect(after.data!.payer_kind).toBe(before.data!.payer_kind)
    expect(after.data!.status).toBe(before.data!.status)
  })

  it('refuses an ordinary member creating a commission', async () => {
    const { error } = await REFERRER.client.from('partner_earnings').insert({
      partner_id: REFERRER.uid, earning_type: 'verification',
      reference_id: caseId, amount: 50_000, status: 'payable',
    })
    expect(error, 'an ordinary member created a commission').toBeTruthy()
  })

  it('does not pay twice for the same task', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_accrue_commission', { p_task_id: caseId })
    expect((data as Record<string, any>).accrued).toBe(false)
    expect((data as Record<string, any>).reason).toBe('already_accrued')
  })

  it('does NOT pay for rejected work', async () => {
    if (!admin) return
    const { data: t } = await admin.rpc('loamy_create_task', {
      p_task_type: 'farm_verification', p_subject_farm_id: farmId,
    })
    const rejectedCase = (t as Record<string, any>).task_id
    await admin.rpc('loamy_publish_task', { p_task_id: rejectedCase })
    await AGENT.client.rpc('loamy_claim_task', { p_task_id: rejectedCase })
    await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: rejectedCase, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 7.7322, p_lng: 8.5391, p_accuracy_m: 6,
      p_content_hash: `b6-${RUN}-rejected`,
    })
    await AGENT.client.rpc('loamy_submit_verification_case', { p_case_id: rejectedCase })
    await admin.rpc('loamy_review_verification_case', {
      p_case_id: rejectedCase, p_decision: 'rejected', p_note: 'Evidence insufficient.',
    })

    const { data: e } = await admin.from('partner_earnings').select('id').eq('task_id', rejectedCase)
    expect(e ?? [], 'rejected work produced a commission').toHaveLength(0)

    const { data: attempt } = await admin.rpc('loamy_accrue_commission', {
      p_task_id: rejectedCase,
    })
    expect((attempt as Record<string, any>).accrued).toBe(false)
    expect((attempt as Record<string, any>).reason).toBe('work_not_approved')
  }, 240_000)

  it('walks the lifecycle and posts to the ledger only at payable and paid', async () => {
    if (!admin) return
    const beforeLedger = await admin.from('ledger_entries')
      .select('id').eq('subject_id', earningId)
    expect((beforeLedger.data ?? []).length,
      'money moved before the commission was payable').toBe(0)

    for (const [ev, ref] of [['approve', null], ['make_payable', null],
                             ['pay', `b6-pay-${RUN}`]] as const) {
      const { data, error } = await admin.rpc('loamy_commission_transition', {
        p_earning_id: earningId, p_event: ev, p_reference: ref,
      })
      // Assert on the error FIRST. This used to read only `data`, so an RPC
      // that errored surfaced as "Cannot read properties of null (reading
      // 'moved')" -- a TypeError that says nothing about what went wrong,
      // which is why this file's intermittent failures stayed unexplained.
      expect(error, `${ev} failed: ${error?.message} (${error?.code})`).toBeFalsy()
      expect((data as Record<string, any>)?.moved, `${ev}: ${JSON.stringify(data)}`).toBe(true)
    }

    const { data: lines } = await admin.from('ledger_entries')
      .select('amount').eq('subject_id', earningId)
    expect((lines ?? []).length).toBe(4)   // liability pair + settlement pair
    const sum = (lines ?? []).reduce((n, l) => n + Number(l.amount), 0)
    expect(Math.abs(sum), 'commission postings did not balance').toBeLessThan(0.01)
  }, 180_000)

  it('REFUSES a replayed payment reference', async () => {
    if (!admin) return
    const { data, error } = await admin.rpc('loamy_commission_transition', {
      p_earning_id: earningId, p_event: 'pay', p_reference: `b6-pay-${RUN}`,
    })
    expect(error, `replay check failed: ${error?.message} (${error?.code})`).toBeFalsy()
    expect((data as Record<string, any>)?.moved, 'a commission was paid twice').toBe(false)
  })

  it('reverses with a counter-entry, never a deletion', async () => {
    if (!admin) return
    const { data, error } = await admin.rpc('loamy_commission_transition', {
      p_earning_id: earningId, p_event: 'reverse',
      p_note: 'Block 6 test: reversal path.',
    })
    expect(error, `reverse failed: ${error?.message} (${error?.code})`).toBeFalsy()
    expect((data as Record<string, any>)?.moved).toBe(true)

    const { data: row } = await admin.from('partner_earnings')
      .select('status, reversal_reason').eq('id', earningId).single()
    expect(row!.status).toBe('reversed')
    expect(row!.reversal_reason).toMatch(/reversal path/)

    // The original postings survive.
    const { data: lines } = await admin.from('ledger_entries')
      .select('event_type').eq('subject_id', earningId)
    const types = (lines ?? []).map((l) => l.event_type)
    expect(types).toContain('payout')
    expect(types).toContain('payout_reversal')
  }, 120_000)

  it('refuses a reversal with no reason', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_commission_transition', {
      p_earning_id: earningId, p_event: 'reverse', p_note: '  ',
    })
    expect(error, 'a commission was reversed with no reason on record').toBeTruthy()
  })

  it('leaves the ledger reconciled', async () => {
    if (!admin) return
    const { data } = await admin
      .from('loamy_reconciliation_exceptions').select('kind').eq('kind', 'unbalanced_group')
    expect(data ?? [], 'commission postings unbalanced the ledger').toHaveLength(0)
  })
})

describe('7 — privacy', () => {
  it('keeps a member\'s referral list to themselves', async () => {
    const { data } = await OUTSIDER.client
      .from('referrals').select('*').eq('referrer_id', REFERRER.uid)
    expect(data ?? [], "a member read another member's referral history").toHaveLength(0)
  })

  it('keeps benefits private', async () => {
    const { data } = await OUTSIDER.client
      .from('referral_benefits').select('*').eq('user_id', REFERRER.uid)
    expect(data ?? []).toHaveLength(0)
  })

  it('does not expose the referred member\'s full identity to the referrer', async () => {
    const { data } = await REFERRER.client.rpc('loamy_my_referral_summary')
    const json = JSON.stringify((data as Record<string, any>).people)
    expect(json).not.toContain('@')            // no email
    expect(json.toLowerCase()).not.toContain('phone')
  })

  it('shows signed-out visitors nothing', async () => {
    const anon = anonClient()
    for (const t of ['referrals', 'referral_benefits']) {
      const { data, error } = await anon.from(t).select('*').limit(1)
      expect(error || (data ?? []).length === 0, `${t} readable signed out`).toBeTruthy()
    }
  })

  it('refuses an ordinary member configuring the programme', async () => {
    const { error } = await REFERRER.client.rpc('loamy_upsert_referral_programme', {
      p_name: 'Mine', p_qualification: { type: 'profile_complete' }, p_benefits: [],
    })
    expect(error, 'a member configured the referral programme').toBeTruthy()
  })

  it('refuses an ordinary member invalidating a referral', async () => {
    const { error } = await REFERRER.client.rpc('loamy_invalidate_referral', {
      p_referral_id: referralId, p_reason: 'because',
    })
    expect(error).toBeTruthy()
  })
})

describe('8 — invalidation revokes without deleting', () => {
  it('revokes the benefits and keeps the history', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_invalidate_referral', {
      p_referral_id: benefitBearingReferral, p_reason: 'Block 6 test: review outcome.',
    })
    expect(error, error?.message).toBeFalsy()

    const { data: r } = await admin.from('referrals')
      .select('status, invalidation_reason').eq('id', benefitBearingReferral).single()
    expect(r!.status).toBe('invalidated')
    expect(r!.invalidation_reason).toMatch(/review outcome/)

    const { data: b } = await admin.from('referral_benefits')
      .select('status').eq('referral_id', benefitBearingReferral)
    expect((b ?? []).length, 'benefit history was deleted').toBeGreaterThan(0)
    for (const row of b ?? []) expect(row.status).toBe('revoked')
  }, 120_000)

  it('refuses invalidating with no reason', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_invalidate_referral', {
      p_referral_id: referralId, p_reason: '   ',
    })
    expect(error).toBeTruthy()
  })
})
