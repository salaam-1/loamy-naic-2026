# Phase 4 — Slice 2: commodity detail + BuyBox correctness

**Status:** complete. **Date:** 2026-09-21.

Slice 2 had one governing idea: the commodity detail page must say only what
the backend can support, and the purchase box must never lie about what
happened. Everything below follows from that.

---

## 1. What was wrong before

| # | Defect | Consequence |
|---|---|---|
| 1 | `BuyBox` caught every error in a bare `catch` and discarded it | A refused add-to-cart looked identical to a successful one: the button finished, nothing appeared, nothing explained why |
| 2 | `BuyBox` ran `Math.floor` on every quantity | A listing priced per tonne could not be bought as 2.5 tonnes — a restriction that exists nowhere in the schema |
| 3 | The seller block was plain text | The Phase 3B digital identity at `/u/:username` was unreachable from the place a buyer actually decides |
| 4 | A trace entry point was offered regardless of whether a batch existed | A seller declaration with nothing behind it was presented as traceable |
| 5 | The page used `select('*')` and treated a backend error as "not found" | A network failure sent the buyer away from a listing that exists |
| 6 | `e instanceof Error` discarded every PostgrestError | Found during this slice's browser QA — see §6 |

---

## 2. Files changed

| File | Change |
|---|---|
| `src/lib/quantity.ts` | **new** — quantity validation that mirrors the database and invents nothing |
| `src/lib/errors.ts` | **new** — reads a thrown PostgrestError, which is not an `Error` |
| `src/components/BuyBox.tsx` | rewritten — visible failures, no truncation, accessible invalid state |
| `src/pages/public/PublicListingDetail.tsx` | explicit columns, load-error vs missing, seller link, conditional trace |
| `src/lib/marketplace.ts` | `PublicListing.seller_username: string | null` |
| `src/pages/marketplace/CardActions.tsx` | save control 32px → 36px (it was the smallest hit area on the page) |
| `scripts/visual-qa-commodity.mjs` | **new** — the §21 journey at three widths |
| `tests/unit/quantity.test.ts` | **new** — 26 tests |
| `tests/unit/errors.test.ts` | **new** — 22 tests |
| `tests/components/buybox.test.tsx` | **new** — 21 tests |

### Functions changed

- `BuyBox.add` — error path rewritten; `Math.floor` removed.
- `PublicListingDetail.load` — explicit column list; `setLoadError` separated from `'missing'`.
- New: `checkQuantity`, `quantityStep`, `isDiscreteUnit`, `formatQuantity`, `errorMessage`, `rawErrorMessage`, `errorCode`.

### Routes changed

None added or removed. `/marketplace/:id` changed in behaviour only. It now
links out to `/u/:username`, which already existed from Phase 3B.

---

## 3. Migration

`supabase/migrations/20260921120001_loamy_public_listing_seller_handle.sql` — **applied live**.

Recreates `loamy_public_listings` with three added columns:

```sql
description,
available_from,
case when p.profile_visibility = 'private' then null else p.username end as seller_username
```

**No user id was added to the view.** A private profile yields `null`, and the
page then renders the seller's display name as plain text rather than a link to
a page that would correctly refuse to load.

### Tables and views queried

`loamy_public_listings` (read), `cart_items` (insert via `addToCart`),
`listings` (embedded read through the cart), `transactions` (read, and written
through `loamy_propose_transaction` / `loamy_checkout_cart` from slice 1).

No table was created, renamed, or dropped. No production column was altered.

---

## 4. Declared vs batch-backed — the actual behaviour

The distinction is now truthful in both directions.

**Batch-backed** (`claim_basis = 'batch_backed'` **and** `batch_ref` non-null):
the batch reference is displayed and a "Trace this stock" link is offered to
`/trace/:batch_ref`. What the trace then discloses is decided by `loamy_trace`'s
own permission model — this page does not pre-judge it.

**Declared** (`claim_basis = 'seller_declared'`): no trace action is offered at
all. In its place:

> This is a seller declaration, so there is no batch to trace. Stock listed from
> a recorded harvest carries a batch reference you can follow.

That copy exists because an absent affordance is ambiguous — a buyer cannot
tell "no trace" from "trace not loaded". The sentence says which.

**The word "Verified" is never applied to a declaration.** The QA asserts the
negative at all three widths: `declared@390/768/1440 claims no verification`.

---

## 5. Fractional quantity — the actual behaviour

`listings.quantity_kg`, `cart_items.quantity` and `transactions.quantity` are
all `numeric` with a `> 0` check. There is **no** minimum-order column, **no**
step, and **no** precision metadata anywhere in the schema. So `quantity.ts`
validates exactly the two things the database validates:

1. greater than zero
2. not greater than the listed quantity (and no limit at all when availability is unknown)

2.5, 0.5, 3.89 and 12.005 all pass through unrounded. 3.89 has been
round-tripped into a live transaction (`TXN-000190`).

`quantityStep(unit)` returns `'1'` for bag/crate/unit and `'any'` otherwise.
**This is an arrow-key convenience and never a constraint** — a decimal typed
into a bag listing is still accepted, because the server has no such rule and
the client must not invent one. An unrecognised unit is treated as continuous,
since wrongly allowing a decimal is cosmetic while wrongly forbidding one blocks
a real sale.

---

## 6. BuyBox error behaviour — including a defect this slice's QA found

Fixing the bare catch was the stated task. Doing it revealed a second, wider
defect.

The induced-failure test (a seller adding their own listing) showed the error
*was* now visible — but as the generic fallback, "Could not add this to your
cart. Please try again." The database had said something specific. The cause:
**supabase-js rejects with a `PostgrestError`, which is a plain object and not
an instance of `Error`**, so `e instanceof Error ? e.message : fallback`
discarded the only accurate description of the refusal.

`src/lib/errors.ts` closes this. Known Postgres codes get plain language;
anything unrecognised is passed through **as the server worded it**, which is
worse prose but true; the fallback is used only when there is genuinely no
message. The seller now sees:

> You are not allowed to do that. If this is your own listing, you cannot buy
> from yourself.

Also guaranteed and tested: the typed quantity survives a failure, the error
clears when the quantity is edited, nothing claims the item was added, the
field carries `aria-invalid` / `aria-describedby`, and the alert is
`role="alert"`.

**Known limitation:** the same `instanceof Error` pattern remains at
`src/lib/escrow.ts:90`, `src/lib/payments.ts:54` and `src/lib/wallet.ts:144`.
They have the same blind spot. They are outside slice 2 and were left alone
rather than changed without QA behind them.

---

## 7. Warehouse dependency

**Unchanged, as instructed.** `loamy_suggest_warehouses` still fails with
`42703` — it reads `v_t.origin_state`, which `transactions` does not have. It
was not repaired in this slice. The QA harness names that one 400 explicitly so
that a *new* console error still fails the run.

Scheduled for slice 5 (logistics + warehouse).

---

## 8. Quality gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **25 files, 553 tests, all passed** |
| `npx vite build` | built in 34.1s |
| `npm run test:security` | see §10 |
| Browser QA @ 390 / 768 / 1440 | **47/47 checks passed** |

### Browser QA — the §21 journey

`scripts/visual-qa-commodity.mjs`, real Chrome, live database, all of:
marketplace list → click a card → detail → seller → `/u/:username` → quantity →
fractional quantity → add to cart → cart → induced failure → visible error →
no false success → checkout → transaction spine intact. Plus a declared
listing, a batch-backed listing, and an unavailable listing, at each width.

Notable confirmed results:

- `seller links to /u/:username — /u/s_9ugci4`
- `fractional quantity accepted in the UI — Total ₦225,000` (2.5 × ₦90,000)
- `over-availability refused with a reason — Only 12 tonne available.`
- `an induced add-to-cart failure is VISIBLE — You are not allowed to do that…`
- `a failed add does not claim success`
- `checkout lands the line in the transaction spine — 1 open proposal`
- `checkout is idempotent — no duplicate proposal`
- `checkout creates NO order row — orders 4 -> 4`

### Three harness defects found and fixed during QA

Worth recording, because each initially looked like an application failure:

1. **A 1.8s sleep after add-to-cart.** The add is two sequential round trips to
   a remote database and settles in ~3.3s. The harness reported a failure on a
   write that had succeeded. Replaced with a wait on the outcome.
2. **The desktop journey picked whichever listing was batch-backed** — which
   happened to have a private seller, so the profile-link check was silently
   skipped. Now it deliberately picks a listing whose seller has a public
   handle.
3. **The checkout check asserted the transaction count went up.** Slice 1's
   partial unique index on `(buyer_id, listing_id, quantity) WHERE status =
   'proposed'` means re-checking-out the same line returns the existing
   proposal and inserts nothing — so the check failed on its own second run,
   when what it was seeing was idempotency working correctly. It now asserts
   what must actually hold: exactly one open proposal, and no order row.

### Two real accessibility defects found and fixed

The save control was 30×30px and "Back to marketplace" was 15px tall. Both are
below the 32px house minimum used since Phase 1. Now 36px and 32px.

---

## 9. What this slice deliberately did not do

- Did not repair `loamy_suggest_warehouses` (slice 5).
- Did not touch Phase 5 fee configuration.
- Did not reconnect the deprecated Stage 4 verification path.
- Did not add a minimum order, step, or precision rule — the schema has none.
- Did not expose any internal user id.
- Did not delete the 38 test fee rules or any test account.

---

## 10. Security suite

Run appended on completion. Note for whoever reads a failing run: this suite has
now produced four separate DNS-caused failures (`EAI_AGAIN`, `ENOTFOUND`) that
passed on re-run of the affected files. **Confirm causation by re-running the
named files before treating a failure as real** — and note that vitest has
exited 0 despite a failed file, so read the summary, not the exit code.
