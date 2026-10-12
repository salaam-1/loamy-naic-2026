import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Phase 3: verification engine.
 *
 * The property the whole design exists to guarantee:
 *
 *     an agent collects evidence; the platform decides.
 *
 * Everything else here is supporting detail. If a Growth Partner can produce
 * an approved verification on their own, the feature is worse than useless —
 * it launders unverified stock as verified.
 */

let FARMER: TestUser
let AGENT: TestUser
let OUTSIDER: TestUser
let admin: SupabaseClient | null
let farmId: string
let caseId: string

// Makurdi-ish, used as the expected subject location.
const LAT = 7.7322
const LNG = 8.5391

// Content hashes must be unique PER RUN. The duplicate-evidence check looks
// across every case ever recorded, so a fixed literal would (correctly) be
// flagged as re-used the second time this suite is run against the same
// project -- which is exactly the behaviour the check exists for.
const RUN = Date.now().toString(36)
const hash = (name: string) => `h-${RUN}-${name}`

beforeAll(async () => {
  FARMER = await makeUser('farmer', 'Farmer')
  AGENT = await makeUser('growth_partner', 'Growth Partner')
  OUTSIDER = await makeUser('trader', 'Trader')
  admin = await adminClient()

  const { data: farm } = await FARMER.client.from('farms').insert({
    owner_id: FARMER.uid, farm_name: 'Phase3 Farm', state: 'Benue', lga: 'Makurdi',
    size_hectares: 5, primary_crops: ['Maize'], ownership_type: 'owned',
    latitude: LAT, longitude: LNG,
  }).select('id').single()
  farmId = farm!.id

  // Cases are created by the guarded RPC, not by a direct insert -- there is
  // no client INSERT policy on verification_tasks, which is itself correct.
  const { error: reqErr } = await FARMER.client
    .rpc('loamy_request_farm_verification_guarded', { p_farm_id: farmId })
  if (reqErr) throw new Error('request verification: ' + reqErr.message)

  // The RPC returns void, and the farmer cannot read verification_tasks (their
  // surface is the status-only view) -- which is correct, so look it up as admin.
  if (!admin) throw new Error('admin-explore account unavailable; Phase 3 suite needs it')
  {
    const { data: found } = await admin
      .from('verification_tasks').select('id').eq('subject_farm_id', farmId).maybeSingle()
    if (!found) throw new Error('verification case was not created')
    caseId = found.id
  }

  {
    // loamy_assign_verification_task requires the partner to hold can_verify,
    // which since the Phase 0 hardening is admin-granted only. Granting it
    // here through the real path is itself a check that the path works.
    const grant = await admin.rpc('loamy_set_can_verify', { p_user: AGENT.uid, p_value: true })
    if (grant.error) throw new Error('grant can_verify: ' + grant.error.message)

    const assign = await admin.rpc('loamy_assign_verification_task', { p_task: caseId, p_partner: AGENT.uid })
    if (assign.error) throw new Error('assign: ' + assign.error.message)
    // No expected_lat/lng is set by hand: it is DERIVED from the subject farm's
    // coordinates by loamy_case_expected_point, so the GPS check cannot be
    // silently skipped by forgetting a setup step.
  }
}, 240_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('case identity and shape', () => {
  it('assigns a VER reference to the case', async () => {
    if (!admin) return expect(admin, 'admin account unavailable — skipped').toBeNull()
    const { data } = await admin.from('verification_tasks').select('ref').eq('id', caseId).single()
    expect(data!.ref).toMatch(/^VER-\d{6}$/)
  })

  it('exposes the case through the directive-named view', async () => {
    if (!admin) return
    const { data } = await admin.from('loamy_verification_cases')
      .select('case_ref, verification_type, subject_type, evidence_count')
      .eq('case_id', caseId).maybeSingle()
    expect(data?.verification_type).toBe('farm_verification')
    expect(data?.subject_type).toBe('farm')
  })
})

describe('only the assigned agent may submit evidence', () => {
  it('refuses an unassigned member', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(), p_lat: LAT, p_lng: LNG,
    })
    expect(error, 'a stranger submitted evidence').toBeTruthy()
  })

  it('refuses the subject of the verification', async () => {
    const { error } = await FARMER.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(), p_lat: LAT, p_lng: LNG,
    })
    expect(error, 'the farmer submitted evidence about their own farm').toBeTruthy()
  })

  it('accepts a clean capture from the assigned agent, unflagged', async () => {
    const { data, error } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: LAT, p_lng: LNG, p_accuracy_m: 8,
      p_storage_path: `${caseId}/photo-1.jpg`, p_content_hash: hash('clean-1'),
      p_note: 'Maize standing, good condition',
    })
    expect(error, error?.message).toBeFalsy()
    expect((data as { flags: string[] }).flags).toEqual([])
  })

  it('tolerates a field phone whose clock is a little slow', async () => {
    // captured_at comes from the agent's device; created_at comes from
    // Postgres. A minute of skew is a bad clock, not a backdated photograph.
    const { data, error } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date(Date.now() - 60_000).toISOString(),
      p_lat: LAT, p_lng: LNG, p_accuracy_m: 8,
      p_content_hash: hash('skew-slow-1'),
    })
    expect(error, error?.message).toBeFalsy()
    expect((data as { flags: string[] }).flags,
      'an honest capture was accused of predating its own case').toEqual([])
  })

  it('still flags a capture that genuinely predates the case', async () => {
    // A photograph from last season is hours or days out, not seconds.
    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date(Date.now() - 30 * 24 * 3600_000).toISOString(),
      p_lat: LAT, p_lng: LNG, p_accuracy_m: 8,
      p_content_hash: hash('skew-old-1'),
    })
    expect((data as { flags: string[] }).flags).toContain('captured_before_case_existed')
  })
})

describe('anti-fraud checks flag rather than silently accept', () => {
  it('flags a capture far from the subject location', async () => {
    // Lagos, ~500km from the farm.
    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: 6.5244, p_lng: 3.3792, p_accuracy_m: 10,
      p_content_hash: hash('far-1'),
    })
    const res = data as { flags: string[]; distance_m: number }
    expect(res.flags).toContain('gps_far_from_subject')
    expect(Number(res.distance_m)).toBeGreaterThan(100_000)
  })

  it('flags a missing GPS fix on a photo', async () => {
    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(), p_content_hash: hash('nogps-1'),
    })
    expect((data as { flags: string[] }).flags).toContain('no_gps')
  })

  it('flags a coarse GPS fix', async () => {
    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: LAT, p_lng: LNG, p_accuracy_m: 5000, p_content_hash: hash('coarse-1'),
    })
    expect((data as { flags: string[] }).flags).toContain('low_gps_accuracy')
  })

  it('flags a timestamp in the future', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: caseId, p_evidence_type: 'photo', p_captured_at: tomorrow,
      p_lat: LAT, p_lng: LNG, p_accuracy_m: 8, p_content_hash: hash('future-1'),
    })
    expect((data as { flags: string[] }).flags).toContain('future_timestamp')
  })

  it('flags evidence re-used from another case', async () => {
    if (!admin) return
    const { data: farm2 } = await FARMER.client.from('farms').insert({
      owner_id: FARMER.uid, farm_name: 'Phase3 Farm B', state: 'Benue', lga: 'Gboko',
      size_hectares: 3, primary_crops: ['Rice'], ownership_type: 'owned',
      latitude: LAT, longitude: LNG,
    }).select('id').single()
    await FARMER.client.rpc('loamy_request_farm_verification_guarded', { p_farm_id: farm2!.id })
    const { data: other } = await admin
      .from('verification_tasks').select('id').eq('subject_farm_id', farm2!.id).maybeSingle()
    const asn = await admin.rpc('loamy_assign_verification_task', { p_task: other!.id, p_partner: AGENT.uid })
    expect(asn.error, asn.error?.message).toBeFalsy()

    const { data } = await AGENT.client.rpc('loamy_submit_evidence', {
      p_case_id: other!.id, p_evidence_type: 'photo',
      p_captured_at: new Date().toISOString(),
      p_lat: LAT, p_lng: LNG, p_accuracy_m: 8,
      p_content_hash: hash('clean-1'),   // already used on the first case
    })
    expect((data as { flags: string[] }).flags).toContain('duplicate_evidence')
  }, 60_000)

  it('bubbles flags onto the case so a reviewer cannot miss them', async () => {
    if (!admin) return
    const { data } = await admin.from('verification_tasks').select('flags').eq('id', caseId).single()
    expect(data!.flags.length).toBeGreaterThan(0)
    expect(data!.flags).toContain('gps_far_from_subject')
  })
})

describe('evidence cannot be forged or detached', () => {
  it('has no client insert path', async () => {
    const { error } = await AGENT.client.from('verification_evidence').insert({
      case_id: caseId, evidence_type: 'photo',
      captured_by: AGENT.uid, captured_at: new Date().toISOString(),
    })
    expect(error, 'evidence was inserted directly, bypassing the fraud checks').toBeTruthy()
  })

  it('cannot be edited or deleted by the agent who made it', async () => {
    const { data: rows } = await AGENT.client
      .from('verification_evidence').select('id, flags').eq('case_id', caseId).limit(1)
    const id = rows?.[0]?.id
    expect(id).toBeTruthy()

    await AGENT.client.from('verification_evidence').update({ flags: [] }).eq('id', id)
    await AGENT.client.from('verification_evidence').delete().eq('id', id)

    const { data: still } = await AGENT.client
      .from('verification_evidence').select('id').eq('id', id).maybeSingle()
    expect(still, 'an agent deleted their own evidence').toBeTruthy()
  })

  it('is invisible to the subject being verified, and to anon', async () => {
    const farmerView = await FARMER.client
      .from('verification_evidence').select('*').eq('case_id', caseId)
    expect(farmerView.data ?? [], 'the farmer can read the agent’s raw evidence').toHaveLength(0)

    const a = anonClient()
    const pub = await a.from('verification_evidence').select('*').limit(1)
    expect(pub.error || (pub.data ?? []).length === 0).toBeTruthy()
  })
})

describe('collection is not approval', () => {
  it('will not let the agent approve their own case', async () => {
    await AGENT.client.rpc('loamy_submit_verification_case', { p_case_id: caseId })

    const { error } = await AGENT.client.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved',
    })
    expect(error, 'an agent approved their own verification').toBeTruthy()
  })

  it('will not let the subject approve it either', async () => {
    const { error } = await FARMER.client.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved',
    })
    expect(error).toBeTruthy()
  })

  it('leaves the farm unverified while the case is unapproved', async () => {
    const { data } = await FARMER.client
      .from('farms').select('verification_status').eq('id', farmId).single()
    expect(data!.verification_status).not.toBe('verified')
  })

  it('records a review and applies the outcome when the platform approves', async () => {
    if (!admin) return expect(admin).toBeNull()

    const { error } = await admin.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'approved', p_note: 'Evidence consistent with the farm.',
    })
    expect(error, error?.message).toBeFalsy()

    const { data: c } = await admin
      .from('verification_tasks').select('status, reviewer_id').eq('id', caseId).single()
    expect(c!.status).toBe('approved')

    const { data: rev } = await admin
      .from('verification_reviews').select('decision, flags_at_review').eq('case_id', caseId).single()
    expect(rev!.decision).toBe('approved')
    // The reviewer's view of the flags is preserved for later audit.
    expect(Array.isArray(rev!.flags_at_review)).toBe(true)

    // Outcome applied through the farm's own path.
    const { data: farm } = await FARMER.client
      .from('farms').select('verification_status').eq('id', farmId).single()
    expect(farm!.verification_status).toBe('verified')
  }, 60_000)

  it('refuses to review the same case twice', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_review_verification_case', {
      p_case_id: caseId, p_decision: 'rejected',
    })
    expect(error, 'a decided case was reviewed again').toBeTruthy()
  })

  it('writes an audit event for the decision', async () => {
    if (!admin) return
    const { data } = await admin
      .from('audit_events').select('event_type, detail')
      .eq('subject_id', caseId).eq('event_type', 'verification_decided').maybeSingle()
    expect(data, 'no audit record for a verification decision').toBeTruthy()
    expect((data!.detail as Record<string, unknown>).decision).toBe('approved')
  })
})

describe('a case cannot be submitted empty', () => {
  it('refuses submission with no evidence', async () => {
    if (!admin) return
    const { data: farm3 } = await FARMER.client.from('farms').insert({
      owner_id: FARMER.uid, farm_name: 'Phase3 Farm C', state: 'Benue', lga: 'Otukpo',
      size_hectares: 2, primary_crops: ['Yam'], ownership_type: 'owned',
    }).select('id').single()
    await FARMER.client.rpc('loamy_request_farm_verification_guarded', { p_farm_id: farm3!.id })
    const { data: empty } = await admin
      .from('verification_tasks').select('id').eq('subject_farm_id', farm3!.id).maybeSingle()
    const asn2 = await admin.rpc('loamy_assign_verification_task', { p_task: empty!.id, p_partner: AGENT.uid })
    expect(asn2.error, asn2.error?.message).toBeFalsy()

    const { error } = await AGENT.client.rpc('loamy_submit_verification_case', {
      p_case_id: empty!.id,
    })
    expect(error, 'an empty case was sent for review').toBeTruthy()
  }, 60_000)
})
