/**
 * §14 browser QA — the real owner edit journey at 390 / 768 / 1440.
 * Run with: node scripts/visual-qa-edit.mjs   (dev server on :5199)
 *
 * Drives the ACTUAL application: signs in as an existing test account, edits
 * a real field, saves to the real database, navigates to /u/:username and
 * checks the change is there. Restores the original value at the end so the
 * account is left as it was found.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { secret } from './_secrets.mjs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/visual-qa-edit.mjs')

const BASE = 'http://localhost:5199'
const OUT = new URL('../.qa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const OWNER = { email: 'usmanyakubu541+loamy3-s-mrj1fc26@gmail.com', password: secret('QA_PASSWORD_STAGE3') }
const HANDLE = 'sahel_grains'
const ROLE = 'trader'

const findings = []
const note = (a, ok, d) => { findings.push({ area: a, ok, detail: d }); console.log(`${ok ? 'OK  ' : 'FLAG'}  ${a}${d ? ` — ${d}` : ''}`) }

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  const d = page.getByRole('button', { name: /essential only/i })
  if (await d.count()) await d.first().click()
  await page.locator('input[type="email"]').fill(OWNER.email)
  await page.locator('input[type="password"]').fill(OWNER.password)
  await page.getByRole('button', { name: /sign in|log in/i }).first().click()
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })
  // NOT networkidle: a polling notifications query keeps the network busy
  // indefinitely, so the wait has to be on content rendering instead.
  await page.waitForSelector('header', { timeout: 30000 })
  await page.waitForTimeout(800)
}

async function openSettings(page) {
  await page.goto(`${BASE}/dashboard/${ROLE}/settings`)
  await page.waitForSelector('#set_headline', { timeout: 30000 })
  await page.waitForTimeout(700)
}

async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement
    const targets = [...document.querySelectorAll('button,a[href],input,select,textarea')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    const clipped = [...document.querySelectorAll('input,select,textarea')].filter(el => {
      const r = el.getBoundingClientRect()
      return r.right > de.clientWidth + 1 || r.left < -1
    }).length
    return {
      overflow: de.scrollWidth - de.clientWidth,
      small: targets.filter(el => el.getBoundingClientRect().height < 32).length,
      total: targets.length,
      clipped,
    }
  })
}

const MARKER = `QA ${Date.now().toString(36).slice(-5)}`
let original = null

for (const [name, width] of Object.entries({ mobile: 390, tablet: 768, desktop: 1440 })) {
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 950 },
    isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: width < 500 ? 2 : 1,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 100)))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 100)) })
  const failedRequests = []
  // ERR_ABORTED is a request the app itself cancelled — the notifications
  // poll being torn down on navigation. That is correct behaviour, not a
  // network failure, and counting it would make this check permanently red.
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? ''
    if (why.includes('ERR_ABORTED')) return
    failedRequests.push(`${why} ${r.url().slice(0, 70)}`)
  })

  await signIn(page)
  await openSettings(page)
  await page.screenshot({ path: `${OUT}p3c-settings-${name}.png`, fullPage: false })

  const m = await measure(page)
  note(`settings@${width} no overflow`, m.overflow <= 1, `${m.overflow}px`)
  note(`settings@${width} tap targets`, m.small === 0, `${m.small}/${m.total} under 32px`)
  note(`settings@${width} no clipped form controls`, m.clipped === 0, `${m.clipped} clipped`)

  if (name === 'desktop') {
    // Capture the original so the account is restored afterwards.
    original = await page.locator('#set_headline').inputValue()

    // Save is inert until something changes.
    const save = page.getByRole('button', { name: /save profile/i })
    note('save disabled until dirty', await save.isDisabled())

    // C. change one field, D. save
    await page.locator('#set_headline').fill(`${MARKER} headline`)
    note('save enabled once dirty', !(await save.isDisabled()))
    note('unsaved-changes hint appears', (await page.getByText(/unsaved changes/i).count()) > 0)
    await save.click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}p3c-settings-saved-${name}.png` })
    note('success confirmation shown',
      (await page.getByText(/your public profile now shows these details/i).count()) > 0)

    // G. validation error
    await page.locator('#set_name').fill('   ')
    await page.getByRole('button', { name: /save profile/i }).click()
    await page.waitForTimeout(600)
    note('validation error shown', (await page.getByText(/name cannot be empty/i).count()) > 0)
    await page.screenshot({ path: `${OUT}p3c-settings-validation-${name}.png` })
    await page.reload(); await openSettings(page)

    // I. username collision
    await page.locator('#username').fill('alt_9uw4pg')
    await page.waitForTimeout(1400)
    const collision = await page.locator('#username-status').innerText()
    note('username collision is refused with a reason', !/is available/i.test(collision), collision.slice(0, 60))
    await page.screenshot({ path: `${OUT}p3c-username-collision-${name}.png` })

    // Invalid username
    await page.locator('#username').fill('a')
    await page.waitForTimeout(900)
    const invalid = await page.locator('#username-status').innerText()
    note('invalid username is refused', !/is available/i.test(invalid), invalid.slice(0, 60))

    // E + F. return to the profile and confirm the saved value
    await page.goto(`${BASE}/u/${HANDLE}`)
    await page.waitForSelector('h1', { timeout: 30000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}p3c-profile-after-save-${name}.png` })
    const body = await page.locator('body').innerText()
    note('saved value appears on the public profile', body.includes(`${MARKER} headline`),
      body.includes(`${MARKER} headline`) ? 'found' : 'NOT found')

    // Restore.
    await openSettings(page)
    await page.locator('#set_headline').fill(original ?? '')
    await page.getByRole('button', { name: /save profile/i }).click()
    await page.waitForTimeout(2000)
    const restored = await page.locator('#set_headline').inputValue()
    note('original headline restored', restored === (original ?? ''), `"${restored}"`)
  }

  note(`settings@${width} no console errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
  note(`settings@${width} no failed requests`, failedRequests.length === 0, failedRequests.slice(0, 2).join(' | '))
  await ctx.close()
}

await browser.close()
writeFileSync(`${OUT}p3c-findings.json`, JSON.stringify(findings, null, 2))
const flags = findings.filter(f => !f.ok)
console.log(`\n${findings.length - flags.length}/${findings.length} checks OK`)
if (flags.length) console.log('FLAGGED:\n' + flags.map(f => `  - ${f.area}: ${f.detail ?? ''}`).join('\n'))
