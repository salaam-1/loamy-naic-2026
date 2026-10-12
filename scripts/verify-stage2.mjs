/**
 * Stage 2 live verification — run with: node scripts/verify-stage2.mjs
 *
 * Two farmer test accounts against the LIVE project. Exercises: farm CRUD,
 * the verification-status integrity boundary, the request-verification
 * workflow, crop records (incl. taxonomy enforcement), the financing
 * application lifecycle (draft → cap → submit → immutability), and full
 * cross-user RLS denial. Publishable key only — everything runs under RLS.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-stage2.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const PASSWORD = 'LoamyStage2-Test!' + Math.random().toString(36).slice(2, 8)
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function signup(email) {
  const client = createClient(TEST_ENV.url, TEST_ENV.key, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: {
      data: {
        full_name: 'Stage2 Test Farmer',
        phone: '08000000000',
        category: 'Farmer',
        platform_role: 'farmer',
        state: 'Kaduna',
      },
    },
  })
  if (error || !data.session) throw new Error(`signup failed: ${error?.message}`)
  return { client, uid: data.user.id }
}

const ts = Date.now().toString(36)
const A = await signup(`usmanyakubu541+loamy2-a-${ts}@gmail.com`)
const B = await signup(`usmanyakubu541+loamy2-b-${ts}@gmail.com`)
console.log(`Test accounts: +loamy2-a-${ts} (farmer A), +loamy2-b-${ts} (farmer B)\n`)

// ---- Farms ----
const { data: farm, error: farmErr } = await A.client
  .from('farms')
  .insert({
    owner_id: A.uid,
    farm_name: 'Verification Test Farm',
    state: 'Kaduna',
    lga: 'Zaria',
    size_hectares: 3.5,
    primary_crops: ['Maize', 'Soybeans'],
    ownership_type: 'owned',
    latitude: 11.085541,
    longitude: 7.719945,
  })
  .select()
  .maybeSingle()
ok('Farmer A creates a farm with GPS', !!farm && !farmErr, farmErr?.message)
ok("New farm starts 'unverified'", farm?.verification_status === 'unverified')

const { error: fakeVerifiedErr } = await A.client.from('farms').insert({
  owner_id: A.uid, farm_name: 'Cheat Farm', state: 'Kaduna', lga: 'Zaria',
  size_hectares: 1, primary_crops: ['Rice'], ownership_type: 'owned',
  verification_status: 'verified',
})
ok("Cannot INSERT a farm as 'verified'", !!fakeVerifiedErr, fakeVerifiedErr?.message?.slice(0, 50))

const { error: selfVerifyErr } = await A.client
  .from('farms').update({ verification_status: 'verified' }).eq('id', farm.id)
ok('Cannot self-set verification_status (trigger)', !!selfVerifyErr, selfVerifyErr?.message?.slice(0, 60))

const { error: livestockErr } = await A.client.from('farms').insert({
  owner_id: A.uid, farm_name: 'Livestock Farm', state: 'Kaduna', lga: 'Zaria',
  size_hectares: 1, primary_crops: ['Goats'], ownership_type: 'owned',
})
ok('Livestock rejected by taxonomy constraint', !!livestockErr, livestockErr?.message?.slice(0, 50))

// ---- Request verification workflow ----
const { error: reqErr } = await A.client.rpc('loamy_request_farm_verification', { p_farm_id: farm.id })
const { data: farmAfter } = await A.client.from('farms').select('verification_status').eq('id', farm.id).maybeSingle()
ok("Request verification → 'pending'", !reqErr && farmAfter?.verification_status === 'pending', reqErr?.message)

const { data: actNotif } = await A.client
  .from('notifications').select('id').eq('type', 'verification')
ok('Farmer got a verification activity notification', (actNotif ?? []).length >= 1)

const { error: reqAgainErr } = await A.client.rpc('loamy_request_farm_verification', { p_farm_id: farm.id })
ok('Cannot re-request while pending', !!reqAgainErr, reqAgainErr?.message?.slice(0, 40))

// ---- Crop records ----
const { data: rec, error: recErr } = await A.client
  .from('crop_records')
  .insert({ farm_id: farm.id, crop: 'Maize', season_year: 2026, expected_yield_kg: 4000 })
  .select()
  .maybeSingle()
ok('Farmer A adds a crop record', !!rec && !recErr, recErr?.message)

// ---- Financing lifecycle ----
const { data: draft, error: draftErr } = await A.client
  .from('financing_applications')
  .insert({ applicant_id: A.uid, farm_id: farm.id, status: 'draft' })
  .select()
  .maybeSingle()
ok('Draft application saves (incomplete is fine)', !!draft && !draftErr, draftErr?.message)

const { error: capErr } = await A.client
  .from('financing_applications')
  .update({ amount_requested: 600000 })
  .eq('id', draft.id)
ok('₦500,000 cap enforced at the DB', !!capErr, capErr?.message?.slice(0, 50))

const { error: incompleteErr } = await A.client
  .from('financing_applications')
  .update({ status: 'submitted', amount_requested: 100000 }) // no purpose/disbursement
  .eq('id', draft.id)
ok('Cannot submit an incomplete application', !!incompleteErr, incompleteErr?.message?.slice(0, 50))

const { error: submitErr } = await A.client
  .from('financing_applications')
  .update({
    status: 'submitted',
    amount_requested: 150000,
    purpose: 'Fertilizer and seed for 2027 maize season',
    intended_items: [{ item: 'NPK Fertilizer', qty: '10 bags' }],
    disbursement_preference: 'supplier_payment',
  })
  .eq('id', draft.id)
ok('Complete application submits', !submitErr, submitErr?.message)

const { data: mutated } = await A.client
  .from('financing_applications')
  .update({ amount_requested: 10 })
  .eq('id', draft.id)
  .select()
const { data: appCheck } = await A.client
  .from('financing_applications').select('amount_requested, status').eq('id', draft.id).maybeSingle()
ok('Submitted application is immutable to applicant',
  (mutated ?? []).length === 0 && Number(appCheck?.amount_requested) === 150000,
  `status=${appCheck?.status}`)

const { data: illegalStatus, error: illegalStatusErr } = await A.client
  .from('financing_applications')
  .insert({ applicant_id: A.uid, status: 'under_review', amount_requested: 1000, purpose: 'x', disbursement_preference: 'cash' })
  .select()
ok("Applicant cannot create 'under_review' rows",
  !!illegalStatusErr || (illegalStatus ?? []).length === 0,
  illegalStatusErr?.message?.slice(0, 50))

// ---- Live dashboard stats move ----
const [{ count: farmCount }, { count: activeApps }] = await Promise.all([
  A.client.from('farms').select('id', { count: 'exact', head: true }),
  A.client.from('financing_applications').select('id', { count: 'exact', head: true })
    .in('status', ['submitted', 'under_review', 'info_requested']),
])
ok('Dashboard stats read live data', farmCount === 1 && activeApps === 1,
  `farms=${farmCount}, active apps=${activeApps}`)

// ---- Cross-user RLS: farmer B sees NOTHING of farmer A ----
const { data: xFarms } = await B.client.from('farms').select('*').eq('owner_id', A.uid)
ok("B cannot read A's farms", (xFarms ?? []).length === 0)

const { data: xRecs } = await B.client.from('crop_records').select('*').eq('farm_id', farm.id)
ok("B cannot read A's crop records", (xRecs ?? []).length === 0)

const { data: xApps } = await B.client.from('financing_applications').select('*').eq('applicant_id', A.uid)
ok("B cannot read A's applications", (xApps ?? []).length === 0)

const { error: xRecInsErr } = await B.client
  .from('crop_records').insert({ farm_id: farm.id, crop: 'Rice', season_year: 2026 })
ok("B cannot add records to A's farm", !!xRecInsErr, xRecInsErr?.message?.slice(0, 50))

const { data: xUpd } = await B.client
  .from('farms').update({ farm_name: 'HACKED' }).eq('id', farm.id).select()
ok("B cannot update A's farm", (xUpd ?? []).length === 0)

const { error: xReqErr } = await B.client.rpc('loamy_request_farm_verification', { p_farm_id: farm.id })
ok("B cannot request verification on A's farm", !!xReqErr, xReqErr?.message?.slice(0, 50))

const { error: xAppInsErr } = await B.client
  .from('financing_applications')
  .insert({ applicant_id: B.uid, farm_id: farm.id, status: 'draft' })
ok("B cannot attach A's farm to an application", !!xAppInsErr, xAppInsErr?.message?.slice(0, 50))

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(`Test password (both accounts): ${PASSWORD}`)
process.exit(failed.length ? 1 : 0)
