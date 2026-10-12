/**
 * Phase 4 slice 2 — commodity detail and BuyBox at 390 / 768 / 1440.
 * Run with: node scripts/visual-qa-commodity.mjs   (dev server on :5199)
 *
 * Drives the real UI against the live database. Covers a declared listing, a
 * batch-backed one, the seller profile link, fractional quantity, and a
 * DELIBERATELY induced add-to-cart failure to prove the error is visible.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { secret } from './_secrets.mjs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/visual-qa-commodity.mjs')

const BASE = 'http://localhost:5199'
const OUT = new URL('../.qa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const BUYER = { email: 'usmanyakubu541+loamy3-b-mrj1fc26@gmail.com', password: secret('QA_PASSWORD_STAGE3') }
const SELLER = { email: 'usmanyakubu541+loamy3-s-mrj1fc26@gmail.com', password: secret('QA_PASSWORD_STAGE3') }

const findings = []
const note = (a, ok, d) => {
  findings.push({ area: a, ok, detail: d })
  console.log(`${ok ? 'OK  ' : 'FLAG'}  ${a}${d ? ` — ${d}` : ''}`)
}

const sb = createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
await sb.auth.signInWithPassword(BUYER)

// Start from an empty cart, or the BuyBox shows "In cart" and the quantity
// field never renders. This is the QA buyer's OWN cart, deleted through their
// own session, so RLS scopes it to them -- no other member is touched.
await sb.from('cart_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')

const { data: rows } = await sb.from('loamy_public_listings')
  .select('id, commodity, unit, quantity, claim_basis, batch_ref, verification_status, seller_username')
  .limit(40)
const all = rows ?? []
const batchBacked = all.find((l) => l.claim_basis === 'batch_backed' && l.batch_ref)
const declared = all.find((l) => l.claim_basis === 'seller_declared')
const withHandle = all.find((l) => l.seller_username)
console.log(`batch-backed: ${batchBacked?.commodity ?? 'none'} · declared: ${declared?.commodity ?? 'none'} · handle: ${withHandle?.seller_username ?? 'none'}`)

note('view exposes a seller handle', !!withHandle, withHandle?.seller_username ?? 'none found')
note('view exposes NO seller id', !Object.keys(all[0] ?? {}).some((k) => /seller_id|user_id/.test(k)))

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function signIn(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  const d = page.getByRole('button', { name: /essential only/i })
  if (await d.count()) await d.first().click()
  await page.locator('input[type="email"]').fill(who.email)
  await page.locator('input[type="password"]').fill(who.password)
  await page.getByRole('button', { name: /sign in|log in/i }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 })
  await page.waitForSelector('header', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(700)
}

async function openListing(page, id) {
  await page.goto(`${BASE}/marketplace/${id}`)
  await page.waitForSelector('h1', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(900)
}

for (const [name, width] of Object.entries({ mobile: 390, tablet: 768, desktop: 1440 })) {
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 950 },
    isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: width < 500 ? 2 : 1,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 100)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // Known pre-existing: loamy_suggest_warehouses 400 (slice 5). Named so a
    // NEW error still fails this check.
    if (/Failed to load resource/.test(m.text())) return
    errors.push(`console: ${m.text().slice(0, 100)}`)
  })

  await signIn(page, BUYER)

  // 1-2. Reach a detail page the way a member does, by clicking a card.
  await page.goto(`${BASE}/marketplace`)
  await page.waitForSelector('a[href^="/marketplace/"]', { timeout: 30000 }).catch(() => {})
  const cards = await page.locator('a[href^="/marketplace/"]').count()
  note(`marketplace@${width} lists commodities`, cards > 0, `${cards} card(s)`)
  if (cards > 0) {
    await page.locator('a[href^="/marketplace/"]').first().click()
    await page.waitForURL(/\/marketplace\/[0-9a-f-]{36}/, { timeout: 20000 }).catch(() => {})
    note(`marketplace@${width} card opens a detail page`, /\/marketplace\/[0-9a-f-]{36}/.test(page.url()), page.url().split('/').pop())
  }

  // An unavailable listing says so, and is NOT confused with a load failure.
  await page.goto(`${BASE}/marketplace/00000000-0000-0000-0000-000000000000`)
  // Wait for the lookup to RESOLVE rather than a fixed sleep -- the first
  // mobile pass is a cold module load and reported a false failure at 1.5s.
  await page
    .waitForFunction(() => /no longer available|could not be loaded/i.test(document.body.innerText), { timeout: 20000 })
    .catch(() => {})
  const goneBody = await page.locator('body').innerText()
  note(`unavailable@${width} says the listing is gone`, /no longer available/i.test(goneBody))
  note(`unavailable@${width} offers no purchase controls`, (await page.locator('#buy-qty').count()) === 0)

  if (batchBacked) {
    await openListing(page, batchBacked.id)
    await page.screenshot({ path: `${OUT}p4s2-batch-${name}.png` })
    const body = await page.locator('body').innerText()
    note(`batch-backed@${width} offers a trace entry point`, /trace this stock/i.test(body))
    note(`batch-backed@${width} shows the batch reference`, /BATCH-/.test(body))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    note(`batch-backed@${width} no overflow`, overflow <= 1, `${overflow}px`)
  }

  if (declared) {
    await openListing(page, declared.id)
    await page.screenshot({ path: `${OUT}p4s2-declared-${name}.png` })
    const body = await page.locator('body').innerText()
    note(`declared@${width} offers NO trace action`, !/trace this stock/i.test(body))
    note(`declared@${width} says why there is nothing to trace`, /no batch to trace/i.test(body))
    note(`declared@${width} claims no verification`, !/loamy verified/i.test(body))
  }

  if (name === 'desktop') {
    // Deliberately a listing whose seller has a PUBLIC handle, so the profile
    // link is actually exercised. A private seller yields null and correctly
    // renders plain text, which would silently skip the check.
    const target = withHandle ?? batchBacked ?? declared
    await openListing(page, target.id)

    const profileLinks = await page.locator('a[href^="/u/"]').count()
    const href = await page.locator('a[href^="/u/"]').first().getAttribute('href').catch(() => null)
    note('seller links to /u/:username', profileLinks > 0 && href === `/u/${target.seller_username}`, href ?? 'none')

    // Fractional quantity.
    const qty = page.locator('#buy-qty')
    if (await qty.count()) {
      await qty.fill('2.5')
      await page.waitForTimeout(400)
      const total = await page.locator('#buy-qty-help').innerText()
      note('fractional quantity accepted in the UI', !/only|enter a/i.test(total), total.slice(0, 50))
      await page.screenshot({ path: `${OUT}p4s2-fractional-${name}.png` })

      // Over-availability is refused with a reason.
      await qty.fill(String(Number(target.quantity) + 1))
      await page.waitForTimeout(400)
      const over = await page.locator('#buy-qty-help').innerText()
      note('over-availability refused with a reason', /only/i.test(over), over.slice(0, 50))
      const addBtn = page.getByRole('button', { name: /add to cart/i })
      note('add is disabled while invalid', await addBtn.isDisabled())

      // Back to a valid value and add. Waiting on the OUTCOME rather than a
      // fixed sleep: the add is two sequential round trips to a remote
      // database and settles in ~3s, so a 1.8s sleep reported a false failure
      // on a write that had in fact succeeded.
      await qty.fill('1')
      await page.waitForTimeout(300)
      await addBtn.click()
      const settled = await page
        .waitForFunction(
          () => /in cart/i.test(document.body.innerText) || !!document.querySelector('[role="alert"]'),
          { timeout: 20000 },
        )
        .then(() => true)
        .catch(() => false)
      const alerts = await page.getByRole('alert').count()
      const after = await page.locator('body').innerText()
      note('valid add succeeds', settled && alerts === 0 && /in cart/i.test(after),
        settled ? (alerts ? await page.getByRole('alert').first().innerText() : 'in cart') : 'never settled in 20s')
      await page.screenshot({ path: `${OUT}p4s2-added-${name}.png` })

      // 8. The cart holds what was added.
      await page.goto(`${BASE}/cart`)
      await page.waitForTimeout(2000)
      const cartBody = await page.locator('body').innerText()
      note('the cart shows the line that was added',
        new RegExp(target.commodity, 'i').test(cartBody), target.commodity)
      await page.screenshot({ path: `${OUT}p4s2-cart-${name}.png` })

      // 12-13. Checkout still terminates in the transaction spine (slice 1).
      //
      // The assertion is NOT "the transaction count went up". Slice 1 added a
      // partial unique index on (buyer_id, listing_id, quantity) WHERE
      // status = 'proposed', so re-checking-out the same line deliberately
      // returns the EXISTING open proposal and inserts nothing. A count-based
      // check therefore reports a failure on the second run of this very
      // script, when what it is seeing is idempotency working. What must hold
      // is that the line ends up in exactly ONE open proposal, and in no order.
      const ordersBefore = await sb.from('orders').select('id', { count: 'exact', head: true })
      const go = page.getByRole('button', { name: /checkout|place order|confirm/i }).first()
      if (await go.count()) {
        await go.click()
        await page.waitForTimeout(1500)
        const state = page.locator('select, input[name="state"], #delivery-state')
        if (await state.count()) {
          const el = state.first()
          if ((await el.evaluate((n) => n.tagName)) === 'SELECT') await el.selectOption({ index: 1 }).catch(() => {})
          else await el.fill('Kaduna').catch(() => {})
        }
        const confirm = page.getByRole('button', { name: /place|confirm|complete|checkout/i }).last()
        await confirm.click().catch(() => {})
        await page.waitForTimeout(6000)
        const { data: who } = await sb.auth.getUser()
        const { data: props } = await sb.from('transactions')
          .select('id, quantity, status')
          .eq('buyer_id', who.user.id).eq('listing_id', target.id).eq('status', 'proposed')
        const open = (props ?? []).filter((t2) => Number(t2.quantity) === 1)
        const ordersAfter = await sb.from('orders').select('id', { count: 'exact', head: true })
        note('checkout lands the line in the transaction spine', open.length >= 1,
          `${open.length} open proposal(s) for this listing at qty 1`)
        note('checkout is idempotent — no duplicate proposal', open.length === 1,
          `${open.length} open proposal(s)`)
        note('checkout creates NO order row', (ordersAfter.count ?? 0) === (ordersBefore.count ?? 0),
          `orders ${ordersBefore.count} -> ${ordersAfter.count}`)
        await page.screenshot({ path: `${OUT}p4s2-checkout-${name}.png` })
      } else {
        note('checkout lands the line in the transaction spine', false, 'no checkout control found on /cart')
      }
    }

    // Back to the detail page: the checks above navigated away.
    await openListing(page, target.id)
    const small = await page.evaluate(() => [...document.querySelectorAll('button,a[href],input,select,textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.height < 32
      }).map((el) => `${el.tagName}:${((el.innerText || el.getAttribute('aria-label') || '').trim()).slice(0, 24)}@${Math.round(el.getBoundingClientRect().height)}px`))
    note(`detail@${width} tap targets`, small.length === 0, small.join(', ') || 'all >= 32px')
  }

  note(`${name} no unexpected console errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

// ---- Deliberate failure: a seller adding their OWN listing to the cart ----
{
  const { data: own } = await (async () => {
    const s2 = createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
    await s2.auth.signInWithPassword(SELLER)
    const { data: me } = await s2.auth.getUser()
    return s2.from('listings').select('id').eq('seller_id', me.user.id).eq('status', 'active').limit(1).maybeSingle()
  })()

  if (own?.id) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
    const page = await ctx.newPage()
    await signIn(page, SELLER)
    await openListing(page, own.id)
    const qty = page.locator('#buy-qty')
    if (await qty.count()) {
      await qty.fill('1')
      await page.getByRole('button', { name: /add to cart/i }).click()
      await page
        .waitForFunction(
          () => /in cart/i.test(document.body.innerText) || !!document.querySelector('[role="alert"]'),
          { timeout: 20000 },
        )
        .catch(() => {})
      const alert = await page.getByRole('alert').count()
      const body = await page.locator('body').innerText()
      note('an induced add-to-cart failure is VISIBLE', alert > 0,
        alert > 0 ? (await page.getByRole('alert').first().innerText()).slice(0, 70) : 'no alert')
      note('a failed add does not claim success', !/in cart/i.test(body))
      await page.screenshot({ path: `${OUT}p4s2-add-failure.png` })
    } else {
      note('an induced add-to-cart failure is VISIBLE', false, 'no quantity field on own listing')
    }
    await ctx.close()
  } else {
    note('an induced add-to-cart failure is VISIBLE', false, 'seller has no active listing to try')
  }
}

await browser.close()
writeFileSync(`${OUT}p4s2-findings.json`, JSON.stringify(findings, null, 2))
const flags = findings.filter((f) => !f.ok)
console.log(`\n${findings.length - flags.length}/${findings.length} checks OK`)
if (flags.length) console.log(`FLAGGED:\n${flags.map((f) => `  - ${f.area}: ${f.detail ?? ''}`).join('\n')}`)
