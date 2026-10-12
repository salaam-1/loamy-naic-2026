/**
 * The homepage marketplace preview, measured in a real browser.
 *
 * WHY THE FULL MARKETPLACE IS MEASURED TOO
 *   `/` and `/marketplace` are the same component; only the bound differs. So
 *   loading both in one run gives a genuine before/after for the claim that
 *   matters -- that the footer is reachable -- rather than a number compared
 *   against a memory of how the page used to be.
 *
 * WHAT IT CHECKS
 *   1. at most HOMEPAGE_MARKETPLACE_LIMIT listing cards on `/`;
 *   2. the CTA exists after the grid, links to /marketplace, and is >= 44px;
 *   3. no horizontal overflow of the document, and nothing past the right edge;
 *   4. no visible translation key;
 *   5. the footer is reachable, measured as document height;
 *   6. all of the above at 390, 768 and 1440, in all five languages.
 *
 * Read-only. No writes, no network beyond the dev server.
 */
import { chromium } from 'playwright'
import { assertServedProjectNotProduction } from './_environment.mjs'

const BASE = 'http://localhost:5199'
await assertServedProjectNotProduction(BASE, 'scripts/verify-homepage-preview.mjs')

const CAP = 12
const MIN_TOUCH = 44
const WIDTHS = [390, 768, 1440]
const LOCALES = ['en', 'fr', 'ha', 'ig', 'yo']

function scan(minTouch) {
  const de = document.documentElement

  // Cards link to /marketplace/:id; the CTA is an exact /marketplace, and the
  // shared header carries one of those too. Counting by prefix and requiring
  // something after the slash keeps the three apart.
  const cards = [...document.querySelectorAll('a[href^="/marketplace/"]')]
    .filter((a) => (a.getAttribute('href') || '').length > '/marketplace/'.length)

  const cta = document.querySelector('[data-testid="preview-cta"], [data-testid="preview-cta-empty"]')
  const ctaBox = cta ? cta.getBoundingClientRect() : null
  // The control inside the link is what a finger hits.
  const ctaControl = cta ? (cta.querySelector('button') || cta) : null
  const ctaControlBox = ctaControl ? ctaControl.getBoundingClientRect() : null

  const overflowing = []
  const limit = de.clientWidth + 2
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (el.closest('.overflow-x-auto, .overflow-auto, .overflow-scroll')) continue
    if (r.right > limit) {
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        right: Math.round(r.right),
        limit,
        text: (el.innerText || '').trim().slice(0, 40),
      })
      if (overflowing.length > 5) break
    }
  }

  const keys = []
  for (const m of (document.body.innerText || '')
    .matchAll(/\b(?:marketplace|public|common|nav)\.[a-z][A-Za-z0-9_.]{2,}/g)) {
    if (!keys.includes(m[0])) keys.push(m[0])
  }

  // Cards narrower than this stop being readable at any width.
  const narrow = cards
    .map((c) => Math.round(c.getBoundingClientRect().width))
    .filter((w) => w > 0 && w < 150)

  return {
    cards: cards.length,
    docOverflow: de.scrollWidth > de.clientWidth
      ? { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth } : null,
    overflowing,
    keys,
    narrow,
    pageHeight: de.scrollHeight,
    viewport: de.clientHeight,
    hasCta: Boolean(cta),
    ctaHref: cta ? cta.getAttribute('href') : null,
    ctaText: cta ? (cta.innerText || '').trim().slice(0, 60) : null,
    ctaBelowGrid: Boolean(cta && cards.length && ctaBox
      && ctaBox.top >= cards[cards.length - 1].getBoundingClientRect().top),
    ctaHeight: ctaControlBox ? Math.round(ctaControlBox.height * 100) / 100 : null,
    ctaWidth: ctaControlBox ? Math.round(ctaControlBox.width * 100) / 100 : null,
    minTouch,
  }
}

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const findings = []
const heights = {}
let scans = 0

async function visit(path, label, width, locale) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  // Wait for the listing read to settle rather than for a fixed delay: a
  // premature sample reads the loading skeleton and reports zero cards.
  await page.waitForFunction(
    () => !document.querySelector('.animate-pulse') || document.querySelectorAll('a[href^="/marketplace/"]').length > 0,
    { timeout: 20000 },
  ).catch(() => {})
  await page.waitForTimeout(600)
  const r = await page.evaluate(scan, MIN_TOUCH)
  scans++

  const where = `${label} @${width}px [${locale}]`
  if (label === 'homepage' && r.cards > CAP) {
    findings.push(`${where}: ${r.cards} cards, cap is ${CAP}`)
  }
  if (r.docOverflow) {
    findings.push(`${where}: document scrolls horizontally `
      + `(${r.docOverflow.scrollWidth} > ${r.docOverflow.clientWidth})`)
  }
  for (const o of r.overflowing) {
    findings.push(`${where}: <${o.tag}> right=${o.right} > ${o.limit} "${o.text}"`)
  }
  for (const k of r.keys) findings.push(`${where}: visible translation key ${k}`)
  for (const w of r.narrow) findings.push(`${where}: a card rendered only ${w}px wide`)

  if (label === 'homepage') {
    if (r.cards > 0 && !r.hasCta) findings.push(`${where}: no preview CTA`)
    if (r.hasCta) {
      if (r.ctaHref !== '/marketplace') {
        findings.push(`${where}: CTA points at ${r.ctaHref}`)
      }
      if (r.cards > 0 && !r.ctaBelowGrid) findings.push(`${where}: CTA is not below the grid`)
      if (r.ctaHeight !== null && r.ctaHeight + 0.5 < MIN_TOUCH) {
        findings.push(`${where}: CTA is ${r.ctaWidth}x${r.ctaHeight}, under ${MIN_TOUCH}px`)
      }
    }
  }
  heights[`${label} @${width} [${locale}]`] = { page: r.pageHeight, cards: r.cards }
  return r
}

try {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    for (const locale of LOCALES) {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.evaluate((l) => {
        try { localStorage.setItem('loamy.language', l) } catch { /* private mode */ }
      }, locale)
      const home = await visit('/', 'homepage', width, locale)
      const full = await visit('/marketplace', 'full marketplace', width, locale)
      if (locale === 'en') {
        console.log(`  ${String(width).padStart(4)}px  homepage ${String(home.cards).padStart(2)} cards, `
          + `${String(home.pageHeight).padStart(5)}px tall   |   `
          + `/marketplace ${String(full.cards).padStart(2)} cards, ${String(full.pageHeight).padStart(5)}px tall`
          + `   |  CTA ${home.ctaWidth}x${home.ctaHeight} "${home.ctaText}"`)
      }
    }
    console.log(`  ${width}px: 5 locales x 2 routes scanned`)
  }
} finally {
  await browser.close()
}

console.log(`\n${scans} page scans, ${findings.length} findings`)
for (const f of findings.slice(0, 30)) console.log(`  ${f}`)

console.log('\nfooter reachability (document height, English):')
for (const [k, v] of Object.entries(heights)) {
  if (!k.includes('[en]')) continue
  console.log(`  ${k.padEnd(34)} ${String(v.page).padStart(6)}px  (${v.cards} cards)`)
}

process.exit(findings.length ? 1 : 0)
