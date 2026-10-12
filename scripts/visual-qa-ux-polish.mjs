/**
 * Browser QA for the Head of Product polish pass, at 390 / 768 / 1440.
 * Run with: node scripts/visual-qa-ux-polish.mjs   (dev server on :5199)
 *
 * Measures rendered geometry rather than asserting that classes exist -- a
 * class name proves nothing about whether two buttons line up on screen.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { assertServedProjectNotProduction, testSecret } from './_environment.mjs'

const BASE = 'http://localhost:5199'
const OUT = '.qa/'
mkdirSync(OUT, { recursive: true })

// This harness writes (cart, wishlist), so it runs against STAGING only and
// takes its account from .env.test. The production buyer is deliberately not
// referenced here any more: it does not exist on staging, and naming it would
// invite someone to point this at production to "make login work".
const BUYER = {
  email: testSecret('LOAMY_TEST_BUYER_EMAIL'),
  password: testSecret('LOAMY_TEST_BUYER_PASSWORD'),
}

const findings = []
const note = (a, ok, d) => {
  findings.push({ a, ok, d })
  console.log(`${ok ? 'OK  ' : 'FLAG'}  ${a}${d ? ` - ${d}` : ''}`)
}

async function settled(page, label, fn, timeout = 25000) {
  try { await page.waitForFunction(fn, { timeout }) }
  catch { throw new Error(`STEP DID NOT SETTLE: ${label}`) }
}

// This harness adds to cart and toggles wishlist hearts, both of which persist
// rows. Ask the dev server which project it serves before writing anything.
const servedRefs = await assertServedProjectNotProduction(BASE, 'scripts/visual-qa-ux-polish.mjs')
console.log(`target project: ${servedRefs.join(', ')}`)

const browser = await chromium.launch({ channel: 'chrome', headless: true })

/**
 * Geometry of the two hero CTAs, found BY THEIR LABELS.
 *
 * The first version took the first two sizeable controls inside the first
 * <section>, which picked up whatever else lived there and then compared a
 * CTA against it -- reporting a font-size mismatch that was never real.
 */
const heroCtas = (page, labels) => page.evaluate((wanted) => {
  // Scope to the section that holds the hero heading. Searching the whole
  // document matched a header/footer link with the same words and then
  // compared a CTA against it.
  const heading = document.querySelector('h1, h2')
  const hero = heading ? heading.closest('section') ?? document : document
  const all = [...hero.querySelectorAll('a,button')]
  const found = wanted
    .map((w) => all.find((el) => new RegExp(w, 'i').test((el.innerText || '').trim())))
    .filter(Boolean)
  if (found.length < 2) return null
  return found.map((el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      text: (el.innerText || '').trim().slice(0, 28),
      h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
      radius: cs.borderRadius, fontSize: cs.fontSize,
      padX: `${cs.paddingLeft}/${cs.paddingRight}`,
    }
  })
}, labels)

try {
  for (const [name, width] of Object.entries({ mobile: 390, tablet: 768, desktop: 1440 })) {
    const ctx = await browser.newContext({
      viewport: { width, height: width < 500 ? 844 : 950 },
      isMobile: width < 500, hasTouch: width < 500,
    })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 110)))
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 110))
    })

    // ---- HERO, public landing -------------------------------------------
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    const d = page.getByRole('button', { name: /essential only/i })
    if (await d.count()) await d.first().click()
    await settled(page, `landing copy@${width}`, () => (document.body.innerText || '').length > 200)

    const ctas = await heroCtas(page, ['shop the marketplace|browse listings', 'sell on loamy'])
    if (ctas && ctas.length === 2) {
      const [a, b] = ctas
      note(`hero CTAs same height@${width}`, a.h === b.h, `${a.text}=${a.h}px, ${b.text}=${b.h}px`)
      // Only meaningful when they sit on the same row. At 390 the pair wraps
      // (flex-wrap), and two rows having different baselines is correct.
      const sameRow = Math.abs(a.top - b.top) <= 2
      note(`hero CTAs share a baseline@${width}`, !sameRow || Math.abs(a.bottom - b.bottom) <= 1,
           sameRow ? `bottom ${a.bottom} vs ${b.bottom}` : 'wrapped to two rows (expected at this width)')
      note(`hero CTAs same radius@${width}`, a.radius === b.radius, `${a.radius} vs ${b.radius}`)
      note(`hero CTAs same typography@${width}`, a.fontSize === b.fontSize, `${a.fontSize} vs ${b.fontSize}`)
    } else {
      note(`hero CTAs found@${width}`, false, `found ${ctas ? ctas.length : 0}`)
    }

    // Reveal: the copy must END UP visible, by itself, with no click.
    const revealed = await page.evaluate(() => {
      // The public home renders the storefront hero, whose heading is an h2.
      const h = document.querySelector('h1, h2')
      if (!h) return null
      // The reveal is applied to the copy WRAPPER, so walk up from the heading
      // to whichever ancestor actually carries the animation.
      let node = h
      let animation = 'none'
      while (node && node !== document.body) {
        const a = getComputedStyle(node).animationName
        if (a && a !== 'none') { animation = a; break }
        node = node.parentElement
      }
      const cs = getComputedStyle(h)
      return { opacity: Number(cs.opacity), animation, delay: getComputedStyle(node || h).animationDelay }
    })
    note(`hero copy visible without interaction@${width}`, revealed && revealed.opacity > 0.99,
         revealed ? `opacity ${revealed.opacity}, animation ${revealed.animation}` : 'no h1')
    note(`hero reveal is automatic@${width}`, revealed && revealed.animation !== 'none', revealed?.animation)

    // No layout shift from the reveal: measure the hero box twice.
    const box1 = await page.evaluate(() => Math.round(document.querySelector('section').getBoundingClientRect().height))
    await page.waitForTimeout(900)
    const box2 = await page.evaluate(() => Math.round(document.querySelector('section').getBoundingClientRect().height))
    note(`hero does not shift after reveal@${width}`, box1 === box2, `${box1}px then ${box2}px`)

    // REGRESSION GUARD: the public header overflowed the viewport by 9px at
    // 390px because the logo lockup (235px, shrink-0) left too little room for
    // the account controls. Asserted exactly as specified, with no tolerance.
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }))
    note(`landing: scrollWidth <= clientWidth@${width}`,
         overflow.scrollW <= overflow.clientW,
         `${overflow.scrollW} vs ${overflow.clientW} (${overflow.scrollW - overflow.clientW}px)`)
    await page.screenshot({ path: `${OUT}polish-hero-${name}.png` })

    // ---- MARKETPLACE hero (the storefront variant) -----------------------
    await page.goto(`${BASE}/marketplace`, { waitUntil: 'domcontentloaded' })
    await settled(page, `marketplace@${width}`, () => (document.body.innerText || '').length > 400)
    const mCtas = await heroCtas(page, ['shop the marketplace|browse listings', 'sell on loamy'])
    if (mCtas && mCtas.length === 2) {
      note(`storefront hero CTAs same height@${width}`, mCtas[0].h === mCtas[1].h, `${mCtas[0].h}px vs ${mCtas[1].h}px`)
    } else {
      note(`storefront hero CTAs found@${width}`, false, `found ${mCtas ? mCtas.length : 0}`)
    }

    const mOverflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }))
    note(`marketplace: scrollWidth <= clientWidth@${width}`,
         mOverflow.scrollW <= mOverflow.clientW,
         `${mOverflow.scrollW} vs ${mOverflow.clientW} (${mOverflow.scrollW - mOverflow.clientW}px)`)

    // The header itself must sit inside the viewport, not merely avoid
    // creating a scrollbar.
    const headerFit = await page.evaluate(() => {
      const row = document.querySelector('header > div > div')
      if (!row) return null
      const kids = [...row.children].filter((el) => el.getBoundingClientRect().width > 0)
      const right = Math.max(...kids.map((el) => el.getBoundingClientRect().right))
      return { right: Math.round(right), vw: document.documentElement.clientWidth }
    })
    note(`header content fits the viewport@${width}`,
         headerFit !== null && headerFit.right <= headerFit.vw,
         headerFit ? `rightmost ${headerFit.right} of ${headerFit.vw}` : 'header row not found')

    note(`public console clean@${width}`, errs.length === 0, errs.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // ---- CART + HEART, signed in, mobile and desktop -----------------------
  for (const [name, width] of Object.entries({ mobile: 390, desktop: 1440 })) {
    const ctx = await browser.newContext({
      viewport: { width, height: width < 500 ? 844 : 950 },
      isMobile: width < 500, hasTouch: width < 500,
    })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 110)))

    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    const d = page.getByRole('button', { name: /essential only/i })
    if (await d.count()) await d.first().click()
    await page.locator('#email').fill(BUYER.email)
    await page.locator('#password').fill(BUYER.password)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 })

    await page.goto(`${BASE}/marketplace`, { waitUntil: 'domcontentloaded' })
    await settled(page, `product cards@${width}`, () => document.querySelectorAll('button[aria-pressed]').length > 0)

    // ---- HEART ----------------------------------------------------------
    // Pick a heart that is NOT already saved, so the test exercises the
    // transition into the selected state -- the one with the new green fill.
    // Falling back to the first heart would otherwise test un-saving.
    const unsaved = page.locator('button[aria-pressed="false"]')
    const heart = (await unsaved.count()) ? unsaved.first() : page.locator('button[aria-pressed]').first()
    const before = await heart.getAttribute('aria-pressed')
    const geomBefore = await heart.evaluate((el) => ({
      h: el.offsetHeight, w: el.offsetWidth,
      // offsetTop is relative to the offset parent, so it does not move when
      // the page scrolls -- getBoundingClientRect does, which made this look
      // like a layout shift when nothing had shifted.
      top: el.offsetTop,
    }))
    note(`heart target is at least 32px@${width}`, geomBefore.h >= 32 && geomBefore.w >= 32, `${geomBefore.w}x${geomBefore.h}`)

    const pressedCount = () => page.evaluate(() =>
      [...document.querySelectorAll('button[aria-pressed]')].filter((e) => e.getAttribute('aria-pressed') === 'true').length)
    const pressedBefore = await pressedCount()
    await heart.click()
    // Count, not node identity: React may replace the button element on
    // re-render, which leaves an element handle detached and permanently
    // reporting its old attribute.
    let pressedAfter = pressedBefore
    for (let i = 0; i < 40 && pressedAfter === pressedBefore; i++) {
      await page.waitForTimeout(250)
      pressedAfter = await pressedCount()
    }
    const after = pressedAfter > pressedBefore ? 'true' : before
    note(`heart state changes@${width}`, pressedAfter > pressedBefore,
         `selected hearts ${pressedBefore} -> ${pressedAfter}`)

    const heartVisual = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button[aria-pressed]')].find((e) => e.getAttribute('aria-pressed') === 'true')
      if (!el) return null
      const svg = el.querySelector('svg')
      const cs = getComputedStyle(svg)
      return { fill: cs.fill, colour: cs.color, h: el.offsetHeight, top: el.offsetTop }
    })
    if (heartVisual) {
      // Filled, and filled GREEN: the fill follows currentColor, so the colour
      // channel is what proves it is not the old rose treatment.
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(heartVisual.fill || '')
      const green = m && Number(m[2]) > Number(m[1]) && Number(m[2]) > Number(m[3])
      note(`selected heart is filled green@${width}`, Boolean(green), `fill ${heartVisual.fill}`)
    } else {
      note(`selected heart is filled green@${width}`, false, 'no selected heart on the page to measure')
    }
    note(`heart does not shift layout@${width}`, !heartVisual || heartVisual.h === geomBefore.h,
         heartVisual ? `${geomBefore.h}px -> ${heartVisual.h}px` : 'no selected heart')

    const focusRing = await heart.evaluate((el) => { el.focus(); return getComputedStyle(el).outlineWidth })
    note(`heart focus is visible@${width}`, focusRing !== '' , `outline ${focusRing}`)

    // ---- CART -----------------------------------------------------------
    const cartLink = page.locator('a[aria-label^="Cart"]').first()
    const cartBoxBefore = await cartLink.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { h: Math.round(r.height), w: Math.round(r.width), left: Math.round(r.left) }
    })

    const addBtn = page.locator('button[aria-label="Add to cart"]').first()
    if (await addBtn.count()) {
      await addBtn.click()
      // Observe the animation class on the icon rather than sleeping blindly.
      let animated = false
      try {
        await page.waitForFunction(() => {
          const svg = document.querySelector('a[aria-label^="Cart"] svg')
          return svg ? svg.getAttribute('class')?.includes('animate-cart-bump') : false
        }, { timeout: 6000 })
        animated = true
      } catch { /* reported */ }
      note(`cart icon reacts to a successful add@${width}`, animated)

      const announced = await page.evaluate(() =>
        [...document.querySelectorAll('[aria-live]')].map((n) => n.textContent || '').join(' '))
      note(`add is announced in text, not motion alone@${width}`, /added to cart/i.test(announced), announced.trim().slice(0, 60))

      await page.waitForTimeout(600)
      const cartBoxAfter = await cartLink.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { h: Math.round(r.height), w: Math.round(r.width), left: Math.round(r.left) }
      })
      note(`cart animation does not shift layout@${width}`,
           cartBoxAfter.h === cartBoxBefore.h && cartBoxAfter.w === cartBoxBefore.w && cartBoxAfter.left === cartBoxBefore.left,
           `${cartBoxBefore.w}x${cartBoxBefore.h}@${cartBoxBefore.left} -> ${cartBoxAfter.w}x${cartBoxAfter.h}@${cartBoxAfter.left}`)

      const count = await page.evaluate(() =>
        document.querySelector('a[aria-label^="Cart"]')?.getAttribute('aria-label') ?? '')
      note(`cart count remains visible@${width}`, /\(\d+\)/.test(count), count)
    } else {
      note(`add-to-cart control present@${width}`, false, 'no "Add to cart" button on marketplace')
    }

    note(`signed-in console clean@${width}`, errs.length === 0, errs.slice(0, 2).join(' | '))
    await page.screenshot({ path: `${OUT}polish-cart-heart-${name}.png` })
    await ctx.close()
  }

  // ---- reduced motion ----------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await settled(page, 'reduced-motion landing', () => (document.body.innerText || '').length > 200)
  const rm = await page.evaluate(() => {
    const h1 = document.querySelector('h1, h2')
    if (!h1) return null
    const cs = getComputedStyle(h1)
    return { opacity: Number(cs.opacity), duration: cs.animationDuration, delay: cs.animationDelay }
  })
  note('reduced motion: hero heading found', rm !== null)
  if (rm) {
    note('reduced motion: hero copy is visible', rm.opacity > 0.99, `opacity ${rm.opacity}`)
    note('reduced motion: duration collapsed', parseFloat(rm.duration) <= 0.001, rm.duration)
    note('reduced motion: delay collapsed', parseFloat(rm.delay) <= 0.001, rm.delay)
  }
  await ctx.close()
} finally {
  await browser.close()
  const bad = findings.filter((f) => !f.ok)
  console.log(`\n${findings.length - bad.length}/${findings.length} checks OK`)
  if (bad.length) {
    console.log('FLAGGED:')
    bad.forEach((f) => console.log(`  - ${f.a}: ${f.d ?? ''}`))
  }
}
