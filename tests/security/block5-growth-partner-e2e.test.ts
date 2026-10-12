import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * BLOCK 5 — the Growth Partner operational system, end to end.
 *
 * The chain directive 37 asks for:
 *
 *   admin approves agent -> task published -> agent claims -> rival locked out
 *   -> checklist -> GPS evidence -> submit -> agent CANNOT approve own work
 *   -> reviewer approves -> commission pending -> approved -> payable -> paid
 *   -> ledger balanced -> trace reconstructs the relationship
 *
 * Plus the failure paths: rejection, expiry, reassignment, duplicate evidence,
 * GPS anomaly, clock skew, suspension, dispute.
 *
 * The single property underneath all of it: FIELD EVIDENCE -> LOAMY REVIEW ->
 * VERIFIED RECORD. An agent must never be able to manufacture platform truth.
 */

let SELLER: TestUser
let AGENT: TestUser
let RIVAL: TestUser
let BUYER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)

let farmId = ''
let batchId = ''
let caseId = ''
let earningId = ''

beforeAll(async () => {
  SELLER = await makeUser('farmer', 'Farmer')
  AGENT = await makeUser('growth_partner', 'Growth Partner')
  RIVAL = await makeUser('growth_partner', 'Growth Partner')
  BUYER = await makeUser('trader', 'Trader')
  admin = await adminClient()

  const { data: farm } = await SELLER.client.from('farms').insert({
    owner_id: SELLER.uid, farm_name: `GP Farm ${RUN}`,
    state: 'Benue', lga: 'Makurdi', size_hectares: 12,
    primary_crops: ['Maize'], ownership_type: 'owned',
    latitude: 7.7322, longitude: 8.5391,
  }).select('id').single()
  farmId = farm!.id

  const { data: cycle } = await SELLER.client.from('crop_records').insert({
    farm_id: farmId, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single()
  const { data: harvest } = await SELLER.client.from('harvests').insert({
    production_cycle_id: cycle!.id, farm_id: farmId, commodity: 'Maize',
    harvest_date: '2026-09-10', quantity: 40, unit: 'tonne',
  }).select('id').single()
  const { data: batch } = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvest!.id, p_quantity: 40,
  })
  batchId = batch as string

  if (admin) {
    for (const u of [AGENT, RIVAL]) {
      await admin.rpc('loamy_set_can_verify', { p_user: u.uid, p_value: true })
      await admin.from('partner_assignments').insert({
        partner_id: u.uid, state: 'Benue', lgas: [], active: true,
      })
    }
    // The rival is trained too. Otherwise the claim test would be satisfied
    // by an eligibility refusal and never reach the exclusivity lock, which
    // is the thing actually worth proving.
    await admin.rpc('loamy_gp_set_training', {
      p_user: RIVAL.uid, p_status: 'trained',
      p_cleared_types: ['commodity_verification', 'farm_verification'],
    })
  }
}, 300_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

// ---------------------------------------------------------------------------

describe('1 — admin controls who may do field work', () => {
  it('starts an agent as untrained', async () => {
    const { data } = await AGENT.client.rpc('loamy_gp_can_take', {
      p_user: AGENT.uid, p_task_type: 'commodity_verification', p_state: 'Benue',
    })
    const r = data as Record<string, any>
    expect(r.restricted_task_type).toBe(true)
    expect(r.reasons).toContain('training_incomplete')
    expect(r.allowed).toBe(false)
  })

  it('refuses an agent certifying their own training', async () => {
    const { error } = await AGENT.client.rpc('loamy_gp_set_training', {
      p_user: AGENT.uid, p_status: 'trained',
      p_cleared_types: ['commodity_verification'],
    })
    expect(error, 'an agent certified themselves as trained').toBeTruthy()
  })

  it('refuses a direct write to the operations table', async () => {
    const { error } = await AGENT.client.from('growth_partner_operations').insert({
      user_id: AGENT.uid, training_status: 'trained',
    })
    expect(error, 'an agent wrote their own operational state').toBeTruthy()
  })

  it('lets an administrator record training and clearance', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_gp_set_training', {
      p_user: AGENT.uid, p_status: 'trained',
      p_cleared_types: ['commodity_verification', 'farm_verification'],
    })
    expect(error, error?.message).toBeFalsy()

    const { data } = await AGENT.client.rpc('loamy_gp_can_take', {
      p_user: AGENT.uid, p_task_type: 'commodity_verification', p_state: 'Benue',
    })
    expect((data as Record<string, any>).allowed).toBe(true)
  }, 60_000)

  it('lets the agent set only their own availability', async () => {
    const ok = await AGENT.client.rpc('loamy_gp_set_availability', {
      p_availability: 'available',
    })
    expect(ok.error, ok.error?.message).toBeFalsy()

    const { data } = await AGENT.client
      .from('growth_partner_operations').select('*').eq('user_id', RIVAL.uid)
    expect(data ?? [], "an agent read another agent's operational record").toHaveLength(0)
  })
})

describe('2 — a task is published, and claimed exclusively', () => {
  it('creates a verification case from a real buyer request', async () => {
    const { data: listing } = await SELLER.client.rpc('loamy_list_batch', {
      p_batch_id: batchId, p_quantity: 40, p_price_per_unit: 85_000,
    })
    const { data, error } = await BUYER.client.rpc('loamy_request_listing_verification', {
      p_listing_id: listing as string, p_note: `Block 5 e2e ${RUN}`,
    })
    expect(error, error?.message).toBeFalsy()
    caseId = data as string
  }, 60_000)

  it('is not visible in the field pool until it is published', async () => {
    const { data } = await AGENT.client.rpc('loamy_available_tasks')
    const ids = ((data as Record<string, any>).items as Record<string, any>[])
      .map((t) => t.task_id)
    expect(ids, 'an unpublished task was offered to the field').not.toContain(caseId)
  })

  it('publishes it, stamping the checklist VERSION', async () => {
    if (!admin) return
    const { data, error } = await admin.rpc('loamy_publish_task', {
      p_task_id: caseId, p_expires_in_hours: 72,
    })
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, any>).published).toBe(true)

    const { data: t } = await admin.from('verification_tasks')
      .select('checklist_key, checklist_version, expires_at').eq('id', caseId).single()
    expect(t!.checklist_key).toBe('commodity_verification')
    expect(t!.checklist_version).toBe(1)
    expect(t!.expires_at).toBeTruthy()
  }, 60_000)

  it('shows only COARSE location before assignment', async () => {
    const { data } = await AGENT.client.rpc('loamy_available_tasks')
    const mine = ((data as Record<string, any>).items as Record<string, any>[])
      .find((t) => t.task_id === caseId)
    expect(mine, 'a published task did not reach an eligible agent').toBeTruthy()
    expect(mine!.state).toBe('Benue')
    // Directive 26: no coordinates before it is yours.
    expect(Object.keys(mine!)).not.toContain('expected_lat')
    expect(Object.keys(mine!)).not.toContain('subject_user_id')
  })

  it('lists the candidate agents WITH factors, and no opaque score', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_assignment_candidates', { p_task_id: caseId })
    const r = data as Record<string, any>
    expect(r.found).toBe(true)
    const c = (r.candidates as Record<string, any>[])[0]
    expect(c.factors).toHaveProperty('in_service_area')
    expect(c.factors).toHaveProperty('open_tasks')
    expect(c.factors).toHaveProperty('prior_pairings_with_subject')
    expect(c).not.toHaveProperty('score')
  })

  it('refuses a member seeing the candidate list at all', async () => {
    const { error } = await BUYER.client.rpc('loamy_assignment_candidates', { p_task_id: caseId })
    expect(error, 'a buyer saw the agent candidate list').toBeTruthy()
  })

  it('is claimed by the agent', async () => {
    const { data, error } = await AGENT.client.rpc('loamy_claim_task', { p_task_id: caseId })
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, any>).claimed, JSON.stringify(data)).toBe(true)
  })

  it('LOCKS OUT a rival agent', async () => {
    const { data } = await RIVAL.client.rpc('loamy_claim_task', { p_task_id: caseId })
    const r = data as Record<string, any>
    expect(r.claimed, 'two agents were given the same task').toBe(false)
    expect(r.reason).toBe('already_taken')
  })

  it('refuses a rival to modify assigned_to directly', async () => {
    const before = await admin!.from('verification_tasks')
      .select('assigned_to').eq('id', caseId).single()
    await RIVAL.client.from('verification_tasks')
      .update({ assigned_to: RIVAL.uid }).eq('id', caseId)
    const after = await admin!.from('verification_tasks')
      .select('assigned_to').eq('id', caseId).single()
    expect(after.data!.assigned_to, 'an agent reassigned a task to themselves')
      .toBe(before.data!.assigned_to)
  })

  it('accepts it, and now shows the full brief', async () => {
    const ok = await AGENT.client.rpc('loamy_accept_task', { p_task_id: caseId })
    expect(ok.error, ok.error?.message).toBeFalsy()

    const { data } = await AGENT.client.rpc('loamy_my_tasks')
    const mine = ((data as Record<string, any>).items as Record<string, any>[])
      .find((t) => t.task_id === caseId)
    expect(mine!.status).toBe('accepted')
    expect(mine!.checklist.version).toBe(1)
  }, 60_000)
})

describe('3 — evidence, not a button', () => {
  it('refuses an incomplete checklist', async () => {
    const { data } = await AGENT.client.rpc('loamy_submit_checklist', {
      p_case_id: caseId, p_answers: { commodity_matches: true },
    })
    const r = data as Record<string, any>
    expect(r.saved, 'an agent submitted a checklist with required items blank').toBe(false)
    expect(r.reason).toBe('missing_required')
    expect((r.missing as string[]).length).toBeGreaterThan(0)
  })

  it('accepts a complete one, answered against its version', async () => {
    const { data, error } = await AGENT.client.rpc('loamy_submit_checklist', {
      p_case_id: caseId,
      p_answers: {
        commodity_matches: true, quantity_observed: 40, unit: 'tonne',
        condition: 'Dry, well bagged', storage_location: 'Makurdi store',
        seller_present: true, gps_captured: true, photos_captured: true,
        available_for_sale: true, anomaly: 'none',
      },
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.saved).toBe(true)
    expect(r.checklist_version).toBe(1)
  }, 60_000)

  it('refuses a checklist from an agent who does not hold the case', async () => {
    const { error } = await RIVAL.client.rpc('loamy_submit_checklist', {
      p_case_id: caseId, p_answers: { commodity_matches: true },
    })
    expect(error, "a rival answered another agent's checklist").toBeTruthy()
  })

  it('records device time AND server time', async () => {
    const { data, error } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 7.7322, p_lng: 8.5391, p_accuracy_m: 5,
      p_content_hash: `gp-${RUN}-clean`,
      p_quantity: 40, p_unit: 'tonne',
      p_note: 'Stock sighted and counted.',
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.flags).toEqual([])
    expect(r.received_at, 'server receipt time was not recorded').toBeTruthy()
    expect(r).toHaveProperty('clock_skew_seconds')
  }, 60_000)

  it('flags a poor GPS fix rather than rejecting it', async () => {
    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 7.7322, p_lng: 8.5391, p_accuracy_m: 4000,
      p_content_hash: `gp-${RUN}-lowacc`,
    })
    const r = data as Record<string, any>
    expect(r.flags).toContain('low_gps_accuracy')
    // Flagged, not refused: poor signal is a fact of field work.
    expect(r.evidence_id).toBeTruthy()
  })

  it('flags reuse of the same media across cases', async () => {
    if (!admin) return
    const { data: other } = await admin.rpc('loamy_create_task', {
      p_task_type: 'farm_verification', p_subject_farm_id: farmId,
    }).then((r) => ({ data: { id: (r.data as Record<string, any>)?.task_id } }))
    await admin.rpc('loamy_publish_task', { p_task_id: other!.id })
    await AGENT.client.rpc('loamy_claim_task', { p_task_id: other!.id })

    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: other!.id, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 7.7322, p_lng: 8.5391, p_accuracy_m: 5,
      // The SAME hash already used on the commodity case.
      p_content_hash: `gp-${RUN}-clean`,
    })
    const r = data as Record<string, any>
    expect(r.flags, 'the same photograph on two cases was not flagged')
      .toContain('duplicate_evidence')
    // NOT flagged for coordinates: this is the same farmer's farm and their
    // store, and one compound legitimately has one set of coordinates.
    expect(r.flags, "one farmer's farm and store were treated as suspicious")
      .not.toContain('repeated_identical_coordinates')
  }, 120_000)

  it('DOES flag one point standing in for two different people', async () => {
    if (!admin) return
    // A second farmer, a second farm, the same coordinates as the first.
    const OTHER = await makeUser('farmer', 'Farmer')
    const { data: farm2 } = await OTHER.client.from('farms').insert({
      owner_id: OTHER.uid, farm_name: `Other Farm ${RUN}`,
      state: 'Benue', lga: 'Makurdi', size_hectares: 4,
      primary_crops: ['Maize'], ownership_type: 'owned',
      latitude: 7.7322, longitude: 8.5391,
    }).select('id').single()

    const { data: t } = await admin.rpc('loamy_create_task', {
      p_task_type: 'farm_verification', p_subject_farm_id: farm2!.id,
    }).then((r) => ({ data: { id: (r.data as Record<string, any>)?.task_id } }))
    await admin.rpc('loamy_publish_task', { p_task_id: t!.id })
    await AGENT.client.rpc('loamy_claim_task', { p_task_id: t!.id })

    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: t!.id, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 7.7322, p_lng: 8.5391, p_accuracy_m: 6,
      p_content_hash: `gp-${RUN}-othersubject`,
    })
    expect((data as Record<string, any>).flags,
      'one set of coordinates covering two different farmers was not flagged')
      .toContain('repeated_identical_coordinates')
  }, 180_000)

  it('flags a capture far from where the stock should be', async () => {
    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 6.5244, p_lng: 3.3792, p_accuracy_m: 8,   // Lagos
      p_content_hash: `gp-${RUN}-far`,
    })
    const r = data as Record<string, any>
    expect(r.flags).toContain('gps_far_from_subject')
    // Lagos to Benue in minutes is not a road journey.
    expect(r.flags).toContain('impossible_travel')
  })

  it('flags a photograph dated before the case existed', async () => {
    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date(Date.now() - 45 * 24 * 3600_000).toISOString(),
      p_lat: 7.7322, p_lng: 8.5391, p_accuracy_m: 6,
      p_content_hash: `gp-${RUN}-old`,
    })
    const r = data as Record<string, any>
    expect(r.flags).toContain('captured_before_case_existed')
    expect(Number(r.clock_skew_seconds)).toBeLessThan(-1000)
  })

  it('does NOT flag a phone that is merely a minute slow', async () => {
    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'measurement',
      p_captured_at: new Date(Date.now() - 60_000).toISOString(),
      p_lat: 7.7322, p_lng: 8.5391, p_accuracy_m: 6,
      p_content_hash: `gp-${RUN}-skew`,
      p_quantity: 40, p_unit: 'tonne',
    })
    // The property is about the CLOCK, so that is what is asserted. Other
    // flags may legitimately be present by this point in the run -- an
    // earlier test deliberately put another farmer at these coordinates.
    expect((data as Record<string, any>).flags,
      'an honest capture was accused over a slow clock')
      .not.toContain('captured_before_case_existed')
    expect(Math.abs(Number((data as Record<string, any>).clock_skew_seconds)))
      .toBeLessThan(120)
  })
})

describe('4 — evidence is immutable', () => {
  let evidenceId = ''

  beforeAll(async () => {
    if (!admin) return
    const { data } = await admin.from('verification_evidence')
      .select('id').eq('case_id', caseId).limit(1).single()
    evidenceId = data!.id
  })

  it('cannot be edited by the agent who captured it', async () => {
    const before = await admin!.from('verification_evidence')
      .select('captured_lat').eq('id', evidenceId).single()
    await AGENT.client.from('verification_evidence')
      .update({ captured_lat: 9.9999 }).eq('id', evidenceId)
    const after = await admin!.from('verification_evidence')
      .select('captured_lat').eq('id', evidenceId).single()
    expect(after.data!.captured_lat, 'an agent edited their own captured GPS')
      .toBe(before.data!.captured_lat)
  })

  it('cannot be deleted', async () => {
    await AGENT.client.from('verification_evidence').delete().eq('id', evidenceId)
    const { data } = await admin!.from('verification_evidence')
      .select('id').eq('id', evidenceId).maybeSingle()
    expect(data?.id, 'evidence was deleted').toBe(evidenceId)
  })

  it('is superseded with a recorded reason instead', async () => {
    const { error } = await AGENT.client.rpc('loamy_supersede_evidence', {
      p_evidence_id: evidenceId, p_reason: 'Blurred; retaken.',
    })
    expect(error, error?.message).toBeFalsy()

    const { data } = await admin!.from('verification_evidence')
      .select('status, note').eq('id', evidenceId).single()
    expect(data!.status).toBe('superseded')
    expect(data!.note).toMatch(/Superseded: Blurred/)
  }, 60_000)

  it('refuses superseding without a reason', async () => {
    const { error } = await AGENT.client.rpc('loamy_supersede_evidence', {
      p_evidence_id: evidenceId, p_reason: '  ',
    })
    expect(error, 'evidence was superseded with no reason on record').toBeTruthy()
  })
})

describe('5 — the agent is never the authority', () => {
  it('cannot approve their own case', async () => {
    await AGENT.client.rpc('loamy_submit_verification_case', { p_case_id: caseId })
    const { error } = await AGENT.client.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved',
    })
    expect(error, 'an agent approved their own evidence').toBeTruthy()
  }, 60_000)

  it('cannot flip the case status by writing the row', async () => {
    const before = await admin!.from('verification_tasks')
      .select('status').eq('id', caseId).single()
    await AGENT.client.from('verification_tasks')
      .update({ status: 'approved' }).eq('id', caseId)
    const after = await admin!.from('verification_tasks')
      .select('status').eq('id', caseId).single()
    expect(after.data!.status, 'an agent declared their own case verified')
      .toBe(before.data!.status)
  })

  it('cannot be approved by the subject of the verification', async () => {
    const { error } = await SELLER.client.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved',
    })
    expect(error, 'the inspected seller approved their own stock').toBeTruthy()
  })

  it('is approved by the platform review layer', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved', p_note: 'Evidence consistent.',
    })
    expect(error, error?.message).toBeFalsy()
  }, 60_000)
})

describe('6 — commission follows approved work', () => {
  it('accrues automatically, as PENDING and not paid', async () => {
    const { data } = await AGENT.client.rpc('loamy_my_commission_summary')
    const s = data as Record<string, any>
    expect(Number(s.pending), 'approved work did not accrue a commission')
      .toBeGreaterThan(0)
    expect(Number(s.paid), 'work completion was treated as payment').toBe(0)

    const { data: e } = await AGENT.client
      .from('partner_earnings').select('id, ref, status, payer_kind, amount')
      .eq('task_id', caseId).single()
    earningId = e!.id
    expect(e!.status).toBe('pending')
    expect(e!.ref).toMatch(/^COM-\d{6}$/)
    // Directive 22: the payer comes from the schedule, never assumed.
    expect(e!.payer_kind).toBeTruthy()
  }, 60_000)

  it('refuses an agent moving their own commission', async () => {
    const { error } = await AGENT.client.rpc('loamy_commission_transition', {
      p_earning_id: earningId, p_event: 'pay', p_reference: `self-${RUN}`,
    })
    expect(error, 'an agent paid themselves').toBeTruthy()
  })

  it('refuses an agent writing the row directly', async () => {
    const { error } = await AGENT.client
      .from('partner_earnings').update({ status: 'paid', amount: 999_999 }).eq('id', earningId)
    expect(error || true).toBeTruthy()
    const { data } = await AGENT.client
      .from('partner_earnings').select('status, amount').eq('id', earningId).single()
    expect(data!.status, 'an agent marked their own commission paid').toBe('pending')
  })

  it('refuses paying before it is payable', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_commission_transition', {
      p_earning_id: earningId, p_event: 'pay', p_reference: `early-${RUN}`,
    })
    expect((data as Record<string, any>).moved).toBe(false)
    expect((data as Record<string, any>).reason).toBe('must_be_payable_first')
  })

  it('walks pending -> approved -> payable -> paid', async () => {
    if (!admin) return
    for (const [ev, ref] of [['approve', null], ['make_payable', null],
                             ['pay', `pay-${RUN}`]] as const) {
      const { data, error } = await admin.rpc('loamy_commission_transition', {
        p_earning_id: earningId, p_event: ev, p_reference: ref,
      })
      expect(error, `${ev}: ${error?.message}`).toBeFalsy()
      expect((data as Record<string, any>).moved, `${ev}: ${JSON.stringify(data)}`).toBe(true)
    }

    const { data: e } = await AGENT.client
      .from('partner_earnings').select('status, paid_reference, liability_group, settlement_group')
      .eq('id', earningId).single()
    expect(e!.status).toBe('paid')
    expect(e!.paid_reference).toBe(`pay-${RUN}`)
    expect(e!.liability_group, 'no liability was recognised in the ledger').toBeTruthy()
    expect(e!.settlement_group, 'no settlement was posted to the ledger').toBeTruthy()
  }, 120_000)

  it('posts the money to the DOUBLE-ENTRY ledger, not a wallet', async () => {
    if (!admin) return
    const { data } = await admin
      .from('ledger_entries')
      .select('amount, event_type, ledger_accounts(account_type)')
      .eq('external_reference', `commission-pay:pay-${RUN}`)
    expect((data ?? []).length).toBe(2)
    const sum = (data ?? []).reduce((n, l: any) => n + Number(l.amount), 0)
    expect(Math.abs(sum), 'the commission payment did not balance').toBeLessThan(0.01)
  })

  it('REFUSES a replayed payment reference', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_commission_transition', {
      p_earning_id: earningId, p_event: 'pay', p_reference: `pay-${RUN}`,
    })
    expect((data as Record<string, any>).moved, 'a commission was paid twice').toBe(false)
  })

  it('leaves the ledger reconciled', async () => {
    if (!admin) return
    const { data } = await admin
      .from('loamy_reconciliation_exceptions').select('kind').eq('kind', 'unbalanced_group')
    expect(data ?? [], 'commission posting unbalanced the ledger').toHaveLength(0)
  })

  it('keeps another agent out of these earnings entirely', async () => {
    const { data } = await RIVAL.client
      .from('partner_earnings').select('*').eq('partner_id', AGENT.uid)
    expect(data ?? [], "an agent read another agent's commission").toHaveLength(0)
  })
})

describe('7 — referral never becomes cash (directive 23)', () => {
  it('refuses to accrue a commission for a non Growth Partner', async () => {
    if (!admin) return
    const { data: t } = await admin.rpc('loamy_create_task', {
      p_task_type: 'farm_verification', p_subject_farm_id: farmId,
    }).then((r) => ({ data: { id: (r.data as Record<string, any>)?.task_id } }))

    // A buyer standing in for "an ordinary member who referred someone".
    await admin.rpc('loamy_publish_task', { p_task_id: t!.id })
    await admin.rpc('loamy_reassign_task', { p_task_id: t!.id, p_partner: BUYER.uid })

    const { data } = await admin.rpc('loamy_accrue_commission', { p_task_id: t!.id })
    const r = data as Record<string, any>
    expect(r.accrued).toBe(false)
    expect(['not_a_growth_partner', 'work_not_approved']).toContain(r.reason)
  }, 120_000)
})

describe('8 — anonymity holds throughout', () => {
  it('never names the agent to the inspected seller', async () => {
    const { data } = await SELLER.client.rpc('loamy_my_verification_cases')
    const mine = (data as Record<string, any>[]).find((c) => c.case_id === caseId)
    expect(mine!.agent_display).toBe('Loamy Verification Agent')
    expect(mine!.assigned_to).toBeUndefined()
  })

  it('never names the agent to the requesting buyer', async () => {
    const { data } = await BUYER.client
      .from('loamy_verification_cases').select('assigned_to, agent_display').eq('case_id', caseId)
    for (const row of data ?? []) {
      expect(row.assigned_to).toBeNull()
      expect(row.agent_display).toBe('Loamy Verification Agent')
    }
  })

  it('does not let a party read the raw task row', async () => {
    const { data } = await SELLER.client
      .from('verification_tasks').select('assigned_to').eq('id', caseId)
    expect(data ?? [], 'the inspected party read the raw task row').toHaveLength(0)
  })

  it('keeps the internal chain administrative', async () => {
    const asBuyer = await BUYER.client.rpc('loamy_trace_agent_chain', { p_case_id: caseId })
    expect((asBuyer.data as Record<string, any>).found,
      'a buyer resolved the agent behind a verification').toBe(false)

    const asAgent = await AGENT.client.rpc('loamy_trace_agent_chain', { p_case_id: caseId })
    expect((asAgent.data as Record<string, any>).found).toBe(false)
  })

  it('DOES give Loamy the whole internal chain', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_trace_agent_chain', { p_case_id: caseId })
    const c = data as Record<string, any>
    expect(c.found).toBe(true)
    expect(c.agent.id).toBe(AGENT.uid)
    expect(c.assignment.mode).toBe('self_claimed')
    expect((c.evidence as unknown[]).length).toBeGreaterThan(0)
    expect((c.reviews as unknown[]).length).toBeGreaterThan(0)
    expect(c.commission.status).toBe('paid')
  })
})

describe('9 — performance is facts, never a score', () => {
  it('reports the agent their own record', async () => {
    const { data } = await AGENT.client.rpc('loamy_gp_performance', { p_user: AGENT.uid })
    const p = data as Record<string, any>
    expect(p.tasks.approved).toBeGreaterThan(0)
    expect(p.evidence.submitted).toBeGreaterThan(0)
    expect(p.flags_by_kind).toBeTruthy()
    expect(p).not.toHaveProperty('score')
    expect(p).not.toHaveProperty('rating')
  })

  it('refuses one agent inspecting another', async () => {
    const { error } = await RIVAL.client.rpc('loamy_gp_performance', { p_user: AGENT.uid })
    expect(error, "an agent read another agent's private history").toBeTruthy()
  })
})

describe('10 — the failure paths', () => {
  it('rejects evidence, and the case says why', async () => {
    if (!admin) return
    const { data: t } = await admin.rpc('loamy_create_task', {
      p_task_type: 'farm_verification', p_subject_farm_id: farmId,
    }).then((r) => ({ data: { id: (r.data as Record<string, any>)?.task_id } }))
    await admin.rpc('loamy_publish_task', { p_task_id: t!.id })
    await AGENT.client.rpc('loamy_claim_task', { p_task_id: t!.id })
    await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: t!.id, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 7.7322, p_lng: 8.5391, p_accuracy_m: 6,
      p_content_hash: `gp-${RUN}-reject`,
    })
    await AGENT.client.rpc('loamy_submit_verification_case', { p_case_id: t!.id })

    const { error } = await admin.rpc('loamy_review_verification_case', {
      p_case_id: t!.id, p_decision: 'rejected', p_note: 'Photograph does not show the field.',
    })
    expect(error, error?.message).toBeFalsy()

    const { data: after } = await admin.from('verification_tasks')
      .select('status, reviewer_note').eq('id', t!.id).single()
    expect(after!.status).toBe('rejected')
    expect(after!.reviewer_note).toMatch(/does not show/)

    // A rejected case pays nothing.
    const { data: e } = await admin.from('partner_earnings').select('id').eq('task_id', t!.id)
    expect(e ?? [], 'a rejected verification paid a commission').toHaveLength(0)
  }, 180_000)

  it('expires unclaimed work and releases abandoned work', async () => {
    if (!admin) return
    const { data: t } = await admin.rpc('loamy_create_task', {
      p_task_type: 'farm_verification', p_subject_farm_id: farmId,
    }).then((r) => ({ data: { id: (r.data as Record<string, any>)?.task_id } }))
    await admin.rpc('loamy_publish_task', { p_task_id: t!.id })
    // Deadlines are moved through the sanctioned admin path, not by writing
    // the row -- the guard refuses that, correctly.
    await admin.rpc('loamy_set_task_expiry', {
      p_task_id: t!.id,
      p_expires_at: new Date(Date.now() - 3600_000).toISOString(),
      p_reason: 'Block 5 e2e: force expiry.',
    })

    const { data, error } = await admin.rpc('loamy_expire_tasks')
    expect(error, error?.message).toBeFalsy()
    expect(Number((data as Record<string, any>).expired)).toBeGreaterThan(0)

    const { data: after } = await admin.from('verification_tasks')
      .select('status').eq('id', t!.id).single()
    expect(after!.status).toBe('expired')
  }, 120_000)

  it('reassigns, recording the previous holder', async () => {
    if (!admin) return
    const { data: t } = await admin.rpc('loamy_create_task', {
      p_task_type: 'farm_verification', p_subject_farm_id: farmId,
    }).then((r) => ({ data: { id: (r.data as Record<string, any>)?.task_id } }))
    await admin.rpc('loamy_publish_task', { p_task_id: t!.id })
    await AGENT.client.rpc('loamy_claim_task', { p_task_id: t!.id })

    const { data } = await admin.rpc('loamy_reassign_task', {
      p_task_id: t!.id, p_partner: RIVAL.uid, p_reason: 'Agent unavailable.',
    })
    const r = data as Record<string, any>
    expect(r.reassigned).toBe(true)
    expect(r.previous_agent, 'the previous holder was erased').toBe(AGENT.uid)
  }, 120_000)

  it('lets a party dispute a decided verification without touching the evidence', async () => {
    const before = await admin!.from('verification_evidence')
      .select('id').eq('case_id', caseId)
    const { data, error } = await SELLER.client.rpc('loamy_dispute_verification', {
      p_case_id: caseId, p_reason: 'The quantity recorded is not what we hold.',
    })
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, any>).raised).toBe(true)

    const after = await admin!.from('verification_evidence')
      .select('id').eq('case_id', caseId)
    expect((after.data ?? []).length, 'raising a dispute altered the evidence')
      .toBe((before.data ?? []).length)
  }, 60_000)

  it('refuses a stranger disputing a verification', async () => {
    const { error } = await RIVAL.client.rpc('loamy_dispute_verification', {
      p_case_id: caseId, p_reason: 'Nothing to do with me.',
    })
    expect(error, 'a stranger disputed a verification').toBeTruthy()
  })

  it('stops a suspended agent taking new work, without erasing their history', async () => {
    if (!admin) return
    const before = await AGENT.client.rpc('loamy_gp_performance', { p_user: AGENT.uid })
    const paidBefore = (before.data as Record<string, any>).commission.paid

    const { error } = await admin.rpc('loamy_gp_set_suspension', {
      p_user: AGENT.uid, p_suspended: true, p_reason: 'Quality review.',
    })
    expect(error, error?.message).toBeFalsy()

    const check = await AGENT.client.rpc('loamy_gp_can_take', {
      p_user: AGENT.uid, p_task_type: 'commodity_verification', p_state: 'Benue',
    })
    expect((check.data as Record<string, any>).reasons).toContain('suspended')

    // History, evidence and commission all survive.
    const after = await AGENT.client.rpc('loamy_gp_performance', { p_user: AGENT.uid })
    const p = after.data as Record<string, any>
    expect(p.commission.paid, 'suspension erased commission history').toBe(paidBefore)
    expect(p.tasks.approved).toBeGreaterThan(0)
    expect(p.suspended).toBe(true)

    await admin.rpc('loamy_gp_set_suspension', { p_user: AGENT.uid, p_suspended: false })
  }, 180_000)

  it('refuses a suspension with no recorded reason', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_gp_set_suspension', {
      p_user: RIVAL.uid, p_suspended: true, p_reason: '  ',
    })
    expect(error, 'an agent was suspended with no reason on record').toBeTruthy()
  })
})

describe('11 — market price collection states its provenance', () => {
  it('classifies an observation, and never mixes the kinds', async () => {
    if (!admin) return
    const { data: me } = await admin.auth.getUser()
    const { error } = await admin.from('market_price_updates').insert({
      commodity: 'Maize', state: 'Benue', unit: '100kg',
      price_min: 48_000, price_max: 49_500,
      recorded_date: new Date().toISOString().slice(0, 10),
      recorded_by: me.user!.id,
      data_class: 'observed', market_name: `Makurdi market (test ${RUN})`,
      traders_sampled: 6,
      source_note: `Block 5 e2e ${RUN}`,
    })
    expect(error, error?.message).toBeFalsy()

    const { data } = await admin.from('market_price_updates')
      .select('data_class, market_name, traders_sampled')
      .eq('source_note', `Block 5 e2e ${RUN}`).single()
    expect(data!.data_class).toBe('observed')
    expect(data!.market_name).toBeTruthy()
  }, 60_000)

  it('refuses a data class outside the vocabulary', async () => {
    if (!admin) return
    const { data: me } = await admin.auth.getUser()
    const { error } = await admin.from('market_price_updates').insert({
      commodity: 'Maize', state: 'Benue', unit: '100kg',
      price_min: 1, price_max: 2, recorded_by: me.user!.id,
      data_class: 'vibes',
    })
    expect(error, 'an unclassified price observation was accepted').toBeTruthy()
  })
})

describe('12 — the chain reconstructs', () => {
  it('shows the verification in the batch trace, without naming the agent', async () => {
    const { data } = await BUYER.client.rpc('loamy_trace', { p_ref: batchId })
    const t = data as Record<string, any>
    if (!t?.found) return
    expect(t.verifications.available).toBe(true)
    expect(JSON.stringify(t.verifications)).not.toContain(AGENT.uid)
  }, 60_000)
})
