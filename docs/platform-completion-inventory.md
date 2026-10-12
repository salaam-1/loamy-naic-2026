# Loamy — platform completion inventory

Produced **2026-09-21**, after Phase 4 slices 1–3, by re-auditing the live
codebase and the live database rather than trusting the earlier Phase 4 audit.

**Method.** Reachability is classified by dependency graph, not by grant: a
function is only a gap if an appropriate user could not initiate it through the
actual application. Internal helpers, triggers and background jobs are excluded.
Section coverage is computed by cross-referencing `ROLE_CONFIGS.nav` against the
four component registries — a section declared in nav but absent from a registry
renders the "is being built" empty state and is **not** reachable functionality.

---

## 0. The blocker that gates a large part of this sprint

`supabase/migrations/20260921140001_loamy_slice3_bank_decision_lifecycle.sql`
**is still not applied.** `supabase migration list --linked` shows it as the
single pending migration. `npx supabase db push --linked` is refused by this
session's production-deploy policy.

Consequence: the bank decision lifecycle built in slice 3 is complete in code
and cannot be exercised, and **every workstream below that needs a schema or
function change is queued behind the same authorisation.** Where that is the
case it is stated explicitly rather than absorbed.

---

## 1. Headline numbers

| Measure | Value |
|---|---|
| Database functions defined | 281 |
| — user-facing (A) | 106 |
| — admin-facing (B) | 59 |
| — internal helper (C) | 64 |
| — trigger/event (D) | 41 |
| — scheduled (E) | 3 |
| — deprecated (F) | 8 |
| **User-facing functions with no UI entry point** | **14** |
| App routes | 56 |
| Distinct dashboard sections declared | 28 |
| — sections rendering a real component | 19 |
| — **sections rendering "is being built"** | **9** |
| `select('*')` in client code | 127 |
| `instanceof Error` sites | 72 across 39 files |

---

## 2. The golden spine, step by step

The intended spine is listing → transaction → financing → bank decision →
verification → settlement → loading → logistics → warehouse → delivery →
ledger → trace. Its current state:

| Step | Authoritative model | Authoritative RPC | UI entry point | Reachable? | End-to-end? |
|---|---|---|---|---|---|
| Listing | `listings` / `loamy_public_listings` | — | `/marketplace`, `/marketplace/:id` | ✅ | ✅ |
| Cart | `cart_items` | `addToCart` | `/cart` | ✅ | ✅ |
| Transaction | `transactions` | `loamy_checkout_cart`, `loamy_propose_transaction` | `/checkout` | ✅ | ✅ slice 1 |
| Financing application | `financing_applications` | `loamy_apply_financing_for_transaction` | `/financing/apply/:txnId` | ✅ | ✅ |
| **Bank decision** | `financing_applications` | `loamy_financing_decision` | `/bank/application/:appId` | ⚠️ **code done, migration pending** | ❌ blocked |
| **Verification** | Block 5 `verification_cases` | `loamy_submit_verification_case` | — | ❌ **0 callers** | ❌ |
| **Settlement** | `external_settlement`, ledger | `loamy_settle_supplier_direct` | — | ❌ **0 callers** | ❌ |
| **Loading** | `loading_records` | `loamy_record_loading` | — | ❌ **0 callers** | ❌ |
| **Transport award** | `transport_offers` | `loamy_award_transport` | — | ❌ **0 callers** | ❌ |
| Transport request/offer | `transport_requests` | `loamy_request_transport`, `loamy_transport_offer` | `/dashboard/*/logistics`, `transport-board` | ✅ | ⚠️ **dead-ends at award** |
| **Warehouse storage** | `storage_requests` | `loamy_request_storage` | — | ❌ **0 callers** | ❌ |
| **Warehouse receipt** | `warehouse_receipts` | `loamy_record_warehouse_receipt` | — | ❌ **0 callers** | ❌ |
| Warehouse suggestion | — | `loamy_suggest_warehouses` | Purchase detail | ⚠️ **called but BROKEN** (`42703`) | ❌ |
| Delivery | `transactions.fulfilment_state` | `loamy_batch_transition` | partial | ⚠️ | ⚠️ |
| Ledger | `ledger_entries` | `loamy_financial_activity` | `wallet` section | ✅ | ✅ |
| Trace | `loamy_trace` | `loamy_trace` | `/trace`, `/trace/:ref` | ✅ | ⚠️ depth unverified |

**The spine is intact from listing to financing application, complete but
unapplied at bank decision, and then breaks.** Verification, settlement,
loading, transport award and the whole warehouse path have authoritative
backend implementations with **zero UI callers**. That is the single largest
finding of this audit: the backend is far more complete than the product.

---

## 3. The 14 user-facing functions with no UI entry point

| Function | Workstream | Note |
|---|---|---|
| `loamy_submit_verification_case` | 1 | Block 5 submission. The app still uses the Stage 4 path. |
| `loamy_my_verification_cases` | 1 | An agent cannot list their own cases. |
| `loamy_accept_task` | 1 | Task acceptance. |
| `loamy_decline_task` | 1 | Task decline — an agent can only claim, never decline. |
| `loamy_request_listing_verification` | 1 | A seller cannot ask for their stock to be inspected. |
| `loamy_open_dispute` | 1 | **No member can raise a dispute anywhere in the product.** |
| `loamy_request_storage` | 3 | Storage request. |
| `loamy_link_bank_account` | 4/11 | Bank account linking (last-4 only, no BVN). |
| `loamy_bank_portfolio_intelligence` | 5 | Bank portfolio intelligence. |
| `loamy_seller_signals` | 5 | Seller-facing demand signals. |
| `loamy_inferred_preferences` | 5 | Buyer preference inference. |
| `loamy_submit_intelligence_feedback` | 5 | Feedback loop on intelligence. |
| `loamy_respond_to_review` | 7 | A seller cannot reply to a review. |
| `loamy_bank_set_status` | — | **Not a gap.** Deprecated in slice 3; its caller was removed deliberately. The reachability script should reclassify it as F. |

Add to this `loamy_award_transport`, `loamy_record_loading`,
`loamy_record_warehouse_receipt` and `loamy_settle_supplier_direct`, which the
script classified as reachable-by-proxy but which have **no caller in `src/`**
— verified by grep. Real gap: **17**, not 14.

---

## 4. Sections declared in navigation that render a placeholder

| Section | Roles | Flag | Workstream |
|---|---|---|---|
| `storage-requests` | warehouse_owner | `storage_requests` | 3 |
| `my-warehouses` | warehouse_owner | `my_warehouses` | 3 |
| `delivery-requests` | logistics_provider | `delivery_requests` | 2 |
| `my-fleet` | logistics_provider | `my_fleet` | 2 |
| `compliance` | exporter | `verification_workflow` | 1 |
| `export-hub` | exporter | `export_hub` | 6/7 |
| `my-network` | growth_partner | `my_network` | 1 |
| `my-business` | trader/buyer | `my_business` | 7 |
| `saved` | trader/buyer | `saved_listings` | 7 |
| `reports` | 6 roles | `reports` | 5 |

All are behind feature flags, so none is currently *visible* — they are
declared intent, not broken UI. `field-ops` is declared without a component but
**is** reachable: it has its own route at `/dashboard/growth_partner/field-ops`.

---

## 5. Workstream-by-workstream state

### WS1 — Verification
Authoritative: Block 5 (`verification_cases`, `loamy_submit_verification_case`,
`loamy_my_verification_cases`, evidence + GPS + fraud signals). The application
still calls the **deprecated Stage 4** `loamy_claim_verification_task`
(`VerificationTasks.tsx:59`). Agent anonymity, GPS validation and evidence
permissions exist in the backend and are covered by `block5-gp-security.test.ts`.
`loamy_open_dispute` is unreachable. **Blocker: UI rewiring, no migration
needed.**

### WS2 — Transaction logistics
`loamy_request_transport` and `loamy_transport_offer` are wired.
`loamy_award_transport` and `loamy_record_loading` are not. So a shipper can
request and a carrier can offer, and **nobody can accept** — competing offers
are never declined because selection never happens. **Blocker: UI, no migration
needed** (pending confirmation that the award function closes losing offers).

### WS3 — Warehouse
`loamy_suggest_warehouses` reads `v_t.origin_state`, which `transactions` does
not have → `42703`, every call fails. Per the directive the fix is to resolve
origin through transaction → listing → batch → farm, **not** to add a column.
`loamy_request_storage` and `loamy_record_warehouse_receipt` have no callers.
**Blocker: migration + UI.**

### WS4 — Settlement
`loamy_settlement_readiness` is displayed on the purchase page; the blocking
reasons render. `loamy_settle_supplier_direct` has no caller, so settlement can
be *observed* but never *initiated*. Non-custodial architecture
(`partner_funding`, `external_settlement`, memorandum ledger) is intact.
**Blocker: UI, no migration needed.**

### WS5 — Intelligence
`MarketIntelligence` is wired for the `intelligence` section. Four functions
unreachable: `loamy_bank_portfolio_intelligence`, `loamy_seller_signals`,
`loamy_inferred_preferences`, `loamy_submit_intelligence_feedback`. The
`reports` section is a placeholder for six roles. Classification
(`observed`/`user_generated`/`model_inference`) and k-anonymity exist in the
backend and are covered by `block7-intelligence-e2e.test.ts`. **Blocker: UI.**

### WS6 — Traceability
`loamy_trace` is wired to `/trace` and `/trace/:ref` and has six caller files.
Slice 2 added a trace entry point from commodity detail, gated on a real
`batch_ref`. Depth across the full spine and the exists-but-invisible vs
does-not-exist distinction are **unverified in the browser**. **Blocker: QA.**

### WS7 — Marketplace / profile / transaction
Closed by slices 1–3. Checkout terminates in `transactions`; `orders` is
deprecated; fractional quantities preserved; fee snapshot at proposal.
Remaining: `loamy_respond_to_review` unreachable; `saved` and `my-business`
placeholders.

### WS8 — Fees / money / ledger
`src/lib/fees.ts` contains no percentage and resolves through
`loamy_resolve_fee`. `AdminFees` manages `fee_schedules`. **`src/pages/shared/Wallet.tsx`
still exists and is imported by nothing** — dead custodial UI that should be
deleted. Known Phase 5 gaps carried forward: split-payer ratio absent from
schema; checkout charges `split` entirely to the buyer; **38 test fee rules
still live in `fee_schedules`**.

### WS9 — Referrals / commissions — **test isolation**
`block6-referrals-commission.test.ts` has now failed in two consecutive full
suite runs and passed **44/44** in isolation both times. The second failure was
not DNS: normal duration, and the failures were `data` null from
`loamy_partner_commission_event`. Cause not yet established. **Investigated
next; no sleeps, no weakened assertions.**

### WS10 — Copilot
`src/lib/copilot/` has `engine`, `retrieval`, `analysis`, `conversations`,
`language`, `llm/`, `stt/`. An LLM adapter directory exists — contract needs
verifying rather than creating. Flag is OFF.

### WS11 — External provider boundaries
Only `src/lib/providers/kyc.ts` and `payments.ts` exist. **Missing:**
`FinancingProvider`, `WeatherProvider`, `Maps/GeoProvider`, `MessagingProvider`,
`LLMProvider` as explicit interfaces. `WeatherPanel.tsx` calls weather directly.
**Blocker: none — pure TypeScript, no migration.**

### WS12 — API configuration contract
`docs/external-integration-contract.md` does not exist. **Blocker: none.**

---

## 6. Cross-cutting

**Error handling.** 72 `instanceof Error` sites across 39 files. The
PostgrestError blind spot fixed in slice 2 is still live in `escrow.ts:90`,
`payments.ts:54`, `wallet.ts:144`, and across the processor pages. Not all
should change — many wrap non-Supabase calls.

**Query hygiene.** 127 `select('*')`. Not all are risky; the client-facing
production paths matter. PostgREST caps an unranged `select()` at 1000 rows,
so any list without `.range()` is silently truncated.

**Privacy.** No `bvn` or `nin` column exists anywhere — re-verified against the
live column list this sprint. Bank isolation, GP anonymity, server-derived
actor identity and k-anonymity are all backed by existing security tests.

---

## 7. Execution order

Dependency order, cheapest-unblocking first:

1. **WS9** test isolation — no DDL; a dirty suite makes every later result
   ambiguous.
2. **WS11/WS12** provider boundaries + integration contract — no DDL, and WS12
   is a named deliverable.
3. **WS1** verification rewiring — no DDL; unblocks the spine.
4. **WS2** logistics award + loading — no DDL; unblocks the spine.
5. **WS4** settlement initiation — no DDL.
6. **WS8** delete dead wallet UI; fee audit — no DDL.
7. **WS5/WS7** intelligence + review reply surfaces — no DDL.
8. **WS3** warehouse — **needs a migration**, queued behind the slice 3 push.
9. **WS6** trace browser QA — needs the migration for full-spine coverage.

Items 8–9, plus every browser QA and security run that depends on slice 3,
cannot complete until the pending migration is authorised.
