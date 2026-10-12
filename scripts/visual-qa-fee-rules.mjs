/**
 * Admin fee rule lifecycle at 390 / 768 / 1440.
 * Run with: node scripts/visual-qa-fee-rules.mjs   (dev server on :5199)
 *
 * Drives the REAL admin surface against the live database. It creates its own
 * rule in the `withdrawal` scope — which nothing in the product resolves — so
 * it can end and reinstate a rule without touching anything commercial, and
 * deletes its rows afterwards.
 *
 * The check that matters most is the negative one: a double-click on "End
 * rule" must not end the rule.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { secret } from './_secrets.mjs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/visual-qa-fee-rules.mjs')

const BASE = 'http://localhost:5199'
const OUT = new URL('../.qa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const ADMIN = { email: 'usmanyakubu541+admin-explore@gmail.com', password: secret('QA_PASSWORD_ADMIN') }
const RUN = Date.now().toString(36).slice(-6)
const NOTE = `QA fee rule ${RUN}`

const findings = []
const note = (a, ok, d) => {
  findings.push({ area: a, ok, detail: d })
  console.log(`${ok ? 'OK  ' : 'FLAG'}  ${a}${d ? ` — ${d}` : ''}`)
}

const sb = createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
{
  const { error } = await sb.auth.signInWithPassword(ADMIN)
  if (error) { console.error('admin sign-in failed:', error.message); process.exit(1) }
}

let seq = 0

async function freshRule() {
  // A distinct transaction_type per iteration. Rules cannot be deleted any
  // more (see cleanup), so a reused type would leave the previous iteration's
  // reinstated rule in force and the next restore would correctly refuse with
  // `equivalent_rule_already_in_force`.
  const { data: me } = await sb.auth.getUser()
  const { data, error } = await sb.from('fee_schedules').insert({
    scope: 'withdrawal', transaction_type: `qa_${RUN}_${seq++}`,
    basis: 'flat', value: 321, payer: 'platform',
    note: NOTE, created_by: me.user.id,
  }).select('id, ref').single()
  if (error) throw new Error(`could not create the QA rule: ${error.message}`)
  return data
}

const ruleState = async (id) => {
  const { data } = await sb.from('fee_schedules').select('active, effective_to').eq('id', id).single()
  return data
}

/**
 * Leave nothing IN FORCE.
 *
 * fee_schedules no longer accepts DELETE from any client -- a fee rule is a
 * historical fact about a period, and the migration that added the lifecycle
 * guard removed the delete policy deliberately. So cleanup ENDS the test
 * rules through the authoritative RPC instead. An ended rule resolves for
 * nothing and charges nobody; it is inert, and it keeps the audit trail
 * honest about what this harness did.
 */
async function cleanup(ref) {
  const { data: live } = await sb.from('fee_schedules')
    .select('id, note')
    .eq('scope', 'withdrawal')
    .eq('active', true)
  for (const r of live ?? []) {
    const mine = r.note === NOTE || (ref && String(r.note ?? '').startsWith(`Reinstates ${ref}`))
    if (!mine) continue
    await sb.rpc('loamy_end_fee_rule', {
      p_rule_id: r.id,
      p_reason: `Browser QA ${RUN} cleanup. Test rule, never commercial.`,
    })
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
let lastRef = null

try {
  for (const [name, width] of Object.entries({ mobile: 390, tablet: 768, desktop: 1440 })) {
    const rule = await freshRule()
    lastRef = rule.ref

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

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    const d = page.getByRole('button', { name: /essential only/i })
    if (await d.count()) await d.first().click()
    await page.locator('input[type="email"]').fill(ADMIN.email)
    await page.locator('input[type="password"]').fill(ADMIN.password)
    await page.getByRole('button', { name: /sign in|log in/i }).first().click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 })

    await page.goto(`${BASE}/admin/fees`)
    await page.waitForSelector('h1', { timeout: 30000 }).catch(() => {})
    // Wait for THIS rule to appear rather than a fixed sleep: the admin page
    // loads ~70 rules and a 2.5s guess raced it at tablet width.
    await page.waitForFunction(
      (ref) => document.body.innerText.includes(ref),
      rule.ref, { timeout: 30000 },
    ).catch(() => {})

    const body = await page.locator('body').innerText()
    note(`fees@${width} lists the QA rule`, body.includes(rule.ref), rule.ref)
    note(`fees@${width} shows in-force state`, /in force/i.test(body))

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    note(`fees@${width} no horizontal overflow`, overflow <= 1, `${overflow}px`)

    // The row for our rule.
    const row = page.locator('li').filter({ hasText: rule.ref })
    const endBtn = row.getByRole('button', { name: /end rule/i })
    note(`fees@${width} offers "End rule" on a live rule`, await endBtn.count() > 0)

    // ---- THE CHECK THAT MATTERS: a double-click must not end the rule ----
    await endBtn.dblclick()
    await page.waitForTimeout(150)
    const dialog = page.getByRole('dialog')
    note(`dialog@${width} opens on click`, await dialog.count() > 0)

    const confirm = dialog.getByRole('button', { name: /end this rule/i })
    note(`dialog@${width} confirm is disarmed immediately after opening`,
      await confirm.isDisabled())

    // Try to confirm anyway, the way a stray second click would.
    await confirm.click({ force: true }).catch(() => {})
    await page.waitForTimeout(600)
    const afterDouble = await ruleState(rule.id)
    note(`a double-click did NOT end the rule@${width}`,
      afterDouble.active === true && afterDouble.effective_to === null,
      `active=${afterDouble.active}`)

    // It names what is affected.
    const dialogText = await dialog.innerText()
    note(`dialog@${width} names the rule`, dialogText.includes(rule.ref))
    note(`dialog@${width} names the rate`, /₦321 flat/.test(dialogText))
    note(`dialog@${width} says it is reversible`, /reinstate this rule afterwards/i.test(dialogText))
    note(`dialog@${width} does not say "delete"`, !/\bdelete\b/i.test(dialogText))
    await page.screenshot({ path: `${OUT}p-fee-dialog-${name}.png`, fullPage: true })

    // Still refuses with no reason, even once armed.
    await page.waitForTimeout(500)
    note(`dialog@${width} still disabled with no reason`, await confirm.isDisabled())

    // Confirm properly.
    await dialog.getByLabel(/why are you/i).fill(`QA ${RUN}: exercising the guarded path.`)
    await page.waitForTimeout(100)
    note(`dialog@${width} enables once a reason is given`, !(await confirm.isDisabled()))
    await confirm.click()
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 20000 })
      .catch(() => {})
    await page.waitForTimeout(1200)

    const afterConfirm = await ruleState(rule.id)
    note(`a confirmed end works@${width}`,
      afterConfirm.active === false && afterConfirm.effective_to !== null)

    const noticeText = await page.locator('body').innerText()
    note(`fees@${width} confirms what happened`, /ended/i.test(noticeText))
    note(`fees@${width} now shows "Ended"`, /ended/i.test(noticeText))

    // ---- Reinstate ----
    await page.waitForTimeout(800)
    const endedRow = page.locator('li').filter({ hasText: rule.ref })
    const restoreBtn = endedRow.getByRole('button', { name: /reinstate/i })
    note(`fees@${width} offers "Reinstate" on an ended rule`, await restoreBtn.count() > 0)

    if (await restoreBtn.count()) {
      await restoreBtn.first().click()
      await page.waitForTimeout(600)
      const rd = page.getByRole('dialog')
      const rdText = await rd.innerText()
      note(`restore@${width} explains it starts a new period`, /new/i.test(rdText) && /record/i.test(rdText))
      await rd.getByLabel(/why are you/i).fill(`QA ${RUN}: ended in error.`)
      await page.waitForTimeout(500)
      await rd.getByRole('button', { name: /reinstate this rule/i }).click()
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 20000 })
        .catch(() => {})
      await page.waitForTimeout(1500)

      const { data: restoredRows } = await sb.from('fee_schedules')
        .select('ref, value, active, effective_from, effective_to, created_by, note')
        .ilike('note', `Reinstates ${rule.ref}%`)
        .order('created_at', { ascending: false })
      const restored = (restoredRows ?? [])[0] ?? null
      note(`reinstate@${width} created a new live rule`, Boolean(restored) && restored.active === true)
      note(`reinstate@${width} kept the rate unchanged`, Number(restored?.value) === 321, `₦${restored?.value}`)
      note(`reinstate@${width} carries attribution`, Boolean(restored?.created_by))

      const stillEnded = await ruleState(rule.id)
      note(`reinstate@${width} left the ended rule untouched`,
        stillEnded.active === false && stillEnded.effective_to !== null)
    }

    const small = await page.evaluate(() => [...document.querySelectorAll('button,a[href],input,select,textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.height < 32
      }).map((el) => `${el.tagName}:${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20)}@${Math.round(el.getBoundingClientRect().height)}px`))
    note(`fees@${width} tap targets`, small.length === 0, small.slice(0, 3).join(', ') || 'all >= 32px')

    note(`${name} no unexpected console errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()
    await cleanup(rule.ref)
  }
} finally {
  await browser.close()
  await cleanup(lastRef)
}

writeFileSync(`${OUT}p-fee-rules-findings.json`, JSON.stringify(findings, null, 2))
const flags = findings.filter((f) => !f.ok)
console.log(`\n${findings.length - flags.length}/${findings.length} checks OK`)
if (flags.length) console.log(`FLAGGED:\n${flags.map((f) => `  - ${f.area}: ${f.detail ?? ''}`).join('\n')}`)
