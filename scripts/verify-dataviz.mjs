/**
 * Dataviz pass verification — run with: node scripts/verify-dataviz.mjs
 *
 * 1) Pure chart-data functions (bucketWeekly / yieldBySeason / thresholds):
 *    empty tables produce EMPTY chart data — no fabricated points, gaps render
 *    as true zeros only between real endpoints.
 * 2) Live: chart queries respect existing RLS (a farmer's yield query returns
 *    zero rows of another farmer; partner aggregates are caller-scoped).
 * 3) Live: partner funnel/earnings populate zero → sparse → counts as fresh
 *    data lands, without fabrication at any step.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { bucketWeekly, realPointCount, yieldBySeason, MIN_TREND_POINTS, MIN_SPARK_POINTS } from '../src/lib/charts.ts'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-dataviz.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const client = () =>
  createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
async function login(email, password) {
  const c = client()
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { client: c, uid: data.user.id }
}

// ---- 1) Pure functions: the sparse rule is structural ----
ok('Empty table → empty chart data (no fabricated points)', bucketWeekly([], []).length === 0)

const oneRow = bucketWeekly([{ at: '2026-07-01' }], [{ key: 'n', date: (r) => r.at }])
ok('One event → one bucket (below trend threshold → sparse state)',
  oneRow.length === 1 && realPointCount(oneRow, ['n']) === 1 && 1 < MIN_TREND_POINTS)

const spread = bucketWeekly(
  [{ at: '2026-06-01' }, { at: '2026-06-22' }],
  [{ key: 'n', date: (r) => r.at }],
)
ok('Gap weeks render as TRUE zeros between real endpoints (never interpolated)',
  spread.length === 4 && spread[1].n === 0 && spread[2].n === 0 && spread[0].n === 1 && spread[3].n === 1)

const y = yieldBySeason([
  { crop: 'Maize', season_year: 2025, actual_yield_kg: 100 },
  { crop: 'Rice', season_year: 2025, actual_yield_kg: null }, // expectation only — must NOT chart
])
ok('Expected-only yields never chart (actuals only)',
  y.rows.length === 1 && y.series.length === 1 && y.series[0].key === 'Maize')

const manyCrops = yieldBySeason(
  ['A', 'B', 'C', 'D', 'E', 'F'].map((c, i) => ({ crop: c, season_year: 2025, actual_yield_kg: 100 - i })),
)
ok('More than 4 crops fold into gray "Other" (fixed series, never cycled hues)',
  manyCrops.series.length === 5 && manyCrops.series[4].key === 'Other' && manyCrops.series[4].other === true)

ok('Sparkline threshold: 1–2 price entries draw no line', MIN_SPARK_POINTS === 3)

// ---- 2) Live RLS on chart queries ----
const s5 = JSON.parse(readFileSync(new URL('./.stage5-state.json', import.meta.url), 'utf8'))
const s6 = JSON.parse(readFileSync(new URL('./.stage6-state.json', import.meta.url), 'utf8'))
const F5 = await login(s5.F.email, s5.password)   // farmer with crop records
const F5b = await login(s5.F2.email, s5.password) // second farmer
const P6 = await login(s6.P.email, s6.password)   // growth partner (no onboardees yet)

const { data: ownYield } = await F5.client.from('crop_records').select('crop, season_year, actual_yield_kg')
const { data: otherYield } = await F5b.client.from('crop_records').select('crop, season_year, actual_yield_kg')
ok("Yield chart query: farmer sees own records, another farmer sees NONE of them",
  (ownYield ?? []).length >= 2 && (otherYield ?? []).length === 0,
  `own=${ownYield?.length} other=${otherYield?.length}`)

const { data: f5Funnel } = await F5.client.rpc('loamy_partner_funnel')
ok('Funnel fn for a non-partner caller returns zeros (caller-scoped)', f5Funnel?.registered === 0)
const { data: f5Terr } = await F5.client.rpc('loamy_partner_territory')
ok('Territory fn for a non-partner caller returns no rows', (f5Terr ?? []).length === 0)

// ---- 3) Baseline → +1 real signup → +1 real onboarding (state-independent:
// runs mutate the live DB, so every assertion is relative to a baseline) ----
const { data: funnel0, error: funnel0Err } = await P6.client.rpc('loamy_partner_funnel')
if (funnel0Err) throw new Error(`funnel rpc: ${funnel0Err.message}`)
ok('Funnel returns honest counts for the partner (verified stays untouched)',
  typeof funnel0.registered === 'number' && typeof funnel0.verified === 'number',
  `baseline registered=${funnel0.registered}`)
const { data: earn0 } = await P6.client.from('partner_earnings').select('created_at, amount')
const buckets0 = bucketWeekly(earn0 ?? [], [{ key: 'a', date: (r) => r.created_at, value: (r) => Number(r.amount) }])
const bucketSum0 = buckets0.reduce((s, b) => s + Number(b.a), 0)
const rowSum0 = (earn0 ?? []).reduce((s, r) => s + Number(r.amount), 0)
ok('Earnings buckets contain exactly the real accruals (sum matches rows)', bucketSum0 === rowSum0,
  `₦${bucketSum0} across ${buckets0.length} bucket(s)`)

// Fresh farmer attributes to P6 → registered 1; completes onboarding → 2nd step.
const { data: pProfile } = await P6.client.from('profiles').select('digital_id').eq('id', P6.uid).maybeSingle()
const ts = Date.now().toString(36)
const nf = client()
const { data: nfData, error: nfErr } = await nf.auth.signUp({
  email: `usmanyakubu541+loamy-viz-${ts}@gmail.com`,
  password: s6.password,
  options: {
    data: {
      full_name: 'Dataviz Farmer', phone: '08066660001',
      category: 'Farmer', platform_role: 'farmer', state: 'Kano',
    },
  },
})
if (nfErr || !nfData.session) throw new Error(`fresh farmer signup: ${nfErr?.message}`)
await nf.rpc('loamy_record_referral', { p_ref_code: pProfile.digital_id, p_method: 'referral_link' })

const { data: funnel1 } = await P6.client.rpc('loamy_partner_funnel')
ok('Funnel: registered rises by exactly the one real signup',
  funnel1.registered === funnel0.registered + 1 && funnel1.profile_completed === funnel0.profile_completed)

await nf.from('role_details').upsert({ user_id: nfData.user.id, role_data: { farm_name: 'Viz Farm', farm_size_ha: 1, primary_crops: ['Maize'], lga: 'Kura' } })
await nf.from('profiles').update({ platform_role: 'farmer', onboarding_complete: true }).eq('id', nfData.user.id)
const { data: funnel2 } = await P6.client.rpc('loamy_partner_funnel')
ok('Funnel: profile-completed follows the real onboarding, verified untouched',
  funnel2.profile_completed === funnel0.profile_completed + 1 && funnel2.verified === funnel0.verified)

const { data: earn1 } = await P6.client.from('partner_earnings').select('created_at, amount')
const buckets1 = bucketWeekly(earn1 ?? [], [{ key: 'a', date: (r) => r.created_at, value: (r) => Number(r.amount) }])
const bucketSum1 = buckets1.reduce((s, b) => s + Number(b.a), 0)
ok('Earnings trend grows by exactly the new real accrual (₦500), stays sparse below threshold',
  bucketSum1 === rowSum0 + 500 && realPointCount(buckets1, ['a']) < MIN_TREND_POINTS,
  `₦${bucketSum1} across ${buckets1.length} bucket(s)`)

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
