/**
 * Measure every interactive control that a finger is meant to hit.
 *
 * WHY MEASURED AND NOT GREPPED
 *   The bug this exists for was invisible in the source: `min-h-11` is the
 *   correct-looking class and renders at 41.25px, because the root font is
 *   15px and Tailwind's spacing scale is rem-based. Only the rendered box tells
 *   the truth, so this reads getBoundingClientRect on real pages.
 *
 * WHAT COUNTS AS A TARGET
 *   Buttons, links that act as controls, selects, inputs, menu items, options,
 *   tabs, checkboxes, radios and switches. Deliberately NOT counted:
 *
 *     - an icon INSIDE a larger control (the parent is the target)
 *     - a link inside a paragraph of prose, which is a reading affordance
 *       rather than a tap target and cannot be 44px without wrecking the text
 *     - anything hidden, zero-sized, or disabled
 *     - table rows and list rows that are not themselves clickable
 *
 *   Each finding reports the rendered box, the tag, the accessible name and the
 *   classes, so a fix can be made precisely rather than by blanket replacement.
 *
 * Read-only.
 */
import { chromium } from 'playwright'
import { assertServedProjectNotProduction, testSecret } from './_environment.mjs'

const BASE = 'http://localhost:5199'
await assertServedProjectNotProduction(BASE, 'scripts/verify-touch-targets.mjs')

const MIN = 44
const WIDTHS = [390, 768, 1440]

const PUBLIC_ROUTES = [['/welcome', 'landing'], ['/marketplace', 'public marketplace'], ['/login', 'login']]
const AUTH_ROUTES = [
  ['/dashboard/farmer', 'dashboard'],
  ['/dashboard/farmer/settings', 'settings'],
  ['/dashboard/farmer/marketplace', 'marketplace'],
  ['/dashboard/farmer/my-listings', 'my listings'],
  ['/cart', 'cart'],
  // The operational screens. Added because the first sweep of this script
  // visited eight routes and reported zero failures, while a source-level
  // guard found a 34px link on a route it had never opened -- "no failures"
  // only ever means "none on the routes scanned".
  ['/dashboard/farmer/financing', 'financing'],
  ['/dashboard/farmer/financing/apply', 'financing apply'],
  ['/dashboard/farmer/wallet', 'financial activity'],
  ['/dashboard/farmer/orders', 'orders'],
  ['/dashboard/farmer/my-stock', 'my stock'],
  ['/dashboard/farmer/my-farm', 'my farm'],
  ['/dashboard/farmer/trace', 'trace'],
  // Wave A.2. The farmer screens a member actually works in, and the field
  // forms. A.1 showed that controls which only exist for a signed-in user are
  // invisible to an anonymous scan; the same applies to forms, which render
  // their controls only once the page they live on is open.
  ['/dashboard/farmer/my-farm', 'my farm'],
  ['/dashboard/farmer/my-farm/new', 'farm form'],
]

function scanPage() {
  const MIN_PX = 44
  const out = []
  const seen = new Set()

  const inProse = (el) => {
    const p = el.closest("p, li, td, blockquote")
    return Boolean(p) && (p.innerText || "").trim().length > 60
  }
  const insideControl = (el) => {
    const parent = el.parentElement && el.parentElement.closest('button, a[href], [role="option"], [role="menuitem"], label')
    return Boolean(parent) && parent !== el
  }

  const SEL = 'button, a[href], select, input:not([type="hidden"]), [role="option"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], summary'
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === "hidden" || cs.display === "none") continue
    if (el.hasAttribute("disabled")) continue
    if (insideControl(el)) continue
    if (el.tagName === "A" && inProse(el)) continue
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio") && r.width < 4) continue

    const h = Math.round(r.height)
    const w = Math.round(r.width)
    if (h >= MIN_PX && w >= MIN_PX) continue

    const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.value || "").trim().slice(0, 32)
    const key = el.tagName + "|" + name + "|" + h + "x" + w
    if (seen.has(key)) continue
    seen.add(key)
    const cls = (typeof el.className === "string" ? el.className : "")
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute("role") || ""

    // Classify: these are not the same problem and do not take the same fix.
    //
    //   action     something a finger is meant to hit - a button, a nav or
    //              menu item, a form control, a link styled as a button.
    //              These must reach 44px.
    //   indicator  a deliberately tiny control such as a carousel dot. The
    //              dot SHOULD stay small; its HIT AREA is what must grow,
    //              via padding. A different fix from "make it bigger".
    //   inline     a link rendered as running text - an address, a phone
    //              number, a "read more". Forcing 44px would blow the
    //              typography apart, and WCAG 2.5.8 exempts inline targets.
    //              Reported so the decision is visible, not remediated.
    const buttonish = /(bg-|border|rounded|px-|py-|min-h|h-[0-9])/.test(cls)
    let kind = "action"
    if (role === "tab" && h <= 12) kind = "indicator"
    else if (tag === "a" && (!buttonish || inProse(el))) kind = "inline"

    out.push({ tag, role, kind, name, h, w, cls: cls.slice(0, 72) })
  }
  return out
}

let findings = []
let screens = 0

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: width < 500 ? 844 : 950 },
      isMobile: width < 500, hasTouch: width < 500,
    })
    const page = await ctx.newPage()

    const scan = async (label) => {
      screens++
      const found = await page.evaluate(scanPage)
      for (const f of found) findings.push({ width, screen: label, ...f })
    }

    for (const [path, label] of PUBLIC_ROUTES) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      const consent = page.getByRole('button', { name: /essential only/i })
      if (await consent.count()) await consent.first().click().catch(() => {})
      await page.waitForTimeout(1400)
      await scan(label)

      // Open the language selector so its options are measured too.
      const sel = page.locator('button[aria-haspopup="listbox"]').first()
      if (await sel.count()) {
        await sel.click().catch(() => {})
        await page.waitForTimeout(400)
        await scan(`${label} + language menu`)
        await page.keyboard.press('Escape').catch(() => {})
      }
    }

    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.locator('#email').fill(testSecret('LOAMY_TEST_FARMER_EMAIL'))
    await page.locator('#password').fill(testSecret('LOAMY_TEST_FARMER_PASSWORD'))
    await page.locator('form button[type="submit"]').first().click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 }).catch(() => {})

    // The PUBLIC shell, while SIGNED IN. Its header renders different
    // controls once there is a session -- cart, saved, orders and the account
    // link -- and scanning /marketplace anonymously never saw them. That is
    // how a 38x41 account link survived a run that reported zero failures.
    for (const [path, label] of [['/marketplace', 'public marketplace (signed in)']]) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(1500)
      await scan(label)
    }

    for (const [path, label] of AUTH_ROUTES) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(1500)
      await scan(label)
    }

    // The phone account menu only exists below 640px.
    if (width < 640) {
      const acct = page.getByRole('button', { name: /account menu/i })
      if (await acct.count()) {
        await acct.first().click().catch(() => {})
        await page.waitForTimeout(400)
        await scan('account menu')
      }
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}

console.log(`scanned ${screens} screen states at ${WIDTHS.join('/')}px\n`)
if (findings.length === 0) {
  console.log(`ALL INTERACTIVE TARGETS >= ${MIN}px`)
  process.exitCode = 0
} else {
  // Group by what the control is, not by where it was seen: one component
  // usually accounts for many sightings.
  const by = new Map()
  for (const f of findings) {
    const k = `${f.tag}${f.role ? `[${f.role}]` : ''} "${f.name}" ${f.h}x${f.w}`
    if (!by.has(k)) by.set(k, { ...f, seen: 0, screens: new Set() })
    by.get(k).seen++
    by.get(k).screens.add(`${f.screen}@${f.width}`)
  }
  const kinds = ['action', 'indicator', 'inline']
  const counts = Object.fromEntries(kinds.map((k) => [k, [...by.values()].filter((v) => v.kind === k).length]))
  console.log(by.size + ' distinct control(s) below ' + MIN + 'px, ' + findings.length + ' sighting(s)')
  console.log()
  console.log('  action    ' + String(counts.action).padStart(4) + '   MUST reach ' + MIN + 'px')
  console.log('  indicator ' + String(counts.indicator).padStart(4) + '   tiny by design; the HIT AREA needs padding, not a bigger dot')
  console.log('  inline    ' + String(counts.inline).padStart(4) + '   text links; WCAG 2.5.8 exempts these. Reported, not remediated.')
  console.log()

  for (const kind of kinds) {
    const rows = [...by.entries()].filter((e) => e[1].kind === kind).sort((a, b) => a[1].h - b[1].h)
    if (rows.length === 0) continue
    const cap = kind === 'action' ? 60 : 6
    console.log('--- ' + kind.toUpperCase() + ' ---')
    for (const [k, v] of rows.slice(0, cap)) {
      console.log('  ' + k)
      console.log('     classes: ' + v.cls)
      console.log('     seen on: ' + [...v.screens].slice(0, 3).join(', '))
    }
    if (rows.length > cap) console.log('  ... and ' + (rows.length - cap) + ' more')
    console.log()
  }
  process.exitCode = 0 // a report, not a gate
}
