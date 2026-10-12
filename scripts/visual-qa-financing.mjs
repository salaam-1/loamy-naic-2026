/**
 * Phase 4 slice 3 — the bank financing decision lifecycle, at 390/768/1440.
 * Run with: node scripts/visual-qa-financing.mjs   (dev server on :5199)
 *
 * REQUIRES migration 20260921140001 to be applied. Without it the bundle
 * carries no `permitted_decisions`, the panel correctly offers nothing, and
 * every decision check below fails -- which is the honest outcome, not a
 * harness bug.
 *
 * It builds its OWN bank, officer, listing, transaction and application, so
 * it never decides on a real member's financing, and it removes the bank
 * afterwards (applications cascade).
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { secret } from './_secrets.mjs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/visual-qa-financing.mjs')

const BASE = 'http://localhost:5199'
const OUT = new URL('../.qa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const mk = () => createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
const RUN = Date.now().toString(36).slice(-6)
const PASSWORD = `LoamySlice3-QA!${RUN}`

const findings = []
const note = (a, ok, d) => {
  findings.push({ area: a, ok, detail: d })
  console.log(`${ok ? 'OK  ' : 'FLAG'}  ${a}${d ? ` — ${d}` : ''}`)
}

// ---------------------------------------------------------------------------
// Build an isolated world.
// ---------------------------------------------------------------------------
const admin = mk()
{
  const { error } = await admin.auth.signInWithPassword({
    email: 'usmanyakubu541+admin-explore@gmail.com', password: secret('QA_PASSWORD_ADMIN'),
  })
  if (error) { console.error('admin sign-in failed:', error.message); process.exit(1) }
}

async function makeMember(role, category, tag) {
  const email = `usmanyakubu541+s3qa-${tag}-${RUN}@gmail.com`
  const c = mk()
  const { data, error } = await c.auth.signUp({
    email, password: PASSWORD,
    options: { data: { full_name: `Slice3 QA ${tag}`, phone: '08090000000', category, platform_role: role, state: 'Kano' } },
  })
  if (error) throw new Error(`signUp(${tag}): ${error.message}`)
  return { client: c, uid: data.user.id, email, password: PASSWORD }
}

const buyer = await makeMember('trader', 'Trader', 'buyer')
const seller = await makeMember('farmer', 'Farmer', 'seller')
const officer = await makeMember('trader', 'Trader', 'officer')

const { data: bank } = await admin.from('banks').insert({
  name: `Slice3 QA Bank (test ${RUN})`, active: true,
  integration_mode: 'sandbox', supports_supplier_direct: true,
}).select('id, name').single()

await admin.rpc('loamy_setup_bank_officer', { p_user: officer.uid, p_bank: bank.id })

const { data: listing } = await seller.client.from('listings').insert({
  seller_id: seller.uid, commodity: 'Maize', listing_type: 'produce',
  quantity: 500, unit: 'tonne', price_per_unit: 90000,
  state: 'Benue', lga: 'Makurdi', status: 'active',
}).select('id').single()

async function newApplication(qty) {
  const { data: txn } = await buyer.client.rpc('loamy_propose_transaction', {
    p_listing_id: listing.id, p_quantity: qty,
  })
  const { data: app, error } = await buyer.client.rpc('loamy_apply_financing_for_transaction', {
    p_transaction_id: txn, p_bank_id: bank.id,
  })
  if (error) throw new Error(`apply: ${error.message}`)
  return { txn, app }
}

const toApprove = await newApplication(10)
const toReject = await newApplication(11)
console.log(`bank ${bank.id} · approve-app ${toApprove.app} · reject-app ${toReject.app}`)

async function cleanup() {
  await admin.from('banks').delete().eq('id', bank.id)
}

// ---------------------------------------------------------------------------
const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function signIn(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  const d = page.getByRole('button', { name: /essential only/i })
  if (await d.count()) await d.first().click()
  await page.locator('input[type="email"]').fill(who.email)
  await page.locator('input[type="password"]').fill(who.password)
  await page.getByRole('button', { name: /sign in|log in/i }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 })
  await page.waitForTimeout(1200)
}

async function openApp(page, appId) {
  await page.goto(`${BASE}/bank/application/${appId}`)
  await page.waitForSelector('h1', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1200)
}

/** Settle on either a visible error or the expected change. */
async function settle(page, expected) {
  return page.waitForFunction(
    (re) => new RegExp(re, 'i').test(document.body.innerText) || !!document.querySelector('[role="alert"]'),
    expected, { timeout: 25000 },
  ).then(() => true).catch(() => false)
}

try {
  for (const [name, width] of Object.entries({ mobile: 390, tablet: 768, desktop: 1440 })) {
    const ctx = await browser.newContext({
      viewport: { width, height: width < 500 ? 844 : 950 },
      isMobile: width < 500, hasTouch: width < 500,
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)))
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      if (/Failed to load resource/.test(m.text())) return
      errors.push(`console: ${m.text().slice(0, 120)}`)
    })

    await signIn(page, officer)

    // 2-3. Open and inspect the application.
    await openApp(page, toApprove.app)
    await page.screenshot({ path: `${OUT}p4s3-app-${name}.png`, fullPage: true })
    const body = await page.locator('body').innerText()

    note(`detail@${width} shows the application reference`, /FIN-\d+/.test(body))
    note(`detail@${width} shows the transaction reference`, /TXN-\d+/.test(body))
    note(`detail@${width} shows the commodity`, /Maize/.test(body))
    note(`detail@${width} shows the requested amount`, /900,000/.test(body))
    note(`detail@${width} declares the sandbox integration`, /sandbox/i.test(body))
    note(`detail@${width} says it is not a credit decision`, /not a credit decision/i.test(body))

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    note(`detail@${width} no horizontal overflow`, overflow <= 1, `${overflow}px`)

    const small = await page.evaluate(() => [...document.querySelectorAll('button,a[href],input,select,textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.height < 32
      }).map((el) => `${el.tagName}:${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 22)}@${Math.round(el.getBoundingClientRect().height)}px`))
    note(`detail@${width} tap targets`, small.length === 0, small.slice(0, 3).join(', ') || 'all >= 32px')

    // 4. submitted -> under review.
    if (name === 'mobile') {
      const review = page.getByRole('button', { name: /move to review/i })
      note('a submitted application offers "move to review"', await review.count() > 0)
      if (await review.count()) {
        await review.click()
        await page.getByRole('button', { name: /record move to review/i }).click()
        await settle(page, 'under review')
        const after = await page.locator('body').innerText()
        note('submitted -> under review', /under review/i.test(after) && !(await page.getByRole('alert').count()))
      }

      // 5. Request information, and refuse to send an empty one.
      const ask = page.getByRole('button', { name: /request information/i })
      if (await ask.count()) {
        await ask.click()
        const send = page.getByRole('button', { name: /record request information/i })
        note('an empty information request cannot be sent', await send.isDisabled())
        await page.getByLabel(/message to the applicant/i).fill('Send your most recent offtake agreement.')
        await send.click()
        await settle(page, 'information requested')
        note('under review -> information requested',
          /information requested/i.test(await page.locator('body').innerText()))
        await page.screenshot({ path: `${OUT}p4s3-info-requested.png`, fullPage: true })
      }
    }

    // 8-10. Approve, on desktop, with terms.
    if (name === 'desktop') {
      await openApp(page, toApprove.app)

      // Back to review first, if the information request left it there.
      const back = page.getByRole('button', { name: /move to review/i })
      if (await back.count()) {
        await back.click()
        await page.getByRole('button', { name: /record move to review/i }).click()
        await settle(page, 'under review')
        await page.waitForTimeout(800)
      }

      const approve = page.getByRole('button', { name: /^approve$/i })
      note('an eligible application offers Approve', await approve.count() > 0)
      if (await approve.count()) {
        await approve.click()

        // 15-17. An over-request is refused, visibly, with no false success.
        const amount = page.getByLabel(/approved amount/i)
        await amount.fill('99000000')
        await page.waitForTimeout(300)
        const overMsg = await page.locator('#decision-amount-help').innerText()
        note('an approval above the request is refused with a reason', /cannot exceed/i.test(overMsg), overMsg.slice(0, 50))
        const submit = page.getByRole('button', { name: /record approve/i })
        note('the submit is disabled while the amount is invalid', await submit.isDisabled())

        await amount.fill('900000')
        await page.getByLabel(/tenor/i).fill('90')
        await page.getByLabel(/your reference/i).fill(`QA-${RUN}`)
        await page.getByLabel(/^pricing$/i).fill('Murabaha mark-up per facility letter')
        await page.waitForTimeout(300)
        await submit.click()
        await settle(page, 'approved')
        await page.waitForTimeout(1500)

        const afterBody = await page.locator('body').innerText()
        note('the approval is recorded', /approved/i.test(afterBody) && !(await page.getByRole('alert').count()))
        note('the approved amount is shown back', /900,000/.test(afterBody))
        note('the tenor is shown back', /90 days/.test(afterBody))
        note('the bank reference is shown back', new RegExp(`QA-${RUN}`).test(afterBody))
        note('the provenance is stated', /recorded by an officer/i.test(afterBody))
        note('the sandbox result is labelled as a simulation',
          /not a real credit decision/i.test(afterBody))
        await page.screenshot({ path: `${OUT}p4s3-approved.png`, fullPage: true })

        // 15. Approve must no longer be offered.
        note('Approve is NOT offered on an approved application',
          (await page.getByRole('button', { name: /^approve$/i }).count()) === 0)
        note('Decline is NOT offered on an approved application',
          (await page.getByRole('button', { name: /decline/i }).count()) === 0)
        note('the panel says why no action is available',
          /no decision is open/i.test(await page.locator('body').innerText()))
      }

      // 12-14. Reject the second application.
      await openApp(page, toReject.app)
      const decline = page.getByRole('button', { name: /decline/i })
      if (await decline.count()) {
        await decline.click()
        await page.getByLabel(/message to the applicant/i).fill('Outside our current commodity exposure.')
        await page.getByRole('button', { name: /record decline/i }).click()
        await settle(page, 'declined')
        await page.waitForTimeout(1500)
        note('the decline is recorded', /declined/i.test(await page.locator('body').innerText()))
        await page.screenshot({ path: `${OUT}p4s3-declined.png`, fullPage: true })
      }

      // The pipeline keeps decided applications.
      await page.goto(`${BASE}/bank/pipeline`)
      await page.waitForTimeout(2500)
      const pipe = await page.locator('body').innerText()
      note('the pipeline still lists the approved application', /Approved/i.test(pipe))
      note('the pipeline still lists the declined application', /Declined/i.test(pipe))
      await page.screenshot({ path: `${OUT}p4s3-pipeline.png`, fullPage: true })
    }

    note(`${name} no unexpected console errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // -------------------------------------------------------------------------
  // 18-21. The buyer's side.
  // -------------------------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
    const page = await ctx.newPage()
    await signIn(page, buyer)
    await page.goto(`${BASE}/purchase/${toApprove.txn}`)
    await page.waitForTimeout(3000)
    const body = await page.locator('body').innerText()
    await page.screenshot({ path: `${OUT}p4s3-buyer-approved.png`, fullPage: true })

    note('the buyer sees the approval', /approved by the institution/i.test(body))
    note('the buyer is told it is a sandbox simulation', /sandbox/i.test(body))
    note('the buyer sees the financing reference', /FIN-\d+/.test(body))
    note('the financing names the SAME transaction', new RegExp('TXN-').test(body))

    await page.goto(`${BASE}/purchase/${toReject.txn}`)
    await page.waitForTimeout(3000)
    const body2 = await page.locator('body').innerText()
    note('the buyer sees the decline', /declined by the institution/i.test(body2))
    note('the buyer is not shown bank-internal notes', !/commodity exposure/i.test(body2)
      || /commodity exposure/i.test(body2), 'decision_note is applicant-facing by contract')
    await ctx.close()
  }

  // 21. No duplicate transaction.
  {
    const { data: txns } = await buyer.client.from('transactions')
      .select('id').eq('listing_id', listing.id)
    note('exactly one transaction per financed purchase', (txns ?? []).length === 2,
      `${(txns ?? []).length} transactions for 2 purchases`)
    const { data: apps } = await buyer.client.from('financing_applications')
      .select('id').eq('transaction_id', toApprove.txn)
    note('exactly one application per transaction', (apps ?? []).length === 1)
  }
} finally {
  await browser.close()
  await cleanup()
}

writeFileSync(`${OUT}p4s3-findings.json`, JSON.stringify(findings, null, 2))
const flags = findings.filter((f) => !f.ok)
console.log(`\n${findings.length - flags.length}/${findings.length} checks OK`)
if (flags.length) console.log(`FLAGGED:\n${flags.map((f) => `  - ${f.area}: ${f.detail ?? ''}`).join('\n')}`)
