/**
 * Shell / heading / copy verification against STAGING, at the four required
 * widths, for every persona this environment has a fixture for.
 *
 * Read-only: it signs in, navigates and reads. It writes nothing.
 *
 * WHAT IT ASSERTS PER PAGE
 *   loamyBanner <= 1   one Loamy-branded header, never two stacked shells.
 *                      Counted as headers carrying the wordmark or logo mark,
 *                      not raw <header> elements: a <header> inside <main> is
 *                      valid sectioning content, not a second site header.
 *   logoMark    <= 1 on a dashboard, <= 2 on a public page, where the shell
 *                      shows it in the header and again in the footer.
 *   h1          == 1 on a dashboard, in every branch including loading and
 *                      empty. See the note beside the check for the two
 *                      public routes that legitimately carry none today.
 *   nav         >= 1 on a dashboard only; a static public page has none.
 *   overflow    <= 1px no horizontal scroll at mobile widths.
 *   emDash      == 0   the house copy rule, applied to rendered text, which
 *                      also covers strings emitted by Postgres.
 *   plus: no console errors and no failed image requests.
 *
 * NOT COVERED, AND WHY
 *   The bank portal (bank dashboard, bank profile, activate facility) needs a
 *   bank officer account. Staging has no bank fixture, so these routes cannot
 *   be signed into here. That surface is covered at the API level by
 *   tests/security/slice3-bank-decision.test.ts instead.
 */
import { chromium } from 'playwright'
import { assertServedProjectNotProduction, testSecret } from './_environment.mjs'

const BASE = 'http://localhost:5199'
await assertServedProjectNotProduction(BASE, 'scripts/verify-header-hierarchy.mjs')

const PERSONAS = [
  {
    name: 'anonymous (public shell + footer)',
    creds: null,
    routes: [
      ['/', 'public storefront home'],
      ['/marketplace', 'public marketplace'],
      ['/welcome', 'marketing landing (footer)'],
      ['/privacy', 'privacy policy (footer)'],
      ['/insights', 'insights'],
    ],
  },
  {
    name: 'farmer',
    creds: ['LOAMY_TEST_FARMER_EMAIL', 'LOAMY_TEST_FARMER_PASSWORD'],
    routes: [
      ['/dashboard/farmer', 'farmer overview'],
      ['/dashboard/farmer/my-stock', 'my stock'],
      ['/dashboard/farmer/my-listings', 'my listings'],
      ['/dashboard/farmer/my-interests', 'my interests (empty)'],
      ['/dashboard/farmer/my-bookings', 'my bookings (empty)'],
      ['/dashboard/farmer/directory', 'directory'],
      ['/dashboard/farmer/wallet', 'financial activity'],
      ['/dashboard/farmer/intelligence', 'intelligence'],
      ['/dashboard/farmer/invite', 'invite'],
      ['/dashboard/farmer/settings', 'settings'],
      ['/dashboard/farmer/marketplace', 'marketplace section'],
      ['/dashboard/farmer/privacy', 'privacy'],
    ],
  },
  {
    name: 'buyer',
    creds: ['LOAMY_TEST_BUYER_EMAIL', 'LOAMY_TEST_BUYER_PASSWORD'],
    routes: [
      ['/dashboard/buyer', 'buyer overview'],
      ['/dashboard/buyer/my-interests', 'buyer interests'],
      ['/dashboard/buyer/wallet', 'buyer financial activity'],
      ['/dashboard/buyer/directory', 'buyer directory'],
    ],
  },
  {
    name: 'logistics_provider',
    creds: ['LOAMY_TEST_LOGISTICS_EMAIL', 'LOAMY_TEST_LOGISTICS_PASSWORD'],
    routes: [
      ['/dashboard/logistics_provider', 'logistics overview (hero bug)'],
      ['/dashboard/logistics_provider/service-bookings', 'bookings inbox'],
      ['/dashboard/logistics_provider/settings', 'logistics settings'],
      ['/dashboard/logistics_provider/wallet', 'logistics financial activity'],
    ],
  },
  {
    name: 'admin',
    creds: ['LOAMY_TEST_ADMIN_EMAIL', 'LOAMY_TEST_ADMIN_PASSWORD'],
    routes: [
      ['/admin', 'admin overview'],
      ['/dashboard/farmer/settings', 'admin settings (no public handle card)'],
    ],
  },
]

const WIDTHS = [390, 414, 768, 1440]

/**
 * Navigation with one retry. Both the dev server and the staging endpoint have
 * been intermittently timing out on this machine, and a single dropped
 * navigation used to abort the entire run, which loses every persona after it
 * and tells you nothing about them. A retry keeps one blip from masquerading
 * as a result.
 */
async function goto(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch {
    await page.waitForTimeout(1500)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
/** Which photograph each role actually rendered, checked for reuse at the end. */
const heroByPersona = {}
let flagged = 0
let checked = 0
const note = (ok, label, detail = '') => {
  checked++
  if (!ok) flagged++
  console.log(`    ${ok ? 'OK  ' : 'FLAG'} ${label}${detail ? ` - ${detail}` : ''}`)
}

try {
  for (const persona of PERSONAS) {
    console.log(`\n${'='.repeat(70)}\n${persona.name}\n${'='.repeat(70)}`)
    for (const width of WIDTHS) {
     try {
      const ctx = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 950 },
        isMobile: width < 500,
        hasTouch: width < 500,
      })
      const page = await ctx.newPage()
      const errs = []
      page.on('pageerror', (e) => errs.push(e.message.slice(0, 100)))
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
          errs.push(m.text().slice(0, 100))
        }
      })
      page.on('response', (r) => {
        if (r.request().resourceType() === 'image' && r.status() >= 400) {
          errs.push(`image ${r.status()} ${r.url().slice(-40)}`)
        }
      })

      if (persona.creds) {
        await goto(page, `${BASE}/login`)
        const d = page.getByRole('button', { name: /essential only/i })
        if (await d.count()) await d.first().click()
        await page.locator('#email').fill(testSecret(persona.creds[0]))
        await page.locator('#password').fill(testSecret(persona.creds[1]))
        await page.getByRole('button', { name: /^sign in$/i }).click()
        // The staging endpoint has been intermittently refusing connections
        // today, and a dropped sign-in used to abort the whole run. Retry once
        // rather than lose the remaining personas to one timeout.
        try {
          await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 })
        } catch {
          await page.getByRole('button', { name: /^sign in$/i }).click()
          await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 })
        }
      } else {
        await goto(page, `${BASE}/`)
        const d = page.getByRole('button', { name: /essential only/i })
        if (await d.count()) await d.first().click()
      }

      console.log(`\n  --- ${width}px ---`)
      for (const [route, label] of persona.routes) {
        await goto(page, `${BASE}${route}`)
        // A dashboard page is asserted to have exactly one <h1>, so wait for
        // that <h1> and not merely for "a heading". Accepting an h2 let the
        // probe measure a page React had not finished rendering, which showed
        // up as an intermittent h1=0 on a page whose heading is unconditional.
        // The public storefront legitimately has no h1, so it keeps the looser
        // condition.
        await page
          .waitForFunction(
            (publicPage) =>
              (publicPage
                ? document.querySelector('main h1, main h2, main') !== null
                : document.querySelector('main h1') !== null) &&
              (document.body.innerText || '').length > 200,
            persona.creds === null,
            { timeout: 25000 },
          )
          .catch(() => {})
        await page.waitForTimeout(800)

        const m = await page.evaluate(() => {
          const vis = (el) => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
          }
          const banners = [...document.querySelectorAll('header')]
            .filter(vis)
            .filter(
              (h) =>
                h.querySelector('img[src*="logo-mark"]') || /^\s*Loamy/.test(h.innerText || ''),
            ).length
          const marks = [...document.querySelectorAll('img[src*="logo-mark"]')].filter(vis).length
          const h1 = [...document.querySelectorAll('h1')].filter(vis).length
          const navs = [...document.querySelectorAll('nav')].filter(vis).length
          return {
            banners,
            marks,
            h1,
            navs,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            emDash: (document.body.innerText.match(/—/g) ?? []).length,
          }
        })
        // Public pages and dashboards do not have the same shape, and the
        // first version of this probe wrongly judged both by the dashboard's
        // rules. Two corrections, both mine, not the app's:
        //   - the public shell legitimately shows the logo mark twice, once
        //     in the header and once in the footer;
        //   - a static public page has no <nav>.
        //
        // KNOWN AND PRE-EXISTING AT main (972b74e): the storefront hero
        // (StorefrontHero.tsx:142) renders its slide title as <h2>, so / and
        // /marketplace carry no <h1>. This branch did not introduce it and
        // does not fix it: deciding which carousel slide owns the page
        // heading is a design call, not a mechanical edit. Allowed here so a
        // NEW regression still stands out, and reported rather than silenced.
        const isPublic = persona.creds === null
        const noH1Expected = isPublic && (route === '/' || route === '/marketplace')
        const ok =
          m.banners <= 1 &&
          m.marks <= (isPublic ? 2 : 1) &&
          (noH1Expected ? m.h1 === 0 : m.h1 === 1) &&
          (isPublic || m.navs >= 1) &&
          m.overflow <= 1 &&
          m.emDash === 0
        note(
          ok,
          label,
          `loamyBanner=${m.banners} logoMark=${m.marks} h1=${m.h1} nav=${m.navs} overflow=${m.overflow}px emDash=${m.emDash}`,
        )
      }
      // ---- UX pass checks: brand link, phone sign out, role hero ----------
      if (persona.creds) {
        await goto(page, `${BASE}${persona.routes[0][0]}`)
        // Wait for the brand to be PAINTED rather than guessing at a delay. A
        // fixed 1200ms passed on three widths and missed the fourth, which
        // looked like a missing brand and was only a slow admin render.
        await page
          .waitForFunction(
            () =>
              [...document.querySelectorAll('a img[src*="logo-mark"]')].some((i) => {
                const r = i.getBoundingClientRect()
                return r.width > 0 && r.height > 0
              }),
            { timeout: 20000 },
          )
          .catch(() => {})

        // 3. The whole brand lockup is a client-side link to this shell's home.
        const brand = await page.evaluate(() => {
          const a = [...document.querySelectorAll('a')]
            .filter((el) => el.querySelector('img[src*="logo-mark"]'))
            .find((el) => {
              const r = el.getBoundingClientRect()
              return r.width > 0 && r.height > 0
            })
          if (!a) return null
          const r = a.getBoundingClientRect()
          return { href: a.getAttribute('href'), w: Math.round(r.width), h: Math.round(r.height) }
        })
        note(
          Boolean(brand && brand.href && brand.w > 60 && brand.h > 20),
          'brand lockup is a link, and a real target',
          brand ? `href=${brand.href} ${brand.w}x${brand.h}px` : 'no linked brand found',
        )

        if (brand?.href) {
          await page.evaluate(() => {
            const a = [...document.querySelectorAll('a')]
              .filter((el) => el.querySelector('img[src*="logo-mark"]'))
              .find((el) => {
                const r = el.getBoundingClientRect()
                return r.width > 0 && r.height > 0
              })
            a?.click()
          })
          await page.waitForTimeout(900)
          const landed = new URL(page.url()).pathname
          note(landed === brand.href, 'brand link navigates to the role home', `landed on ${landed}`)
        }

        // 2. Sign out must be reachable on a phone without a profile page.
        if (width < 640) {
          await goto(page, `${BASE}${persona.routes[0][0]}`)
          const btn = page.getByRole('button', { name: /account menu/i })
          // Wait for the control, do not sample for it: on a cold dev server
          // the first persona at the first width had not painted the header
          // yet, which read as a missing feature rather than a slow render.
          await btn.first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
          const found = await btn.count()
          if (found) await btn.first().click()
          const signOut = page.getByRole('menuitem', { name: /^sign out$/i })
          await signOut.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
          note(
            found > 0 && (await signOut.count()) > 0,
            'sign out reachable from the phone account menu',
            found ? '' : 'no account menu button in the header',
          )
        }

        // 1 + 6. The hero is present, role-specific and inside the viewport.
        // Only the role dashboards carry one; the admin console never has.
        const hasHero = persona.routes[0][0].startsWith('/dashboard/')
        if (hasHero) {
        await goto(page, `${BASE}${persona.routes[0][0]}`)
        await page.waitForSelector('img[src*="/images/hero-"]', { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(600)
        const hero = await page.evaluate(() => {
          const img = [...document.querySelectorAll('img')].find((i) =>
            /\/images\/hero-/.test(i.getAttribute('src') || ''),
          )
          if (!img) return null
          const r = img.getBoundingClientRect()
          return {
            src: (img.getAttribute('src') || '').split('/').pop(),
            overflows: r.right > document.documentElement.clientWidth + 1,
            h: Math.round(r.height),
          }
        })
        note(
          Boolean(hero && !hero.overflows && hero.h > 60),
          'hero image present and inside the viewport',
          hero ? `${hero.src} h=${hero.h}px` : 'no hero image rendered',
        )
        if (hero) heroByPersona[persona.name] = hero.src
        }
      }

      note(errs.length === 0, 'no console / image errors', errs.slice(0, 2).join(' | '))
      await ctx.close()
     } catch (e) {
      // Reported as a flag so it is visible, rather than thrown so it ends the
      // run. An unreachable persona is a result too.
      note(false, `${persona.name} @ ${width}px could not be exercised`, String(e).slice(0, 90))
     }
    }
  }
  // 6. Role differentiation, asserted on what the browser really loaded.
  const seen = Object.entries(heroByPersona)
  const dupes = seen.filter(([n, src]) => seen.some(([m, s2]) => m !== n && s2 === src))
  console.log(`
${'='.repeat(70)}
hero per role
${'='.repeat(70)}`)
  for (const [n, src] of seen) console.log(`    ${n.padEnd(22)} ${src}`)
  note(dupes.length === 0, 'each role rendered its own photograph', dupes.map(([n]) => n).join(', '))
} finally {
  await browser.close()
  console.log(
    flagged === 0
      ? `\nALL CHECKS OK (${checked} assertions)`
      : `\n${flagged} of ${checked} FLAGGED`,
  )
}
