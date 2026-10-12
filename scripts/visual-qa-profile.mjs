/**
 * Phase 3B browser QA — public profile at 390 / 768 / 1440.
 * Run with: node scripts/visual-qa-profile.mjs   (dev server on :5199)
 *
 * Uses existing accounts from scripts/TEST-LOGINS.md and existing handles.
 * Creates nothing.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { secret } from './_secrets.mjs'
import { testEnv } from './_environment.mjs'

// Mutation-heavy: refuses to run without a staging project, and refuses
// to run against production even if one is configured to point there.
const TEST_ENV = testEnv('scripts/visual-qa-profile.mjs')

const BASE = 'http://localhost:5199'
const OUT = new URL('../.qa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const OWNER = { email: 'usmanyakubu541+loamy3-s-mrj1fc26@gmail.com', password: secret('QA_PASSWORD_STAGE3') }

const findings = []
const note = (a, ok, d) => { findings.push({ area: a, ok, detail: d }); console.log(`${ok ? 'OK  ' : 'FLAG'}  ${a}${d ? ` — ${d}` : ''}`) }

// Find a real public handle to screenshot, rather than inventing one.
const sb = createClient(TEST_ENV.url, TEST_ENV.key, { auth: { persistSession: false } })
await sb.auth.signInWithPassword(OWNER)
// The SIGNED-IN user's own handle, not merely the first row RLS allows.
const { data: auth } = await sb.auth.getUser()
const { data: me } = await sb.from('profiles').select('username').eq('id', auth.user.id).maybeSingle()
const { data: handles } = await sb.from('loamy_profile_handles').select('username').limit(25)
let withListings = null, withoutListings = null
for (const h of (handles ?? [])) {
  const { data } = await sb.rpc('loamy_profile_by_username', { p_username: h.username })
  if (!data?.found) continue
  if ((data.listings?.length ?? 0) > 0 && !withListings) withListings = h.username
  if ((data.listings?.length ?? 0) === 0 && !withoutListings) withoutListings = h.username
  if (withListings && withoutListings) break
}
const ownHandle = me?.username ?? null
console.log(`handles — with listings: ${withListings ?? 'none'} · without: ${withoutListings ?? 'none'} · owner: ${ownHandle ?? 'none'}`)

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function ready(page) {
  await page.waitForLoadState('networkidle')
  try { await page.waitForFunction(() => document.querySelectorAll('h1').length > 0, { timeout: 20000 }) } catch {}
  await page.waitForTimeout(900)
}

async function audit(page, tag) {
  const m = await page.evaluate(() => {
    const de = document.documentElement
    const h1s = [...document.querySelectorAll('h1')]
    const targets = [...document.querySelectorAll('button,a[href],input,select')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    const imgs = [...document.querySelectorAll('main img, section img')]
    return {
      h1Count: h1s.length,
      h1: h1s[0]?.innerText.slice(0, 50) ?? null,
      headings: document.querySelectorAll('h1,h2,h3').length,
      overflow: de.scrollWidth - de.clientWidth,
      small: targets.filter(el => el.getBoundingClientRect().height < 32).length,
      total: targets.length,
      imagesMissingAlt: imgs.filter(i => !i.hasAttribute('alt')).length,
      // Listing ids ARE public -- the marketplace routes on them -- so the
      // check is not "no uuid anywhere". What must never appear is the
      // profile owner's USER id, which the payload deliberately omits.
      uuids: [...new Set((document.body.innerHTML.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []))],
    }
  })
  note(`${tag} exactly one h1`, m.h1Count === 1, `${m.h1Count}: ${m.h1 ?? ''}`)
  note(`${tag} no overflow`, m.overflow <= 1, `${m.overflow}px`)
  note(`${tag} tap targets`, m.small === 0, `${m.small}/${m.total} under 32px`)
  note(`${tag} every image has alt`, m.imagesMissingAlt === 0, `${m.imagesMissingAlt} missing`)
  // Every uuid on the page must belong to a listing link. Anything else is
  // an identifier with no business being on a public profile.
  const stray = await page.evaluate((ids) => {
    const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '')
    return ids.filter((id) => !hrefs.some((h) => h.includes(`/marketplace/${id}`)))
  }, m.uuids)
  note(`${tag} no stray identifier`, stray.length === 0,
    `${m.uuids.length} uuid(s) on page, ${stray.length} not a listing link`)
  return m
}

const WIDTHS = { mobile: 390, tablet: 768, desktop: 1440 }
const summary = {}

for (const [name, width] of Object.entries(WIDTHS)) {
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 900 },
    isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: width < 500 ? 2 : 1,
  })
  const page = await ctx.newPage()
  page.on('pageerror', e => note(`profile@${width} page error`, false, e.message.slice(0, 110)))

  // 1. Visitor (anonymous) on a profile WITH listings
  if (withListings) {
    await page.goto(`${BASE}/u/${withListings}`); await ready(page)
    const d = page.getByRole('button', { name: /essential only/i }); if (await d.count()) { await d.first().click(); await page.waitForTimeout(250) }
    await page.screenshot({ path: `${OUT}p3b-profile-listings-${name}.png` })
    summary[`listings-${name}`] = await audit(page, `visitor@${width}`)
  }

  // 2. Profile WITHOUT listings
  if (withoutListings) {
    await page.goto(`${BASE}/u/${withoutListings}`); await ready(page)
    await page.screenshot({ path: `${OUT}p3b-profile-nolistings-${name}.png` })
  }

  // 3. Not found
  await page.goto(`${BASE}/u/definitely-not-a-handle-zz`); await ready(page)
  await page.screenshot({ path: `${OUT}p3b-profile-notfound-${name}.png` })
  const nf = await page.locator('body').innerText()
  note(`notfound@${width} has a polished state`, /profile not found/i.test(nf))

  await ctx.close()
}

// 4. Owner view — signed in, own profile
if (!ownHandle) note('owner view testable', false, 'the test account has no handle set')
if (ownHandle) {
  for (const [name, width] of Object.entries(WIDTHS)) {
    const ctx = await browser.newContext({
      viewport: { width, height: width < 500 ? 844 : 900 },
      isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: width < 500 ? 2 : 1,
    })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    const d = page.getByRole('button', { name: /essential only/i }); if (await d.count()) await d.first().click()
    await page.locator('input[type="email"]').fill(OWNER.email)
    await page.locator('input[type="password"]').fill(OWNER.password)
    await page.getByRole('button', { name: /sign in|log in/i }).first().click()
    await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })
    await page.goto(`${BASE}/u/${ownHandle}`); await ready(page)
    await page.screenshot({ path: `${OUT}p3b-profile-owner-${name}.png` })
    if (name === 'desktop') {
      const owns = await page.locator('body').innerText()
      note('owner sees edit + visibility controls',
        /this is your public profile/i.test(owns) && /edit profile/i.test(owns))
      note('owner sees a share control', (await page.getByRole('button', { name: /share profile|copy link/i }).count()) > 0)
      summary['owner-desktop'] = await audit(page, 'owner@1440')
    }
    await ctx.close()
  }
}

await browser.close()
writeFileSync(`${OUT}p3b-findings.json`, JSON.stringify({ findings, summary }, null, 2))
const flags = findings.filter(f => !f.ok)
console.log(`\n${findings.length - flags.length}/${findings.length} checks OK`)
if (flags.length) console.log('FLAGGED:\n' + flags.map(f => `  - ${f.area}: ${f.detail ?? ''}`).join('\n'))
