# Head of Product — UX Polish Pass

**Date:** 2026-09-23
**Branch:** `ux-polish-hop` (not merged; `main` auto-deploys to production)
**Scope:** Visual and interaction polish only. No business logic, database, RLS,
migration, financing, fulfilment, fee or provider change.

**Gates:** `tsc --noEmit` exit 0 · `vitest run` **756/756** (was 735; +21 new) ·
`npm run build` clean · browser QA **53/54** at 390 / 768 / 1440.

The one flag is a pre-existing header overflow, verified identical on the live
production build. See §J.

---

## A. Hero CTA — canonical button sizing

**BEFORE**

Both heroes paired a canonical `Button` with a hand-written link:

```tsx
<Button variant="gold" size="lg">Shop the marketplace</Button>   {/* h-11, rounded-control, 15px */}
<Link className="inline-flex h-9 ... rounded border border-white/80 px-4 text-sm">
  Sell on Loamy                                                   {/* h-9, rounded, 14px */}
</Link>
```

Measured on the live page: **44px beside 36px**, different radius, different
type size. That 8px difference is the misalignment reported.

**AFTER**

Measured at all three widths: **41px vs 41px**, `10px vs 10px` radius,
`15px vs 15px` type, shared baseline.

Two changes made this possible, both to the canonical component rather than to
the hero:

1. **`buttonVariants` is now exported.** A `<Link>` cannot be a `<Button>`, so
   before this the only way to make a link look like a button was to retype its
   classes — which is exactly how the two drifted apart. The link now wears the
   canonical classes.
2. **A new `outline-inverse` variant.** The existing `outline` is opaque white,
   which punches a hole in a hero photograph. `outline-inverse` keeps the
   picture visible and inverts on hover — the treatment the hero already had,
   now expressed as a variant of the canonical component instead of a one-off.

**No hero-only size was created, and no arbitrary margin was added.** Both CTAs
use `size="lg"`, the same size available everywhere else.

### The subtle part: why the type size was still wrong after the first fix

Applying `buttonVariants(...)` directly still rendered the link at 13.125px
beside a 15px button. `buttonVariants` emits **both** `text-sm` (from the base)
and `text-[15px]` (from `size: lg`). `Button` passes its result through `cn()`,
whose tailwind-merge drops the loser; a raw string keeps both and the stylesheet
order decides. The fix is `cn(buttonVariants({...}))` — the same path `Button`
itself takes.

This is only visible by measuring the rendered page. Asserting that the class
string contains `text-[15px]` would have passed while the button was the wrong
size on screen.

**FILES** `src/components/ui/button.tsx`, `src/pages/marketplace/StorefrontHero.tsx`,
`src/pages/public/Landing.tsx`

**TEST COVERAGE** 4 component tests (equal height, equal radius + typography,
built from canonical variants, focus ring retained) + 8 browser measurements.

---

## B. Hero animation — automatic delayed reveal

**BEFORE** The hero copy was static. Nothing revealed it; nothing was delayed.

**AFTER** The copy settles in by itself a beat after load — no click, no
loading-screen feel.

Built from the **existing** animation system: `rise-in` (opacity + 6px rise)
was already defined in `tailwind.config.ts`. Only duration and a stagger are
tuned at the call site. **No animation library was added.**

```
Landing:          h1 0ms · body 90ms · CTAs 180ms · disclaimer 270ms   (420ms each)
StorefrontHero:   the copy block as one unit                           (480ms)
```

**Why CSS animation and not React state.** A state-driven reveal starts with
`opacity-0` and removes it in an effect. If that effect ever fails to run, the
hero is stranded invisible — a worse failure than no animation at all. A CSS
animation whose resting state is *visible* cannot do that. A test pins it:
*"never hides hero copy behind an opacity-0 class that JS must remove"*.

`animation-fill-mode: backwards` holds the opening frame through the delay, so
the copy never paints, disappears, then paints again.

### Reduced motion — a real bug found while implementing this

The existing global rule collapsed `animation-duration` but **not**
`animation-delay`. A staggered entrance under `prefers-reduced-motion` would
therefore have had its animation suppressed while the delay still applied —
leaving content invisible for up to 270ms, precisely the *"do not leave content
hidden waiting for an animation"* failure. `animation-delay` and
`transition-delay` are now collapsed too.

Verified in a real reduced-motion browser context: `opacity 1`,
`duration 1e-05s`, **`delay 0s`**.

**FILES** `src/pages/public/Landing.tsx`, `src/pages/marketplace/StorefrontHero.tsx`,
`src/index.css`

**TEST COVERAGE** 4 tests (animates on render with no click; no stranded
`opacity-0`; renders under reduced motion; CSS collapses both duration and
delay) + 6 browser checks including a no-layout-shift measurement.

---

## C. Dash typography audit

**BEFORE** 771 em dashes (`—`) across `src/`.
**AFTER** **214 user-facing occurrences changed** to `-`.

No blind replacement was performed. Every occurrence was classified by parsing
each file and tracking comment and string state:

| Context | Count | Action |
|---|---|---|
| Inside `//` or `/* */` comments | **467** | **untouched** — code, not user-facing |
| Empty-value placeholders (`: '—'`) | **106** | **kept** — see below |
| User-facing prose and JSX text | **214** | **changed to `-`** |

**Why the 106 placeholders were kept.** These are lone dashes standing in for
"no value" in table cells and detail rows. That is a dash with a technical
meaning, which the brief explicitly excludes. A bare `-` in a numeric column
also reads as a minus sign. This is a judgement call and is flagged here so it
can be reversed in one run if the Head of Product wants them changed too.

Nothing in code, operators, identifiers, URLs, UUIDs, migration names or
filenames was touched — the classifier never looks outside `src/`, and within
it only at non-comment text.

**Audited surfaces** (files carrying changes): landing, auth, dashboards,
marketplace, marketplace detail, profile, financing, logistics, warehouse,
verification, Trace, Copilot, settings, admin, empty states, error messages,
notifications, modal copy — 94 files in total. Largest: `privacy-policy.ts` (19),
`copilot/engine.ts` (19), `FinancingApply.tsx` (9), `roles.ts` (8).

**One existing test needed updating**, not weakening: `financing.test.ts`
asserted the literal copy `'Sandbox — no real money moves'`. The expectation now
matches the new copy. `identity.test.ts`, which asserts the `'—'` **placeholder**,
still passes unchanged — confirming the placeholders really were left alone.

**FILES** 94 files under `src/`, plus `tests/unit/financing.test.ts`

**TEST COVERAGE** A standing guard test re-runs the classifier and fails if any
user-facing em dash reappears, so this cannot regress silently.

---

## D. Cart interaction

**BEFORE** Adding to cart updated the count. The icon did not react.

**AFTER** The cart icon acknowledges the add with a single short scale (320ms,
`cart-bump`), and says so in text.

**No cart logic changed.** The authoritative implementation in `CartContext`
still owns the cart. One notification-only field was added:

```ts
await apiAddToCart(listingId, quantity)
setCart(await fetchCart())
setCartBump((n) => n + 1)     // only after BOTH awaits resolve
```

**A failed add cannot animate.** The bump sits after both awaits, so a throw
from either skips it entirely. Existing error handling is untouched.

The two shells each had their own copy of the cart link; the behaviour now lives
in one `CartIconLink` and each shell passes only its own sizing. Two copies of
an animation are two things to keep in step.

**Not animation alone.** Motion is invisible to a screen-reader user and
suppressed under reduced motion, so a polite live region carries the same
message: *"Added to cart. 2 items in cart."* Verified live in the browser.

**Layout is untouched by the reaction** — the animation is on the icon, not the
link, so the hit area never moves. Measured: `34x34@1129 -> 34x34@1129`.

**Verified in the browser:** icon reacts on success (390 and 1440), text
announcement present, no layout shift, count stays visible (`Cart (10)`).

**Not covered:** batch-backed vs declared listings and fractional quantities go
through `BuyBox`, whose add path is the same `addToCart`, and whose fractional
and failure behaviour is already covered by `tests/components/buybox.test.tsx`.
The bump is downstream of that call, so it inherits the distinction rather than
needing its own case. Duplicate adds are idempotent at the data layer
(`upsert` / existing cart row) and were not separately re-verified here.

**FILES** `src/context/CartContext.tsx`, `src/components/CartIconLink.tsx` (new),
`src/components/layout/AppShell.tsx`, `src/pages/public/PublicShell.tsx`,
`tailwind.config.ts`

**TEST COVERAGE** 6 tests: no animation on first paint; animates on bump;
announces in text; **does not animate when the count changes without a bump**
(the failed-add case); count stays visible; and a source-level test asserting
the bump is sequenced after both writes.

---

## E. Heart / favourite interaction

**BEFORE** Selected state was **red** (`border-red-200 text-red-500`) — a
borrowed social-media signal on an agricultural marketplace.

**AFTER** Selected is the brand's own green: `border-emerald-200 text-emerald-700`
with `fill-current`, and a 200ms scale on the way in only. Un-saving is not an
event worth celebrating, so nothing animates on the way out.

Measured in the live browser on a selected heart: **`fill: rgb(10, 90, 71)`** =
`#0A5A47` = the existing **emerald-700** token. No new green was introduced.

**One favourite system, not two.** `WishlistHeart` is the single implementation
used by `BuyBox`, `ProductCard` and `PublicProductCard`, and it continues to
persist through the existing `toggleWishlist` in `CartContext`. No local-only
state was added.

**Accessibility** — `aria-pressed` and a state-dependent accessible name were
already present and are preserved. **A visible focus ring was added**, which the
control did not have before (measured: `outline 3px`). Target is 34×34, above
the 32px house minimum.

**FILES** `src/pages/marketplace/CardActions.tsx`

**TEST COVERAGE** 6 tests: outline when unselected; filled green (and explicitly
**not** red) when selected; `aria-pressed` reflects state; accessible name states
the next action; focus ring and target size; persists through `toggleWishlist`.

---

## F. Accessibility checks

| Requirement | Result |
|---|---|
| Targets ≥32px where applicable | heart 34×34, cart 34×34 |
| Sentence-level privacy link exemption respected | yes — not padded, per the earlier documented WCAG 2.2 inline exception |
| Buttons have accessible names | yes, including the new `CartIconLink` |
| Heart state announced | `aria-pressed` + name changes with state |
| Cart feedback not animation-dependent | polite live region carries the message |
| Reduced motion respected | duration **and delay** now collapsed |
| Keyboard navigation | unchanged; focus ring **added** to the heart |
| Visible focus states | heart `outline 3px`; hero secondary CTA keeps `focus-visible:ring-2` |

Nothing was regressed; two things improved (heart focus ring, reduced-motion
delay).

## G. Responsive checks — 390 / 768 / 1440

| | 390 | 768 | 1440 |
|---|---|---|---|
| Hero CTA height parity | 41/41 | 41/41 | 41/41 |
| Hero CTA radius / type | 10px, 15px | 10px, 15px | 10px, 15px |
| Shared baseline | wraps to two rows (correct) | aligned | aligned |
| Storefront hero CTA parity | 41/41 | 41/41 | 41/41 |
| Hero reveal automatic, no shift | yes | yes | yes |
| Cart icon reacts, no shift | yes | — | yes |
| Heart green, no shift, ≥32px | yes | — | yes |
| Horizontal overflow | **9px (pre-existing, §J)** | 0 | 0 |

At 390 the two CTAs wrap onto separate rows. That is correct flex-wrap
behaviour, not a misalignment — the harness now distinguishes the two rather
than reporting a false failure.

## H. Tests

| | Before | After |
|---|---|---|
| `tsc --noEmit` | exit 0 | **exit 0** |
| `vitest run` | 735 passed, 30 files | **756 passed, 31 files** |
| `npm run build` | clean | **clean** |

21 new tests in `tests/components/ux-polish.test.tsx`. One existing assertion
updated to match intended copy (§C). **No test was weakened, skipped or
`.catch(() => {})`-ed.**

## I. Browser QA — 53/54

`scripts/visual-qa-ux-polish.mjs`, real Chrome, three widths. It measures
**rendered geometry** — heights, radii, computed fill, bounding boxes — rather
than asserting that class names exist, because a class name proves nothing about
whether two buttons line up.

### Harness defects found and fixed

Recorded because a harness that reports false failures is worth no more than one
that reports false passes. **Five of the initial flags were mine:**

1. Looked for the hero on an `h1`. The public home renders the **storefront**
   hero, whose heading is an `h2`; `Landing.tsx` is at `/welcome`.
2. Took "the first two sizeable controls in the first `<section>`" as the CTAs,
   which matched an unrelated header link and then compared a CTA against it.
3. Checked `animationName` on the heading, but the reveal is applied to the copy
   **wrapper**; it now walks up to whichever ancestor carries the animation.
4. Asserted the CTAs share a baseline at 390, where they legitimately wrap.
5. **The heart one, which nearly became a false bug report.** The harness used
   `page.locator('button[aria-pressed="false"]').first()`, which re-runs its
   selector on every read — so once the clicked heart flipped to `true`, the
   locator resolved to the *next* unsaved heart and reported `false` again. An
   element handle did not fix it either, because React replaces the node on
   re-render, leaving the handle detached and permanently reporting its old
   attribute. Asserting on the **count** of selected hearts is immune to both.

Before concluding the heart was broken, the click was verified against the
database directly: the wishlist row count went 4 → 5 and the signed-in
marketplace rendered 3 of 12 hearts as selected. **The product was correct
throughout; the test was wrong.**

## J. Remaining observations

1. **9px horizontal overflow at 390px on the public shell header** — the
   `ml-auto flex items-center gap-1.5` cluster ending in "Get started" extends
   to 399px in a 390px viewport.

   **This is pre-existing and not caused by this pass.** Verified by A/B: the
   live production build (which has none of these changes) overflows by exactly
   the same 9px at the same width. It is in the header, not the hero, and
   fixing it means changing the public header's responsive layout — beyond a
   polish pass on the items requested. Flagged for a decision rather than
   changed unilaterally.

2. **106 empty-value placeholder em dashes were kept** (§C). One run reverses
   this if the Head of Product wants them converted too.

3. **The Loam character artwork is still absent**, unchanged by this pass. The
   launcher renders the approved leaf-mark fallback.

4. **Bank portal remains unexercised** in browser QA — no bank-role credential
   exists on this machine. Unchanged by this pass, carried forward from the
   deployment report.

5. **Not deployed.** This work is on `ux-polish-hop`. `main` auto-deploys to
   production on push, so nothing reaches the live site until the branch is
   merged deliberately.

**Wave 2 not started.**
