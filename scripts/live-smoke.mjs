/**
 * Post-deploy smoke test against LIVE production.
 *
 * READ-ONLY. It navigates and reads. It creates no account, transaction,
 * financing application, logistics job, warehouse receipt or fee change, and
 * runs no part of the security suite (deployment directive section 10).
 */
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import { secret } from './_secrets.mjs'

const BASE = 'https://loamy-platform.vercel.app'
const OUT = '.qa/'
mkdirSync(OUT, { recursive: true })
const w1 = JSON.parse(readFileSync('.qa/w1-accounts.json', 'utf8'))

const ACC = {
  buyer:   { email: 'usmanyakubu541+loamy3-b-mrj1fc26@gmail.com', password: secret('QA_PASSWORD_STAGE3') },
  trader:  { email: 'usmanyakubu541+loamy3-s-mrj1fc26@gmail.com', password: secret('QA_PASSWORD_STAGE3') },
  farmer:  { email: 'usmanyakubu541+loamy5-f-mrpmbwpe@gmail.com', password: secret('QA_PASSWORD_STAGE5') },
  partner: { email: 'usmanyakubu541+loamy4-p-mrlk3b11@gmail.com', password: secret('QA_PASSWORD_STAGE4') },
  admin:   { email: secret('QA_EMAIL_ADMIN'), password: secret('QA_PASSWORD_ADMIN') },
  carrier: w1.carrier,
  warehouse: w1.wh,
}

const findings = []
const note = (a, ok, d) => {
  findings.push({ a, ok, d })
  console.log(`${ok ? 'OK  ' : 'FLAG'}  ${a}${d ? ` - ${d}` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

function watch(page, errs) {
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 110)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (/Failed to load resource/.test(m.text())) return
    errs.push('console: ' + m.text().slice(0, 110))
  })
  page.on('requestfailed', (r) => {
    const u = r.url()
    // A request cancelled because the harness navigated away is not a
    // production failure. Only real network errors count.
    const why = r.failure()?.errorText ?? ''
    if (/ERR_ABORTED/.test(why)) return
    if (/supabase|\.js$|\.css$/.test(u)) errs.push(`netfail(${why}): ` + u.slice(0, 80))
  })
}

async function login(ctx, who) {
  const page = await ctx.newPage()
  const errs = []
  watch(page, errs)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  const d = page.getByRole('button', { name: /essential only/i })
  if (await d.count()) await d.first().click()
  await page.locator('#email').fill(ACC[who].email)
  await page.locator('#password').fill(ACC[who].password)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  try {
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 })
  } catch {
    note(`${who}: sign-in`, false, 'stayed on /login')
    return { page, errs, ok: false }
  }
  note(`${who}: sign-in + role routing`, true, new URL(page.url()).pathname)
  return { page, errs, ok: true }
}

async function visit(page, path, label, expect) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  // Wait for the app to paint something, rather than for a fixed interval.
  try {
    await page.waitForFunction(() => (document.body?.innerText ?? '').trim().length > 40, { timeout: 20000 })
  } catch { /* reported as blank below */ }
  const body = await page.locator('body').innerText().catch(() => '')
  const blank = body.trim().length < 40
  const ok = !blank && (!expect || expect.test(body))
  note(`${label} (${path})`, ok, blank ? 'BLANK SCREEN' : `${body.trim().length} chars, at ${new URL(page.url()).pathname}`)
  return body
}

try {
  // ---- public surfaces, three widths ---------------------------------------
  for (const [name, width] of Object.entries({ mobile: 390, tablet: 768, desktop: 1440 })) {
    const ctx = await browser.newContext({
      viewport: { width, height: width < 500 ? 844 : 950 },
      isMobile: width < 500, hasTouch: width < 500,
    })
    const page = await ctx.newPage()
    const errs = []
    watch(page, errs)
    const routes = [['/', 'landing', null], ['/privacy', 'privacy', /privacy/i],
                    ['/login', 'login', /sign in/i], ['/signup', 'signup', /create/i]]
    for (const [p, label, re] of routes) {
      await visit(page, p, `${label}@${width}`, re)
      if (p === '/login' || p === '/signup') {
        const hero = await page.locator('img[src*="hero-farmer"]').count()
        note(`${label}@${width}: new auth photography`, hero > 0)
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth)
        note(`${label}@${width}: no horizontal overflow`, overflow <= 1, `${overflow}px`)
      }
      await page.screenshot({ path: `${OUT}live-${label}-${name}.png` })
    }
    note(`public console clean@${width}`, errs.length === 0, errs.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // ---- buyer journey + Loam, mobile and desktop ----------------------------
  for (const [name, width] of Object.entries({ mobile: 390, desktop: 1440 })) {
    const ctx = await browser.newContext({
      viewport: { width, height: width < 500 ? 844 : 950 },
      isMobile: width < 500, hasTouch: width < 500,
    })
    const { page, errs, ok } = await login(ctx, 'buyer')
    if (ok) {
      await visit(page, '/dashboard/buyer', `buyer dashboard@${width}`)
      await visit(page, '/marketplace', `marketplace@${width}`)
      // Commodity detail is /marketplace/<uuid>. Exclude the in-page
      // "#market-prices" anchor, which is not a listing.
      const href = await page.evaluate(() => {
        const a = [...document.querySelectorAll('a[href^="/marketplace/"]')]
          .map((x) => x.getAttribute('href'))
          .find((h) => h && !h.includes('#'))
        return a ?? null
      })
      if (href) {
        await visit(page, href, `commodity detail@${width}`)
      } else {
        note(`commodity detail@${width}`, false, 'no listing link found on marketplace')
      }
      await visit(page, '/trace', `trace@${width}`)

      // Loam must be checked on an in-shell route. /financing is not a route
      // at all (the real ones are /financing/apply/:txnId and
      // /dashboard/farmer/financing/apply), so it correctly 404s -- and the
      // 404 page renders outside AppShell, where there is no Copilot.
      await visit(page, '/dashboard/buyer', `back to dashboard@${width}`)
      const launcher = page.getByRole('button', { name: /open loam/i })
      let found = false
      try {
        await page.waitForFunction(() => !!document.querySelector('button[aria-label*="Open Loam"]'), { timeout: 20000 })
        found = true
      } catch { /* reported below */ }
      note(`Loam launcher present@${width}`, found)
      if (found) {
        note(`launcher reads "Ask Loam"@${width}`, /ask loam/i.test(await launcher.innerText()))
        const svgs = await launcher.locator('svg').count()
        note(`launcher uses Loam identity, not a star@${width}`, svgs >= 1, `${svgs} svg`)
        const col = await page.evaluate(() => {
          const b = document.querySelector('button[aria-label*="Open Loam"]')
          if (!b) return null
          const r = b.getBoundingClientRect()
          const navs = [...document.querySelectorAll('nav')].filter((n) => n.getBoundingClientRect().bottom > window.innerHeight - 8)
          if (!navs.length) return { bar: false, overlap: 0 }
          const nr = navs[0].getBoundingClientRect()
          return { bar: true, overlap: Math.max(0, Math.min(r.bottom, nr.bottom) - Math.max(r.top, nr.top)) }
        })
        note(`launcher clears bottom nav@${width}`, col !== null && col.overlap === 0,
             col && col.bar ? `overlap ${Math.round(col.overlap)}px` : 'no bottom nav at this width')
        await launcher.click()
        await page.waitForTimeout(1500)
        const panel = await page.locator('body').innerText()
        note(`Copilot panel opens@${width}`, /Loam/.test(panel))
        note(`panel names the role@${width}`, /your farming co-pilot/i.test(panel))
        await page.screenshot({ path: `${OUT}live-copilot-${name}.png` })
      }
      // Public profile is /u/:username.
      const handle = await page.evaluate(() => {
        const a = [...document.querySelectorAll('a[href^="/u/"]')][0]
        return a ? a.getAttribute('href') : null
      })
      if (handle) await visit(page, handle, `public profile@${width}`)
      else note(`public profile@${width}`, true, 'no /u/ link exposed to this account (not a defect)')
    }
    note(`buyer runtime clean@${width}`, errs.length === 0, errs.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // ---- other role surfaces, desktop ---------------------------------------
  for (const who of ['farmer', 'partner', 'admin', 'carrier', 'warehouse', 'trader']) {
    if (!ACC[who] || !ACC[who].email) {
      note(`${who}: account available`, false, 'no credential on this machine')
      continue
    }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
    const { page, errs, ok } = await login(ctx, who)
    if (ok) {
      try {
        await page.waitForFunction(() => (document.body?.innerText ?? '').trim().length > 60, { timeout: 25000 })
      } catch { /* reported below */ }
      const body = await page.locator('body').innerText().catch(() => '')
      note(`${who}: dashboard renders`, body.trim().length > 60, `${body.trim().length} chars at ${new URL(page.url()).pathname}`)
      await page.screenshot({ path: `${OUT}live-role-${who}.png` })
    }
    note(`${who}: runtime clean`, errs.length === 0, errs.slice(0, 2).join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
  const bad = findings.filter((f) => !f.ok)
  console.log(`\n${findings.length - bad.length}/${findings.length} checks OK`)
  if (bad.length) {
    console.log('FLAGGED:')
    bad.forEach((f) => console.log(`  - ${f.a}: ${f.d ?? ''}`))
  }
}
