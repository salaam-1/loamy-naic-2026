/**
 * Wave A.4: the bank portal, measured in a real browser.
 *
 * WHICH FIXTURE, AND WHY THAT IS LEGITIMATE
 *   `.env.test` has no bank account. But `RequireBank` in src/routes/guards.tsx
 *   admits `profile.platform_role === 'bank'` OR `profile.role === 'admin'`, so
 *   the EXISTING admin fixture reaches every /bank route by the guard's own
 *   rule. No credential is created and no staging row is written: this signs
 *   in, navigates, measures and leaves.
 *
 *   What that does NOT give is a bank officer's DATA. An admin session is not
 *   scoped to an institution, so several screens render their empty state. So
 *   this measures chrome, layout, controls and the empty/loading states at
 *   three widths in five languages, and says plainly that populated tables were
 *   not exercised. A report that called this full bank QA would be lying about
 *   which rows were on screen.
 *
 * WHAT IT CHECKS
 *   1. no interactive control smaller than 44px in either dimension;
 *   2. no horizontal overflow of the document at any width;
 *   3. no element overflowing the viewport to the right;
 *   4. no visible translation key (a string that looks like `bank.x.y`);
 *   5. the same, in all five languages, because French and the Nigerian
 *      languages expand and a label that fits in English may not fit at all.
 *
 * Read-only.
 */
import { chromium } from 'playwright'
import { assertServedProjectNotProduction, testSecret } from './_environment.mjs'

const BASE = 'http://localhost:5199'
await assertServedProjectNotProduction(BASE, 'scripts/verify-bank-qa.mjs')

const MIN = 44
const WIDTHS = [390, 768, 1440]
const LOCALES = ['en', 'fr', 'ha', 'ig', 'yo']

const BANK_ROUTES = [
  ['/bank', 'dashboard'],
  ['/bank/pipeline', 'application queue'],
  ['/bank/loans', 'loans'],
  ['/bank/customers', 'customers'],
  ['/bank/collateral', 'collateral'],
  ['/bank/disbursements', 'disbursements'],
  ['/bank/repayments', 'repayments'],
  ['/bank/transactions', 'transactions'],
  ['/bank/risk', 'risk and compliance'],
  ['/bank/alerts', 'alerts'],
  ['/bank/monitoring', 'monitoring'],
  ['/bank/reports', 'reports'],
  ['/bank/messages', 'messages'],
  ['/bank/settings', 'settings'],
]

function scanPage(minPx) {
  const out = { small: [], overflow: [], keys: [], docOverflow: null }

  const inProse = (el) => {
    const p = el.closest('p, li, td, blockquote')
    return Boolean(p) && (p.innerText || '').trim().length > 60
  }
  const insideControl = (el) => {
    const parent = el.parentElement
      && el.parentElement.closest('button, a[href], [role="option"], [role="menuitem"], label')
    return Boolean(parent) && parent !== el
  }

  const SEL = 'button, a[href], select, input:not([type="hidden"]), [role="option"],'
    + ' [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], summary'
  const seen = new Set()
  for (const el of document.querySelectorAll(SEL)) {
    if (el.disabled) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (insideControl(el)) continue
    if (el.tagName === 'A' && inProse(el)) continue
    const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.id || '')
      .trim().slice(0, 48)
    const key = `${el.tagName}|${name}|${Math.round(r.width)}x${Math.round(r.height)}`
    if (seen.has(key)) continue
    seen.add(key)
    if (r.width + 0.5 < minPx || r.height + 0.5 < minPx) {
      out.small.push({
        tag: el.tagName.toLowerCase(),
        name,
        w: Math.round(r.width * 100) / 100,
        h: Math.round(r.height * 100) / 100,
        cls: (el.className || '').toString().slice(0, 110),
      })
    }
  }

  // Document-level horizontal overflow.
  const de = document.documentElement
  out.docOverflow = de.scrollWidth > de.clientWidth
    ? { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth }
    : null

  // Elements sticking out past the right edge. A few pixels are rounding.
  const limit = de.clientWidth + 2
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    // A scroll container is allowed to have wide content inside it.
    if (el.closest('.overflow-x-auto, .overflow-auto, .overflow-scroll')) continue
    if (r.right > limit) {
      out.overflow.push({
        tag: el.tagName.toLowerCase(),
        right: Math.round(r.right),
        limit,
        text: (el.innerText || '').trim().slice(0, 56),
      })
      if (out.overflow.length > 6) break
    }
  }

  // A visible translation key: the failure mode the A.3 plural bug produced.
  const body = document.body.innerText || ''
  for (const m of body.matchAll(/\b(?:bank|financing|nav|common)\.[a-z][A-Za-z0-9_.]{2,}/g)) {
    if (!out.keys.includes(m[0])) out.keys.push(m[0])
  }
  return out
}

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const findings = []
let scans = 0

async function scan(label, width, locale) {
  const r = await page.evaluate(scanPage, MIN)
  scans++
  for (const s of r.small) findings.push({ kind: 'small', label, width, locale, ...s })
  for (const o of r.overflow) findings.push({ kind: 'overflow', label, width, locale, ...o })
  for (const k of r.keys) findings.push({ kind: 'key', label, width, locale, key: k })
  if (r.docOverflow) {
    findings.push({ kind: 'doc-overflow', label, width, locale, ...r.docOverflow })
  }
}

try {
  // --- sign in with the admin fixture -------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.locator('#email').fill(testSecret('LOAMY_TEST_ADMIN_EMAIL'))
  await page.locator('#password').fill(testSecret('LOAMY_TEST_ADMIN_PASSWORD'))
  await page.locator('form button[type="submit"]').first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 }).catch(() => {})

  // Confirm the session actually reaches the portal rather than bouncing home.
  await page.goto(`${BASE}/bank`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2500)
  if (!page.url().includes('/bank')) {
    console.log('BLOCKED: the admin fixture did not reach /bank (redirected to ' + page.url() + ')')
    console.log('Bank browser QA could not run. Report it as blocked rather than as passed.')
    await browser.close()
    process.exit(2)
  }
  console.log('reached /bank as the admin fixture\n')

  // --- every route at every width, in English -----------------------------
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    for (const [path, label] of BANK_ROUTES) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(1200)
      await scan(label, width, 'en')
    }
    console.log(`scanned ${BANK_ROUTES.length} bank routes at ${width}px`)
  }

  // --- the dense screens in all five languages ----------------------------
  // French and the Nigerian languages run longer than English; a column
  // heading that fits at 390px in English can wrap or overflow elsewhere.
  const DENSE = [
    ['/bank', 'dashboard'],
    ['/bank/pipeline', 'application queue'],
    ['/bank/repayments', 'repayments'],
    ['/bank/loans', 'loans'],
    ['/bank/risk', 'risk and compliance'],
  ]
  for (const locale of LOCALES) {
    await page.goto(`${BASE}/bank`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.evaluate((l) => {
      try { localStorage.setItem('loamy.language', l) } catch { /* private mode */ }
    }, locale)
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      for (const [path, label] of DENSE) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.waitForTimeout(1200)
        await scan(`${label} [${locale}]`, width, locale)
      }
    }
    console.log(`scanned ${DENSE.length} dense screens x ${WIDTHS.length} widths in ${locale}`)
  }
} finally {
  await browser.close()
}

// --- report -----------------------------------------------------------------
const byKind = (k) => findings.filter((f) => f.kind === k)
console.log(`\n${scans} page scans, ${findings.length} findings\n`)

for (const kind of ['small', 'doc-overflow', 'overflow', 'key']) {
  const rows = byKind(kind)
  const seen = new Set()
  const unique = rows.filter((r) => {
    const sig = kind === 'small' ? `${r.tag}|${r.name}|${r.w}x${r.h}`
      : kind === 'key' ? r.key
        : `${r.label}|${r.width}|${r.tag ?? 'doc'}`
    if (seen.has(sig)) return false
    seen.add(sig)
    return true
  })
  console.log(`${kind.toUpperCase()}: ${rows.length} (${unique.length} distinct)`)
  for (const r of unique.slice(0, 25)) {
    if (kind === 'small') {
      console.log(`  ${r.w}x${r.h} ${r.tag} "${r.name}" @${r.width}px ${r.label}`)
      console.log(`      ${r.cls}`)
    } else if (kind === 'key') {
      console.log(`  ${r.key} @${r.width}px ${r.label}`)
    } else if (kind === 'doc-overflow') {
      console.log(`  ${r.label} @${r.width}px scrollWidth ${r.scrollWidth} > ${r.clientWidth}`)
    } else {
      console.log(`  ${r.tag} right=${r.right} > ${r.limit} @${r.width}px ${r.label} "${r.text}"`)
    }
  }
  console.log('')
}

process.exit(findings.length ? 1 : 0)
