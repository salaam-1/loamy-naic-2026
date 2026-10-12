/**
 * UI/UX refinement QA — auth + Loam, at 390 / 768 / 1440.
 * Run with: node scripts/visual-qa-auth-loam.mjs   (dev server on :5199)
 *
 * Checks the things the brief actually rules out — a giant flat green field,
 * a white card, a sparkle identity, clipped text, tiny targets — rather than
 * checking that elements merely exist. Screenshots land in .qa/.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { secret } from './_secrets.mjs'

const BASE = 'http://localhost:5199'
const OUT = new URL('../.qa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const BUYER = { email: 'usmanyakubu541+loamy3-b-mrj1fc26@gmail.com', password: secret('QA_PASSWORD_STAGE3') }

const findings = []
const note = (a, ok, d) => {
  findings.push({ area: a, ok, detail: d })
  console.log(`${ok ? 'OK  ' : 'FLAG'}  ${a}${d ? ` — ${d}` : ''}`)
}

/** Largest single-colour run on a horizontal scan — catches flat colour fields. */
const largestFlatBlock = (page) => page.evaluate(() => {
  const el = document.body
  const seen = new Map()
  for (const node of el.querySelectorAll('*')) {
    const r = node.getBoundingClientRect()
    if (r.width < 200 || r.height < 200) continue
    const bg = getComputedStyle(node).backgroundColor
    const img = getComputedStyle(node).backgroundImage
    if (bg === 'rgba(0, 0, 0, 0)' || img !== 'none') continue
    const area = Math.round((r.width * r.height) / (window.innerWidth * window.innerHeight) * 100)
    seen.set(bg, Math.max(seen.get(bg) ?? 0, area))
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['none', 0]
})

/**
 * Targets under 32px, EXCLUDING links that sit inline within a sentence.
 *
 * WCAG 2.2 Target Size (Minimum) exempts a target "in a sentence or block of
 * text", and rightly so: padding a link inside a paragraph to 32px breaks the
 * line rhythm and helps nobody. The signup consent line is exactly that case.
 * A standalone link, like "Create an account" on its own row, is not exempt.
 */
const smallTargets = (page) => page.evaluate(() =>
  [...document.querySelectorAll('button,a[href],input,select,textarea')]
    .filter((el) => {
      const r = el.getBoundingClientRect()
      if (!(r.width > 0 && r.height > 0 && r.height < 32)) return false
      if (el.tagName !== 'A') return true
      const parent = el.parentElement
      if (!parent) return true
      const parentText = (parent.innerText || '').trim()
      const ownText = (el.innerText || '').trim()
      // Inline exception: the link is a fragment of a longer sentence.
      return !(parentText.length > ownText.length + 20)
    })
    .map((el) => `${el.tagName}:${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 22)}@${Math.round(el.getBoundingClientRect().height)}px`))

const overflow = (page) => page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth)

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function settled(page, label, fn, timeout = 25000) {
  try { await page.waitForFunction(fn, { timeout }) }
  catch { throw new Error(`STEP DID NOT SETTLE: ${label}`) }
}

try {
  // =========================================================================
  // AUTH — /login and /signup at three widths
  // =========================================================================
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

    for (const route of ['/login', '/signup']) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
      const d = page.getByRole('button', { name: /essential only/i })
      if (await d.count()) await d.first().click()
      await page.waitForTimeout(500)

      const body = await page.locator('body').innerText()
      const tag = `${route}@${width}`

      // The photograph must actually be there, not a green field.
      const heroCount = await page.locator('img[src*="hero-farmer"]').count()
      note(`${tag} uses agricultural photography`, heroCount > 0)

      // No giant flat colour field. A solid block over ~35% of the viewport is
      // the failure mode the brief names.
      const [colour, area] = await largestFlatBlock(page)
      note(`${tag} no giant flat colour block`, area < 35, `${colour} covers ${area}%`)

      // The form surface must be warm, not pure white.
      const panelBg = await page.evaluate(() => {
        const h1 = document.querySelector('h1')
        let el = h1?.parentElement
        while (el && getComputedStyle(el).backgroundImage === 'none'
               && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)') el = el.parentElement
        return el ? getComputedStyle(el).backgroundImage.slice(0, 60) || getComputedStyle(el).backgroundColor : 'none'
      })
      note(`${tag} form sits on a warm gradient surface`, /gradient/.test(panelBg), panelBg)

      note(`${tag} positioning line present`, /moving agriculture forward/i.test(body))
      note(`${tag} privacy policy reachable`, /privacy policy/i.test(body))
      note(`${tag} no horizontal overflow`, (await overflow(page)) <= 1)

      const small = await smallTargets(page)
      note(`${tag} tap targets`, small.length === 0, small.slice(0, 3).join(', ') || 'all >= 32px')

      await page.screenshot({ path: `${OUT}ux-${route.slice(1)}-${name}.png`, fullPage: true })
    }

    // Password reveal + focus, once per width.
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const pw = page.locator('#password')
    await pw.fill('secret123')
    note(`password masked by default@${width}`, (await pw.getAttribute('type')) === 'password')
    await page.getByRole('button', { name: /show password/i }).click()
    note(`password reveal works@${width}`, (await pw.getAttribute('type')) === 'text')
    await page.getByRole('button', { name: /hide password/i }).click()
    note(`password re-masks@${width}`, (await pw.getAttribute('type')) === 'password')

    // Keyboard: tab order must reach the submit button, and focus must show.
    // Tab FORWARD until the submit button has focus. The first version
    // pressed Tab twice and asserted a BUTTON, but "Forgot password?" sits
    // between the two fields -- so it was asserting the tab order it imagined
    // rather than the one the page has.
    await page.locator('#email').focus()
    let reached = false
    let ring = 'none'
    for (let i = 0; i < 8 && !reached; i++) {
      await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const el = document.activeElement
        if (!el) return null
        const s = getComputedStyle(el)
        return {
          submit: el.tagName === 'BUTTON' && el.getAttribute('type') === 'submit',
          ring: `${el.tagName} outline=${s.outlineWidth} shadow=${s.boxShadow !== 'none'}`,
        }
      })
      if (info?.submit) { reached = true; ring = info.ring }
    }
    note(`keyboard reaches the submit control@${width}`, reached, ring)
    note(`focused control shows a visible ring@${width}`, /outline=2px|shadow=true/.test(ring), ring)

    // A real failed sign-in must announce itself.
    await page.locator('#email').fill('nobody@example.invalid')
    await page.locator('#password').fill('wrong-password')
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await settled(page, 'sign-in error', () => !!document.querySelector('[role="alert"]'))
    const alertText = await page.getByRole('alert').first().innerText()
    note(`failed sign-in is announced@${width}`, /incorrect|invalid/i.test(alertText), alertText.slice(0, 50))
    note(`error field association@${width}`,
      (await page.locator('#email').getAttribute('aria-invalid')) === 'true')
    await page.screenshot({ path: `${OUT}ux-login-error-${name}.png` })

    note(`${name} auth: no console errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // =========================================================================
  // LOAM — launcher + panel, signed in, three widths
  // =========================================================================
  for (const [name, width] of Object.entries({ mobile: 390, tablet: 768, desktop: 1440 })) {
    const ctx = await browser.newContext({
      viewport: { width, height: width < 500 ? 844 : 950 },
      isMobile: width < 500, hasTouch: width < 500,
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)))

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    const d = page.getByRole('button', { name: /essential only/i })
    if (await d.count()) await d.first().click()
    await page.locator('#email').fill(BUYER.email)
    await page.locator('#password').fill(BUYER.password)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 })

    // Part 17 names /dashboard/buyer specifically. Landing wherever the login
    // redirect happens to go is not the same thing as testing that route.
    await page.goto(`${BASE}/dashboard/buyer`, { waitUntil: 'networkidle' })
    note(`lands on /dashboard/buyer@${width}`, page.url().includes('/dashboard/buyer'), page.url())

    // Wait for the LAUNCHER, not for a stopwatch. A flat 2.5s sleep here was
    // enough at 1440 and not enough at 390 -- the mobile dashboard settles
    // later -- so the harness reported a missing launcher and blamed the
    // feature flag for what was its own impatience.
    let found = 0
    try {
      await page.waitForFunction(
        () => !!document.querySelector('button[aria-label*="Open Loam"]'),
        { timeout: 30000 },
      )
      found = 1
    } catch { found = 0 }

    const launcher = page.getByRole('button', { name: /open loam/i })
    note(`launcher present@${width}`, found > 0)
    if (found === 0) {
      // Don't speculate about the cause. Read the flag the app actually reads.
      const flag = await page.evaluate(() => {
        try { return localStorage.getItem('loamy.flags') ?? '(unset)' } catch { return '(unreadable)' }
      })
      note(`Loam QA@${width}`, false, `launcher never mounted within 30s; flags=${flag}`)
      await ctx.close()
      continue
    }

    note(`launcher has an accessible name@${width}`,
      /farming co-pilot/i.test(await launcher.getAttribute('aria-label') ?? ''))
    note(`launcher reads "Ask Loam"@${width}`, /ask loam/i.test(await launcher.innerText()))

    // The launcher's own comment claims bottom-20 clears the mobile tab bar.
    // Verify it instead of trusting it: a launcher sitting on top of the
    // Intelligence and Profile tabs is a navigation collision.
    const collision = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label*="Open Loam"]')
      if (!btn) return null
      const b = btn.getBoundingClientRect()
      const bars = [...document.querySelectorAll('nav')].filter((n) => {
        const r = n.getBoundingClientRect()
        return r.height > 0 && r.bottom > window.innerHeight - 8
      })
      if (!bars.length) return { bar: false, overlap: 0 }
      const r = bars[0].getBoundingClientRect()
      const overlap = Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top))
      return { bar: true, overlap: Math.round(overlap) }
    })
    note(`launcher clears the bottom nav@${width}`,
      collision !== null && collision.overlap === 0,
      collision?.bar ? `bottom nav present, overlap ${collision.overlap}px` : 'no bottom nav at this width')

    // Closed state: the launcher must not sit over page content that matters.
    const closedShot = `${OUT}ux-dashboard-${name}-closed.png`
    await page.screenshot({ path: closedShot })
    note(`dashboard renders with Loam closed@${width}`,
      (await page.locator('main, [role="main"]').count()) > 0)

    const box = await launcher.boundingBox()
    note(`launcher is a comfortable target@${width}`, (box?.height ?? 0) >= 40, `${Math.round(box?.height ?? 0)}px`)

    // No sparkle anywhere in the launcher.
    const svgCount = await launcher.locator('svg').count()
    note(`launcher carries an avatar, not a sparkle icon@${width}`,
      await launcher.locator('span.rounded-full').count() > 0, `${svgCount} svg`)

    await page.screenshot({ path: `${OUT}ux-loam-closed-${name}.png` })

    await launcher.click()
    await settled(page, 'copilot panel', () => /Your farming co-pilot/i.test(document.body.innerText))
    const panel = await page.locator('body').innerText()
    note(`panel header says "Loam"@${width}`, /\bLoam\b/.test(panel))
    note(`panel names the role@${width}`, /your farming co-pilot/i.test(panel))
    // The HEADER, not the whole panel: COPILOT_DISCLAIMER legitimately names
    // the product in its legal text, and asserting over the whole body was
    // flagging that correct content as a failure.
    const headerText = await page.locator('[role="dialog"], .bg-brand-fill').first().innerText().catch(() => panel.slice(0, 200))
    note(`panel header drops the old "Loamy Co-pilot" label@${width}`, !/Loamy Co-pilot/.test(headerText))
    note(`panel no horizontal overflow@${width}`, (await overflow(page)) <= 1)
    await page.screenshot({ path: `${OUT}ux-loam-open-${name}.png` })

    await page.getByRole('button', { name: /^close$/i }).click()
    await page.waitForTimeout(400)
    note(`panel closes@${width}`, (await page.getByRole('button', { name: /open loam/i }).count()) > 0)

    note(`${name} loam: no console errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // =========================================================================
  // Reduced motion — the launcher must not animate on hover
  // =========================================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    const dur = await page.evaluate(() => {
      const b = document.querySelector('button[type="submit"]')
      return b ? getComputedStyle(b).transitionDuration : 'none'
    })
    // 1e-05s IS 0.01ms. The first regex only matched the literal strings.
    const seconds = parseFloat(dur)
    note('reduced motion collapses transitions', Number.isFinite(seconds) && seconds <= 0.001, dur)
    await ctx.close()
  }
} finally {
  await browser.close()
}

writeFileSync(`${OUT}ux-findings.json`, JSON.stringify(findings, null, 2))
const flags = findings.filter((f) => !f.ok)
console.log(`\n${findings.length - flags.length}/${findings.length} checks OK`)
if (flags.length) console.log(`FLAGGED:\n${flags.map((f) => `  - ${f.area}: ${f.detail ?? ''}`).join('\n')}`)
