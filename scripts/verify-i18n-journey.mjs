/**
 * The acceptance journey: a visitor chooses a language and the platform becomes
 * that language, before login and after it.
 *
 * This is deliberately NOT a check that document.lang changed. It reads visible
 * interface text off each screen and asserts the text itself differs from
 * English wherever a translation exists. "The selector changed and nothing else
 * did" is exactly the failure this is built to catch.
 *
 * Read-only against STAGING: it navigates, signs in with an existing fixture,
 * and reads.
 */
import { chromium } from 'playwright'
import { assertServedProjectNotProduction, testSecret } from './_environment.mjs'

const BASE = 'http://localhost:5199'
await assertServedProjectNotProduction(BASE, 'scripts/verify-i18n-journey.mjs')

const WIDTHS = [390, 768, 1440]
const LANGS = ['en', 'ha', 'ig', 'yo', 'fr']

/** Interface text that should change when a translation exists. */
/**
 * Wait for the screen to have PAINTED before sampling it.
 *
 * Without this the English baseline could be captured from a half-rendered
 * page, and every later language would then be compared against an empty
 * signature. That showed up as a language being reported "identical to
 * English" when it was in fact translating correctly.
 */
async function settled(page) {
  await page
    .waitForFunction(
      () => {
        const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 }
        const headings = [...document.querySelectorAll('h1,h2,h3')].filter(vis).length
        const links = [...document.querySelectorAll('nav a, main a[href], main button')].filter(vis).length
        return (headings > 0 || links > 2) && (document.body.innerText || '').length > 200
      },
      { timeout: 25000 },
    )
    .catch(() => {})
  await page.waitForTimeout(700)
}

async function sample(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    const body = document.body.innerText || ''
    const headings = [...document.querySelectorAll('h1,h2,h3')].filter(vis)
      .map((e) => e.innerText.trim()).filter(Boolean).slice(0, 6)
    const controls = [...document.querySelectorAll('button,a[href]')].filter(vis)
      .map((e) => e.innerText.trim()).filter(Boolean).slice(0, 10)
    const keyLeak = body.match(/\b(common|nav|auth|settings|marketplace|cart|checkout|financing|verification|transaction|public|dashboard|role|error|validation|a11y|term)\.[a-zA-Z][\w.]*/g) ?? []
    return {
      headings, controls,
      keyLeak: [...new Set(keyLeak)].slice(0, 3),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      lang: document.documentElement.lang,
      money: (body.match(/₦[\d,]+/) ?? [])[0] ?? null,
      sig: headings.join('|') + '||' + controls.join('|'),
    }
  })
}

let flagged = 0
let checked = 0
const note = (ok, label, detail = '') => {
  checked++
  if (!ok) flagged++
  console.log(`    ${ok ? 'OK  ' : 'FLAG'} ${label}${detail ? ` - ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of WIDTHS) {
    console.log(`\n${'='.repeat(72)}\n${width}px\n${'='.repeat(72)}`)
    /** English signatures per screen, to compare the others against. */
    const baseline = {}

    for (const lang of LANGS) {
      const ctx = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 950 },
        isMobile: width < 500, hasTouch: width < 500,
      })
      await ctx.addInitScript((l) => {
        try { localStorage.setItem('loamy.language', l) } catch { /* ignore */ }
      }, lang)
      const page = await ctx.newPage()
      console.log(`\n  --- ${lang} ---`)

      const screens = []

      // ---- public, logged OUT -------------------------------------------
      for (const [path, name] of [['/welcome', 'public landing'], ['/marketplace', 'public marketplace'], ['/login', 'login']]) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        const consent = page.getByRole('button', { name: /essential only|masu muhimmanci|essentiels/i })
        if (await consent.count()) await consent.first().click().catch(() => {})
        await settled(page)
        screens.push([name, await sample(page)])
      }

      // ---- sign in, then authenticated ----------------------------------
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.locator('#email').fill(testSecret('LOAMY_TEST_FARMER_EMAIL'))
      await page.locator('#password').fill(testSecret('LOAMY_TEST_FARMER_PASSWORD'))
      await page.locator('form button[type="submit"]').first().click()
      await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 }).catch(() => {})

      for (const [path, name] of [
        ['/dashboard/farmer', 'dashboard'],
        ['/dashboard/farmer/marketplace', 'marketplace'],
        ['/dashboard/farmer/settings', 'settings'],
        ['/cart', 'cart'],
      ]) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await settled(page)
        screens.push([name, await sample(page)])
      }

      for (const [name, m] of screens) {
        if (lang === 'en') baseline[name] = m.sig
        const changed = lang === 'en' || (baseline[name] && m.sig !== baseline[name])
        const clean = m.keyLeak.length === 0 && m.overflow <= 1
        note(
          clean && changed,
          `${name}`,
          `${lang === 'en' ? 'baseline' : changed ? 'TEXT CHANGED' : 'IDENTICAL TO ENGLISH'}`
          + ` overflow=${m.overflow}px keyLeak=${m.keyLeak.join(',') || 'none'}`
          + (m.money ? ` money=${m.money}` : ''),
        )
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  console.log(flagged === 0
    ? `\nJOURNEY OK (${checked} assertions)`
    : `\n${flagged} of ${checked} FLAGGED`)
}
