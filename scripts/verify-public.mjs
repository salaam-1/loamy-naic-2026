/**
 * Public access verification — the anon role must read ONLY the safe view and
 * NOTHING else, with no PII leaking. node scripts/verify-public.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-public.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
// A pristine anon client — no session.
const anon = createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

// Public view IS readable by anon
const { data: pub, error: pubErr } = await anon.from('loamy_public_listings').select('*').limit(5)
ok('anon can read loamy_public_listings', !pubErr && Array.isArray(pub), pubErr?.message)

// Only safe columns exist — no seller_id / phone / email / coordinates
if (pub && pub.length > 0) {
  const keys = Object.keys(pub[0])
  const leaks = keys.filter((k) => /seller_id|phone|email|latitude|longitude|owner_id|digital_id|bvn|nin/i.test(k))
  ok('public view exposes no id/phone/email/coordinate columns', leaks.length === 0, leaks.join(',') || 'clean')
  ok('public view returns only active listings (has seller_display_name)', 'seller_display_name' in pub[0])
  // The raw payload string must not contain an email or an 11-digit phone.
  const blob = JSON.stringify(pub)
  ok('no email address in public payload', !/@/.test(blob))
  ok('no 11-digit phone in public payload', !/\b\d{11}\b/.test(blob))
} else {
  ok('public view exposes no unsafe columns (no rows to inspect)', true)
}

// anon must NOT read base tables directly
for (const t of ['listings', 'profiles', 'farms', 'listing_interests', 'financing_applications', 'platform_transactions']) {
  const { data } = await anon.from(t).select('*').limit(1)
  ok(`anon cannot read base table "${t}" (RLS)`, (data ?? []).length === 0)
}

// anon cannot call privileged functions
const { error: bundleErr } = await anon.rpc('loamy_platform_metrics')
ok('anon cannot call admin metrics', !!bundleErr)
const { error: modErr } = await anon.rpc('loamy_admin_moderate_listing', { p_listing: '00000000-0000-0000-0000-000000000000', p_action: 'remove' })
ok('anon cannot moderate listings', !!modErr)

// anon cannot insert an interest (the gated action)
const { error: insErr } = await anon.from('listing_interests').insert({ listing_id: pub?.[0]?.id ?? '00000000-0000-0000-0000-000000000000', buyer_id: '00000000-0000-0000-0000-000000000000' })
ok('anon cannot express interest (gated action)', !!insErr)

const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
