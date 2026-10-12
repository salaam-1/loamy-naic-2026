/**
 * Live verification for the 2026-09-19 change set (migrations 20260919100001–06).
 *
 *   node scripts/verify-sept2026.mjs
 *
 * Creates two throwaway accounts, exercises every new surface against the LIVE
 * project, and cleans up the rows it created. It deliberately leans on the
 * NEGATIVE cases — the ones that matter are "a second account cannot read my
 * wallet", "I cannot overdraw", "I cannot switch into a role I do not hold".
 *
 * Read-only on everything that already existed; the only writes are this
 * script's own fixtures.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-sept2026.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const results = []
const ok = (n, p, d = '') => {
  results.push({ n, p })
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`)
}
const client = () =>
  createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })

async function signup(email, role, category, password) {
  const c = client()
  const { data, error } = await c.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: `Sept26 ${role}`,
        phone: '0809' + Math.floor(1e6 + Math.random() * 8e6),
        category,
        platform_role: role,
        state: 'Kano',
      },
    },
  })
  if (error || !data.session) throw new Error(`signup ${email}: ${error?.message}`)
  return { c, uid: data.user.id, email }
}

const ts = Date.now().toString(36)
const password = 'LoamySept26-Test!' + Math.random().toString(36).slice(2, 8)
const A = await signup(`usmanyakubu541+s26-a-${ts}@gmail.com`, 'trader', 'Trader', password)
const B = await signup(`usmanyakubu541+s26-b-${ts}@gmail.com`, 'farmer', 'Farmer', password)
console.log(`\nfixtures: A=${A.email} (trader)  B=${B.email} (farmer)\n`)

// ---------------------------------------------------------------------------
// 1. Farmer financing — the ₦500,000 cap is gone.
// ---------------------------------------------------------------------------
{
  const { data, error } = await B.c
    .from('financing_applications')
    .insert({
      applicant_id: B.uid,
      amount_requested: 2_500_000,
      purpose: 'Verification: above the old pilot cap',
      status: 'draft',
    })
    .select('id')
    .maybeSingle()
  ok('financing above the old ₦500k cap is accepted', !error && !!data, error?.message)
  if (data) await B.c.from('financing_applications').delete().eq('id', data.id)
}

// ---------------------------------------------------------------------------
// 2. Service directory — full address column.
// ---------------------------------------------------------------------------
{
  const { error } = await A.c.from('service_directory').select('address').limit(1)
  ok('service_directory.address is selectable', !error, error?.message)
}

// ---------------------------------------------------------------------------
// 3. Market prices — tonne units + quantity normalisation.
// ---------------------------------------------------------------------------
{
  const { data: units } = await A.c
    .from('commodity_units')
    .select('unit_name, kg_equivalent')
    .eq('active', true)
  const names = (units ?? []).map((u) => u.unit_name.toLowerCase())
  ok('tonne unit exists (1000kg)', names.includes('tonne'),
    `${units?.find((u) => u.unit_name === 'tonne')?.kg_equivalent ?? '—'} kg`)

  // A non-ambassador must still be refused: quantity did not loosen the gate.
  const { error } = await A.c.rpc('loamy_submit_ambassador_price', {
    p_state: 'Kano', p_lga: null, p_market: 'Verify market', p_commodity: 'Maize',
    p_variety: null, p_price_low: 100, p_price_high: 200, p_unit: 'tonne',
    p_quantity: 2, p_observed_date: new Date().toISOString().slice(0, 10),
    p_note: null, p_photo_url: null,
  })
  ok('price submission still gated to ambassadors/admins', !!error, error?.message)
  ok('RPC accepts the new p_quantity argument',
    !!error && !/p_quantity|does not exist|schema cache/i.test(error.message), error?.message)
}

// ---------------------------------------------------------------------------
// 4. Trader & Buyer merge — `buyer` counts as a supplier role.
// ---------------------------------------------------------------------------
{
  const { data, error } = await A.c.rpc('loamy_is_supplier_role')
  ok('loamy_is_supplier_role answers for a trader', !error && data === true, error?.message)
}

// ---------------------------------------------------------------------------
// 5. Multi-role accounts.
// ---------------------------------------------------------------------------
{
  const { data: mine } = await A.c.from('user_platform_roles').select('role, onboarded')
  ok('signup role was backfilled into user_platform_roles',
    (mine ?? []).some((r) => r.role === 'trader'), JSON.stringify(mine))

  // Cross-account read must return nothing (RLS, not an error).
  const { data: theirs } = await B.c.from('user_platform_roles').select('role').eq('user_id', A.uid)
  ok('a second account cannot read my roles', (theirs ?? []).length === 0,
    `${theirs?.length ?? 0} rows`)

  // Switching into a role not held must be refused.
  const { error: notHeld } = await A.c.rpc('loamy_switch_role', { p_role: 'growth_partner' })
  ok('switching into an unheld role is refused', !!notHeld, notHeld?.message)

  // The operational bank role must never be reachable.
  const { error: bankAdd } = await A.c.rpc('loamy_add_role', { p_role: 'bank' })
  ok('adding the bank role is refused', !!bankAdd, bankAdd?.message)
  const { error: bankSwitch } = await A.c.rpc('loamy_switch_role', { p_role: 'bank' })
  ok('switching into the bank role is refused', !!bankSwitch, bankSwitch?.message)

  // The happy path: add, then switch.
  const { error: addErr } = await A.c.rpc('loamy_add_role', { p_role: 'warehouse_owner' })
  ok('adding a second role succeeds', !addErr, addErr?.message)
  const { error: swErr } = await A.c.rpc('loamy_switch_role', { p_role: 'warehouse_owner' })
  ok('switching into the added role succeeds', !swErr, swErr?.message)
  const { data: prof } = await A.c.from('profiles').select('platform_role, category').eq('id', A.uid).maybeSingle()
  ok('active role and category moved together',
    prof?.platform_role === 'warehouse_owner' && prof?.category === 'Warehouse Owner',
    JSON.stringify(prof))
  // Back to trader so later checks read naturally.
  await A.c.rpc('loamy_switch_role', { p_role: 'trader' })
}

// ---------------------------------------------------------------------------
// 6. Wallet.
// ---------------------------------------------------------------------------
{
  const { data: bal, error: balErr } = await A.c.rpc('loamy_wallet_balance')
  ok('wallet balance reads zero for a new account', !balErr && Number(bal) === 0,
    balErr?.message ?? `balance=${bal}`)

  // Asking for someone else's balance must be refused outright.
  const { error: otherBal } = await B.c.rpc('loamy_wallet_balance', { p_user: A.uid })
  ok("cannot read another member's balance", !!otherBal, otherBal?.message)

  // Ledger is own-rows-only.
  const { data: entries } = await B.c.from('wallet_entries').select('id').eq('user_id', A.uid)
  ok("cannot read another member's ledger", (entries ?? []).length === 0, `${entries?.length ?? 0} rows`)

  // No client write path to the ledger at all.
  const { error: insErr } = await A.c.from('wallet_entries').insert({
    user_id: A.uid, direction: 'credit', amount: 1000, kind: 'adjustment',
    reference: `verify-${ts}`,
  })
  ok('clients cannot credit their own wallet', !!insErr, insErr?.message)

  // Withdrawal with no balance and no bank account.
  const { error: wdErr } = await A.c.rpc('loamy_request_withdrawal', { p_amount: 5000 })
  ok('withdrawal without a verified bank account is refused', !!wdErr, wdErr?.message)

  // Zero / negative amounts.
  const { error: zeroErr } = await A.c.rpc('loamy_request_withdrawal', { p_amount: 0 })
  ok('zero-amount withdrawal is refused', !!zeroErr, zeroErr?.message)

  const { data: wds } = await B.c.from('wallet_withdrawals').select('id').eq('user_id', A.uid)
  ok("cannot read another member's withdrawals", (wds ?? []).length === 0, `${wds?.length ?? 0} rows`)
}

// ---------------------------------------------------------------------------
// 7. Anonymous must see none of it.
// ---------------------------------------------------------------------------
{
  const anon = client()
  for (const t of ['wallet_entries', 'wallet_withdrawals', 'user_platform_roles']) {
    const { data, error } = await anon.from(t).select('*').limit(1)
    ok(`anon sees no ${t}`, !!error || (data ?? []).length === 0, error?.message ?? `${data?.length ?? 0} rows`)
  }
}

const passed = results.filter((r) => r.p).length
console.log(`\n${passed}/${results.length} checks passed`)
console.log(`\nClean up the two fixture accounts in Supabase → Authentication:\n  ${A.email}\n  ${B.email}`)
process.exit(passed === results.length ? 0 : 1)
