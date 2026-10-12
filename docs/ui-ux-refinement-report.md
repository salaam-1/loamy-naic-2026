# UI/UX Refinement — Auth + Loam Copilot

**Date:** 2026-09-23
**Scope:** Visual and interaction refinement only. No business logic, database, RLS, financial, provider, state-machine or lifecycle changes.
**Routes touched:** `/login`, `/signup`, `/reset-password`, `/forgot-password` (inherited), plus the Copilot launcher and panel on every authenticated route.

---

## 1. Existing visual problems identified

These were read off the code, not assumed.

**Auth (`AuthLayout.tsx`, before):**

| Problem | Evidence in the old code |
|---|---|
| A giant flat field of brand colour | `bg-emerald-900` applied to the full viewport |
| A pure-white rectangle on top of it | `bg-white` card |
| Wrong radius | `rounded` (10px control radius) used on a card-scale surface |
| No elevation | no `shadow-*` at all |
| No photography, no texture | no image, no grain, no scrim |
| **Used none of the design system** | not `bone`, not `env-panel`, not `image-scrim`, not the elevation scale |

The last row is the important one. A token layer already existed — warm neutrals, three soil-tinted elevation steps, four environment gradients — and the first screen anyone saw used none of it. This was not a screen that needed a new design language; it was a screen that had never been connected to the one already in the repo.

**Copilot:**

- The identity was a generic ✨ `Sparkles` icon — the most overused signifier for "AI feature" on the web, saying nothing about farming, Loamy, or what the thing does.
- The launcher was a single solid green lozenge, reading as a feature button rather than as someone available to help.
- The panel header read "Loamy Co-pilot", a product label rather than a name.

**Accessibility defects found during QA (all now fixed):**

- Password fields had no reveal control — the most common cause of a sign-in failure that has nothing to do with the account, and Loamy's members are frequently on phones in bright sunlight.
- Sign-in errors were rendered as plain text with no `role="alert"` and no programmatic association to the fields that caused them.
- Two standalone inline links sat below a 32px hit area (`Forgot password?` at 15px, `Create an account` / `Sign in` at 16px).

---

## 2. Design principles applied

1. **Compose from existing tokens; add none.** Verified, not claimed — see §4.
2. **Let a photograph do the emotional work and the form do the practical work.** Neither competes.
3. **Restraint over effect.** No glassmorphism, no neon, no glow, no gradient text.
4. **Motion only where it means something.** One state — "thinking" — earns animation, because it means *wait*.
5. **Loam is an object on the surface, not another block of brand colour.** The avatar sits *outside* the green pill.
6. **State what is missing rather than substituting for it.** See §5.

---

## 3. Components changed

**Created**

| File | Purpose |
|---|---|
| [LoamAvatar.tsx](src/components/copilot/LoamAvatar.tsx) | Loam's face. Four expressions, image-with-fallback, no frame animation. |
| [password-input.tsx](src/components/ui/password-input.tsx) | Password field with a reveal toggle. **Composes the existing `Input`** — same height, border and focus ring. |
| [visual-qa-auth-loam.mjs](scripts/visual-qa-auth-loam.mjs) | The browser QA harness for this pass. |

**Rewritten**

| File | Change |
|---|---|
| [AuthLayout.tsx](src/pages/auth/AuthLayout.tsx) | Full recomposition (§6). |

**Modified**

| File | Change |
|---|---|
| [Copilot.tsx](src/components/copilot/Copilot.tsx) | Sparkle → Loam, launcher and panel (§8). |
| [Login.tsx](src/pages/auth/Login.tsx) | `PasswordInput`, associated error, widened link targets. |
| [Signup.tsx](src/pages/auth/Signup.tsx) | Same treatment. |
| [ResetPassword.tsx](src/pages/auth/ResetPassword.tsx) | Both new-password fields → `PasswordInput`. |

Per Part 14, **no `LoginButton2`, `NewCard`, `CopilotButtonNew` or `NewModal` was created.** `PasswordInput` composes `Input`; the auth panel composes existing surface and radius tokens; the launcher is a plain `button` with token classes. `ForgotPassword.tsx` was not edited at all — it uses `AuthLayout` and inherited the redesign for free, which is the argument for having changed the layout rather than each page.

---

## 4. New / extended design tokens

**None. Zero tokens were added, and zero were changed.**

This is verifiable rather than asserted:

```
$ ls -l --time-style=+%F src/index.css tailwind.config.ts
-rw-r--r-- 5874 2026-09-21 src/index.css
-rw-r--r-- 8742 2026-09-21 tailwind.config.ts
```

Both predate this pass and were never opened for writing. Every value in the redesign is an existing token: `bone`, `sand`, `clay`, `emerald-800/900/950`, `gold-400`, `bg-env-page`, `bg-env-panel`, `bg-brand-fill`, `bg-image-scrim`, `rounded-card`, `rounded-control`, `rounded-pill`, `shadow-md`, `shadow-lg`, `text-display-sm`.

A note on the one design decision that was *rejected*: the `ui-ux-pro-max` skill proposed a stock agriculture palette (`#15803D` on `#F0FDF4`). That is precisely the templated default the `frontend-design` guidance warns against, and it would have introduced a second design system in violation of the brief. Loamy's existing tokens already satisfy the direction, so the skill's palette was not used.

---

## 5. Asset decisions

The repository was searched before anything was added. `public/images/` contains three Nigerian farming photographs, the Loamy logo mark, and `leaf.svg`. Nothing else.

**The Loam character render does not exist in this repository, and no reference artwork reached this build.**

That is stated plainly rather than worked around. The brief forbade generating a different mascot, so `LoamAvatar` does not invent one. It requests four character renders by path and, when they are absent, falls back via `onError` to the **Loamy leaf mark on the brand's own emerald** — an already-approved agricultural brand asset. It is not a character and does not pretend to be one.

When the real renders arrive, drop them at these paths and the component picks them up with no other change:

```
public/images/loam/loam-default.png
public/images/loam/loam-thinking.png
public/images/loam/loam-happy.png
public/images/loam/loam-concerned.png
```

Square, ≥192px, transparent background. Because the fallback is wired to `onError`, a missing or misnamed file degrades to the leaf rather than to a broken-image icon.

No new photography was added. The auth screens reuse `hero-farmer.jpg`, which already ships and is already credited (CC BY-SA 4.0, `public/images/IMAGE-CREDITS.md`). **No stock image was silently substituted.**

---

## 6. Login redesign

```
desktop   photograph (45%)  |  warm ivory panel (55%)
mobile    compact photo header (184px), then the panel
```

- The photograph is full-bleed behind `bg-image-scrim` — the same bottom-weighted gradient the home hero uses, whose contrast was measured against real pixels rather than assumed. The image keeps its top half readable *as an image*; the type sits in the dark part. A flat green wash over the photo would have put us back where we started.
- The form sits on `bg-env-panel` (warm ivory gradient) at `rounded-card` with `border-clay` and `shadow-md` — a lit surface, not a white rectangle.
- The positioning line is "Nigeria's Agricultural Operating System" with the existing public-site supporting sentence. **No new marketing claim was invented** — both strings already exist in approved copy.
- Password field gains a reveal toggle; errors render with `role="alert"`, an `AlertCircle`, and `aria-describedby` association from *both* fields.

## 7. Signup redesign

Signup uses the same `AuthLayout`, so it is the same composition by construction rather than by careful duplication — the failure mode where two auth screens drift apart is structurally prevented.

Signup-specific: identical error treatment (`id="signup-error"`), `PasswordInput`, widened footer link, and the consent line retained verbatim. `Privacy Policy` appears in two places — the consent sentence and a standalone link that `AuthLayout` now renders on *every* auth screen, because someone resetting a password is as entitled to read it as someone joining.

## 8. Copilot / Loam redesign

| | Before | After |
|---|---|---|
| Launcher | solid green pill, ✨ icon | `LoamAvatar` (36px) **outside** the green, on a `brand-fill` pill |
| Launcher label | *(not recorded before the change)* | "Ask Loam" |
| Launcher `aria-label` | — | "Open Loam, your farming co-pilot" |
| Panel header | "Loamy Co-pilot" + ✨ | `LoamAvatar` (32px), "Loam" / "Your farming co-pilot" |
| Empty state | text | `LoamAvatar` (48px) |

The `Sparkles` import is gone from `Copilot.tsx` (verified: zero references remain). It is still used elsewhere in the app — the marketplace "Suggested" badge — which is unrelated and was left alone.

The launcher's pre-change label was not captured before it was edited, and this repository is not under version control, so the "before" cell above is left blank rather than reconstructed from memory.

Expression is **derived from real state**, never decorative:

```tsx
const loamExpression: LoamExpression =
  sending                             ? 'thinking'
  : lastAssistant?.wasAnswered === false ? 'concerned'
  : lastAssistant?.wasAnswered === true  ? 'happy'
  :                                        'default'
```

Only the four states the Copilot can actually reach are modelled. An expression the product cannot reach is decoration, so none were added.

Per Part 18, **nothing about the Copilot's intelligence was touched**: no LLM provider, no fake responses, no new tables, no prompt. This was a visual identity change only.

---

## 9. Responsive behaviour

| Width | Auth | Loam |
|---|---|---|
| 390 | stacked; 184px photo header | launcher `bottom-20` clears the tab bar; panel `inset-x-2`, `max-h-[70dvh]` |
| 768 | stacked; 220px photo header | panel pinned `right-4`, 400px |
| 1440 | 45/55 split, full-height photo | launcher returns to `bottom-4` (no tab bar) |

**Measured, not assumed:** the launcher's own code comment claims `bottom-20` clears the mobile tab bar. The QA harness now verifies that claim geometrically instead of trusting it — bottom-nav overlap is **0px at 390 and 768**, and at 1440 there is no bottom nav. Horizontal overflow is ≤1px on every route at every width.

## 10. Accessibility changes

All improvements; nothing was traded away.

| Area | Change |
|---|---|
| Keyboard | Tab from email reaches the submit button on every width. The reveal toggle is deliberately `tabIndex={-1}` — reached on purpose, not stumbled into between field and submit. |
| Focus | `outline: 2px` visible on the focused control at all three widths. |
| Labels | Reveal toggle's accessible name states the *next* action ("Show password" / "Hide password") and reports state via `aria-pressed`. |
| Error association | `role="alert"` + `aria-invalid` + `aria-describedby` on both fields. |
| Targets | Standalone links widened to a 32px hit area via negative margin, so the visual rhythm is unchanged. |
| Alt text | The decorative hero carries `alt=""` and the scrim is `aria-hidden` — correct, since the adjacent `h2` carries the meaning. |

**Measured contrast** (computed from rendered colours at 1440):

| Element | Ratio | Verdict |
|---|---|---|
| `h1` title | 15.28:1 | AAA |
| Field label | 15.28:1 | AAA |
| Privacy link (11px) | 9.83:1 | AAA |
| Submit text on `brand-fill` | **8.18:1 worst gradient stop** | AAA |

The submit button was measured against *every* colour stop in its gradient and the worst case reported, because `backgroundColor` is transparent on a gradient element and the naive measurement is meaningless there.

**One deliberate non-change:** the Privacy Policy link inside the signup consent *sentence* remains at 14px. WCAG 2.2 Target Size (Minimum) explicitly exempts a target "in a sentence or block of text", and padding it to 32px would break the paragraph's line rhythm for no accessibility gain. The QA harness was corrected to encode that exemption rather than flagging correct markup — standalone links are still held to 32px.

## 11. Motion changes

Deliberately minimal:

- Launcher: `hover:-translate-y-0.5` + `shadow-md → shadow-lg`, 150ms, on `transform,box-shadow` only.
- Loam "thinking": a single pulsing gold dot. Not a spinner, not a glow, and **not swapped static frames** — faking motion that way is exactly what the brief rules out.
- Every motion path carries `motion-reduce:` guards, and the global `prefers-reduced-motion` rule collapses transitions to `1e-05s` (verified in-browser).

No entrance animations, no parallax, no shimmer.

## 12. Before / after browser QA

Real Chrome via Playwright (`channel: 'chrome'`), against the live dev server, signed in as a real buyer account.

| Run | Result | What happened |
|---|---|---|
| 1 | **84 / 97** | 2 real defects + **3 faulty assertions of my own** |
| 2 | 89 / 91 | assertions corrected; 1 real harness bug surfaced |
| 3 | 100 / 100 | harness bug fixed |
| 4 | **109 / 109** | after adding the `/dashboard/buyer` and nav-overlap checks Part 17 requires |

The check count changes because checks were **added and corrected between runs** — the denominator is not fixed, and it would be misleading to present this as a rising score.

**Two real product defects, both fixed:** the standalone inline-link tap targets on `/login` and `/signup`.

**Four harness defects, all mine, all fixed** — recorded because a QA harness that reports false failures is worth no more than one that reports false passes:

1. Asserted no "Loamy Co-pilot" anywhere in the panel; `COPILOT_DISCLAIMER` legitimately names the product in its legal text. Now scoped to the header.
2. Assumed two Tab presses from email reach the submit button; `Forgot password?` sits between the fields. Now tabs forward until it finds the submit control.
3. Reduced-motion regex matched only the literal `0.01ms`/`0s`; the browser reports `1e-05s`, which *is* 0.01ms. Now parsed numerically.
4. **A fixed 2.5s sleep after sign-in** — enough at 1440, not enough at 390. The harness reported a missing launcher at mobile and blamed the feature flag for its own impatience. Now waits on the launcher element, and if it genuinely never mounts it reports the flag it actually read instead of speculating.

Defect 4 is the same fixed-sleep pattern that produced false failures repeatedly across this project. The launcher was present at 390 the entire time.

**Also verified:** photography present on both auth routes at all widths · no flat colour block ≥35% of viewport · warm gradient form surface · password masked → revealed → re-masked · failed sign-in announced and associated · launcher 47px · panel opens and closes · **no console errors at any width**.

## 13. Screenshots / viewport results

In `.qa/`:

```
ux-login-{mobile,tablet,desktop}.png
ux-signup-{mobile,tablet,desktop}.png
ux-login-error-{mobile,tablet,desktop}.png
ux-loam-closed-{mobile,tablet,desktop}.png
ux-loam-open-{mobile,tablet,desktop}.png
ux-dashboard-{mobile,tablet,desktop}-closed.png
```

**Gate status:**

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run` | **735 / 735 passed**, 30 files |
| `npx vite build` | **exit 0**, built in 1m 07s |
| Browser QA 390/768/1440 | **109 / 109** |

The build emits a pre-existing chunk-size advisory unrelated to this pass.

## 14. Remaining visual debt

Stated honestly, including the parts that are uncomfortable.

1. **The Loam character does not exist.** This is the largest item. Every Loam surface currently renders the leaf-mark fallback. The identity is *wired*, not *drawn*. Until the four renders land, "Loam" is a name and a shell, and the definition-of-done line "Copilot launcher uses the Loam character" is **satisfied structurally but not visually.**

2. **Loam now has a face but still has no mind.** [copilot-ground-truth-audit.md](docs/copilot-ground-truth-audit.md) established that the Copilot has no LLM, no prompt, and can see 6 of 23 data categories; `engine.ts` is a keyword router. Giving it a warmer identity raises the intelligence a user expects from it. This pass widened that gap rather than narrowing it — correctly, since Part 18 forbade touching it, but it is a real product risk and should not be discovered later.

3. **`bg-white` appears in 105 component and page files**, including the Copilot panel body. The token layer defines warm surfaces that most of the app bypasses. The panel is therefore *consistent with the app* while being *inconsistent with the design system*. Out of scope for a visual pass on auth, but it is the reason the app still reads cooler than its own tokens intend.

4. **Only the auth screens were recomposed.** The dashboards were left alone deliberately. The auth screens now set a warmer, more considered standard than the screens behind them, which is a deliberate staging choice, not a finished state.

5. **The `ui-ux-pro-max` palette was rejected** and is not installed anywhere. If that skill is re-run later without this context, it will propose the same stock green palette again.

---

**Wave 2 has not been started**, per the instruction not to begin it until this visual pass is complete and verified.
