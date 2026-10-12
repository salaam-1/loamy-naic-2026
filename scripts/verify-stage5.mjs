/**
 * Stage 5 live verification — two phases (admin fixture in between):
 *   node scripts/verify-stage5.mjs setup   → creates accounts, prints ADMIN_EMAIL
 *   node scripts/verify-stage5.mjs verify  → full bank loop + isolation checks
 *
 * Accounts: F farmer (applicant) · F2 farmer (isolation) · O officer (LOTUS)
 *           · O2 officer (second bank, multi-tenant check) · A admin candidate
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-stage5.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const STATE_FILE = new URL('./.stage5-state.json', import.meta.url)

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
  const password = 'LoamyStage5-Test!' + Math.random().toString(36).slice(2, 8)
  const farmerMeta = (n) => ({
    full_name: `Stage5 Farmer ${n}`, phone: '0803456' + Math.floor(1000 + Math.random() * 9000),
    category: 'Farmer', platform_role: 'farmer', state: 'Kano',
  })
  const F = await signup(`usmanyakubu541+loamy5-f-${ts}@gmail.com`, password, farmerMeta(1))
  const F2 = await signup(`usmanyakubu541+loamy5-f2-${ts}@gmail.com`, password, farmerMeta(2))
  // Officer accounts: NO category (banks are not portal members).
  const O = await signup(`usmanyakubu541+loamy5-o-${ts}@gmail.com`, password, {
    full_name: 'Stage5 Officer LOTUS', phone: '08000000001', platform_role: 'bank', state: 'Lagos',
  })
  const O2 = await signup(`usmanyakubu541+loamy5-o2-${ts}@gmail.com`, password, {
    full_name: 'Stage5 Officer Bank2', phone: '08000000002', platform_role: 'bank', state: 'Lagos',
  })
  const A = await signup(`usmanyakubu541+loamy5-admin-${ts}@gmail.com`, password, {
    full_name: 'Stage5 Admin', phone: '08000000003', category: 'Buyer', platform_role: 'buyer', state: 'Lagos',
  })
  writeFileSync(STATE_FILE, JSON.stringify({ ts, password, F, F2, O, O2, A }, null, 2))
  console.log(`ADMIN_EMAIL=${A.email}`)
  process.exit(0)
}

const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
const { password } = state
const F = await login(state.F.email, password)
const F2 = await login(state.F2.email, password)
const O = await login(state.O.email, password)
const O2 = await login(state.O2.email, password)
const A = await login(state.A.email, password)

const { data: aRole } = await A.client.from('profiles').select('role').eq('id', A.uid).maybeSingle()
ok('Admin fixture in place', aRole?.role === 'admin')

// ---- Farmer sets up farm + records + application ----
const { data: farm } = await F.client.from('farms').insert({
  owner_id: F.uid, farm_name: 'Stage5 Farm', state: 'Kano', lga: 'Wudil',
  size_hectares: 3, primary_crops: ['Maize', 'Rice'], ownership_type: 'owned',
  latitude: 11.79, longitude: 8.84,
}).select().maybeSingle()
await F.client.from('crop_records').insert({
  farm_id: farm.id, crop: 'Maize', season_year: 2025, expected_yield_kg: 3000, actual_yield_kg: 2800,
})
const { data: app } = await F.client.from('financing_applications').insert({
  applicant_id: F.uid, farm_id: farm.id, amount_requested: 200000,
  purpose: 'Fertilizer and improved seed for the 2026 wet season',
  intended_items: [{ item: 'NPK Fertilizer', qty: '10 bags' }, { item: 'Improved maize seed', qty: '25 kg' }],
  disbursement_preference: 'supplier_payment', status: 'submitted',
}).select().maybeSingle()
const { data: draft } = await F.client.from('financing_applications').insert({
  applicant_id: F.uid, amount_requested: 50000, status: 'draft',
}).select().maybeSingle()
ok('Farmer submits application (+ one draft)', !!app && !!draft)
ok('Application auto-routed to LOTUS Bank', !!app.bank_id)

// ---- Officer lifecycle: admin-only ----
const { error: preSetup } = await O.client.rpc('loamy_bank_pipeline')
const { data: preRows } = await O.client.rpc('loamy_bank_pipeline')
ok('Unassigned account sees no pipeline', !!preSetup || (preRows ?? []).length === 0)

const { error: selfSetup } = await O.client.rpc('loamy_setup_bank_officer', { p_user: O.uid, p_bank: app.bank_id })
ok('Non-admin cannot create bank officers', !!selfSetup, selfSetup?.message?.slice(0, 30))

const { error: setupErr } = await A.client.rpc('loamy_setup_bank_officer', { p_user: O.uid, p_bank: app.bank_id })
ok('Admin assigns officer to LOTUS Bank', !setupErr, setupErr?.message)

// ---- Pipeline + draft invisibility ----
const { data: pipeline } = await O.client.rpc('loamy_bank_pipeline')
const row = (pipeline ?? []).find((r) => r.id === app.id)
ok('Officer sees the submitted application in pipeline', !!row)
ok('Pipeline computes a risk tier', ['Low', 'Medium', 'High', 'Very High'].includes(row?.risk_tier), row?.risk_tier)
ok('Draft is NOT in the pipeline', !(pipeline ?? []).some((r) => r.id === draft.id))
const { data: directApps } = await O.client.from('financing_applications').select('id, status')
ok('Direct table read excludes drafts too', !(directApps ?? []).some((r) => r.status === 'draft'))

// ---- No raw applicant access ----
const { data: rawProfile } = await O.client.from('profiles').select('*').eq('id', F.uid)
const { data: rawFarms } = await O.client.from('farms').select('*')
const { data: rawCrops } = await O.client.from('crop_records').select('*')
ok('Officer has NO raw access to profiles/farms/crop_records',
  (rawProfile ?? []).length === 0 && (rawFarms ?? []).length === 0 && (rawCrops ?? []).length === 0)

// ---- Bundle ----
const { data: bundle, error: bundleErr } = await O.client.rpc('loamy_application_bundle', { p_app: app.id })
ok('Bundle function returns the application bundle', !bundleErr && bundle?.identity?.digital_id?.startsWith('LOAMY'))
ok('Bundle has farms + records + activity + context',
  bundle?.farms?.length === 1 && bundle.farms[0].crop_records.length === 1 && 'activity' in bundle && 'financing_context' in bundle)
ok('Bundle contains no BVN/NIN/email keys', !JSON.stringify(bundle).match(/bvn|nin_|email/i))
const { error: draftBundleErr } = await O.client.rpc('loamy_application_bundle', { p_app: draft.id })
ok('Bundle refuses drafts', !!draftBundleErr, draftBundleErr?.message?.slice(0, 35))
const { error: farmerBundleErr } = await F.client.rpc('loamy_application_bundle', { p_app: app.id })
ok('Applicant cannot pull the bank bundle', !!farmerBundleErr)

// ---- Status flow (no approve/decline exists) ----
const { error: badStatus } = await O.client.rpc('loamy_bank_set_status', { p_app: app.id, p_status: 'approved' })
ok("'approved' is not a valid transition anywhere", !!badStatus, badStatus?.message?.slice(0, 40))

await O.client.rpc('loamy_bank_set_status', { p_app: app.id, p_status: 'under_review' })
const { error: infoErr } = await O.client.rpc('loamy_bank_set_status', {
  p_app: app.id, p_status: 'info_requested', p_message: 'Please add your input supplier quotations.',
})
ok('Under review → info requested transitions work', !infoErr, infoErr?.message)

const { data: fNotifs } = await F.client.from('notifications').select('title').eq('type', 'financing')
ok('Applicant notified of review + info request',
  (fNotifs ?? []).some((n) => n.title === 'Application under review')
  && (fNotifs ?? []).some((n) => n.title === 'Bank requested more information'))

// ---- Report immutability ----
const { data: report1Id, error: genErr } = await O.client.rpc('loamy_generate_credit_report', { p_app: app.id })
ok('Officer generates a Credit Intelligence Report', !genErr && !!report1Id, genErr?.message)

// Source data changes AFTER generation…
await F.client.from('crop_records').insert({
  farm_id: farm.id, crop: 'Rice', season_year: 2026, expected_yield_kg: 2000, actual_yield_kg: 2100,
})
const { data: report1 } = await O.client.from('credit_reports').select('*').eq('id', report1Id).maybeSingle()
const recordsInSnapshot = report1.snapshot.bundle.farms[0].crop_records.length
ok('Old snapshot is unchanged after source data changed', recordsInSnapshot === 1, `records frozen at ${recordsInSnapshot}`)

const { data: report2Id } = await O.client.rpc('loamy_generate_credit_report', { p_app: app.id })
const { data: report2 } = await O.client.from('credit_reports').select('*').eq('id', report2Id).maybeSingle()
ok('Regeneration produces a NEW report reflecting new data',
  report2.snapshot.bundle.farms[0].crop_records.length === 2 && report2.id !== report1.id)

const { error: mutateErr } = await O.client.from('credit_reports')
  .update({ risk_tier: 'Low' }).eq('id', report1Id).select().maybeSingle()
const { data: afterMutate } = await O.client.from('credit_reports').select('risk_tier').eq('id', report1Id).maybeSingle()
ok('Reports cannot be mutated via the API', afterMutate.risk_tier === report1.risk_tier, mutateErr?.message?.slice(0, 30) ?? '0 rows updated')

const { data: fReports } = await F.client.from('credit_reports').select('*')
ok('Applicant cannot read credit reports', (fReports ?? []).length === 0)

// ---- Decision + monitoring ----
const { error: earlyMilestone } = await O.client.from('repayment_milestones').insert({
  application_id: app.id, milestone_type: 'instalment', due_date: '2026-09-01', created_by: O.uid,
})
ok('Milestones impossible before a recorded decision', !!earlyMilestone)

const { error: decideNoNote } = await O.client.rpc('loamy_bank_set_status', { p_app: app.id, p_status: 'decided_external' })
ok('Decision requires a note', !!decideNoNote, decideNoNote?.message?.slice(0, 40))

await O.client.rpc('loamy_bank_set_status', {
  p_app: app.id, p_status: 'decided_external',
  p_message: 'Decision communicated to applicant on 18 Jul 2026.',
})
const { data: fNotifs2 } = await F.client.from('notifications').select('title').eq('type', 'financing')
ok("Applicant notified 'Decision communicated by your bank'",
  (fNotifs2 ?? []).some((n) => n.title === 'Decision communicated by your bank'))

const { data: appAfter } = await F.client.from('financing_applications').select('status, decision_note, status_history').eq('id', app.id).maybeSingle()
ok('Status history recorded every transition', (appAfter.status_history ?? []).length >= 3, `${appAfter.status_history.length} transitions`)

const { data: milestone } = await O.client.from('repayment_milestones').insert({
  application_id: app.id, milestone_type: 'instalment', due_date: '2026-09-01', created_by: O.uid,
}).select().maybeSingle()
await O.client.from('repayment_milestones').update({ status: 'missed' }).eq('id', milestone.id)
const { data: msAfter } = await O.client.from('repayment_milestones').select('status').eq('id', milestone.id).maybeSingle()
ok('Milestone created and marked missed', msAfter.status === 'missed')

const { data: risk2 } = await O.client.rpc('loamy_risk_assessment', { p_app: app.id })
const missedFactor = (risk2.factors ?? []).find((f) => f.key === 'milestones_missed')
ok('Missed milestone feeds the risk factors (strong minus)', missedFactor?.points === -20, `${missedFactor?.points} pts`)

// ---- Multi-tenant: second bank sees nothing ----
const { data: bank2 } = await A.client.from('banks').insert({ name: 'Stage5 Test Bank' }).select().maybeSingle()
await A.client.rpc('loamy_setup_bank_officer', { p_user: O2.uid, p_bank: bank2.id })
const { data: o2Pipeline } = await O2.client.rpc('loamy_bank_pipeline')
const { error: o2Bundle } = await O2.client.rpc('loamy_application_bundle', { p_app: app.id })
const { data: o2Reports } = await O2.client.from('credit_reports').select('*')
ok('Second-bank officer sees NO LOTUS applications', (o2Pipeline ?? []).length === 0)
ok('Second-bank officer denied the LOTUS bundle', !!o2Bundle)
ok('Second-bank officer sees no LOTUS reports', (o2Reports ?? []).length === 0)

// Clean up the test bank + deactivate its officer.
await A.client.rpc('loamy_set_bank_officer_active', { p_user: O2.uid, p_active: false })
const { error: bank2DelErr } = await A.client.from('banks').delete().eq('id', bank2.id)
ok('Test bank removed after multi-tenant check', !bank2DelErr, bank2DelErr?.message)

// ---- Route/role isolation ----
const { error: oAdminFn } = await O.client.rpc('loamy_set_can_verify', { p_user: O.uid, p_value: true })
ok('Officer cannot call admin functions', !!oAdminFn)
const { error: f2Status } = await F2.client.rpc('loamy_bank_set_status', { p_app: app.id, p_status: 'under_review' })
ok('Non-officers cannot drive bank transitions', !!f2Status)
const { data: f2Pipeline } = await F2.client.rpc('loamy_bank_pipeline')
ok('Non-officers get an empty pipeline', (f2Pipeline ?? []).length === 0)

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
