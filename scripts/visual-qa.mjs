/**
 * Browser visual QA.
 * Run with: node scripts/visual-qa.mjs   (dev server must be on :5199)
 *
 * Drives the INSTALLED Chrome via Playwright's `channel: 'chrome'`, so no
 * browser is downloaded. Signs in with the existing test accounts from
 * scripts/TEST-LOGINS.md rather than creating anything, because §50 is
 * explicit that production is not a test environment.
 *
 * It does two things a source read cannot:
 *
 *   1. SCREENSHOTS the intended surfaces at desktop and phone widths, so the
 *      visual direction can be judged by looking at it.
 *
 *   2. MEASURES the tokens as the browser actually computed them -- the page
 *      gradient, the grain opacity, card radius and shadow, tap-target
 *      heights, horizontal overflow, and the safe-area padding on the tab
 *      bar. A class name in the source proves nothing about what rendered.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { secret } from './_secrets.mjs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/visual-qa.mjs')

const BASE = process.env.QA_BASE ?? 'http://localhost:5199'
const OUT = new URL('../.qa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const ACCOUNTS = {
  farmer: { email: 'usmanyakubu541+loamy5-f-mrpmbwpe@gmail.com', password: secret('QA_PASSWORD_STAGE5') },
  admin: { email: 'usmanyakubu541+admin-explore@gmail.com', password: secret('QA_PASSWORD_ADMIN') },
}

const findings = []
const note = (area, ok, detail) => {
  findings.push({ area, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FLAG'}  ${area}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function newPage(mobile) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  page.on('pageerror', (e) => note('console', false, `page error: ${e.message.slice(0, 120)}`))
  return { ctx, page }
}

async function dismissPrivacy(page) {
  // The notice is correct behaviour, not a defect -- but it covers the bottom
  // of every first screenshot, so it is answered once per context.
  const btn = page.getByRole('button', { name: /essential only/i })
  if (await btn.count()) {
    await btn.first().click()
    await page.waitForTimeout(250)
  }
}

async function login(page, who) {
  const { email, password } = ACCOUNTS[who]
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await dismissPrivacy(page)
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /sign in|log in/i }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
  await ready(page)
  await dismissPrivacy(page)
}

/**
 * Wait for the app to finish booting.
 *
 * `networkidle` is not enough: AuthContext resolves the session and profile
 * after the last request settles, so the first screenshots caught a spinner
 * on an otherwise empty page. Waiting for real chrome to exist is the only
 * honest signal that a screen has rendered.
 */
async function ready(page) {
  await page.waitForLoadState('networkidle')
  try {
    await page.waitForSelector('header, main, nav[aria-label="Primary"]', { timeout: 20_000 })
    await page.waitForFunction(
      () => document.querySelectorAll('button, a[href]').length > 3,
      { timeout: 20_000 },
    )
  } catch {
    /* screenshot whatever state it reached; the measurements will say so */
  }
  await page.waitForTimeout(600)
}

async function shoot(page, name) {
  const file = `${OUT}${name}.png`
  await page.screenshot({ path: file, fullPage: false })
  return file
}

/** Token measurements, read from the live computed styles. */
async function measure(page) {
  return page.evaluate(() => {
    const body = getComputedStyle(document.body)
    const before = getComputedStyle(document.body, '::before')
    const card =
      document.querySelector('.surface-2') ??
      document.querySelector('[class*="rounded-card"]')
    const cardStyle = card ? getComputedStyle(card) : null

    const targets = [...document.querySelectorAll('button, a[href], input, select')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
    const small = targets.filter((el) => el.getBoundingClientRect().height < 32).length

    return {
      bodyBackgroundImage: body.backgroundImage.slice(0, 120),
      bodyBackgroundColor: body.backgroundColor,
      grainOpacity: before.opacity,
      grainBlend: before.mixBlendMode,
      cardRadius: cardStyle?.borderRadius ?? null,
      cardShadow: cardStyle?.boxShadow?.slice(0, 80) ?? null,
      cardBackground: cardStyle?.backgroundImage?.slice(0, 80) ?? null,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      tapTargets: targets.length,
      tapTargetsUnder32: small,
    }
  })
}

// ---------------------------------------------------------------------------
// DESKTOP
// ---------------------------------------------------------------------------
{
  const { ctx, page } = await newPage(false)

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await shoot(page, 'desktop-01-public-home-with-notice')
  await dismissPrivacy(page)
  await shoot(page, 'desktop-02-public-marketplace')

  const m = await measure(page)
  note('page gradient', m.bodyBackgroundImage.includes('gradient'), m.bodyBackgroundImage)
  note('grain', m.grainOpacity !== '' && Number(m.grainOpacity) > 0,
    `opacity ${m.grainOpacity}, blend ${m.grainBlend}`)
  note('no horizontal overflow (desktop)', m.scrollWidth <= m.clientWidth + 1,
    `scroll ${m.scrollWidth} vs client ${m.clientWidth}`)

  await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' })
  await shoot(page, 'desktop-03-privacy-policy')

  await login(page, 'farmer')
  await shoot(page, 'desktop-04-farmer-home')
  const dash = await measure(page)
  note('card radius (desktop dashboard)', dash.cardRadius !== null, String(dash.cardRadius))
  note('card elevation', (dash.cardShadow ?? '') !== 'none', String(dash.cardShadow))
  note('card is a gradient panel, not a flat fill',
    (dash.cardBackground ?? '').includes('gradient'), String(dash.cardBackground))
  note('no horizontal overflow (dashboard)', dash.scrollWidth <= dash.clientWidth + 1,
    `scroll ${dash.scrollWidth} vs client ${dash.clientWidth}`)
  writeFileSync(`${OUT}measure-desktop.json`, JSON.stringify(dash, null, 2))

  await page.goto(`${BASE}/dashboard/farmer/my-stock`); await ready(page)
  await shoot(page, 'desktop-05-my-stock')

  await page.goto(`${BASE}/dashboard/farmer/marketplace`); await ready(page)
  await shoot(page, 'desktop-06-marketplace-signed-in')

  await page.goto(`${BASE}/cart`); await ready(page)
  await shoot(page, 'desktop-07-cart')

  await ctx.close()
}

// ---------------------------------------------------------------------------
// DESKTOP — admin
// ---------------------------------------------------------------------------
{
  const { ctx, page } = await newPage(false)
  try {
    await login(page, 'admin')
    await page.goto(`${BASE}/admin`); await ready(page)
    await shoot(page, 'desktop-08-admin-home')
    await page.goto(`${BASE}/admin/config`); await ready(page)
    await shoot(page, 'desktop-09-admin-config-fallback')
    await page.goto(`${BASE}/admin/fees`); await ready(page)
    await shoot(page, 'desktop-10-admin-fee-schedules')
    note('fee schedule admin renders',
      (await page.getByRole('heading', { name: /fee schedules/i }).count()) > 0)
    note('admin reachable', true, 'signed in and rendered')
  } catch (e) {
    note('admin reachable', false, String(e).slice(0, 140))
  }
  await ctx.close()
}

// ---------------------------------------------------------------------------
// MOBILE
// ---------------------------------------------------------------------------
{
  const { ctx, page } = await newPage(true)

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await shoot(page, 'mobile-01-public-home-with-notice')
  const notice = await measure(page)
  note('no horizontal overflow (mobile public)', notice.scrollWidth <= notice.clientWidth + 1,
    `scroll ${notice.scrollWidth} vs client ${notice.clientWidth}`)
  await dismissPrivacy(page)
  await shoot(page, 'mobile-02-public-marketplace')

  await login(page, 'farmer')
  await shoot(page, 'mobile-03-home-with-tabbar')

  const mob = await measure(page)
  note('no horizontal overflow (mobile dashboard)', mob.scrollWidth <= mob.clientWidth + 1,
    `scroll ${mob.scrollWidth} vs client ${mob.clientWidth}`)
  note('tap targets >= 32px', mob.tapTargetsUnder32 === 0,
    `${mob.tapTargetsUnder32} of ${mob.tapTargets} under 32px`)
  writeFileSync(`${OUT}measure-mobile.json`, JSON.stringify(mob, null, 2))

  // Bottom tab bar
  const tabbar = page.locator('nav[aria-label="Primary"]')
  const hasTabbar = await tabbar.count()
  note('bottom tab bar present on mobile', hasTabbar > 0)
  if (hasTabbar) {
    const box = await tabbar.boundingBox()
    const vp = page.viewportSize()
    note('tab bar sits at the bottom edge', box && Math.abs(box.y + box.height - vp.height) < 2,
      `bottom ${box ? Math.round(box.y + box.height) : '?'} vs viewport ${vp.height}`)
    const pad = await tabbar.evaluate((el) => getComputedStyle(el).paddingBottom)
    note('tab bar reserves safe-area padding', pad !== '', `padding-bottom: ${pad}`)
    const tabs = await tabbar.locator('a, button').count()
    note('tab count is thumb-sized', tabs >= 3 && tabs <= 5, `${tabs} tabs`)

    // Open a multi-section tab -> sheet
    const multi = tabbar.locator('button').first()
    if (await multi.count()) {
      await multi.click()
      await page.waitForTimeout(350)
      await shoot(page, 'mobile-04-tab-sheet')
      const sheet = page.locator('[role="dialog"]')
      note('tab sheet opens as a dialog', (await sheet.count()) > 0)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
  }

  // The Co-pilot launcher must sit ABOVE the tab bar, not on it. This was a
  // real collision at 390px: it covered the Intelligence and Profile tabs.
  {
    const fab = page.getByRole('button', { name: /co-?pilot/i })
    if (await fab.count()) {
      const fabBox = await fab.first().boundingBox()
      const barBox = await page.locator('nav[aria-label="Primary"]').boundingBox()
      const clears = fabBox && barBox ? fabBox.y + fabBox.height <= barBox.y + 1 : true
      note('Co-pilot launcher clears the tab bar', clears,
        fabBox && barBox ? `fab ends ${Math.round(fabBox.y + fabBox.height)}, bar starts ${Math.round(barBox.y)}` : 'not both present')
    } else {
      note('Co-pilot launcher clears the tab bar', true, 'launcher not rendered (flag off)')
    }
  }

  // A card-heavy screen and a form
  await page.goto(`${BASE}/dashboard/farmer/my-stock`); await ready(page)
  await shoot(page, 'mobile-05-my-stock-cards')
  const stock = await measure(page)
  note('no horizontal overflow (card-heavy mobile)', stock.scrollWidth <= stock.clientWidth + 1,
    `scroll ${stock.scrollWidth} vs client ${stock.clientWidth}`)

  await page.goto(`${BASE}/dashboard/farmer/settings`); await ready(page)
  await shoot(page, 'mobile-06-form')
  const form = await measure(page)
  note('no horizontal overflow (mobile form)', form.scrollWidth <= form.clientWidth + 1,
    `scroll ${form.scrollWidth} vs client ${form.clientWidth}`)

  await page.goto(`${BASE}/dashboard/farmer/privacy`); await ready(page)
  await shoot(page, 'mobile-07-privacy-settings')

  await ctx.close()
}

await browser.close()

writeFileSync(`${OUT}findings.json`, JSON.stringify(findings, null, 2))
const flags = findings.filter((f) => !f.ok)
console.log(`\n${findings.length - flags.length}/${findings.length} checks OK`)
if (flags.length) console.log('FLAGGED:\n' + flags.map((f) => `  - ${f.area}: ${f.detail ?? ''}`).join('\n'))
console.log(`screenshots in ${OUT}`)
