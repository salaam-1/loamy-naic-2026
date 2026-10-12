/**
 * Stage 3 live verification — run with: node scripts/verify-stage3.mjs
 *
 * Four test accounts (seller-trader, buyer, third-party buyer, warehouse
 * owner). Exercises: listing lifecycle, taxonomy enforcement, photo-storage
 * policies, the interest→accept→contact-reveal→conclude loop, the directory
 * variant, third-party isolation, badge protection, the limited public
 * profile surface, and admin-only market prices. Publishable key only.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/verify-stage3.mjs')

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const PASSWORD = 'LoamyStage3-Test!' + Math.random().toString(36).slice(2, 8)
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function signup(email, role, category) {
  const client = createClient(TEST_ENV.url, TEST_ENV.key, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: {
      data: {
        full_name: `Stage3 ${role}`,
        phone: '0801234' + Math.floor(1000 + Math.random() * 9000),
        category,
        platform_role: role,
        state: 'Kano',
      },
    },
  })
  if (error || !data.session) throw new Error(`signup failed: ${error?.message}`)
  return { client, uid: data.user.id }
}

const ts = Date.now().toString(36)
const S = await signup(`usmanyakubu541+loamy3-s-${ts}@gmail.com`, 'trader', 'Trader')
const B = await signup(`usmanyakubu541+loamy3-b-${ts}@gmail.com`, 'buyer', 'Buyer')
const T = await signup(`usmanyakubu541+loamy3-t-${ts}@gmail.com`, 'buyer', 'Buyer')
const W = await signup(`usmanyakubu541+loamy3-w-${ts}@gmail.com`, 'warehouse_owner', 'Warehouse Owner')
console.log(`Test accounts: +loamy3-{s,b,t,w}-${ts}\n`)

// ---- Flag flipped ----
const { data: cfg } = await S.client.from('platform_config').select('flags').eq('id', 1).maybeSingle()
ok('marketplace feature flag is ON', cfg?.flags?.marketplace === true, JSON.stringify(cfg?.flags))

// ---- Listings ----
const { data: listing, error: listErr } = await S.client
  .from('listings')
  .insert({
    seller_id: S.uid, listing_type: 'commodity', commodity: 'Maize',
    quantity_kg: 500, price_per_unit: 450, state: 'Kano', lga: 'Dawakin Kudu',
    description: 'Clean dry maize, 2026 harvest',
  })
  .select()
  .maybeSingle()
ok('Seller creates a commodity listing', !!listing && !listErr, listErr?.message)

const { error: livestockErr } = await S.client.from('listings').insert({
  seller_id: S.uid, listing_type: 'commodity', commodity: 'Goat Meat',
  quantity_kg: 10, price_per_unit: 100, state: 'Kano',
})
ok('Livestock commodity rejected by taxonomy', !!livestockErr, livestockErr?.message?.slice(0, 50))

// Photo storage: own folder OK, someone else's folder denied.
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const { error: upOwnErr } = await S.client.storage
  .from('listing-photos').upload(`${S.uid}/test-${ts}.png`, png, { contentType: 'image/png' })
ok('Photo upload to own folder allowed', !upOwnErr, upOwnErr?.message)
const { error: upForeignErr } = await B.client.storage
  .from('listing-photos').upload(`${S.uid}/intruder-${ts}.png`, png, { contentType: 'image/png' })
ok("Photo upload to another's folder denied", !!upForeignErr, upForeignErr?.message?.slice(0, 50))

// ---- Browse + limited seller surface ----
const { data: found } = await B.client.from('listings').select('*').eq('id', listing.id)
ok('Buyer can browse the active listing', (found ?? []).length === 1)

const { data: pub } = await B.client.from('loamy_public_profiles').select('*').eq('id', S.uid).maybeSingle()
ok('Public profile view shows name/state/badge', !!pub?.full_name && pub?.verified_badge === false)
const { error: pubPhoneErr } = await B.client.from('loamy_public_profiles').select('phone').eq('id', S.uid)
ok('Public profile view has NO phone column', !!pubPhoneErr, pubPhoneErr?.message?.slice(0, 40))
const { data: directProfile } = await B.client.from('profiles').select('phone').eq('id', S.uid)
ok("Direct profiles read of seller still blocked", (directProfile ?? []).length === 0)

// ---- Interest loop ----
const { error: selfIntErr } = await S.client.from('listing_interests').insert({
  listing_id: listing.id, buyer_id: S.uid, message: 'my own listing',
})
ok('Seller cannot express interest in own listing', !!selfIntErr, selfIntErr?.message?.slice(0, 50))

const { data: interest, error: intErr } = await B.client
  .from('listing_interests')
  .insert({ listing_id: listing.id, buyer_id: B.uid, quantity_wanted: 200, message: 'Interested in 200kg' })
  .select()
  .maybeSingle()
ok('Buyer expresses interest', !!interest && !intErr, intErr?.message)

const { error: preAcceptBuyer } = await B.client.rpc('loamy_get_interest_contacts', { p_interest_id: interest.id })
const { error: preAcceptSeller } = await S.client.rpc('loamy_get_interest_contacts', { p_interest_id: interest.id })
ok('Contacts NOT available before acceptance (buyer & seller)', !!preAcceptBuyer && !!preAcceptSeller,
  preAcceptBuyer?.message?.slice(0, 55))

const { data: selfAccept } = await B.client
  .from('listing_interests').update({ status: 'accepted' }).eq('id', interest.id).select()
ok('Buyer cannot accept their own interest', (selfAccept ?? []).length === 0)

const { data: tSees } = await T.client.from('listing_interests').select('*').eq('id', interest.id)
const { error: tContacts } = await T.client.rpc('loamy_get_interest_contacts', { p_interest_id: interest.id })
ok('Third account sees no interest and no contacts', (tSees ?? []).length === 0 && !!tContacts)

const { error: acceptErr } = await S.client
  .from('listing_interests')
  .update({ status: 'accepted', seller_response: 'Available — let us talk.' })
  .eq('id', interest.id)
ok('Seller accepts the interest', !acceptErr, acceptErr?.message)

const { data: sellerNotif } = await S.client.from('notifications').select('title').eq('type', 'marketplace')
const { data: buyerNotif } = await B.client.from('notifications').select('title').eq('type', 'marketplace')
ok('Seller notified of new interest', (sellerNotif ?? []).some((n) => n.title === 'New interest received'))
ok('Buyer notified of acceptance', (buyerNotif ?? []).some((n) => n.title === 'Interest accepted'))

const { data: contacts, error: cErr } = await B.client.rpc('loamy_get_interest_contacts', { p_interest_id: interest.id })
ok('Post-acceptance contact reveal works (both parties, name+phone)',
  !cErr && (contacts ?? []).length === 2 && contacts.every((c) => 'phone' in c),
  cErr?.message)

const { error: tContacts2 } = await T.client.rpc('loamy_get_interest_contacts', { p_interest_id: interest.id })
ok('Third account still denied contacts after acceptance', !!tContacts2, tContacts2?.message?.slice(0, 40))

const { error: concludeErr } = await B.client
  .from('listing_interests').update({ status: 'concluded_externally' }).eq('id', interest.id)
ok("Buyer marks 'concluded externally'", !concludeErr, concludeErr?.message)

// ---- Directory variant ----
const { data: entry, error: dirErr } = await W.client
  .from('service_directory')
  .insert({ owner_id: W.uid, service_type: 'warehouse', business_name: 'Kano AgriStore', state: 'Kano', capacity_note: '500t dry storage' })
  .select()
  .maybeSingle()
ok('Warehouse owner publishes directory entry', !!entry && !dirErr, dirErr?.message)

const { data: dirInterest, error: dirIntErr } = await B.client
  .from('listing_interests')
  .insert({ directory_id: entry.id, buyer_id: B.uid, message: 'Need 50t storage for maize' })
  .select()
  .maybeSingle()
ok('Buyer requests directory contact', !!dirInterest && !dirIntErr, dirIntErr?.message)

await W.client.from('listing_interests').update({ status: 'accepted' }).eq('id', dirInterest.id)
const { data: dirContacts, error: dirCErr } = await B.client
  .rpc('loamy_get_interest_contacts', { p_interest_id: dirInterest.id })
ok('Directory contact exchange works after acceptance', !dirCErr && (dirContacts ?? []).length === 2, dirCErr?.message)

// ---- Integrity: badge, prices, listing tamper ----
const { error: badgeErr } = await B.client.from('profiles').update({ verified_badge: true }).eq('id', B.uid)
ok('Cannot self-set verified_badge', !!badgeErr, badgeErr?.message?.slice(0, 55))

const { error: priceErr } = await B.client.from('market_prices').insert({
  commodity: 'Maize', price_per_kg: 999, entered_by: B.uid,
})
ok('Non-admin cannot enter market prices', !!priceErr, priceErr?.message?.slice(0, 50))

const { data: tamper } = await B.client
  .from('listings').update({ price_per_unit: 1 }).eq('id', listing.id).select()
ok("Buyer cannot edit seller's listing", (tamper ?? []).length === 0)

const { data: pausedHidden } = await (async () => {
  await S.client.from('listings').update({ status: 'paused' }).eq('id', listing.id)
  return B.client.from('listings').select('id').eq('id', listing.id)
})()
ok('Paused listing disappears from buyers', (pausedHidden.data ?? []).length === 0)

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(`Test password (all accounts): ${PASSWORD}`)
process.exit(failed.length ? 1 : 0)
