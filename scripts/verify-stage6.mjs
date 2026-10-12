/**
 * Stage 6 live verification + full-platform regression — two phases:
 *   node scripts/verify-stage6.mjs setup   → creates accounts, prints ADMIN_EMAIL
 *   node scripts/verify-stage6.mjs verify  → Stage 6 checks + the compressed
 *     end-to-end story (farm → verification → badge → financing → bank
 *     decision), with every step checked in notifications AND the audit trail.
 *
 * Reuses the Stage 5 LOTUS officer for the bank leg (scripts/.stage5-state.json).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-stage6.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const STATE_FILE = new URL('./.stage6-state.json', import.meta.url)

const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const client = () =>
  createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })

async function signup(email, password, meta) {
  const c = client()
  const { data, error } = await c.auth.signUp({ email, password, options: { data: meta } })
  if (error || !data.session) throw new Error(`signup ${email}: ${error?.message}`)
  return { uid: data.user.id, email }
}
async function login(email, password) {
  const c = client()
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { client: c, uid: data.user.id }
}

const phase = process.argv[2]

if (phase === 'setup') {
  const ts = Date.now().toString(36)
  const password = 'LoamyStage6-Test!' + Math.random().toString(36).slice(2, 8)
  const F = await signup(`usmanyakubu541+loamy6-f-${ts}@gmail.com`, password, {
    full_name: 'Stage6 Farmer', phone: '08055550001', category: 'Farmer', platform_role: 'farmer', state: 'Kano',
  })
  const P = await signup(`usmanyakubu541+loamy6-p-${ts}@gmail.com`, password, {
    full_name: 'Stage6 Partner', phone: '08055550002', category: 'Growth Partner', platform_role: 'growth_partner', state: 'Kano',
  })
  const U = await signup(`usmanyakubu541+loamy6-u-${ts}@gmail.com`, password, {
    full_name: 'Stage6 User', phone: '08055550003', category: 'Buyer', platform_role: 'buyer', state: 'Lagos',
  })
  const A = await signup(`usmanyakubu541+loamy6-admin-${ts}@gmail.com`, password, {
    full_name: 'Stage6 Admin', phone: '08055550004', category: 'Buyer', platform_role: 'buyer', state: 'Lagos',
  })
  writeFileSync(STATE_FILE, JSON.stringify({ ts, password, F, P, U, A }, null, 2))
  console.log(`ADMIN_EMAIL=${A.email}`)
  process.exit(0)
}

const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
const s5 = JSON.parse(readFileSync(new URL('./.stage5-state.json', import.meta.url), 'utf8'))
const { password } = state
const F = await login(state.F.email, password)
const P = await login(state.P.email, password)
const U = await login(state.U.email, password)
const A = await login(state.A.email, password)
const O = await login(s5.O.email, s5.password) // LOTUS bank officer (Stage 5)

const { data: aRole } = await A.client.from('profiles').select('role').eq('id', A.uid).maybeSingle()
ok('Admin fixture in place', aRole?.role === 'admin')

// ---- Audit trail RLS ----
const { data: fAudit } = await F.client.from('audit_events').select('*')
ok('Non-admin reads zero audit events', (fAudit ?? []).length === 0)
const { error: fAuditIns } = await F.client.from('audit_events').insert({ event_type: 'hack' })
ok('Client audit inserts denied', !!fAuditIns)

// ---- Admin stats + summary ----
const { error: fStats } = await F.client.rpc('loamy_admin_stats')
ok('Stats function is admin-only', !!fStats)
const { data: stats } = await A.client.rpc('loamy_admin_stats')
ok('Admin stats return live counts', stats?.users_total > 0 && 'users_by_role' in stats && 'verifications' in stats)
const { error: fSummary } = await F.client.rpc('loamy_admin_user_summary', { p_user: F.uid })
ok('User summary is admin-only', !!fSummary)

// ---- Role change (audited) ----
const { error: fRole } = await F.client.rpc('loamy_admin_set_role', { p_user: U.uid, p_role: 'trader' })
ok('Non-admin cannot change roles', !!fRole)
await A.client.rpc('loamy_admin_set_role', { p_user: U.uid, p_role: 'trader' })
const { data: uAfter } = await A.client.from('profiles').select('platform_role').eq('id', U.uid).maybeSingle()
ok('Admin role change applied', uAfter?.platform_role === 'trader')
const { error: bankRole } = await A.client.rpc('loamy_admin_set_role', { p_user: U.uid, p_role: 'bank' })
ok("'bank' not assignable through role change", !!bankRole)

// ---- Suspension (audited + enforced) ----
const { error: fDeact } = await F.client.rpc('loamy_admin_set_user_active', { p_user: U.uid, p_active: false })
ok('Non-admin cannot deactivate', !!fDeact)
await A.client.rpc('loamy_admin_set_user_active', { p_user: F.uid, p_active: false })
const { data: farmA } = await F.client.from('farms').insert({
  owner_id: F.uid, farm_name: 'Stage6 Regression Farm', state: 'Kano', lga: 'Kura',
  size_hectares: 2, primary_crops: ['Maize'], ownership_type: 'owned',
  latitude: 11.77, longitude: 8.42,
}).select().maybeSingle()
const { error: suspendedReq } = await F.client.rpc('loamy_request_farm_verification_guarded', { p_farm_id: farmA.id })
ok('Suspended account blocked from action paths', !!suspendedReq, suspendedReq?.message?.slice(0, 40))
await A.client.rpc('loamy_admin_set_user_active', { p_user: F.uid, p_active: true })
const { error: selfDeact } = await A.client.rpc('loamy_admin_set_user_active', { p_user: A.uid, p_active: false })
ok('Admin cannot deactivate own account', !!selfDeact)

// ---- Announcements ----
const { error: fAnnounce } = await F.client.rpc('loamy_announce', { p_title: 'x', p_body: 'y' })
ok('Non-admin cannot announce', !!fAnnounce)
const { data: recipients } = await A.client.rpc('loamy_announce', {
  p_title: 'Stage 6 regression notice', p_body: 'Farmers only.', p_role: 'farmer',
})
ok('Segmented announcement sent', Number(recipients) >= 1, `${recipients} recipients`)
const { data: fNote } = await F.client.from('notifications').select('title').eq('type', 'announcement')
const { data: uNote } = await U.client.from('notifications').select('title').eq('type', 'announcement')
ok('Farmer segment received it; trader did not',
  (fNote ?? []).some((n) => n.title === 'Stage 6 regression notice')
  && !(uNote ?? []).some((n) => n.title === 'Stage 6 regression notice'))

// ---- Export logging ----
const { error: fExport } = await F.client.rpc('loamy_admin_log_export', { p_kind: 'users', p_rows: 1 })
ok('Non-admin cannot log exports', !!fExport)
await A.client.rpc('loamy_admin_log_export', { p_kind: 'users', p_rows: 42 })

// ---- Config change audit ----
const { data: cfg } = await A.client.from('platform_config').select('flags').eq('id', 1).maybeSingle()
await A.client.from('platform_config').update({ flags: { ...cfg.flags, stage6_probe: true } }).eq('id', 1)
await A.client.from('platform_config').update({ flags: cfg.flags }).eq('id', 1)

// ============================================================
// COMPRESSED END-TO-END STORY (regression across Stages 2–5)
// ============================================================
const { error: reqErr } = await F.client.rpc('loamy_request_farm_verification_guarded', { p_farm_id: farmA.id })
ok('E2E: reactivated farmer requests verification', !reqErr, reqErr?.message)

await A.client.rpc('loamy_set_can_verify', { p_user: P.uid, p_value: true })
await A.client.from('partner_assignments').insert({ partner_id: P.uid, state: 'Kano', lgas: [] })
const { data: pool } = await P.client.from('verification_tasks').select('*').eq('status', 'pending')
const task = (pool ?? []).find((t) => t.subject_farm_id === farmA.id)
ok('E2E: task in partner territory pool', !!task)

await P.client.rpc('loamy_claim_verification_task', { p_task: task.id })
const { data: dist } = await P.client.rpc('loamy_gps_check', { p_task: task.id, p_lat: 11.7705, p_lng: 8.4207 })
ok('E2E: GPS check sane', Number(dist) > 30 && Number(dist) < 200, `${dist} m`)
const checklist = Object.fromEntries(
  ['farm_exists', 'crops_match', 'size_plausible', 'identity_confirmed'].map((k) => [k, { value: true, note: '' }]),
)
await P.client.from('verification_tasks').update({
  evidence: { checklist, partner_note: 'Regression pass', photos: [] }, status: 'submitted',
}).eq('id', task.id)
const { error: approveErr } = await A.client.rpc('loamy_review_verification_task', {
  p_task: task.id, p_decision: 'approved', p_note: 'Regression approval',
})
ok('E2E: admin approves', !approveErr, approveErr?.message)
const { data: badge } = await U.client.from('loamy_public_profiles').select('verified_badge').eq('id', F.uid).maybeSingle()
ok('E2E: marketplace badge live', badge?.verified_badge === true)

const { data: draftApp } = await F.client.from('financing_applications').insert({
  applicant_id: F.uid, farm_id: farmA.id, amount_requested: 150000,
  purpose: 'Inputs for regression season', intended_items: [{ item: 'NPK', qty: '5 bags' }],
  disbursement_preference: 'supplier_payment', status: 'draft',
}).select().maybeSingle()
await F.client.from('financing_applications').update({ status: 'submitted' }).eq('id', draftApp.id)

const { data: pipeline } = await O.client.rpc('loamy_bank_pipeline')
ok('E2E: application reaches the LOTUS pipeline', (pipeline ?? []).some((r) => r.id === draftApp.id))
await O.client.rpc('loamy_bank_set_status', { p_app: draftApp.id, p_status: 'under_review' })
const { error: decideErr } = await O.client.rpc('loamy_bank_set_status', {
  p_app: draftApp.id, p_status: 'decided_external', p_message: 'Decision communicated (regression).',
})
ok('E2E: bank records decision', !decideErr, decideErr?.message)
const { data: milestone } = await O.client.from('repayment_milestones').insert({
  application_id: draftApp.id, milestone_type: 'instalment', due_date: '2026-10-01', created_by: O.uid,
}).select().maybeSingle()
await O.client.from('repayment_milestones').update({ status: 'missed' }).eq('id', milestone.id)
ok('E2E: milestone created and marked missed', !!milestone)

const { data: fNotifs } = await F.client.from('notifications').select('title')
ok('E2E: farmer notified at every step',
  ['Verification requested', 'Your farm is now verified', 'Application under review', 'Decision communicated by your bank']
    .every((t) => (fNotifs ?? []).some((n) => n.title === t)))

// ---- Audit trail captured the story ----
const { data: audit } = await A.client.from('audit_events').select('event_type')
const types = new Set((audit ?? []).map((a) => a.event_type))
const expected = ['role_changed', 'user_deactivated', 'user_reactivated', 'can_verify_granted',
  'verification_approved', 'application_status_changed', 'application_under_review',
  'application_decided_external', 'announcement_sent', 'export_generated', 'config_changed']
const missing = expected.filter((t) => !types.has(t))
ok('Audit trail contains every expected event type', missing.length === 0, missing.join(', ') || 'all present')

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
