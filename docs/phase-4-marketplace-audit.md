# Phase 4 — Marketplace, commodity detail and the transaction spine

_Forensic audit, 2026-09-21. Current state only. No code was changed to produce it._

## The finding that shapes the whole phase

**Checkout forks into two incompatible models, and the default branch is the non-authoritative one.**

`src/pages/marketplace/CheckoutPage.tsx` has two buttons:

| Action | Path | Produces |
|---|---|---|
| **Place order** (the default) | `placeOrdersFromCart` → `loamy_place_orders_from_cart` | a row in `orders` |
| **Apply for financing** (per line) | `loamy_propose_transaction` | a row in `transactions` |

`loamy_place_orders_from_cart` and `loamy_respond_to_order` **never reference `transactions`** — verified by reading both function bodies. So an ordinary purchase produces a record with:

- no fee snapshot (so no frozen economics),
- no `batch_id` (so no traceability),
- no `transaction_events` (so no lifecycle),
- no route to financing, verification, logistics, warehouse or settlement.

Everything downstream in Phase 4 hangs off `transactions`. Until the ordinary buy path creates one, the rest of the spine is unreachable by design, not by oversight.

`docs/model-freeze.json` already records `orders` / `order_payments` / `order_payouts` as **retained-but-not-authoritative**. This audit does not propose deleting them.

---

## 1. Concept map

Legend for function class: **A** user-facing · **B** admin-facing · **C** internal helper · **D** trigger · **E** scheduled · **F** deprecated.

| Concept | Authoritative table | Authoritative function | Frontend | Callers | Reachable? |
|---|---|---|---|---|---|
| Listing | `listings` | `loamy_list_batch` (A) for batch-backed; direct insert for declared | `ListingForm`, `MyStock` | both wired | ✅ |
| Public listing | view `loamy_public_listings` | — | `PublicMarketplace` | wired | ✅ |
| Commodity batch | `commodity_batches` | `loamy_create_batch_from_harvest` (A), `loamy_batch_transition` (C) | `FarmDetail`, `MyStock` | wired (Phase 2 work) | ✅ |
| Cart | `cart_items` | `loamy_*` cart RPCs | `CartPage`, `CartContext` | wired | ✅ |
| **Order** | `orders` | `loamy_place_orders_from_cart` (A) | `CheckoutPage`, `OrdersPage` | wired | ⚠️ reachable but **non-authoritative** |
| **Transaction** | `transactions` | `loamy_propose_transaction` (A) | `CheckoutPage` financing branch only | 1 caller | ⚠️ **only via financing** |
| Transaction lifecycle | `transaction_events` | `loamy_transaction_transition` (A), `loamy_transaction_journey` (A) | `PurchaseDetail` | wired | ✅ |
| Fees | `fee_schedules` | `loamy_resolve_fee` (A), `loamy_snapshot_transaction_fee` (D) | `CheckoutPage`, `AdminFees` | wired | ✅ |
| Financing application | `financing_applications` | `loamy_apply_financing_for_transaction` (A) | `marketplace/FinancingApply` | wired | ✅ |
| Financing partners | `banks` | `loamy_financing_partners` (A), `loamy_bank_capabilities` (A) | `FinancingApply` | partial | ⚠️ capabilities unreached |
| **Financing decision** | `financing_applications` | `loamy_financing_decision` (A/B) | — | **0 callers** | ❌ |
| Bank review | `financing_applications` | `loamy_bank_set_status` (B) | `BankApplicationDetail` | wired | ⚠️ **wrong function** |
| Verification case | `verification_tasks` | `loamy_create_task` (A), `loamy_accept_task` (A), `loamy_decline_task` (A) | — | **0 callers** | ❌ |
| Verification claim | `verification_tasks` | `loamy_claim_task` (A, Block 5) | `FieldOps` | wired | ⚠️ duplicated |
| Verification claim (old) | `verification_tasks` | `loamy_claim_verification_task` (**F**, Stage 4) | `VerificationTasks` | wired | ❌ **deprecated path still live** |
| Evidence | `verification_evidence` | `loamy_submit_evidence` (A) | `TaskDetail` | wired (P0-3) | ✅ |
| Review decision | `verification_cases` | `loamy_review_verification_case` (B) | `AdminVerificationQueue` | wired (P0-2) | ✅ |
| Settlement readiness | — | `loamy_settlement_readiness` (A) | `PurchaseDetail` | wired | ✅ |
| Supplier settlement | `ledger_entries` | `loamy_record_supplier_settlement` (B) | — | **0 callers** | ❌ |
| Logistics | `transport_*` | `loamy_request_transport_for_transaction` (A) | `PurchaseDetail` | wired | ✅ |
| Logistics lifecycle | `transport_*` | `loamy_logistics_transition` (A) | — | **0 callers** | ❌ |
| Warehouse suggest | — | `loamy_suggest_warehouses` (A) | `PurchaseDetail` | wired | ✅ |
| Warehouse request | `storage_*` | `loamy_request_storage` (A) | — | **0 callers** | ❌ |
| Warehouse receipt | `storage_*` | `loamy_record_warehouse_receipt` (A) | — | **0 callers** | ❌ |
| Traceability | `batch_events` | `loamy_trace` (A) | `TraceExplorer` | wired | ✅ |
| Public profile | `profiles` | `loamy_profile_by_username` (A) | `PublicProfile` | wired (Phase 3B) | ✅ |

---

## 2. Flow-by-flow current state

### 2.1 Marketplace listing
Works. `claim_basis` distinguishes `seller_declared` from `batch_backed`, is set only by `loamy_list_batch`, and a trigger refuses a client attempt to forge either `batch_id` or `claim_basis` (proven live in `scripts/verify-stock-spine.mjs`). `PublicProductCard` surfaces it via `VerifiedTag` / `StockClaim`.

**Gap:** the *seller name* on cards is plain text. §15 wants it linked to `/u/:username`, which Phase 3B now supports.

### 2.2 Commodity detail
Two routes exist and neither is a commodity-detail page in the §4 sense:

- `/marketplace/:id` → `PublicListingDetail` (anon-safe, reads `loamy_public_listings`)
- `/dashboard/:role/marketplace/listing/:listingId` → `ListingDetail` (reads `listings` + `listing_interests`)

Neither exposes: minimum order quantity, available-vs-committed quantity, a traceability entry point, financing availability, logistics or warehouse options. Neither calls `loamy_trace`. **This is the largest build item in the phase.**

### 2.3 Cart and checkout
One cart, correctly. Checkout is the fork described above.

Two further defects in the financing branch:
- `loamy_propose_transaction` accepts `p_note`, `p_delivery_state`, `p_delivery_lga`; `CheckoutPage` passes **only** `p_listing_id` and `p_quantity`, silently discarding the delivery state and note the buyer just typed.
- The fee breakdown renders on the order branch but the financing branch navigates away before any fee is shown.

### 2.4 Transaction creation
`loamy_propose_transaction` is the authoritative path and is well formed — it carries buyer, seller, listing, **batch_id**, commodity, quantity, unit, price, subtotal, delivery, writes a `transaction_events` row and notifies the seller. Nothing needs redesigning; it needs a second caller.

### 2.5 Financing
Application creation works and the **one-active-application rule is enforced server-side**:

```sql
if exists (select 1 from public.financing_applications
           where transaction_id = p_transaction_id and applicant_id = v_uid
             and status not in ('rejected','cancelled','expired','completed'))
then raise exception 'You already have a live financing application for this purchase.';
```

So Bank A pending + Bank B pending is already impossible, and a rejection correctly frees the transaction for a second attempt. No new engine is needed.

### 2.6 Sterling
**There is no Sterling integration, and no reference to Sterling anywhere in `src/` or in any migration.**

This is not a gap to paper over — it is the correct state. The Block 4 adapter deliberately names no bank:

> _"CAPABILITIES ARE DATA, NOT CODE. No bank is named anywhere in the core model. A bank declares what it supports, every flag defaults to NO."_

`banks.integration_mode` is `sandbox | live | disabled`, and `decision_source` records `bank_officer | bank_api | sandbox_adapter` with `is_sandbox` propagated into every payload. `src/lib/financing.ts:157` already appends *"(sandbox simulation — not a real credit decision)"* to any sandboxed decision.

**Therefore Sterling onboarding is a row plus capability flags, not code.** What is missing is the *UI* to select a partner and see its capabilities, and an explicit pending state where `integration_mode` is not `live`.

### 2.7 Bank portal — the sharpest functional gap
`BankApplicationDetail` calls `loamy_bank_set_status`, which accepts only:

```
'under_review', 'info_requested', 'decided_external'
```

The authoritative `loamy_financing_decision` accepts:

```
'approved', 'partially_approved', 'rejected',
'additional_information_required', 'under_review'
```

plus approved amount, tenor, pricing note, bank reference, expiry and decision source — and enforces that only an officer of the **assigned** bank may decide.

**A bank officer currently cannot approve or reject anything through the UI.** They can only mark "decided externally", which is why the financing lifecycle dead-ends.

### 2.8 Verification
`TaskDetail` (evidence) and `AdminVerificationQueue` (review) were repointed to the Block 5 path in P0-2/P0-3 and are correct.

**But `VerificationTasks.tsx:59` still calls `loamy_claim_verification_task` — the Stage 4 function §10 explicitly forbids reconnecting.** `FieldOps.tsx` calls the Block 5 `loamy_claim_task`. Two parallel claim paths against the same table.

`loamy_accept_task`, `loamy_decline_task`, `loamy_submit_verification_case` and `loamy_my_verification_cases` have zero callers.

### 2.9 Settlement
`loamy_settlement_readiness` is wired into `PurchaseDetail`. `loamy_record_supplier_settlement` has no caller, so the supplier-direct path cannot be completed from the UI. No wallet concepts remain (P0-1 removed them).

---

## 3. Duplicate and parallel implementations

1. **`orders` vs `transactions`** — two purchase models, both reachable, only one authoritative.
2. **`loamy_claim_verification_task` (Stage 4, F) vs `loamy_claim_task` (Block 5, A)** — both called from different screens.
3. **`loamy_bank_set_status` (B) vs `loamy_financing_decision` (A/B)** — the portal uses the weaker one.

---

## 4. The 13 reachability gaps, triaged

| Function | Who needs it | Phase |
|---|---|---|
| `loamy_financing_decision` | bank officer | **4** — §9 |
| `loamy_accept_task` / `loamy_decline_task` | Growth Partner | **4** — §10 |
| `loamy_submit_verification_case` | Growth Partner | **4** — §10 |
| `loamy_my_verification_cases` | Growth Partner | **4** — §10 |
| `loamy_request_listing_verification` | buyer, from commodity detail | **4** — §4 |
| `loamy_request_storage` | buyer, post-transaction | **4** — §13 |
| `loamy_record_warehouse_receipt` | warehouse operator | **4** — §13 |
| `loamy_logistics_transition` | logistics provider | **4** — §13 |
| `loamy_record_supplier_settlement` | admin / bank | **4** — §11 |
| `loamy_link_bank_account` | applicant | **4** — §8, gated on capability |
| `loamy_open_dispute` | either party | **later** — needs a dispute surface |
| `loamy_respond_to_review` | seller | **later** — Phase 3 adjacent, not marketplace |
| `loamy_bank_portfolio_intelligence` | bank | **later** — Phase 12 |
| `loamy_seller_signals` | seller | **later** — Phase 12 |
| `loamy_inferred_preferences` | buyer | **later** — Phase 12, consent-gated |
| `loamy_submit_intelligence_feedback` | any | **later** — Phase 12 |

---

## 5. Files requiring change

| File | Change |
|---|---|
| `src/pages/marketplace/CheckoutPage.tsx` | route the ordinary purchase through `loamy_propose_transaction`; stop discarding delivery state and note |
| `src/pages/public/PublicListingDetail.tsx` | build the real commodity detail |
| `src/pages/marketplace/ListingDetail.tsx` | converge on one detail implementation |
| `src/pages/bank/BankApplicationDetail.tsx` | `loamy_bank_set_status` → `loamy_financing_decision` |
| `src/pages/partner/VerificationTasks.tsx` | Stage 4 → Block 5 claim/accept/decline |
| `src/pages/marketplace/PurchaseDetail.tsx` | storage request, logistics transition, settlement |
| `src/pages/marketplace/FinancingApply.tsx` | partner capabilities + explicit pending state |
| `src/lib/orders.ts` | mark non-authoritative; keep reads for history |
| `src/pages/marketplace/PublicProductCard.tsx` | seller name → `/u/:username` |

**No new tables. No migration expected** — every function required already exists.

---

## 6. Recommended implementation order

Each slice ends with its own tests before the next begins.

1. **Checkout → authoritative transaction.** The unlock for everything else. Keep `orders` reads for history; stop creating new ones.
2. **Commodity detail.** Real quantities, verification state, traceability entry point, seller profile link, financing entry.
3. **Bank decision.** Repoint to `loamy_financing_decision`; surface approved amount, tenor, bank reference, and the sandbox label.
4. **Verification lifecycle.** Retire the Stage 4 claim; wire accept/decline/submit-case/my-cases.
5. **Logistics + warehouse.** `loamy_request_storage`, `loamy_record_warehouse_receipt`, `loamy_logistics_transition`.
6. **Settlement.** `loamy_record_supplier_settlement` behind the existing gates.
7. **Sterling as data.** Partner selection driven by `loamy_bank_capabilities`; explicit pending state where `integration_mode <> 'live'`; `loamy_link_bank_account` only where the capability allows.

---

## 7. Constraints carried into implementation

- No second transaction/order/deal model; `orders` stays for history.
- No wallet, no `wallet_entries`, no withdrawal.
- No BVN or NIN anywhere, including logs.
- No Stage 4 verification reconnection — the opposite: remove the one that remains.
- No hardcoded fee rates; `loamy_resolve_fee` only.
- **Phase 5 fee configuration untouched.** Still open: split-payer ratio absent from the schema, checkout charges split entirely to the buyer, revenue destination documented rather than enforced, and 38 test fee rules live in `fee_schedules`.
- No invented Sterling responses, approvals, accounts or limits.


---

## Addendum — slice 1 outcome and findings carried into slice 2

_Appended 2026-09-21 after slice 1 shipped._

### Slice 1 closed

`listing → cart → checkout → transactions` is live. Migration
`20260921110001` added `loamy_checkout_cart` (an orchestrator over
`loamy_propose_transaction`, not a second model), made proposal idempotent on
`(buyer, listing, quantity)` while `proposed`, and marked the `orders` path
deprecated. `orders` is retained for history and has no production writer.

### Found during slice 1, belongs to a later slice

**`loamy_suggest_warehouses` has never worked.** It reads `v_t.origin_state`
and `transactions` has no such column — PostgreSQL `42703`, on every load of
`/purchase/:txnId`. Origin state lives on `commodity_batches.origin_state`,
reachable through `transactions.batch_id`. Fixing it means deciding whether
warehouse suggestion keys off the delivery state, the batch origin, or both,
which is a **slice 5** decision. The browser QA harness names this one call
explicitly so a *new* error still fails the check.

**`BuyBox` swallows add-to-cart failures.** `src/components/BuyBox.tsx`:

```ts
} catch {
  /* silent — e.g. RLS blocks carting your own listing */
}
```

A member whose add-to-cart is refused sees nothing happen. **Slice 2**, with
the rest of the commodity-detail work.

**`BuyBox` forces whole units.** `Math.max(1, Math.floor(n))` means a listing
priced per tonne cannot be bought as 2.5 tonnes. The backend accepts a
`numeric` quantity and `loamy_propose_transaction` has no integer
constraint, so this is a client-side restriction on legitimate partial sales.
**Slice 2.**

### Known limitation accepted in slice 1

`loamy_propose_transaction` validates quantity against the listing only, not
against quantity already committed by other open proposals. Two buyers can
each propose the full listed amount; the conflict surfaces later at
`loamy_batch_transition`, which enforces `available_quantity`. This is the
pre-existing authoritative behaviour and was left alone deliberately —
introducing a reservation model was out of scope and would change partial-sale
semantics.

---

## Addendum — slice 2 findings (2026-09-21)

Full report: `docs/phase-4-slice-2-report.md`. Recorded here because two of
these change what later slices should expect.

**Gap 6 closed, plus one the audit did not see.** The bare `catch` and
`Math.floor` were both fixed as planned. Fixing the first exposed a wider
defect the audit missed: **`e instanceof Error` is false for a
`PostgrestError`**, because supabase-js rejects with a plain object. Every
site using that idiom silently discards the database's own description of the
failure. `src/lib/errors.ts` now handles it. The same idiom still stands at
`src/lib/escrow.ts:90`, `src/lib/payments.ts:54` and `src/lib/wallet.ts:144` —
**each is a live instance of the same defect** and should be swept when those
surfaces are next touched (slices 6 and 7).

**`profile_visibility` gates the seller handle, and nothing else needed to
change.** `loamy_public_listings.seller_username` is null for a private
profile. Later slices that want to link a counterparty from a listing should
read this column rather than joining `profiles` themselves.

**Slice 1's idempotency index is observable from the UI, and will break naive
count assertions.** Re-checking-out the same `(buyer, listing, quantity)`
returns the existing open proposal and inserts nothing. Any QA that asserts
"transaction count increased" will report a false failure on its second run.
Assert the invariant — exactly one open proposal — not the delta.

**`loamy_suggest_warehouses` remains broken** (`42703`, reads
`v_t.origin_state`). Untouched in slice 2 by instruction. Slice 5.
