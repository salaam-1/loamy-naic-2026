import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * BLOCK 5 — the sixteen refusals directive 35 asks for, each as its own test.
 *
 * Several assert by OUTCOME rather than by error. With no UPDATE policy,
 * PostgREST matches zero rows and reports success; "an error was raised"
 * would be testing the wrong thing. The value staying put is the property.
 */

let AGENT: TestUser
let RIVAL: TestUser
let SUBJECT: TestUser
let BUYER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
let farmId = ''
let caseId = ''
let evidenceId = ''
let earningId = ''
let rivalCaseId = ''

beforeAll(async () => {
  AGENT = await makeUser('growth_partner', 'Growth Partner')
  RIVAL = await makeUser('growth_partner', 'Growth Partner')
  SUBJECT = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('trader', 'Trader')
  admin = await adminClient()
  if (!admin) return

  const { data: farm } = await SUBJECT.client.from('farms').insert({
    owner_id: SUBJECT.uid, farm_name: `Sec Farm ${RUN}`,
    state: 'Kaduna', lga: 'Zaria', size_hectares: 8,
    primary_crops: ['Maize'], ownership_type: 'owned',
    latitude: 11.0855, longitude: 7.7199,
  }).select('id').single()
  farmId = farm!.id

  for (const u of [AGENT, RIVAL]) {
    await admin.rpc('loamy_set_can_verify', { p_user: u.uid, p_value: true })
    await admin.from('partner_assignments').insert({
      partner_id: u.uid, state: 'Kaduna', lgas: [], active: true,
    })
    await admin.rpc('loamy_gp_set_training', {
      p_user: u.uid, p_status: 'trained', p_cleared_types: ['farm_verification'],
    })
  }

  // The agent's case.
  const { data: t1 } = await admin.rpc('loamy_create_task', {
    p_task_type: 'farm_verification', p_subject_farm_id: farmId,
  })
  caseId = (t1 as Record<string, any>).task_id
  await admin.rpc('loamy_publish_task', { p_task_id: caseId })
  await AGENT.client.rpc('loamy_claim_task', { p_task_id: caseId })
  await AGENT.client.rpc('loamy_accept_task', { p_task_id: caseId })

  const { data: ev } = await AGENT.client.rpc('loamy_submit_evidence', {
    p_case_id: caseId, p_evidence_type: 'photo',
    p_captured_at: new Date().toISOString(),
    p_lat: 11.0855, p_lng: 7.7199, p_accuracy_m: 6,
    p_content_hash: `sec-${RUN}-a`,
  })
  evidenceId = (ev as Record<string, any>).evidence_id

  // A second case held by the rival, used for cross-agent tests.
  const { data: t2 } = await admin.rpc('loamy_create_task', {
    p_task_type: 'farm_verification', p_subject_farm_id: farmId,
  })
  rivalCaseId = (t2 as Record<string, any>).task_id
  await admin.rpc('loamy_publish_task', { p_task_id: rivalCaseId })
  await RIVAL.client.rpc('loamy_claim_task', { p_task_id: rivalCaseId })
}, 300_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('an agent cannot reach another agent', () => {
  it('cannot read another agent\'s tasks through their own board', async () => {
    const { data } = await AGENT.client.rpc('loamy_my_tasks')
    const ids = ((data as Record<string, any>).items as Record<string, any>[])
      .map((t) => t.task_id)
    expect(ids, "an agent saw another agent's case").not.toContain(rivalCaseId)
  })

  it('cannot read another agent\'s operational record', async () => {
    const { data } = await AGENT.client
      .from('growth_partner_operations').select('*').eq('user_id', RIVAL.uid)
    expect(data ?? []).toHaveLength(0)
  })

  it('cannot read another agent\'s performance history', async () => {
    const { error } = await AGENT.client.rpc('loamy_gp_performance', { p_user: RIVAL.uid })
    expect(error, "an agent inspected another agent's history").toBeTruthy()
  })

  it('cannot read another agent\'s commission', async () => {
    const { data } = await AGENT.client
      .from('partner_earnings').select('*').eq('partner_id', RIVAL.uid)
    expect(data ?? []).toHaveLength(0)
  })

  it('cannot submit evidence on a case held by someone else', async () => {
    const { error } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: rivalCaseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(), p_lat: 11.08, p_lng: 7.71,
    })
    expect(error, "an agent filed evidence on another agent's case").toBeTruthy()
  })

  it('cannot answer a checklist on a case held by someone else', async () => {
    const { error } = await AGENT.client.rpc('loamy_submit_checklist', {
      p_case_id: rivalCaseId, p_answers: { identity_confirmed: true },
    })
    expect(error).toBeTruthy()
  })
})

describe('an agent cannot rewrite the work', () => {
  it('cannot change assigned_to', async () => {
    const before = await admin!.from('verification_tasks')
      .select('assigned_to').eq('id', caseId).single()
    await AGENT.client.from('verification_tasks')
      .update({ assigned_to: RIVAL.uid }).eq('id', caseId)
    const after = await admin!.from('verification_tasks')
      .select('assigned_to').eq('id', caseId).single()
    expect(after.data!.assigned_to).toBe(before.data!.assigned_to)
  })

  it('cannot set their own case to approved', async () => {
    await AGENT.client.from('verification_tasks')
      .update({ status: 'approved' }).eq('id', caseId)
    const { data } = await admin!.from('verification_tasks')
      .select('status').eq('id', caseId).single()
    expect(data!.status, 'an agent approved their own case').not.toBe('approved')
  })

  it('cannot alter submitted evidence', async () => {
    const before = await admin!.from('verification_evidence')
      .select('captured_lat, content_hash').eq('id', evidenceId).single()
    await AGENT.client.from('verification_evidence')
      .update({ captured_lat: 1.111, content_hash: 'rewritten' }).eq('id', evidenceId)
    const after = await admin!.from('verification_evidence')
      .select('captured_lat, content_hash').eq('id', evidenceId).single()
    expect(after.data!.captured_lat).toBe(before.data!.captured_lat)
    expect(after.data!.content_hash).toBe(before.data!.content_hash)
  })

  it('cannot delete evidence', async () => {
    await AGENT.client.from('verification_evidence').delete().eq('id', evidenceId)
    const { data } = await admin!.from('verification_evidence')
      .select('id').eq('id', evidenceId).maybeSingle()
    expect(data?.id, 'evidence was deleted').toBe(evidenceId)
  })

  it('cannot clear a fraud flag on their own case', async () => {
    if (!admin) return
    // Put a flag there first, through the ordinary path.
    const put = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 6.5244, p_lng: 3.3792, p_accuracy_m: 9,
      p_content_hash: `sec-${RUN}-flagged`,
    })
    expect(put.error, `could not plant a flag: ${put.error?.message}`).toBeFalsy()
    expect((put.data as Record<string, any>).flags,
      `a Lagos capture on a Kaduna farm was not flagged: ${JSON.stringify(put.data)}`)
      .toContain('gps_far_from_subject')

    const before = await admin.from('verification_tasks')
      .select('flags').eq('id', caseId).single()
    expect((before.data!.flags as string[]).length).toBeGreaterThan(0)

    await AGENT.client.from('verification_tasks').update({ flags: [] }).eq('id', caseId)
    const after = await admin.from('verification_tasks')
      .select('flags').eq('id', caseId).single()
    expect((after.data!.flags as string[]).length,
      'an agent cleared the flags on their own work').toBeGreaterThan(0)
  }, 60_000)
})

describe('an agent cannot become the authority', () => {
  it('cannot approve their own evidence', async () => {
    await AGENT.client.rpc('loamy_submit_verification_case', { p_case_id: caseId })
    const { error } = await AGENT.client.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved',
    })
    expect(error, 'an agent approved their own evidence').toBeTruthy()
  }, 60_000)

  it('cannot approve ANOTHER agent\'s evidence either — review is admin-only', async () => {
    const { error } = await RIVAL.client.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved',
    })
    expect(error, 'an agent reviewed a case').toBeTruthy()
  })

  it('cannot create a task for themselves', async () => {
    const { error } = await AGENT.client.rpc('loamy_create_task', {
      p_task_type: 'farm_verification', p_subject_farm_id: farmId,
    })
    expect(error, 'an agent created their own work').toBeTruthy()
  })

  it('cannot publish a task to the field', async () => {
    const { error } = await AGENT.client.rpc('loamy_publish_task', { p_task_id: caseId })
    expect(error).toBeTruthy()
  })

  it('cannot reassign work to themselves', async () => {
    const { error } = await AGENT.client.rpc('loamy_reassign_task', {
      p_task_id: rivalCaseId, p_partner: AGENT.uid,
    })
    expect(error, 'an agent took a task off a colleague').toBeTruthy()
  })

  it('cannot move a deadline', async () => {
    const { error } = await AGENT.client.rpc('loamy_set_task_expiry', {
      p_task_id: caseId, p_expires_at: new Date(Date.now() + 9e8).toISOString(),
    })
    expect(error).toBeTruthy()
  })

  it('cannot see the candidate list for any task', async () => {
    const { error } = await AGENT.client.rpc('loamy_assignment_candidates', { p_task_id: caseId })
    expect(error).toBeTruthy()
  })

  it('cannot expire tasks', async () => {
    const { error } = await AGENT.client.rpc('loamy_expire_tasks')
    expect(error).toBeTruthy()
  })
})

describe('an agent cannot touch money', () => {
  beforeAll(async () => {
    if (!admin) return
    await admin.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved', p_note: 'Accepted for the security suite.',
    })
    const { data } = await admin.from('partner_earnings')
      .select('id').eq('task_id', caseId).maybeSingle()
    earningId = data?.id ?? ''
  }, 120_000)

  it('cannot move their own commission through the lifecycle', async () => {
    // Asserted, not skipped: without an earning these three negative
    // authorisation tests would pass without exercising anything, and the
    // accrual depends on a fee rule that has been ended by accident before.
    expect(earningId, 'no commission was accrued in setup, so this asserts nothing').toBeTruthy()
    for (const ev of ['approve', 'make_payable', 'pay']) {
      const { error } = await AGENT.client.rpc('loamy_commission_transition', {
        p_earning_id: earningId, p_event: ev, p_reference: `hack-${RUN}`,
      })
      expect(error, `an agent performed ${ev} on their own commission`).toBeTruthy()
    }
  })

  it('cannot mark their own commission paid by writing the row', async () => {
    // Asserted, not skipped: without an earning these three negative
    // authorisation tests would pass without exercising anything, and the
    // accrual depends on a fee rule that has been ended by accident before.
    expect(earningId, 'no commission was accrued in setup, so this asserts nothing').toBeTruthy()
    await AGENT.client.from('partner_earnings')
      .update({ status: 'paid', amount: 5_000_000 }).eq('id', earningId)
    const { data } = await AGENT.client.from('partner_earnings')
      .select('status, amount').eq('id', earningId).single()
    expect(data!.status).not.toBe('paid')
    expect(Number(data!.amount)).toBeLessThan(5_000_000)
  })

  it('cannot invent a commission row', async () => {
    const { error } = await AGENT.client.from('partner_earnings').insert({
      partner_id: AGENT.uid, earning_type: 'verification',
      reference_id: caseId, amount: 999_999, status: 'payable',
    })
    expect(error, 'an agent created their own commission').toBeTruthy()
  })

  it('cannot delete commission history', async () => {
    // Asserted, not skipped: without an earning these three negative
    // authorisation tests would pass without exercising anything, and the
    // accrual depends on a fee rule that has been ended by accident before.
    expect(earningId, 'no commission was accrued in setup, so this asserts nothing').toBeTruthy()
    await AGENT.client.from('partner_earnings').delete().eq('id', earningId)
    const { data } = await admin!.from('partner_earnings')
      .select('id').eq('id', earningId).maybeSingle()
    expect(data?.id, 'commission history was deleted').toBe(earningId)
  })

  it('cannot post to the ledger directly', async () => {
    const { error } = await AGENT.client.rpc('loamy_post_ledger', {
      p_event_type: 'payout', p_lines: [],
    })
    expect(error, 'a member reached loamy_post_ledger').toBeTruthy()
  })
})

describe('an agent cannot reach the wider platform', () => {
  it('cannot read transactions they are not party to', async () => {
    const { data } = await AGENT.client.from('transactions').select('id').limit(5)
    expect(data ?? [], 'an agent browsed the transaction table').toHaveLength(0)
  })

  it('cannot read the buyer behind a verification they performed', async () => {
    const { data } = await AGENT.client
      .from('verification_tasks').select('requested_by, subject_user_id').eq('id', caseId)
    expect(data ?? [], 'an agent resolved the parties from the raw task row').toHaveLength(0)
  })

  it('cannot read another member\'s private farm detail', async () => {
    const { data } = await RIVAL.client.from('farms').select('*').eq('id', farmId)
    expect(data ?? [], "an unassigned agent read a farmer's private farm").toHaveLength(0)
  })

  it('cannot read another member\'s discovery behaviour', async () => {
    const { data } = await AGENT.client
      .from('discovery_events').select('*').eq('actor_id', BUYER.uid)
    expect(data ?? []).toHaveLength(0)
  })

  it('cannot expose their own identity through the case view', async () => {
    const { data } = await BUYER.client
      .from('loamy_verification_cases').select('assigned_to, agent_display').eq('case_id', caseId)
    for (const row of data ?? []) {
      expect(row.assigned_to).toBeNull()
      expect(row.agent_display).toBe('Loamy Verification Agent')
    }
  })

  it('shows signed-out visitors none of it', async () => {
    const anon = anonClient()
    for (const t of ['growth_partner_operations', 'partner_earnings',
                     'verification_evidence', 'verification_tasks']) {
      const { data, error } = await anon.from(t).select('*').limit(1)
      expect(error || (data ?? []).length === 0, `${t} is readable signed out`).toBeTruthy()
    }
  })
})

describe('a suspended agent is stopped, not erased', () => {
  it('cannot claim new work', async () => {
    if (!admin) return
    await admin.rpc('loamy_gp_set_suspension', {
      p_user: RIVAL.uid, p_suspended: true, p_reason: 'Security suite.',
    })

    const { data: t } = await admin.rpc('loamy_create_task', {
      p_task_type: 'farm_verification', p_subject_farm_id: farmId,
    })
    const newCase = (t as Record<string, any>).task_id
    await admin.rpc('loamy_publish_task', { p_task_id: newCase })

    const { data } = await RIVAL.client.rpc('loamy_claim_task', { p_task_id: newCase })
    const r = data as Record<string, any>
    expect(r.claimed).toBe(false)
    expect(r.reasons).toContain('suspended')
  }, 120_000)

  it('keeps their history and evidence intact', async () => {
    const { data } = await RIVAL.client.rpc('loamy_gp_performance', { p_user: RIVAL.uid })
    const p = data as Record<string, any>
    expect(p.suspended).toBe(true)
    expect(p.tasks.total, 'suspension erased the task history').toBeGreaterThan(0)

    if (admin) {
      await admin.rpc('loamy_gp_set_suspension', { p_user: RIVAL.uid, p_suspended: false })
    }
  }, 60_000)
})
