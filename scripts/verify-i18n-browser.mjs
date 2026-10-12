/**
 * Browser QA for localization, against STAGING.
 *
 * Read-only: signs in with existing fixtures, navigates, reads.
 *
 * HOW THE LANGUAGE IS SET
 *   The footer and Settings selectors land in Phase 4, so there is no control to
 *   click yet. This writes `loamy.language` into localStorage before the app
 *   boots, which is the same key the provider reads for an anonymous choice. It
 *   exercises the real resolution path rather than a test hook.
 *
 * WHAT IT LOOKS FOR
 *   Horizontal overflow, clipped or blank interface text, and key names leaking
 *   into the UI. Long French strings and Nigerian-language diacritics are the
 *   two things most likely to break a layout built against English, so the
 *   report prints the widest rendered control per surface.
 */
import { chromium } from 'playwright'
import { assertServedProjectNotProduction, testSecret } from './_environment.mjs'

const BASE = 'http://localhost:5199'
await assertServedProjectNotProduction(BASE, 'scripts/verify-i18n-browser.mjs')

const LANGS = ['en', 'ha', 'ig', 'yo', 'fr']
const WIDTHS = [390, 768, 1440]

/** Surfaces every language is checked on, at every width. */
const PUBLIC_ROUTES = [['/', 'landing'], ['/marketplace', 'marketplace']]
/** Signed-in surfaces. Text-dense operational screens included deliberately. */
const AUTH_ROUTES = [
  ['/dashboard/farmer', 'dashboard'],
  ['/dashboard/farmer/settings', 'settings'],
  ['/dashboard/farmer/my-stock', 'my stock (dense)'],
  ['/dashboard/farmer/wallet', 'financial activity (dense)'],
]

let flagged = 0
let checked = 0
const note = (ok, label, detail = '') => {
  checked++
  if (!ok) flagged++
  console.log(`    ${ok ? 'OK  ' : 'FLAG'} ${label}${detail ? ` - ${detail}` : ''}`)
}

async function measure(page) {
  return page.evaluate(() => {
    const docW = document.documentElement.clientWidth
    const vis = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    // A key name leaking into the UI is the signature failure of a broken
    // lookup: 'nav.marketplace' rendered instead of a word.
    const body = document.body.innerText || ''
    const keyLeak = (body.match(/\b(common|nav|auth|settings|marketplace|cart|checkout|financing|verification|transaction|logistics|warehouse|booking|inspection|directory|profile|privacy|notifications|onboarding|support|copilot|a11y|term|role|dashboard|error|confirm|validation|financial|trace)\.[a-zA-Z][\w.]*/g) ?? [])
    // Widest interactive control: the thing a long translation bursts first.
    let widest = 0
    let widestText = ''
    for (const el of document.querySelectorAll('button, a[href], [role="menuitem"]')) {
      if (!vis(el)) continue
      const w = el.getBoundingClientRect().width
      if (w > widest) { widest = w; widestText = (el.innerText || '').trim().slice(0, 28) }
    }
    return {
      overflow: document.documentElement.scrollWidth - docW,
      keyLeak: [...new Set(keyLeak)].slice(0, 3),
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      bodyLen: body.trim().length,
      widest: Math.round(widest),
      widestText,
    }
  })
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const lang of LANGS) {
    console.log(`\n${'='.repeat(72)}\n${lang}\n${'='.repeat(72)}`)
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 950 },
        isMobile: width < 500,
        hasTouch: width < 500,
      })
      // Seed the preference before any app code runs.
      await ctx.addInitScript((l) => {
        try { localStorage.setItem('loamy.language', l) } catch { /* ignore */ }
      }, lang)
      const page = await ctx.newPage()
      const errs = []
      page.on('pageerror', (e) => errs.push(e.message.slice(0, 90)))
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 90))
      })

      console.log(`\n  --- ${width}px ---`)

      for (const [route, label] of PUBLIC_ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1500)
        const m = await measure(page)
        note(
          m.overflow <= 1 && m.keyLeak.length === 0 && m.bodyLen > 200 && m.lang === lang,
          `${label}`,
          `lang=${m.lang} overflow=${m.overflow}px widest=${m.widest}px keyLeak=${m.keyLeak.join(',') || 'none'}`,
        )
      }

      // ---- the footer selector, driven as a member would -------------------
      // Only once per language, at each width: the point is that the control
      // works and repaints, not that it works on every route.
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
      // The privacy banner is fixed to the bottom of the viewport and sits over
      // the footer, so it has to be answered before the footer is reachable.
      const consent = page.getByRole('button', { name: /essential only/i })
      if (await consent.count()) await consent.first().click()
      await page.waitForTimeout(1200)
      const trigger = page.locator('footer button[aria-haspopup="listbox"]')
      const hasSelector = await trigger.count()
      note(hasSelector > 0, 'footer language selector present')
      if (hasSelector) {
        const box = await trigger.first().boundingBox()
        note(Boolean(box && box.height >= 44), 'footer selector meets the 44px touch target', box ? `${Math.round(box.height)}px` : 'no box')

        await trigger.first().click()
        const options = page.locator('footer [role="option"]')
        await options.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
        note((await options.count()) === 5, 'footer selector offers five languages', `${await options.count()}`)

        // Switch to French and confirm the document actually follows.
        await options.filter({ hasText: 'Français' }).first().click()
        await page.waitForTimeout(900)
        const after = await page.evaluate(() => ({
          lang: document.documentElement.lang,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          stored: (() => { try { return localStorage.getItem('loamy.language') } catch { return null } })(),
        }))
        note(after.lang === 'fr', 'selecting French repaints the document', `lang=${after.lang}`)
        note(after.stored === 'fr', 'the choice is persisted for this device', `stored=${after.stored}`)
        note(after.overflow <= 1, 'no overflow after switching', `${after.overflow}px`)

        // Put the language back for the rest of this pass.
        await trigger.first().click()
        await page.locator('footer [role="option"]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
        const want = { en: 'English', ha: 'Hausa', ig: 'Igbo', yo: 'Yorùbá', fr: 'Français' }[lang]
        await page.locator('footer [role="option"]').filter({ hasText: want }).first().click()
        await page.waitForTimeout(600)
      }

      // Signed-in surfaces
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
      const d = page.getByRole('button', { name: /essential only/i })
      if (await d.count()) await d.first().click()
      await page.locator('#email').fill(testSecret('LOAMY_TEST_FARMER_EMAIL'))
      await page.locator('#password').fill(testSecret('LOAMY_TEST_FARMER_PASSWORD'))
      // Selected structurally, not by its English label: the button now reads
      // "Shiga", "Banye", "Wọlé" or "Se connecter" depending on the language,
      // which is the point of the exercise.
      await page.locator('form button[type="submit"]').first().click()
      await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 }).catch(() => {})

      for (const [route, label] of AUTH_ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => document.querySelector('main h1') !== null, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(900)
        const m = await measure(page)
        note(
          m.overflow <= 1 && m.keyLeak.length === 0 && m.bodyLen > 200 && m.dir === 'ltr',
          `${label}`,
          `overflow=${m.overflow}px widest=${m.widest}px "${m.widestText}" keyLeak=${m.keyLeak.join(',') || 'none'}`,
        )
      }

      note(errs.length === 0, 'no console errors', errs.slice(0, 2).join(' | '))
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  console.log(flagged === 0 ? `\nALL I18N BROWSER CHECKS OK (${checked} assertions)` : `\n${flagged} of ${checked} FLAGGED`)
}
