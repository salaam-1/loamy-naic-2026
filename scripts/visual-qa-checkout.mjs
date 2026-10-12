/**
 * Phase 4 slice 1 — the real buyer journey at 390 / 768 / 1440.
 * Run with: node scripts/visual-qa-checkout.mjs   (dev server on :5199)
 *
 * Drives the actual UI against the real database with an existing test
 * account. Verifies the purchase reaches `transactions`, carries the typed
 * delivery state and note, creates NO order, and that the financing entry
 * point refers to the same transaction.
 *
 * Only the desktop pass actually buys, so one run creates one purchase.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { secret } from './_secrets.mjs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/visual-qa-checkout.mjs')

const BASE = 'http://localhost:5199'
const OUT = new URL('../.qa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const BUYER = {
  email: 'usmanyakubu541+loamy3-b-mrj1fc26@gmail.com',
  password: secret('QA_PASSWORD_STAGE3'),
}

const findings = []
const note = (a, ok, d) => {
  findings.push({ area: a, ok, detail: d })
  console.log(`${ok ? 'OK  ' : 'FLAG'}  ${a}${d ? ` — ${d}` : ''}`)
}

const sb = createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
await sb.auth.signInWithPassword({ email: BUYER.email, password: BUYER.password })
const { data: auth } = await sb.auth.getUser()

const { data: listings } = await sb.from('loamy_public_listings')
  .select('id, commodity, quantity, unit, price_per_unit').gte('quantity', 4).limit(12)
const target = (listings ?? [])[0]
if (!target) {
  console.log('No purchasable listing found; cannot run.')
  process.exit(0)
}
console.log(`listing: ${target.commodity} ${target.quantity}${target.unit} @ ${target.price_per_unit}`)

const before = await sb.from('transactions').select('id', { count: 'exact', head: true }).eq('buyer_id', auth.user.id)
const ordersBefore = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('buyer_id', auth.user.id)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const MARKER = `QA note ${Date.now().toString(36).slice(-5)}`
// A quantity unique to this run. Re-using one would hit the server-side
// idempotency guard and return the PREVIOUS purchase -- correct behaviour,
// but it would make this run assert nothing about a fresh checkout.
const BUY_QTY = 1 + (Date.now() % 3) + Number(`0.${Date.now() % 97}`)

async function ready(page, sel = 'header') {
  try { await page.waitForSelector(sel, { timeout: 30000 }) } catch { /* measured below */ }
  await page.waitForTimeout(900)
}

for (const [name, width] of Object.entries({ mobile: 390, tablet: 768, desktop: 1440 })) {
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 950 },
    isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: width < 500 ? 2 : 1,
  })
  const page = await ctx.newPage()
  const errors = []
  const failed = []
  let knownWarehouse400 = 0
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 100)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    // The known loamy_suggest_warehouses 400 surfaces here as a generic
    // "Failed to load resource". Counted separately below.
    if (/Failed to load resource/.test(text)) { knownWarehouse400 += 1; return }
    errors.push(`console: ${text.slice(0, 100)}`)
  })
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? ''
    // A request the app cancels on navigation is not a failure.
    if (!why.includes('ERR_ABORTED')) failed.push(`${why} ${r.url().slice(0, 60)}`)
  })
  // KNOWN, PRE-EXISTING: loamy_suggest_warehouses reads v_t.origin_state,
  // which `transactions` does not have, so it 400s on every purchase page.
  // Named explicitly rather than ignoring all 400s, so a NEW error still
  // fails this check. Belongs to slice 5 (logistics + warehouse).
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('loamy_suggest_warehouses')) {
      failed.push(`HTTP ${r.status()} ${r.url().slice(0, 60)}`)
    }
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  const dismiss = page.getByRole('button', { name: /essential only/i })
  if (await dismiss.count()) await dismiss.first().click()
  await page.locator('input[type="email"]').fill(BUYER.email)
  await page.locator('input[type="password"]').fill(BUYER.password)
  await page.getByRole('button', { name: /sign in|log in/i }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 })
  await ready(page)

  await page.goto(`${BASE}/marketplace/${target.id}`)
  await ready(page, 'h1')
  await page.screenshot({ path: `${OUT}p4-listing-${name}.png` })
  const listingOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  note(`listing@${width} no overflow`, listingOverflow <= 1, `${listingOverflow}px`)

  if (name === 'desktop') {
    await sb.from('cart_items').delete().eq('user_id', auth.user.id)
    await sb.from('cart_items').insert({ user_id: auth.user.id, listing_id: target.id, quantity: BUY_QTY })

    await page.goto(`${BASE}/checkout`)
    await ready(page, 'h1')
    await page.screenshot({ path: `${OUT}p4-checkout-${name}.png` })

    const stateSelect = page.locator('select').first()
    if (await stateSelect.count()) await stateSelect.selectOption('Lagos')
    const noteBox = page.locator('textarea').first()
    if (await noteBox.count()) await noteBox.fill(MARKER)
    await page.screenshot({ path: `${OUT}p4-checkout-filled-${name}.png` })

    const btn = page.getByRole('button', { name: /place order|checkout|confirm/i }).first()
    note('checkout action present', (await btn.count()) > 0)
    await btn.click()
    await page.waitForURL((u) => u.pathname.startsWith('/purchase/'), { timeout: 40000 }).catch(() => {})
    await ready(page, 'h1')
    await page.screenshot({ path: `${OUT}p4-purchase-${name}.png` })

    note('lands on a purchase, not /orders', page.url().includes('/purchase/'), page.url().replace(BASE, ''))
    const body = await page.locator('body').innerText()
    note('confirmation shown', /purchase created/i.test(body))
    const ref = (body.match(/TXN-\d+/) ?? [])[0] ?? null
    note('transaction reference shown', !!ref, ref ?? 'none')
    note('financing entry point present', /financing/i.test(body))

    const purchaseOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    note(`purchase@${width} no overflow`, purchaseOverflow <= 1, `${purchaseOverflow}px`)
    const small = await page.evaluate(() => [...document.querySelectorAll('button,a[href],input,select,textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.height < 32
      }).length)
    note(`purchase@${width} tap targets`, small === 0, `${small} under 32px`)
  }

  note(`${name} no unexpected console errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
  if (knownWarehouse400 > 0) {
    console.log(`      (${knownWarehouse400}x known loamy_suggest_warehouses 400 — pre-existing, slice 5)`)
  }
  note(`${name} no failed requests`, failed.length === 0, failed.slice(0, 2).join(' | '))
  await ctx.close()
}
await browser.close()

// ---- Verify in the database what the UI claimed ---------------------------
const after = await sb.from('transactions').select('id', { count: 'exact', head: true }).eq('buyer_id', auth.user.id)
const ordersAfter = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('buyer_id', auth.user.id)
note('exactly one transaction created', (after.count ?? 0) - (before.count ?? 0) === 1,
  `${before.count} -> ${after.count}`)
note('NO order created', (ordersAfter.count ?? 0) === (ordersBefore.count ?? 0),
  `${ordersBefore.count} -> ${ordersAfter.count}`)

const { data: latest } = await sb.from('transactions')
  .select('ref, quantity, delivery_state, buyer_note, status, listing_id, batch_id')
  .eq('buyer_id', auth.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
note('delivery state persisted', latest?.delivery_state === 'Lagos', String(latest?.delivery_state))
note('buyer note persisted', latest?.buyer_note === MARKER, String(latest?.buyer_note))
note('quantity persisted', Number(latest?.quantity) === BUY_QTY, String(latest?.quantity))
note('listing reference persisted', latest?.listing_id === target.id)
note('status is proposed', latest?.status === 'proposed', String(latest?.status))
const { data: cart } = await sb.from('cart_items').select('id').eq('user_id', auth.user.id)
note('cart emptied', (cart ?? []).length === 0, `${(cart ?? []).length} left`)

// Re-submitting the identical purchase must return the SAME transaction.
{
  const first = await sb.rpc('loamy_propose_transaction', {
    p_listing_id: target.id, p_quantity: BUY_QTY, p_note: null,
    p_delivery_state: null, p_delivery_lga: null,
  })
  const again = await sb.rpc('loamy_propose_transaction', {
    p_listing_id: target.id, p_quantity: BUY_QTY, p_note: null,
    p_delivery_state: null, p_delivery_lga: null,
  })
  note('repeat purchase is idempotent', first.data === again.data && !!first.data,
    `${String(first.data).slice(0, 8)} === ${String(again.data).slice(0, 8)}`)
}

writeFileSync(`${OUT}p4-findings.json`, JSON.stringify(findings, null, 2))
const flags = findings.filter((f) => !f.ok)
console.log(`\n${findings.length - flags.length}/${findings.length} checks OK`)
if (flags.length) console.log(`FLAGGED:\n${flags.map((f) => `  - ${f.area}: ${f.detail ?? ''}`).join('\n')}`)
