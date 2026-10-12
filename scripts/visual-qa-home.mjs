/**
 * Phase 3 browser QA — Home + Profile at 390 / 768 / 1440.
 * Run with: node scripts/visual-qa-home.mjs   (dev server on :5199)
 *
 * Signs in with existing accounts from scripts/TEST-LOGINS.md. Creates
 * nothing: production is not a test environment.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { secret } from './_secrets.mjs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/visual-qa-home.mjs')

const BASE = 'http://localhost:5199'
const OUT = new URL('../.qa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const ACCOUNTS = {
  farmer:  { email: 'usmanyakubu541+loamy5-f-mrpmbwpe@gmail.com', password: secret('QA_PASSWORD_STAGE5'), role: 'farmer' },
  trader:  { email: 'usmanyakubu541+loamy3-s-mrj1fc26@gmail.com', password: secret('QA_PASSWORD_STAGE3'), role: 'trader' },
  buyer:   { email: 'usmanyakubu541+loamy3-b-mrj1fc26@gmail.com', password: secret('QA_PASSWORD_STAGE3'), role: 'buyer' },
  partner: { email: 'usmanyakubu541+loamy4-p-mrlk3b11@gmail.com', password: secret('QA_PASSWORD_STAGE4'), role: 'growth_partner' },
}
const WIDTHS = { mobile: 390, tablet: 768, desktop: 1440 }

const findings = []
const note = (a, ok, d) => { findings.push({ area: a, ok, detail: d }); console.log(`${ok?'OK  ':'FLAG'}  ${a}${d?` — ${d}`:''}`) }

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function ready(page) {
  await page.waitForLoadState('networkidle')
  try {
    // Wait for Home's real content, not merely for chrome: the skeleton also
    // has buttons in the shell around it.
    await page.waitForFunction(() => document.querySelectorAll('h1,h2,h3').length > 0, { timeout: 25000 })
  } catch {}
  await page.waitForTimeout(1200)
}

async function session(who, width) {
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 900 },
    isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: width < 500 ? 2 : 1,
  })
  const page = await ctx.newPage()
  page.on('pageerror', e => note(`${who}@${width} page error`, false, e.message.slice(0,110)))
  const { email, password } = ACCOUNTS[who]
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  const d = page.getByRole('button', { name: /essential only/i })
  if (await d.count()) await d.first().click()
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /sign in|log in/i }).first().click()
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })
  await ready(page)
  const d2 = page.getByRole('button', { name: /essential only/i })
  if (await d2.count()) { await d2.first().click(); await page.waitForTimeout(200) }
  return { ctx, page }
}

/**
 * Contrast of the hero heading against the pixels actually behind it.
 *
 * §22: imagery behind text needs readability VERIFIED. Rendering the hero to
 * a canvas and sampling the real composite is the only way to know -- the
 * scrim looked fine over one photograph and washed the title out over
 * another.
 */
async function heroContrast(page) {
  return page.evaluate(async () => {
    const h1 = document.querySelector('h1')
    const hero = h1?.closest('section')
    const img = hero?.querySelector('img')
    if (!h1 || !hero || !img) return null

    const lum = (r, g, b) => {
      const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }

    const hRect = h1.getBoundingClientRect()
    const heroRect = hero.getBoundingClientRect()
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(heroRect.width); canvas.height = Math.ceil(heroRect.height)
    const cx = canvas.getContext('2d')
    // Draw the photo as the hero renders it (object-fit: cover), then the
    // scrim gradient over it, matching the composite the eye receives.
    const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight)
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale
    cx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
    // Read the scrim's ACTUAL stops from the rendered element. Duplicating
    // them here would let the check drift away from the design token and
    // quietly start measuring a gradient that is no longer on the page.
    const scrimEl = hero.querySelector('[aria-hidden]')
    const bg = scrimEl ? getComputedStyle(scrimEl).backgroundImage : ''
    const stops = [...bg.matchAll(/rgba?\(([^)]+)\)\s*([\d.]+)%/g)].map((m) => {
      const [r, gg, b, a = '1'] = m[1].split(',').map((v) => parseFloat(v))
      return { r, g: gg, b, a, at: parseFloat(m[2]) / 100 }
    })
    if (stops.length < 2) return null
    const grad = cx.createLinearGradient(0, 0, 0, canvas.height)
    for (const s of stops) grad.addColorStop(Math.min(1, Math.max(0, s.at)), `rgba(${s.r},${s.g},${s.b},${s.a})`)
    cx.fillStyle = grad; cx.fillRect(0, 0, canvas.width, canvas.height)

    const y = Math.round(hRect.top - heroRect.top + hRect.height / 2)
    const strip = cx.getImageData(0, Math.max(0, Math.min(y, canvas.height - 1)), canvas.width, 1).data
    let worst = 21
    for (let x = 0; x < canvas.width; x += 8) {
      const i = x * 4
      const bg = lum(strip[i], strip[i + 1], strip[i + 2])
      // White text on the sampled background.
      const ratio = (1.0 + 0.05) / (bg + 0.05)
      if (ratio < worst) worst = ratio
    }
    return Math.round(worst * 100) / 100
  })
}

async function audit(page, tag) {
  const m = await page.evaluate(() => {
    const de = document.documentElement
    const h1 = document.querySelector('h1')
    const imgs = [...document.querySelectorAll('main img, section img')]
    const cards = [...document.querySelectorAll('.surface-1, .surface-2, .surface-3')]
    const targets = [...document.querySelectorAll('button, a[href], input, select')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    // Is anything hidden behind the fixed bottom tab bar?
    // The tab bar is `lg:hidden`, i.e. display:none above 1024px, so its
    // rect collapses to zeros. A zeroed rect is "not on screen", not "at the
    // top of the page" -- treating it as the latter flagged every desktop run.
    const bar = document.querySelector('nav[aria-label="Primary"]')
    const barRect = bar ? bar.getBoundingClientRect() : null
    const barTop = barRect && barRect.height > 0 ? barRect.top : Infinity
    // Scroll to the end and ask whether the LAST piece of content is still
    // visible above the bar. Comparing <main>'s box bottom was wrong: on a
    // scrolling page that box extends far below the viewport, so it flagged
    // every run regardless of padding.
    window.scrollTo(0, document.body.scrollHeight)
    const last = document.querySelector('main > div > :last-child')
    const mainBottom = last ? last.getBoundingClientRect().bottom : 0
    return {
      h1: h1 ? h1.innerText.slice(0, 70) : null,
      headings: document.querySelectorAll('h1,h2,h3').length,
      images: imgs.length,
      cards: cards.length,
      overflow: de.scrollWidth - de.clientWidth,
      smallTargets: targets.filter(el => el.getBoundingClientRect().height < 32).length,
      totalTargets: targets.length,
      mainClearsBar: mainBottom <= barTop + 1 || !bar,
    }
  })
  note(`${tag} h1 present`, !!m.h1, m.h1 ?? 'none')
  note(`${tag} no overflow`, m.overflow <= 1, `${m.overflow}px`)
  note(`${tag} tap targets`, m.smallTargets === 0, `${m.smallTargets}/${m.totalTargets} under 32px`)
  note(`${tag} content clears tab bar`, m.mainClearsBar)
  const contrast = await heroContrast(page)
  if (contrast !== null) {
    note(`${tag} hero text contrast`, contrast >= 4.5, `${contrast}:1 (WCAG AA needs 4.5)`)
    m.heroContrast = contrast
  }
  return m
}

const summary = {}
for (const [who, acct] of Object.entries(ACCOUNTS)) {
  for (const [name, width] of Object.entries(WIDTHS)) {
    // Desktop + mobile for every role; tablet only for the farmer (the densest).
    if (name === 'tablet' && who !== 'farmer') continue
    const { ctx, page } = await session(who, width)
    await page.screenshot({ path: `${OUT}p3-${who}-home-${name}.png`, fullPage: false })
    summary[`${who}-${name}`] = await audit(page, `${who}@${width}`)
    if (who === 'farmer' && name === 'desktop') {
      await page.screenshot({ path: `${OUT}p3-farmer-home-full.png`, fullPage: true })
      await page.goto(`${BASE}/dashboard/farmer/profile`); await ready(page)
      await page.screenshot({ path: `${OUT}p3-profile-desktop.png`, fullPage: false })
    }
    await ctx.close()
  }
}

// Public profile, signed out.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/u/nosuchhandle-xyz`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}p3-public-profile-notfound.png` })
  const txt = await page.locator('body').innerText()
  note('public profile: unknown handle has a not-found state', /not found|no public profile|does not exist|no longer|unavailable/i.test(txt), txt.slice(0,90).replace(/\n/g,' '))
  await ctx.close()
}

await browser.close()
writeFileSync(`${OUT}p3-findings.json`, JSON.stringify({ findings, summary }, null, 2))
const flags = findings.filter(f => !f.ok)
console.log(`\n${findings.length - flags.length}/${findings.length} checks OK`)
if (flags.length) console.log('FLAGGED:\n' + flags.map(f => `  - ${f.area}: ${f.detail ?? ''}`).join('\n'))
console.log('\nComposition summary:')
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(18)} headings=${v.headings} images=${v.images} surfaces=${v.cards}`)
