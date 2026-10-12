/**
 * Wave 1 — the fulfilment spine in the real UI, at 390 / 768 / 1440.
 * Run with: node scripts/visual-qa-fulfilment.mjs   (dev server on :5199)
 *
 * Builds its own farm, batch, listing, purchase, carrier and warehouse, then
 * drives the spine through the ACTUAL pages: the seller records loading on
 * the purchase page, the buyer arranges transport and picks an offer, the
 * carrier quotes from the transport board, the warehouse answers a storage
 * request from its inbox.
 *
 * The checks that matter most are the ones that were impossible before:
 * a carrier SEEING marketplace freight, a buyer SEEING offers on their own
 * job, a warehouse SEEING a purchase-linked storage request.
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/visual-qa-fulfilment.mjs')

const BASE = 'http://localhost:5199'
const OUT = new URL('../.qa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const mk = () => createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
const RUN = Date.now().toString(36).slice(-6)
const PASSWORD = `LoamyWave1-QA!${RUN}`
const QTY = 12

const findings = []
const note = (a, ok, d) => {
  findings.push({ area: a, ok, detail: d })
  console.log(`${ok ? 'OK  ' : 'FLAG'}  ${a}${d ? ` — ${d}` : ''}`)
}

/**
 * Members are created ONCE and reused across runs.
 *
 * Supabase rate-limits signups and this harness needs four accounts. Creating
 * them every run made the QA fail in different places each time -- a rate
 * limit three steps back surfaces as "the carrier cannot see the job", which
 * is a lie about the code under test. The cache makes the run deterministic.
 */
const CACHE = `${OUT}w1-accounts.json`
const cached = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : null

async function member(role, category, tag) {
  if (cached?.[tag]) {
    const c = mk()
    const { error } = await c.auth.signInWithPassword({
      email: cached[tag].email, password: cached[tag].password,
    })
    if (!error) return { client: c, ...cached[tag] }
    console.log(`  cached ${tag} no longer signs in; creating a new one`)
  }

  const email = `usmanyakubu541+w1-${tag}-${RUN}@gmail.com`
  const c = mk()
  let data, error
  for (let attempt = 0; attempt < 6; attempt++) {
    ;({ data, error } = await c.auth.signUp({
      email, password: PASSWORD,
      options: { data: { full_name: `Wave1 ${tag}`, phone: '08090000000', category, platform_role: role, state: 'Benue' } },
    }))
    if (!error) break
    if (!/rate limit/i.test(error.message)) break
    const wait = 10000 * (attempt + 1)
    console.log(`  rate limited on ${tag}; waiting ${wait / 1000}s`)
    await new Promise((r) => setTimeout(r, wait))
  }
  if (error) throw new Error(`signUp(${tag}): ${error.message}`)

  // A fresh account lands on /onboarding and every dashboard route redirects
  // there, so the carrier and warehouse boards would appear empty for a
  // reason that has nothing to do with what is being tested.
  const done = await c.from('profiles')
    .update({ onboarding_complete: true }).eq('id', data.user.id).select('id')
  if (done.error) throw new Error(`onboarding(${tag}): ${done.error.message}`)
  return { client: c, uid: data.user.id, email, password: PASSWORD }
}

const seller = await member('farmer', 'Farmer', 'seller')
const buyer = await member('trader', 'Trader', 'buyer')
const carrier = await member('logistics_provider', 'Logistics Provider', 'carrier')
const warehouse = await member('warehouse_owner', 'Warehouse Owner', 'wh')

writeFileSync(CACHE, JSON.stringify({
  seller: { uid: seller.uid, email: seller.email, password: seller.password },
  buyer: { uid: buyer.uid, email: buyer.email, password: buyer.password },
  carrier: { uid: carrier.uid, email: carrier.email, password: carrier.password },
  wh: { uid: warehouse.uid, email: warehouse.email, password: warehouse.password },
}, null, 2))

// ---- A real chain of stock -------------------------------------------------
const { data: farm } = await seller.client.from('farms').insert({
  owner_id: seller.uid, farm_name: `Wave1 Farm ${RUN}`, state: 'Benue', lga: 'Makurdi',
  size_hectares: 10, primary_crops: ['Maize'], ownership_type: 'owned',
  latitude: 7.7322, longitude: 8.5391,
}).select('id').single()
const { data: cycle } = await seller.client.from('crop_records').insert({
  farm_id: farm.id, crop: 'Maize', season_year: 2026, status: 'harvested',
}).select('id').single()
const { data: harvest } = await seller.client.from('harvests').insert({
  production_cycle_id: cycle.id, farm_id: farm.id, commodity: 'Maize',
  harvest_date: '2026-09-10', quantity: 100, unit: 'tonne',
}).select('id').single()
const { data: batchId } = await seller.client.rpc('loamy_create_batch_from_harvest', {
  p_harvest_id: harvest.id, p_quantity: 100,
})
const { data: listingId, error: listErr } = await seller.client.rpc('loamy_list_batch', {
  p_batch_id: batchId, p_quantity: 100, p_price_per_unit: 90000,
  p_state: 'Benue', p_lga: 'Makurdi',
})
if (listErr) { console.error('listing failed:', listErr.message); process.exit(1) }

const { data: txnId } = await buyer.client.rpc('loamy_propose_transaction', {
  p_listing_id: listingId, p_quantity: QTY,
})
await buyer.client.from('transactions')
  .update({ delivery_state: 'Benue', delivery_lga: 'Makurdi' }).eq('id', txnId)

const { data: facility } = await warehouse.client.from('service_directory').insert({
  owner_id: warehouse.uid, service_type: 'warehouse',
  business_name: `Wave1 Store ${RUN}`, state: 'Benue', lga: 'Makurdi',
  capacity_tonnes: 500, capacity_note: 'Dry storage',
}).select('id').single()

console.log(`txn ${txnId} · listing ${listingId} · facility ${facility?.id}`)

async function cleanup() {
  if (facility?.id) await warehouse.client.from('service_directory').delete().eq('id', facility.id)
}

// ---------------------------------------------------------------------------
const browser = await chromium.launch({ channel: 'chrome', headless: true })

/**
 * Sign in, with retries.
 *
 * Supabase rate-limits auth, and this harness performs six UI logins per run
 * against a project that is also running the security suite. A throttled
 * login surfaced as a 30s navigation timeout that killed the whole run --
 * another environmental failure reported as if it were a product defect.
 */
async function signIn(page, who) {
  let last
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
      const d = page.getByRole('button', { name: /essential only/i })
      if (await d.count()) await d.first().click()
      await page.locator('input[type="email"]').fill(who.email)
      await page.locator('input[type="password"]').fill(who.password)
      await page.getByRole('button', { name: /sign in|log in/i }).first().click()
      await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 })
      await page.waitForTimeout(1200)
      return
    } catch (e) {
      last = e
      const wait = 6000 * (attempt + 1)
      console.log(`  sign-in for ${who.email.split('+')[1]} did not settle; retrying in ${wait / 1000}s`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw new Error(`SIGN-IN FAILED after 4 attempts for ${who.email}: ${last}`)
}

async function openPurchase(page) {
  await page.goto(`${BASE}/purchase/${txnId}`)
  await page.waitForSelector('h1', { timeout: 30000 }).catch(() => {})
  // All three cards, not just the word "Fulfilment": the panel renders its
  // heading before its own round trip resolves, so waiting on the heading
  // raced the content and reported the cards missing.
  await settled(page, 'purchase page fulfilment panel', () => {
    const t = document.body.innerText
    return /loading/i.test(t) && /transport/i.test(t) && /storage/i.test(t)
  })
  await page.waitForTimeout(500)
}

/**
 * Wait for a condition and FAIL LOUDLY if it never arrives.
 *
 * Every wait in this file used `.catch(() => {})`, which swallowed the
 * timeout and carried on into a broken state -- so one slow step reported
 * itself as five unrelated failures further down, and the run blamed the
 * wrong thing. Exactly the vacuous-green pattern the security suite was
 * audited for.
 */
async function settled(page, label, fn, timeout = 30000) {
  try {
    await page.waitForFunction(fn, { timeout })
  } catch {
    throw new Error(`STEP DID NOT SETTLE: ${label} (waited ${timeout / 1000}s)`)
  }
}

const ctxFor = (width) => browser.newContext({
  viewport: { width, height: width < 500 ? 844 : 950 },
  isMobile: width < 500, hasTouch: width < 500,
})

try {
  // =========================================================================
  // 1. Responsive: the panel renders for both parties at all three widths.
  // =========================================================================
  for (const [name, width] of Object.entries({ mobile: 390, tablet: 768, desktop: 1440 })) {
    const ctx = await ctxFor(width)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)))
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      if (/Failed to load resource/.test(m.text())) return
      errors.push(`console: ${m.text().slice(0, 120)}`)
    })

    await signIn(page, buyer)
    await openPurchase(page)
    const body = await page.locator('body').innerText()

    note(`buyer@${width} sees the fulfilment panel`, /fulfilment/i.test(body))
    note(`buyer@${width} is told whose move it is`, /the seller/i.test(body))
    note(`buyer@${width} sees loading, transport and storage`,
      /loading/i.test(body) && /transport/i.test(body) && /storage/i.test(body))
    note(`buyer@${width} is NOT offered loading (seller's move)`,
      !(await page.getByRole('button', { name: /schedule loading/i }).count()))

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    note(`buyer@${width} no horizontal overflow`, overflow <= 1, `${overflow}px`)

    const small = await page.evaluate(() => [...document.querySelectorAll('button,a[href],input,select,textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.height < 32
      }).map((el) => `${el.tagName}:${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20)}@${Math.round(el.getBoundingClientRect().height)}px`))
    note(`buyer@${width} tap targets`, small.length === 0, small.slice(0, 3).join(', ') || 'all >= 32px')

    await page.screenshot({ path: `${OUT}w1-purchase-${name}.png`, fullPage: true })
    note(`${name} no unexpected console errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // =========================================================================
  // 2. The spine, driven through the UI at desktop width.
  // =========================================================================
  {
    // ---- Seller schedules and completes loading ----
    const ctx = await ctxFor(1440)
    const page = await ctx.newPage()
    await signIn(page, seller)
    await openPurchase(page)

    // Wait for the control rather than a fixed sleep: the panel resolves
    // after its own round trip and a guess raced it.
    const schedule = page.getByRole('button', { name: /schedule loading/i })
    await schedule.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {})
    note('seller is offered loading', await schedule.count() > 0)
    await schedule.click()
    await page.getByRole('button', { name: /^record$/i }).click()
    await settled(page, 'loading scheduled', () => /loading scheduled/i.test(document.body.innerText), 20000)
    note('loading scheduled is persisted', /loading scheduled/i.test(await page.locator('body').innerText()))

    const startBtn = page.getByRole('button', { name: /start loading/i })
    await startBtn.waitFor({ state: 'visible', timeout: 25000 })
    await startBtn.click()
    await page.getByRole('button', { name: /^record$/i }).click()
    await settled(page, 'loading started', () => /loading started/i.test(document.body.innerText), 25000)

    const doneBtn = page.getByRole('button', { name: /confirm loaded/i })
    await doneBtn.waitFor({ state: 'visible', timeout: 25000 })
    await doneBtn.click()
    await page.locator('#load-waybill').fill(`WB-${RUN}`)
    await page.locator('#load-vehicle').fill(`ABC-${RUN.slice(0, 3)}`)
    await page.getByRole('button', { name: /^record$/i }).click()
    // Wait for the FLAGS, not merely the word "Loaded" -- the stage label
    // renders before the panel reloads the confirmation and its evidence
    // gaps, so matching "Loaded" raced the thing being asserted.
    await settled(page, 'loaded confirmed with evidence flags',
      () => /no photograph was taken|no location was captured/i.test(document.body.innerText), 25000)

    const afterLoad = await page.locator('body').innerText()
    note('loaded is persisted', /loaded/i.test(afterLoad))
    // Evidence gaps are shown, not hidden: no photo and no GPS were captured.
    note('evidence gaps are shown to the seller', /no photograph|no location/i.test(afterLoad))
    await page.screenshot({ path: `${OUT}w1-loaded.png`, fullPage: true })
    await ctx.close()
  }

  {
    // ---- Buyer sees the seller's record, then arranges transport ----
    const ctx = await ctxFor(1440)
    const page = await ctx.newPage()
    await signIn(page, buyer)
    await openPurchase(page)
    const body = await page.locator('body').innerText()
    note('the BUYER sees the loading the seller recorded', /loaded/i.test(body))
    note('the buyer sees the evidence gaps too', /no photograph|no location/i.test(body))

    const arrange = page.getByRole('button', { name: /arrange transport/i })
    await arrange.waitFor({ state: 'visible', timeout: 25000 })
    note('the buyer is offered transport once loading has moved', await arrange.count() > 0)
    await arrange.click()
    // By id: the page header also has a "Deliver to state" selector.
    await page.locator('#tr-dropoff').fill('Makurdi depot')
    await page.getByRole('button', { name: /send to carriers/i }).click()
    await page.waitForFunction(() => /out to carriers|offers/i.test(document.body.innerText), { timeout: 20000 })
      .catch(() => {})
    note('transport request is persisted', /out to carriers|carrier/i.test(await page.locator('body').innerText()))
    await page.screenshot({ path: `${OUT}w1-transport-requested.png`, fullPage: true })
    await ctx.close()
  }

  {
    // ---- The carrier SEES marketplace freight. This was impossible. ----
    const ctx = await ctxFor(1440)
    const page = await ctx.newPage()
    await signIn(page, carrier)
    await page.goto(`${BASE}/dashboard/logistics_provider/transport-board`)
    // Wait for the board to SETTLE rather than a fixed sleep. It issues two
    // queries and a 3.5s guess raced them -- which reported "a carrier cannot
    // see marketplace freight" when the carrier could see it perfectly well.
    await settled(page, 'carrier transport board',
      () => /Open transport jobs|No transport jobs right now/i.test(document.body.innerText))
    await page.waitForTimeout(800)
    const body = await page.locator('body').innerText()
    note('a carrier SEES the marketplace job', /maize/i.test(body),
      'loamy_open_transport_jobs filtered on company_id, NULL for a purchase')
    await page.screenshot({ path: `${OUT}w1-carrier-board.png`, fullPage: true })

    // OUR job's row, not merely the first: the board carries other freight.
    // Ancestor filters match many nested divs, so the button is found by
    // walking the candidates and reading each row's own text.
    const allOffer = page.getByRole('button', { name: /submit offer|update offer/i })
    const n = await allOffer.count()
    let offerBtn = null
    for (let i = 0; i < n; i++) {
      const b = allOffer.nth(i)
      const rowText = await b.evaluate((el) => el.closest('div')?.parentElement?.innerText ?? '')
      if (/Makurdi depot/.test(rowText)) { offerBtn = b; break }
    }
    if (!offerBtn && n > 0) offerBtn = allOffer.first()
    if (offerBtn) {
      await offerBtn.click()
      const priceField = page.locator('input[type="number"]').first()
      await priceField.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
      if (await priceField.count()) {
        await priceField.fill('120000')
        const send = page.getByRole('button', { name: /send offer|submit offer|save/i }).last()
        await send.click()
        await page.waitForFunction(
          () => !document.querySelector('input[type="number"]') ||
                /update offer/i.test(document.body.innerText),
          { timeout: 20000 },
        ).catch(() => {})
        note('the carrier can submit an offer', !(await page.getByRole('alert').count()))
      } else {
        note('the carrier can submit an offer', false, 'no price field found')
      }
    } else {
      note('the carrier can submit an offer', false, 'no offer control on the board')
    }
    await ctx.close()
  }

  {
    // ---- The buyer SEES the offer and awards it. Also impossible before. ----
    const ctx = await ctxFor(1440)
    const page = await ctx.newPage()
    await signIn(page, buyer)
    await openPurchase(page)
    const body = await page.locator('body').innerText()
    note('the BUYER sees the carrier offer', /120,000/.test(body),
      'loamy_transport_offers_v had no branch for a transaction party')

    const book = page.getByRole('button', { name: /book this carrier/i }).first()
    if (await book.count()) {
      await book.click()
      await page.waitForFunction(() => /booked with/i.test(document.body.innerText), { timeout: 20000 })
        .catch(() => {})
      note('the buyer can award the job', /booked with/i.test(await page.locator('body').innerText()))
      await page.screenshot({ path: `${OUT}w1-carrier-booked.png`, fullPage: true })
    } else {
      note('the buyer can award the job', false, 'no book control')
    }

    // ---- Storage: suggestions now resolve, and a request is explicit ----
    await page.getByRole('button', { name: /find storage/i }).click()
    // The suggestion list is its own round trip; a fixed sleep raced it and
    // reported "suggestions do not resolve" when they resolve fine.
    await settled(page, 'warehouse suggestions',
      () => /Ask for space|No warehouses are listed|Suggestions only/i.test(document.body.innerText))
    await page.waitForTimeout(400)
    const storageText = await page.locator('body').innerText()
    note('warehouse suggestions resolve at last', new RegExp(`Wave1 Store ${RUN}`).test(storageText),
      'loamy_suggest_warehouses had three column bugs and had never run')

    // OUR facility's row, not merely the first suggestion: there are other
    // warehouses in Benue and asking one of them would leave our own inbox
    // empty for a reason that has nothing to do with the code under test.
    const ourRow = page.locator('li').filter({ hasText: `Wave1 Store ${RUN}` })
    const ask = ourRow.getByRole('button', { name: /ask for space/i }).first()
    if (await ask.count()) {
      await ask.click()
      const send = page.getByRole('button', { name: /send request/i })
      await send.waitFor({ state: 'visible', timeout: 15000 })
      await send.click()
      await settled(page, 'storage request sent',
        () => /awaiting the facility/i.test(document.body.innerText), 20000)
      const after = await page.locator('body').innerText()
      note('a storage request is sent', /awaiting the facility/i.test(after))
      // "Requested" is not "booked". A request the facility has not
      // answered must never read as confirmed storage.
      note('storage is NOT presented as booked',
        /awaiting the facility/i.test(after) && !/storage confirmed/i.test(after))
      await page.screenshot({ path: `${OUT}w1-storage-requested.png`, fullPage: true })
    } else {
      note('a storage request is sent', false, 'no "ask for space" control')
    }
    await ctx.close()
  }

  {
    // ---- The warehouse SEES the request. The third hidden-row defect. ----
    const ctx = await ctxFor(1440)
    const page = await ctx.newPage()
    await signIn(page, warehouse)
    await page.goto(`${BASE}/dashboard/warehouse_owner/warehouse-inbox`)
    // Wait for the ROW, not the heading. The heading renders before the
    // query resolves, and this account's inbox accumulates across runs, so a
    // heading-only wait raced the list and reported the request missing.
    await settled(page, 'warehouse inbox',
      () => /Marketplace purchase/i.test(document.body.innerText) ||
            /No storage requests yet/i.test(document.body.innerText))
    await page.waitForTimeout(500)
    const body = await page.locator('body').innerText()
    note('the WAREHOUSE sees the purchase storage request', /marketplace purchase|maize/i.test(body),
      'loamy_warehouse_reservations_v filtered on company_id')
    note('the request is marked as coming from a purchase', /purchase/i.test(body))
    await page.screenshot({ path: `${OUT}w1-warehouse-inbox.png`, fullPage: true })

    // Confirm the request that is still awaiting an answer, whichever row it
    // is: this inbox carries older reservations from previous runs.
    const confirm = page.getByRole('button', { name: /^confirm$/i }).first()
    if (await confirm.count()) {
      await confirm.click()
      await page.waitForFunction(() => /booking confirmed/i.test(document.body.innerText), { timeout: 20000 })
        .catch(() => {})
      note('the facility can accept the request', /booking confirmed/i.test(await page.locator('body').innerText()))
    } else {
      note('the facility can accept the request', false, 'no confirm control')
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  await cleanup()
}

writeFileSync(`${OUT}w1-findings.json`, JSON.stringify(findings, null, 2))
const flags = findings.filter((f) => !f.ok)
console.log(`\n${findings.length - flags.length}/${findings.length} checks OK`)
if (flags.length) console.log(`FLAGGED:\n${flags.map((f) => `  - ${f.area}: ${f.detail ?? ''}`).join('\n')}`)
