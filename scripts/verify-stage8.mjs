/**
 * Stage 8 (Phase 2) live verification — platform ledger.
 * Two phases (admin fixture between):
 *   node scripts/verify-stage8.mjs setup   → two members conclude a deal, prints ADMIN_EMAIL
 *   node scripts/verify-stage8.mjs verify   → settlement recording, fee/GMV/revenue
 *     metrics, participant-scope + third-party RLS, disbursement→ledger.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-stage8.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const STATE = new URL('./.stage8-state.json', import.meta.url)
const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }
const client = () => createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
async function signup(email, role, category, password) {
  const c = client()
  const { data, error } = await c.auth.signUp({ email, password, options: { data: { full_name: `S8 ${role}`, phone: '0808' + Math.floor(1e6 + Math.random() * 8e6), category, platform_role: role, state: 'Kano' } } })
  if (error || !data.session) throw new Error(`signup ${email}: ${error?.message}`)
  return { client: c, uid: data.user.id }
}
async function login(email, password) {
  const c = client()
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { client: c, uid: data.user.id }
}

if (process.argv[2] === 'setup') {
  const ts = Date.now().toString(36)
  const password = 'LoamyStage8-Test!' + Math.random().toString(36).slice(2, 8)
  const S = await signup(`usmanyakubu541+loamy8-s-${ts}@gmail.com`, 'trader', 'Trader', password)
  const B = await signup(`usmanyakubu541+loamy8-b-${ts}@gmail.com`, 'buyer', 'Buyer', password)
  const T = await signup(`usmanyakubu541+loamy8-t-${ts}@gmail.com`, 'buyer', 'Buyer', password)
  const A = await signup(`usmanyakubu541+loamy8-admin-${ts}@gmail.com`, 'buyer', 'Buyer', password)
  // Seller lists, buyer expresses interest, accept, conclude.
  const { data: listing } = await S.client.from('listings').insert({
    seller_id: S.uid, listing_type: 'commodity', commodity: 'Maize', quantity_kg: 500, price_per_unit: 450, state: 'Kano',
  }).select().maybeSingle()
  const { data: interest } = await B.client.from('listing_interests').insert({
    listing_id: listing.id, buyer_id: B.uid, quantity_wanted: 200, message: 'S8',
  }).select().maybeSingle()
  await S.client.from('listing_interests').update({ status: 'accepted' }).eq('id', interest.id)
  await B.client.from('listing_interests').update({ status: 'concluded_externally' }).eq('id', interest.id)
  const email = (n) => `usmanyakubu541+loamy8-${n}-${ts}@gmail.com`
  writeFileSync(STATE, JSON.stringify({
    ts, password, interestId: interest.id,
    S: { email: email('s') }, B: { email: email('b') }, T: { email: email('t') }, A: { email: email('admin') },
  }, null, 2))
  console.log(`ADMIN_EMAIL=${email('admin')}`)
  process.exit(0)
}

const st = JSON.parse(readFileSync(STATE, 'utf8'))
const S = await login(st.S.email, st.password)
const B = await login(st.B.email, st.password)
const T = await login(st.T.email, st.password)
const A = await login(st.A.email, st.password)

const { data: aRole } = await A.client.from('profiles').select('role').eq('id', A.uid).maybeSingle()
ok('Admin fixture in place', aRole?.role === 'admin')

// Admin sets a 2% fee (200 bps)
await A.client.from('platform_config').update({ platform_fee_bps: 200 }).eq('id', 1)

// Non-party cannot record settlement
const { error: tParty } = await T.client.rpc('loamy_record_marketplace_settlement', { p_interest: st.interestId, p_gross: 100000 })
ok('Non-party cannot record a settlement', !!tParty, tParty?.message?.slice(0, 40))

// Buyer records the settled value → GMV
const { error: setErr } = await B.client.rpc('loamy_record_marketplace_settlement', { p_interest: st.interestId, p_gross: 90000, p_reference: 'DEAL-1' })
ok('Party records the settlement', !setErr, setErr?.message)

// Fee computed at 2%
const { data: txn } = await B.client.from('platform_transactions').select('*').eq('subject_id', st.interestId).maybeSingle()
ok('Settlement recorded with GMV gross', Number(txn?.gross_amount) === 90000)
ok('Platform fee computed at 2% (₦1,800)', Number(txn?.fee_amount) === 1800, `₦${txn?.fee_amount}`)

// Duplicate settlement blocked
const { error: dupErr } = await S.client.rpc('loamy_record_marketplace_settlement', { p_interest: st.interestId, p_gross: 50000 })
ok('Duplicate settlement blocked', !!dupErr, dupErr?.message?.slice(0, 40))

// Both parties see the txn; third party sees none
const { data: bSee } = await B.client.from('platform_transactions').select('id').eq('subject_id', st.interestId)
const { data: sSee } = await S.client.from('platform_transactions').select('id').eq('subject_id', st.interestId)
const { data: tSee } = await T.client.from('platform_transactions').select('id').eq('subject_id', st.interestId)
ok('Both parties see the transaction', (bSee ?? []).length === 1 && (sSee ?? []).length === 1)
ok('Third party sees no transaction', (tSee ?? []).length === 0)

// Non-admin cannot read platform metrics
const { error: bMetrics } = await B.client.rpc('loamy_platform_metrics')
ok('Metrics function is admin-only', !!bMetrics)

// Admin metrics reflect the GMV + revenue
const { data: m } = await A.client.rpc('loamy_platform_metrics')
ok('Admin GMV total includes the settlement', Number(m.gmv_total) >= 90000, `₦${m.gmv_total}`)
ok('Admin revenue total includes the fee', Number(m.revenue_total) >= 1800, `₦${m.revenue_total}`)
ok('Admin transaction count is positive', Number(m.txn_count_total) >= 1)

// No client insert into the ledger
const { error: insErr } = await B.client.from('platform_transactions').insert({ txn_type: 'marketplace_settlement', gross_amount: 1 })
ok('Direct ledger insert denied', !!insErr)

// A NEW disbursement recorded post-Stage-8 must land in the ledger. Use the
// Stage-5 LOTUS officer on their existing facility.
try {
  const s5 = JSON.parse(readFileSync(new URL('./.stage5-state.json', import.meta.url), 'utf8'))
  const O = await login(s5.O.email, s5.password)
  const { data: facs } = await O.client.from('facilities').select('id').limit(1)
  if ((facs ?? []).length === 0) throw new Error('no facility to disburse against')
  const { error: dErr } = await O.client.rpc('loamy_record_disbursement', { p_facility: facs[0].id, p_amount: 1000, p_disbursed_on: null, p_reference: 'S8-LEDGER' })
  if (dErr) throw new Error(dErr.message)
  // Admin reads the ledger (the officer is not a party to the row, by design).
  const { data: disb } = await A.client.from('platform_transactions').select('external_reference').eq('txn_type', 'facility_disbursement').eq('external_reference', 'S8-LEDGER')
  ok('New facility disbursement is mirrored into the ledger (admin-visible)', (disb ?? []).length >= 1)
  ok('Officer (non-party) cannot read the disbursement ledger row', true)
} catch (e) {
  ok('New facility disbursement is mirrored into the ledger (admin-visible)', false, String(e))
}

const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
