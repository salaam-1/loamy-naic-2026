/**
 * Stage 1 live verification — run with: node scripts/verify-stage1.mjs
 *
 * Creates two test accounts (different roles) against the LIVE project and
 * checks: portal signup trigger compatibility (digital_id), the
 * category→platform_role sync trigger, the onboarding write path, feature
 * flags, and — most importantly — that RLS blocks every cross-user access.
 * Uses only the browser-safe publishable key; every check runs under RLS.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-stage1.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const URL_ = TEST_ENV.url
const KEY = TEST_ENV.key
const PASSWORD = 'LoamyStage1-Test!' + Math.random().toString(36).slice(2, 8)

const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function newClient() {
  return createClient(URL_, KEY, { auth: { persistSession: false } })
}

// Portal's profiles_category_check requires these exact Title-case labels.
const CATEGORY_LABELS = { farmer: 'Farmer', trader: 'Trader' }

async function signupAndOnboard(email, role, roleData) {
  const client = newClient()
  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: {
      data: {
        full_name: `Stage1 Test ${role}`,
        phone: '08000000000',
        category: CATEGORY_LABELS[role],
        platform_role: role,
        state: 'Kaduna',
      },
    },
  })
  if (error) {
    // Account may exist from a previous run — try signing in instead.
    const { data: si, error: siErr } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (siErr) return { client, session: null, error: error.message + ' / ' + siErr.message }
    return { client, session: si.session, user: si.user }
  }
  if (!data.session) return { client, session: null, error: 'email confirmation required' }

  // Onboarding write path (same as the app's Onboarding page)
  const uid = data.user.id
  const { error: rdErr } = await client.from('role_details').upsert({ user_id: uid, role_data: roleData })
  const { error: pErr } = await client
    .from('profiles')
    .update({ platform_role: role, onboarding_complete: true })
    .eq('id', uid)
  return { client, session: data.session, user: data.user, rdErr, pErr }
}

const ts = Date.now().toString(36)
const farmerEmail = `usmanyakubu541+loamy-t1-${ts}@gmail.com`
const traderEmail = `usmanyakubu541+loamy-t2-${ts}@gmail.com`

console.log(`Creating test accounts:\n  ${farmerEmail}\n  ${traderEmail}\n`)

const farmer = await signupAndOnboard(farmerEmail, 'farmer', {
  farm_name: 'Stage1 Test Farm', farm_size_ha: 2, primary_crops: ['Maize'], lga: 'Zaria',
})
if (!farmer.session) {
  console.log(`BLOCKED: farmer signup gave no session (${farmer.error}).`)
  process.exit(2)
}
ok('Farmer signup creates a session', true)
ok('Onboarding writes role_details', !farmer.rdErr, farmer.rdErr?.message)
ok('Onboarding flips onboarding_complete', !farmer.pErr, farmer.pErr?.message)

// Portal trigger compatibility: profile row with digital_id + platform_role
const { data: fp } = await farmer.client
  .from('profiles')
  .select('id, digital_id, full_name, platform_role, onboarding_complete, role, state, category')
  .eq('id', farmer.user.id)
  .maybeSingle()
ok('Portal signup trigger created profile row', !!fp)
ok('digital_id generated (LOAMY#######)', /^LOAMY\d{7}$/.test(fp?.digital_id ?? ''), fp?.digital_id)
ok("platform_role = 'farmer' (sync trigger)", fp?.platform_role === 'farmer', String(fp?.platform_role))
ok('onboarding_complete = true', fp?.onboarding_complete === true)

// Feature flags readable when authenticated, all off
const { data: cfg } = await farmer.client.from('platform_config').select('flags').eq('id', 1).maybeSingle()
ok('platform_config readable when signed in', !!cfg?.flags)
ok('All Stage-1 flags are false', cfg && Object.values(cfg.flags).every((v) => v === false), JSON.stringify(cfg?.flags))

// Notifications: zero rows, and direct insert must be DENIED
const { count: nCount } = await farmer.client.from('notifications').select('id', { count: 'exact', head: true })
ok('New account has 0 notifications', nCount === 0, `count=${nCount}`)
const { error: nInsErr } = await farmer.client
  .from('notifications')
  .insert({ user_id: farmer.user.id, title: 'should fail' })
ok('Direct notifications INSERT denied by RLS', !!nInsErr, nInsErr?.message?.slice(0, 60))

// Second account, different role
const trader = await signupAndOnboard(traderEmail, 'trader', {
  business_name: 'Stage1 Test Trading', commodities: ['Rice'], years_active: 3,
})
if (!trader.session) {
  console.log(`BLOCKED: trader signup gave no session (${trader.error}).`)
  process.exit(2)
}
ok('Trader signup creates a session', true)
const { data: tp } = await trader.client
  .from('profiles').select('platform_role').eq('id', trader.user.id).maybeSingle()
ok("platform_role = 'trader'", tp?.platform_role === 'trader', String(tp?.platform_role))

// ---- CROSS-USER RLS: trader must see NOTHING of the farmer ----
const { data: xProfile } = await trader.client.from('profiles').select('*').eq('id', farmer.user.id)
ok("Trader cannot read farmer's profile", (xProfile ?? []).length === 0, `rows=${xProfile?.length}`)

const { data: xDetails } = await trader.client.from('role_details').select('*').eq('user_id', farmer.user.id)
ok("Trader cannot read farmer's role_details", (xDetails ?? []).length === 0, `rows=${xDetails?.length}`)

const { data: xNotif } = await trader.client.from('notifications').select('*').eq('user_id', farmer.user.id)
ok("Trader cannot read farmer's notifications", (xNotif ?? []).length === 0, `rows=${xNotif?.length}`)

const { data: xUpd } = await trader.client
  .from('profiles').update({ full_name: 'HACKED' }).eq('id', farmer.user.id).select()
ok("Trader cannot update farmer's profile", (xUpd ?? []).length === 0, `rows affected=${xUpd?.length}`)

const { error: xRd } = await trader.client
  .from('role_details').upsert({ user_id: farmer.user.id, role_data: { hacked: true } })
ok("Trader cannot write farmer's role_details", !!xRd, xRd?.message?.slice(0, 60))

const { error: xFlag } = await trader.client
  .from('platform_config').update({ flags: { marketplace: true } }).eq('id', 1)
const { data: cfgAfter } = await trader.client.from('platform_config').select('flags').eq('id', 1).maybeSingle()
ok('Non-admin cannot flip feature flags', cfgAfter?.flags?.marketplace === false, xFlag?.message?.slice(0, 60) ?? 'silently 0 rows')

// Farmer's own data still intact
const { data: fpAfter } = await farmer.client
  .from('profiles').select('full_name').eq('id', farmer.user.id).maybeSingle()
ok('Farmer profile unmodified after attack attempts', fpAfter?.full_name === 'Stage1 Test farmer', fpAfter?.full_name)

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(`Test password (both accounts): ${PASSWORD}`)
process.exit(failed.length ? 1 : 0)
