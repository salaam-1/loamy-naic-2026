/**
 * Stage 4 live verification — two phases because the review loop needs an
 * admin actor:
 *   node scripts/verify-stage4.mjs setup    → creates test accounts, writes
 *     .stage4-state.json, prints the admin-candidate email (a temporary
 *     promote migration then makes THAT account admin)
 *   node scripts/verify-stage4.mjs verify   → runs the full field loop +
 *     isolation checks (a demote migration afterwards restores 'member')
 *
 * Accounts: P  = growth partner (granted can_verify by admin)
 *           P2 = growth partner WITHOUT can_verify (must see nothing)
 *           F  = farmer (subject) · F2 = second farmer (must see nothing)
 *           A  = admin candidate
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-stage4.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const STATE_FILE = new URL('./.stage4-state.json', import.meta.url)

const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function client() {
  return createClient(TEST_ENV.url, TEST_ENV.key, {
    auth: { persistSession: false },
  })
}

async function signup(email, password, role, category) {
  const c = client()
  const { data, error } = await c.auth.signUp({
    email, password,
    options: {
      data: {
        full_name: `Stage4 ${role} ${email.split('+')[1]?.split('@')[0] ?? ''}`.trim(),
        phone: '0802345' + Math.floor(1000 + Math.random() * 9000),
        category, platform_role: role, state: 'Kaduna',
      },
    },
  })
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
  const password = 'LoamyStage4-Test!' + Math.random().toString(36).slice(2, 8)
  const P = await signup(`usmanyakubu541+loamy4-p-${ts}@gmail.com`, password, 'growth_partner', 'Growth Partner')
  const P2 = await signup(`usmanyakubu541+loamy4-p2-${ts}@gmail.com`, password, 'growth_partner', 'Growth Partner')
  const F = await signup(`usmanyakubu541+loamy4-f-${ts}@gmail.com`, password, 'farmer', 'Farmer')
  const F2 = await signup(`usmanyakubu541+loamy4-f2-${ts}@gmail.com`, password, 'farmer', 'Farmer')
  const A = await signup(`usmanyakubu541+loamy4-admin-${ts}@gmail.com`, password, 'buyer', 'Buyer')

  // Sanity: a normal user must NOT be able to self-promote to admin.
  const a = await login(A.email, password)
  const { data: promoted } = await a.client.from('profiles').update({ role: 'admin' }).eq('id', A.uid).select('role')
  const selfPromoted = (promoted ?? []).some((r) => r.role === 'admin')
  console.log(selfPromoted
    ? 'WARNING: SELF-PROMOTION TO ADMIN SUCCEEDED — portal profiles UPDATE policy must be fixed!'
    : 'OK: self-promotion to admin is blocked')

  writeFileSync(STATE_FILE, JSON.stringify({ ts, password, P, P2, F, F2, A, selfPromoted }, null, 2))
  console.log(`\nADMIN_EMAIL=${A.email}`)
  console.log('State written. Promote that account to admin (temp migration), then run the verify phase.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// verify phase
// ---------------------------------------------------------------------------
const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
const { password } = state
const P = await login(state.P.email, password)
const P2 = await login(state.P2.email, password)
const F = await login(state.F.email, password)
const F2 = await login(state.F2.email, password)
const A = await login(state.A.email, password)

ok('Self-promotion to admin blocked (from setup)', !state.selfPromoted)

const { data: aProfile } = await A.client.from('profiles').select('role').eq('id', A.uid).maybeSingle()
ok('Admin fixture in place', aProfile?.role === 'admin', `role=${aProfile?.role}`)

// ---- Haversine sanity ----
const { data: hav } = await A.client.rpc('loamy_haversine_m', { lat1: 0, lng1: 0, lat2: 0, lng2: 1 })
ok('Haversine 1° longitude at equator ≈ 111.2 km', Number(hav) > 111000 && Number(hav) < 111400, `${hav} m`)

// ---- Capability + territory ----
const { error: nonAdminGrant } = await P.client.rpc('loamy_set_can_verify', { p_user: P.uid, p_value: true })
ok('Non-admin cannot grant can_verify', !!nonAdminGrant, nonAdminGrant?.message?.slice(0, 30))

const { error: grantErr } = await A.client.rpc('loamy_set_can_verify', { p_user: P.uid, p_value: true })
ok('Admin grants can_verify to partner P', !grantErr, grantErr?.message)

const { error: assignErr } = await A.client.from('partner_assignments').insert({
  partner_id: P.uid, state: 'Kaduna', lgas: ['Zaria'],
})
ok('Admin assigns territory (Kaduna/Zaria) to P', !assignErr, assignErr?.message)

// P2: can_verify but WRONG territory (Lagos) — must see nothing in the pool.
await A.client.rpc('loamy_set_can_verify', { p_user: P2.uid, p_value: true })
await A.client.from('partner_assignments').insert({ partner_id: P2.uid, state: 'Lagos', lgas: [] })

// ---- Referral attribution (onboarding earning) ----
const { data: pProfile } = await P.client.from('profiles').select('digital_id').eq('id', P.uid).maybeSingle()
const { error: refErr } = await F.client.rpc('loamy_record_referral', {
  p_ref_code: pProfile.digital_id, p_method: 'referral_link',
})
ok('Farmer self-attributes referral to partner P', !refErr, refErr?.message)

const { error: refAgainErr } = await F.client.rpc('loamy_record_referral', {
  p_ref_code: pProfile.digital_id, p_method: 'referral_link',
})
ok('Double attribution rejected', !!refAgainErr, refAgainErr?.message?.slice(0, 40))

const { data: f2Digital } = await F2.client.from('profiles').select('digital_id').eq('id', F2.uid).maybeSingle()
const { error: notPartnerErr } = await F2.client.rpc('loamy_record_referral', {
  p_ref_code: f2Digital.digital_id, p_method: 'referral_link',
})
ok('Referral code must belong to a growth partner', !!notPartnerErr, notPartnerErr?.message?.slice(0, 40))

// ---- Farm + request verification → task ----
const { data: farm } = await F.client.from('farms').insert({
  owner_id: F.uid, farm_name: 'Stage4 Loop Farm', state: 'Kaduna', lga: 'Zaria',
  size_hectares: 2, primary_crops: ['Maize'], ownership_type: 'owned',
  latitude: 11.085541, longitude: 7.719945,
}).select().maybeSingle()
await F.client.rpc('loamy_request_farm_verification', { p_farm_id: farm.id })

const { data: fProgress } = await F.client.from('loamy_verification_progress').select('*').eq('subject_farm_id', farm.id)
ok("Farmer sees status-only progress ('pending')", fProgress?.[0]?.status === 'pending')
ok('Progress view exposes NO evidence column', fProgress?.[0] && !('evidence' in fProgress[0]))

const { data: fTasks } = await F.client.from('verification_tasks').select('*')
ok('Farmer cannot read verification_tasks directly', (fTasks ?? []).length === 0)

const { data: pool } = await P.client.from('verification_tasks').select('*').eq('status', 'pending')
const task = pool?.[0]
ok('can_verify partner in territory sees the pool task', !!task)

const { data: pool2 } = await P2.client.from('verification_tasks').select('*')
ok('Partner outside territory sees NO pool task', (pool2 ?? []).length === 0)

// ---- Claim + evidence ----
const { error: claimErr } = await P.client.rpc('loamy_claim_verification_task', { p_task: task.id })
ok('P claims the task from the pool', !claimErr, claimErr?.message)

const { error: claim2Err } = await P2.client.rpc('loamy_claim_verification_task', { p_task: task.id })
ok('Second claim rejected (already assigned)', !!claim2Err, claim2Err?.message?.slice(0, 35))

const { data: dist, error: gpsErr } = await P.client.rpc('loamy_gps_check', {
  p_task: task.id, p_lat: 11.0860, p_lng: 7.7205,
})
ok('Server-side GPS check returns sane distance (~60 m)', !gpsErr && Number(dist) > 30 && Number(dist) < 120, `${dist} m`)

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const { error: up1 } = await P.client.storage.from('verification-evidence').upload(`${task.id}/photo-1.png`, png, { contentType: 'image/png' })
const { error: up2 } = await P.client.storage.from('verification-evidence').upload(`${task.id}/photo-2.png`, png, { contentType: 'image/png' })
ok('Assigned partner uploads evidence photos', !up1 && !up2, up1?.message ?? up2?.message)

const { error: farmerUpErr } = await F.client.storage.from('verification-evidence').upload(`${task.id}/intruder.png`, png, { contentType: 'image/png' })
ok('FARMER cannot upload to evidence bucket', !!farmerUpErr, farmerUpErr?.message?.slice(0, 40))

const { data: farmerList } = await F.client.storage.from('verification-evidence').list(task.id)
const { error: farmerSignErr } = await F.client.storage.from('verification-evidence').createSignedUrl(`${task.id}/photo-1.png`, 60)
ok('FARMER cannot list or sign evidence URLs', (farmerList ?? []).length === 0 && !!farmerSignErr)

const { data: f2List } = await F2.client.storage.from('verification-evidence').list(task.id)
ok('Another farmer sees nothing at all', (f2List ?? []).length === 0)

const checklist = Object.fromEntries(
  ['farm_exists', 'crops_match', 'size_plausible', 'identity_confirmed'].map((k) => [k, { value: true, note: '' }]),
)
const { error: submitErr } = await P.client.from('verification_tasks').update({
  evidence: { checklist, partner_note: 'All checks passed on site.', photos: ['photo-1.png', 'photo-2.png'] },
  status: 'submitted',
}).eq('id', task.id)
ok('P submits evidence for review', !submitErr, submitErr?.message)

// ---- Two-layer integrity: partner cannot approve ----
const { data: selfApprove } = await P.client.from('verification_tasks')
  .update({ status: 'approved' }).eq('id', task.id).select()
ok('Partner cannot self-approve (submitted is locked)', (selfApprove ?? []).length === 0)

const { error: nonAdminReview } = await P.client.rpc('loamy_review_verification_task', {
  p_task: task.id, p_decision: 'approved',
})
ok('Non-admin review rejected', !!nonAdminReview, nonAdminReview?.message?.slice(0, 30))

// ---- Admin reviews: evidence visible, then approve ----
const { data: adminSign } = await A.client.storage.from('verification-evidence').createSignedUrl(`${task.id}/photo-1.png`, 60)
ok('Admin can read evidence via signed URL', !!adminSign?.signedUrl)

const { error: reviewErr } = await A.client.rpc('loamy_review_verification_task', {
  p_task: task.id, p_decision: 'approved', p_note: 'Evidence complete and consistent.',
})
ok('Admin approves the submission', !reviewErr, reviewErr?.message)

const { data: farmAfter } = await F.client.from('farms').select('verification_status').eq('id', farm.id).maybeSingle()
ok("Farm flips to 'verified'", farmAfter?.verification_status === 'verified')

const { data: badge } = await F2.client.from('loamy_public_profiles').select('verified_badge').eq('id', F.uid).maybeSingle()
ok('Marketplace badge (Stage 3 surface) now shows verified', badge?.verified_badge === true)

const { data: fProgress2 } = await F.client.from('loamy_verification_progress').select('status').eq('subject_farm_id', farm.id)
ok("Farmer progress shows 'approved'", fProgress2?.[0]?.status === 'approved')

// ---- Earnings: onboarding (500) + verification (1000) at default rates ----
const { data: earnings } = await P.client.from('partner_earnings').select('*').order('created_at')
const onboardingEarning = (earnings ?? []).find((e) => e.earning_type === 'onboarding')
const verificationEarning = (earnings ?? []).find((e) => e.earning_type === 'verification')
ok('Onboarding earning accrued at configured rate', Number(onboardingEarning?.amount) === 500, `₦${onboardingEarning?.amount}`)
ok('Verification earning accrued at configured rate', Number(verificationEarning?.amount) === 1000, `₦${verificationEarning?.amount}`)

const { error: fEarnErr, data: fEarn } = await F.client.from('partner_earnings').select('*')
ok("Farmer sees no one's earnings", !fEarnErr && (fEarn ?? []).length === 0)

const { data: paidRow, error: paidErr } = await A.client.from('partner_earnings')
  .update({ status: 'paid_externally', paid_note: 'Test transfer ref 001' })
  .eq('id', onboardingEarning.id).select().maybeSingle()
ok("Admin marks earning 'paid externally' (no payment executed)", !paidErr && paidRow?.status === 'paid_externally')

const { data: pMarkOwn } = await P.client.from('partner_earnings')
  .update({ status: 'paid_externally' }).eq('id', verificationEarning.id).select()
ok('Partner cannot mark own earning paid', (pMarkOwn ?? []).length === 0)

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
