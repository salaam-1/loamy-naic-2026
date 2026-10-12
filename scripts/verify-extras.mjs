/**
 * Extras verification — service bookings RLS + Open-Meteo weather smoke.
 * Single phase (no admin needed): node scripts/verify-extras.mjs
 *
 * Accounts: OWN warehouse owner (publishes a directory entry) · BK booker
 *           (farmer) · TP third party (buyer, must see nothing).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-extras.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const PASSWORD = 'LoamyExtras-Test!' + Math.random().toString(36).slice(2, 8)
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const client = () => createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
async function signup(email, role, category) {
  const c = client()
  const { data, error } = await c.auth.signUp({
    email, password: PASSWORD,
    options: { data: { full_name: `Extras ${role}`, phone: '0807000' + Math.floor(1000 + Math.random() * 9000), category, platform_role: role, state: 'Kano' } },
  })
  if (error || !data.session) throw new Error(`signup ${email}: ${error?.message}`)
  return { client: c, uid: data.user.id }
}

const ts = Date.now().toString(36)
const OWN = await signup(`usmanyakubu541+loamyx-own-${ts}@gmail.com`, 'warehouse_owner', 'Warehouse Owner')
const BK = await signup(`usmanyakubu541+loamyx-bk-${ts}@gmail.com`, 'farmer', 'Farmer')
const TP = await signup(`usmanyakubu541+loamyx-tp-${ts}@gmail.com`, 'buyer', 'Buyer')
console.log(`Accounts: +loamyx-{own,bk,tp}-${ts}\n`)

// Flag
const { data: cfg } = await BK.client.from('platform_config').select('flags').eq('id', 1).maybeSingle()
ok('service_booking flag is ON', cfg?.flags?.service_booking === true, JSON.stringify(cfg?.flags?.service_booking))

// Owner publishes a directory entry
const { data: entry, error: entErr } = await OWN.client.from('service_directory').insert({
  owner_id: OWN.uid, service_type: 'warehouse', business_name: 'Extras AgriStore', state: 'Kano', capacity_note: '500t dry',
}).select().maybeSingle()
ok('Owner publishes directory entry', !!entry && !entErr, entErr?.message)

// Owner cannot book their own entry
const { error: selfBook } = await OWN.client.from('service_bookings').insert({
  directory_id: entry.id, booker_id: OWN.uid, service_type: 'warehouse', start_date: '2026-09-01', details: 'mine',
})
ok('Owner cannot book their own service', !!selfBook, selfBook?.message?.slice(0, 45))

// Booker requests a booking
const { data: booking, error: bkErr } = await BK.client.from('service_bookings').insert({
  directory_id: entry.id, booker_id: BK.uid, service_type: 'warehouse',
  start_date: '2026-09-01', end_date: '2026-10-01', details: '50t maize, dry storage',
}).select().maybeSingle()
ok('Booker creates a booking request', !!booking && !bkErr, bkErr?.message)

// A client-sent service_type that mismatches the directory is force-corrected
// server-side (trigger) to the directory's type — mismatch is impossible.
const { data: forced } = await BK.client.from('service_bookings').insert({
  directory_id: entry.id, booker_id: BK.uid, service_type: 'logistics', start_date: '2026-09-05', details: 'type test',
}).select().maybeSingle()
ok('Client service_type force-corrected to the directory type', forced?.service_type === 'warehouse', forced?.service_type)

// Contacts NOT available before acceptance (both parties)
const { error: preBk } = await BK.client.rpc('loamy_get_booking_contacts', { p_booking: booking.id })
const { error: preOwn } = await OWN.client.rpc('loamy_get_booking_contacts', { p_booking: booking.id })
ok('Contacts denied before acceptance (both parties)', !!preBk && !!preOwn, preBk?.message?.slice(0, 45))

// Third party sees nothing + denied contacts
const { data: tpSees } = await TP.client.from('service_bookings').select('*').eq('id', booking.id)
const { error: tpContacts } = await TP.client.rpc('loamy_get_booking_contacts', { p_booking: booking.id })
ok('Third party sees no booking and no contacts', (tpSees ?? []).length === 0 && !!tpContacts)

// Booker cannot self-accept
const { data: selfAccept } = await BK.client.from('service_bookings').update({ status: 'accepted' }).eq('id', booking.id).select()
ok('Booker cannot self-accept', (selfAccept ?? []).length === 0)

// Owner accepts
const { error: acceptErr } = await OWN.client.from('service_bookings').update({ status: 'accepted', owner_response: 'Space available.' }).eq('id', booking.id)
ok('Owner accepts the booking', !acceptErr, acceptErr?.message)

// Booker notified
const { data: bkNotif } = await BK.client.from('notifications').select('title').eq('type', 'booking')
ok('Booker notified of acceptance', (bkNotif ?? []).some((n) => n.title === 'Booking accepted'))

// Contacts now available to both; third still denied
const { data: bkC, error: bkCErr } = await BK.client.rpc('loamy_get_booking_contacts', { p_booking: booking.id })
const { data: ownC } = await OWN.client.rpc('loamy_get_booking_contacts', { p_booking: booking.id })
ok('Both parties get contacts after acceptance (name+phone)',
  !bkCErr && (bkC ?? []).length === 2 && (ownC ?? []).length === 2 && bkC.every((c) => 'phone' in c))
const { error: tpC2 } = await TP.client.rpc('loamy_get_booking_contacts', { p_booking: booking.id })
ok('Third party still denied contacts after acceptance', !!tpC2)

// No payment/amount column exists on the booking
ok('Booking row carries no amount/payment field',
  !('amount' in booking) && !('price' in booking) && !('total' in booking))

// Owner completes
const { error: compErr } = await OWN.client.from('service_bookings').update({ status: 'completed' }).eq('id', booking.id)
ok('Owner marks booking completed', !compErr, compErr?.message)

// ---- Weather smoke (Open-Meteo, no key) ----
try {
  const params = new URLSearchParams({
    latitude: '11.08', longitude: '7.72',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
    timezone: 'auto', forecast_days: '7',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  const j = await res.json()
  ok('Open-Meteo returns a 7-day forecast for a farm coordinate',
    res.ok && j.daily?.time?.length === 7 && typeof j.daily.temperature_2m_max[0] === 'number',
    `${j.daily?.time?.length} days`)
} catch (e) {
  ok('Open-Meteo returns a 7-day forecast for a farm coordinate', false, String(e))
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(`Test password: ${PASSWORD}`)
process.exit(failed.length ? 1 : 0)
