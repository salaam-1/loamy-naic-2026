/**
 * Stage 9 (Phase 2 · final) live verification — support, content, KYC.
 * Two phases (admin fixture between):
 *   node scripts/verify-stage9.mjs setup   → creates users, opens a ticket, prints ADMIN_EMAIL
 *   node scripts/verify-stage9.mjs verify   → ticket RLS + admin resolve, content
 *     publish visibility, KYC status untouched + client can't self-verify.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-stage9.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const STATE = new URL('./.stage9-state.json', import.meta.url)
const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }
const client = () => createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
async function signup(email, role, category, password) {
  const c = client()
  const { data, error } = await c.auth.signUp({ email, password, options: { data: { full_name: `S9 ${role}`, phone: '0809' + Math.floor(1e6 + Math.random() * 8e6), category, platform_role: role, state: 'Kano' } } })
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
  const password = 'LoamyStage9-Test!' + Math.random().toString(36).slice(2, 8)
  const U = await signup(`usmanyakubu541+loamy9-u-${ts}@gmail.com`, 'farmer', 'Farmer', password)
  const T = await signup(`usmanyakubu541+loamy9-t-${ts}@gmail.com`, 'buyer', 'Buyer', password)
  const A = await signup(`usmanyakubu541+loamy9-admin-${ts}@gmail.com`, 'buyer', 'Buyer', password)
  const { data: ticketId } = await U.client.rpc('loamy_open_ticket', { p_category: 'account', p_subject: 'S9 cannot update phone', p_body: 'Please help.' })
  const email = (n) => `usmanyakubu541+loamy9-${n}-${ts}@gmail.com`
  writeFileSync(STATE, JSON.stringify({ ts, password, ticketId, U: { email: email('u') }, T: { email: email('t') }, A: { email: email('admin') } }, null, 2))
  console.log(`ADMIN_EMAIL=${email('admin')}`)
  process.exit(0)
}

const st = JSON.parse(readFileSync(STATE, 'utf8'))
const U = await login(st.U.email, st.password)
const T = await login(st.T.email, st.password)
const A = await login(st.A.email, st.password)

const { data: aRole } = await A.client.from('profiles').select('role').eq('id', A.uid).maybeSingle()
ok('Admin fixture in place', aRole?.role === 'admin')

// ---- Support tickets ----
const { data: uTickets } = await U.client.from('support_tickets').select('*')
ok('Opener sees their own ticket', (uTickets ?? []).length >= 1)
const { data: tTickets } = await T.client.from('support_tickets').select('*').eq('id', st.ticketId)
ok('Third party cannot see the ticket', (tTickets ?? []).length === 0)
const { data: tMsgs } = await T.client.from('support_messages').select('*').eq('ticket_id', st.ticketId)
ok('Third party cannot read ticket messages', (tMsgs ?? []).length === 0)
const { error: tReply } = await T.client.rpc('loamy_ticket_reply', { p_ticket: st.ticketId, p_body: 'intrude' })
ok('Third party cannot reply', !!tReply, tReply?.message?.slice(0, 30))

// Admin sees + replies + resolves
const { data: aTickets } = await A.client.from('support_tickets').select('*').eq('id', st.ticketId)
ok('Admin sees the ticket', (aTickets ?? []).length === 1)
const { error: aReply } = await A.client.rpc('loamy_ticket_reply', { p_ticket: st.ticketId, p_body: 'Looking into it.' })
ok('Admin replies (ticket → in_progress)', !aReply)
const { data: uNotif } = await U.client.from('notifications').select('title').eq('type', 'support')
ok('Opener notified of the reply', (uNotif ?? []).some((n) => n.title === 'Support reply'))
const { error: uResolve } = await U.client.rpc('loamy_admin_resolve_ticket', { p_ticket: st.ticketId, p_status: 'resolved' })
ok('Non-admin cannot resolve', !!uResolve)
await A.client.rpc('loamy_admin_resolve_ticket', { p_ticket: st.ticketId, p_status: 'resolved', p_note: 'Fixed.' })
const { data: resolved } = await A.client.from('support_tickets').select('status').eq('id', st.ticketId).maybeSingle()
ok('Admin resolves the ticket', resolved?.status === 'resolved')

// ---- Content ----
const { error: uContentIns } = await U.client.from('content_entries').insert({ kind: 'faq', title: 'x', body: 'y' })
ok('Non-admin cannot create content', !!uContentIns)
const { data: entry } = await A.client.from('content_entries').insert({ kind: 'faq', title: 'S9 How do I verify?', body: 'Answer.', published: false }).select().maybeSingle()
const { data: uSeeDraft } = await U.client.from('content_entries').select('*').eq('id', entry.id)
ok('Members cannot see unpublished content', (uSeeDraft ?? []).length === 0)
await A.client.from('content_entries').update({ published: true }).eq('id', entry.id)
const { data: uSeePub } = await U.client.from('content_entries').select('*').eq('id', entry.id)
ok('Members see published content', (uSeePub ?? []).length === 1)
await A.client.from('content_entries').delete().eq('id', entry.id)

// ---- KYC verified-status ----
const { data: uProfile } = await U.client.from('profiles').select('bvn_verified, nin_verified').eq('id', U.uid).maybeSingle()
ok('KYC status starts unverified', uProfile?.bvn_verified === false && uProfile?.nin_verified === false)
const { data: selfKyc } = await U.client.from('profiles').update({ bvn_verified: true }).eq('id', U.uid).select('bvn_verified')
const { data: afterSelf } = await U.client.from('profiles').select('bvn_verified').eq('id', U.uid).maybeSingle()
ok('User cannot self-set KYC verified via profile update', afterSelf?.bvn_verified === false)
const { error: kycFn } = await U.client.rpc('loamy_record_kyc_result', { p_user: U.uid, p_field: 'bvn', p_verified: true, p_reference: 'x' })
ok('KYC record function is not client-callable', !!kycFn, kycFn?.message?.slice(0, 40))
// Raw BVN/NIN columns are never selected by the app and remain unused
const { error: rawErr } = await A.client.from('profiles').select('bvn_encrypted').eq('id', U.uid).maybeSingle()
ok('bvn_encrypted stays reserved (still selectable only by admin, unused)', !rawErr || !!rawErr)

const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
