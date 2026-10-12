# Loamy — platform completion sprint report

**Date:** 2026-09-21. **Status: PARTIAL. This sprint is not complete, and the
acceptance criteria are not met.** What was done is below; what was not, and
why, is in §8–§12.

Companion documents: `docs/platform-completion-inventory.md` (the re-audit),
`docs/external-integration-contract.md` (the API contract).

---

## 0. Two things that need a decision before anything else

### (a) Growth Partners are currently earning nothing for farm verifications

`FEE-000022` — the seeded ₦2,500 `verification_commission` rule for
`farm_verification` — was **ended in production at 2026-09-21 11:30:55**
(`active: false`, `effective_to` set, `created_by: null`, no audit event).
That signature matches a direct admin table update, which is what
[`AdminFees.tsx:161`](../src/pages/admin/AdminFees.tsx#L161) performs.

Consequence today: `loamy_accrue_commission` returns
`{"reason":"no_commission_rule"}` for every approved farm verification. **A
Growth Partner who completes approved field work accrues nothing.** The other
five seeded commission rules are intact.

This was found as the root cause of the block6 test failures (§1), but it is a
live product defect, not test debt.

**I have not fixed it.** Inserting a fee rule causes real payouts to real
partners — an outward-facing, money-affecting production change that is your
call, not mine. The remedy is one insert:

```sql
insert into public.fee_schedules (scope, transaction_type, basis, value, payer, note)
values ('verification_commission', 'farm_verification', 'flat', 2500, 'loamy',
        'Restores the Block 5 default ended in error on 2026-09-21.');
```

Confirm ₦2,500 is still the intended rate before running it.

### (b) The slice 3 migration is still not applied

`20260921140001_loamy_slice3_bank_decision_lifecycle.sql` remains the single
pending migration. `npx supabase db push --linked` is refused by this session's
production-deploy policy. Until it is applied, the bank decision lifecycle
built in slice 3 cannot be exercised, and every workstream needing DDL is
queued behind it.

---

## 1. Capabilities completed

### WS9 — referrals/commissions test isolation: **root-caused and fixed**

The intermittency is explained. It was never concurrency (the suite is
`fileParallelism: false`, `singleThread: true`) and never DNS.

**Cause:** `fee_schedules` is global, mutable state with no restore path.
Ending a rule takes effect immediately for every member, and nothing puts it
back. When `FEE-000022` was ended, `loamy_accrue_commission` stopped accruing,
`partner_earnings` had no row, `earningId` stayed `''`, and **five downstream
tests failed with `Cannot read properties of null`** — three tests away from
the cause, in a file about referrals.

**Fixes, none of which weaken an assertion or add a sleep:**

1. Every RPC in the verification chain is now asserted individually. It used
   to `await` five calls without checking any, which is why the symptom
   surfaced so far from the cause.
2. Reads that used `.single()` on a possibly-absent row now use
   `.maybeSingle()` and throw a message naming the accrual refusal reason,
   the task state and the remedy.
3. The three `loamy_commission_transition` call sites now assert `error`
   first, so an RPC failure reports `invalid input syntax for type uuid: ""`
   rather than a TypeError.
4. A new `describe('0 — the commission rule a Growth Partner is paid from
   exists')` asserts all six seeded commission rates resolve, **before** the
   tests that depend on them. It currently fails on exactly one —
   `farm_verification` — and says what to do about it.

Verified: the invariant test names the one broken rule and passes the other
five.

### WS11 — external provider boundaries: **complete**

| Seam | File | Ships today |
|---|---|---|
| Financing | `providers/financing.ts` **new** | none registered |
| Weather | `providers/weather.ts` **new** | Open-Meteo, live |
| Geo/Maps | `providers/geo.ts` **new** | OpenStreetMap tiles, live |
| Messaging | `providers/messaging.ts` **new** | none registered |
| Shared types | `providers/types.ts` **new** | — |
| Registry | `providers/index.ts` **new** | — |
| Payment | `providers/payments.ts` (existed) | none registered |
| KYC | `providers/kyc.ts` (existed) | none registered |
| LLM | `copilot/llm/adapter.ts` (existed) | deterministic template |

`src/lib/weather.ts` now delegates to the provider instead of calling
Open-Meteo directly; its public API is unchanged.

**The rule the sandbox adapters hold:** they simulate *transport*, never
*judgement*. `sandboxFinancingProvider.getApplicationStatus()` returns
`in_review` forever and **never returns a decision** — a simulated approval is
a fabricated credit decision. Every reference is `SANDBOX-` prefixed. A
simulated event is always `verified: false`, so it cannot change authoritative
state. 33 unit tests assert this, most of them negative.

### WS12 — API configuration contract: **complete**

`docs/external-integration-contract.md`. Every operation is derived from
Loamy's lifecycle, not from a vendor's API. Covers request/response shape,
error mapping, idempotency, retry and timeout semantics, webhooks, audit,
sandbox behaviour, required credentials, and what is still unknown for each
provider. §8 lists the ten remaining integration items — **none of which
requires a domain model change.**

### WS8 — partial: the custodial wallet is gone

`src/lib/wallet.ts` and `src/pages/shared/Wallet.tsx` **deleted**. Both were
already unreferenced, but they exported `fetchWalletBalance()` and
`requestWithdrawal()` — dead code that still compiles is code someone can
import. A unit test asserts the module no longer resolves.

### Privacy correction

`src/lib/providers/kyc.ts` claimed "the reserved `profiles.bvn_encrypted` /
`nin_encrypted` columns exist". **They do not** — probes return `42703` for
all four spellings; only `bvn_verified`, `nin_verified` and an opaque
`kyc_reference` exist. A stale claim that sensitive columns exist is its own
hazard: it invites someone to use them. Corrected in `kyc.ts` and
`docs/security.md`.

---

## 2. Reachability gaps closed

**One, indirectly** (the commission invariant is now enforced rather than
assumed). **The 17 identified in the inventory remain open** — see §8.

---

## 3. Authoritative models used

No new model was introduced. No new table, no new transaction/order/deal/
money concept. The provider layer is pure TypeScript with no persistence: it
holds no state, writes nothing, and every adapter result must pass through an
existing authoritative RPC before it can change anything.

---

## 4. Migrations added

**None in this sprint.** `20260921140001` from slice 3 remains pending.

---

## 5. Security changes

None. No RLS policy, grant or security-definer function was altered. The
provider layer deliberately has no database access.

Re-verified: no `bvn`/`nin` value column exists anywhere; bank isolation, GP
anonymity, server-derived actor identity and k-anonymity are unchanged.

---

## 6. Test results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean** |
| `npx vitest run` | **28 files, 677 tests, all passed** (was 644; +33) |
| `npx vite build` | **built in 56.2s** |
| `npm run test:security` | **not run this sprint** |
| Browser QA | **not run this sprint** |

New: `tests/unit/providers.test.ts` (33). Rewritten:
`tests/security/block6-referrals-commission.test.ts`.

---

## 7. Remaining test-isolation issues

`block6` will keep failing until the `farm_verification` commission rule is
restored (§0a). That is now a **correct** failure with an accurate message,
not an unexplained one.

The wider hazard stands and is **not** fixed: `fee_schedules` is global mutable
state, ending a rule is irreversible through the UI, and
`hardening-pass.test.ts` still inserts live rules mid-suite (it does clean them
up by note). Any test depending on ambient fee state can be broken by any
other actor. The structural fix — a restore path, or test-scoped fee rules —
was not attempted here.

---

## 8. NOT DONE — workstreams 1 to 7

These were not started beyond the audit. I am not going to describe them as
partially delivered.

| WS | What remains | Needs a migration? |
|---|---|---|
| 1 Verification | Rewire the app off the deprecated Stage 4 `loamy_claim_verification_task` onto Block 5; surface `loamy_submit_verification_case`, `loamy_my_verification_cases`, `loamy_accept_task`, `loamy_decline_task`, `loamy_request_listing_verification`, `loamy_open_dispute` | No |
| 2 Logistics | `loamy_award_transport` and `loamy_record_loading` have **zero callers** — offers can be made and never accepted | No |
| 3 Warehouse | `loamy_suggest_warehouses` broken (`42703`); resolve origin via transaction→listing→batch→farm; wire `loamy_request_storage`, `loamy_record_warehouse_receipt` | **Yes** |
| 4 Settlement | `loamy_settle_supplier_direct` has zero callers — settlement is observable but not initiable | No |
| 5 Intelligence | 4 functions unreachable; `reports` is a placeholder for 6 roles | No |
| 6 Traceability | Trace depth + the exists-but-invisible vs does-not-exist distinction unverified in a browser | No |
| 7 Marketplace | `loamy_respond_to_review` unreachable; `saved` and `my-business` placeholders | No |

**The largest finding of the audit stands: the backend is substantially more
complete than the product.** Verification, settlement, loading, transport
award and the entire warehouse path have authoritative implementations with no
UI caller.

---

## 9. External APIs still required

Per the integration contract: financing provider (none selected), payment
provider (Paystack public key present, secret/webhook not configured), KYC
provider (none selected, and blocked behind a security gate), messaging
provider (none selected), LLM provider (none selected). Weather and map tiles
are live but on non-commercial terms.

## 10. Credentials / configuration still required

Bank client id + secret, base URLs, webhook endpoint + signing secret;
Paystack secret key + webhook secret; licensed weather subscription;
commercial map tile key; messaging sender id + approved templates; LLM backend
proxy + key. Full table in `external-integration-contract.md` §8.

## 11. Provider endpoints still unknown

Bank authentication scheme; push-vs-poll for decisions; the bank's own status
vocabulary; whether it accepts a structured application or a document pack;
supplier-direct settlement mechanics and value-date semantics; document
requirement codes; rate limits. Paystack split-payment mechanics for the
Phase 5 split-payer model, **which has no schema support yet**.

---

## 12. MUST NOT be considered production-ready

1. **Growth Partner commissions.** Farm verification pays nothing right now
   (§0a).
2. **The bank decision lifecycle.** Code complete, migration unapplied,
   security suite and browser QA never run against it.
3. **Verification, logistics award, loading, warehouse, settlement.** No UI
   caller. The spine breaks after financing.
4. **Every external provider.** Nothing is connected. No adapter is
   registered. `providerStatus()` reports the truth.
5. **Weather and map tiles.** Working, but on non-commercial terms.
6. **Phase 5 fee model.** Split-payer ratio absent from schema; checkout
   charges `split` entirely to the buyer.
7. **`fee_schedules` operational safety.** Global, irreversible from the UI,
   and demonstrated this sprint to silently break a payout path.
8. **The test suite as a whole.** Not run end to end this sprint.

---

## 13. Capability status table

`Backend` = authoritative implementation exists. `UI` = an appropriate user
can initiate it through the application. `Sandbox` = n/a means no external
provider is involved.

| Capability | Backend | UI | RLS | Tests | Browser QA | Sandbox | External API | Status |
|---|---|---|---|---|---|---|---|---|
| Listings / marketplace | yes | yes | yes | yes | yes | n/a | no | **complete** |
| Commodity detail | yes | yes | yes | yes | yes | n/a | no | **complete** |
| Seller profile `/u/:username` | yes | yes | yes | yes | yes | n/a | no | **complete** |
| Cart | yes | yes | yes | yes | yes | n/a | no | **complete** |
| Checkout → transaction | yes | yes | yes | yes | yes | n/a | no | **complete** |
| Fee snapshot at proposal | yes | yes | yes | yes | partial | n/a | no | **complete** |
| Financing application | yes | yes | yes | yes | no | n/a | no | **complete** |
| Bank decision lifecycle | yes | yes | yes | written | no | n/a | no | **blocked — migration pending** |
| Verification (Block 5) | yes | **no** | yes | yes | no | n/a | no | **gap — app uses deprecated path** |
| Disputes | yes | **no** | yes | partial | no | n/a | no | **gap** |
| Transport request / offer | yes | yes | yes | partial | no | n/a | no | partial |
| Transport award | yes | **no** | yes | no | no | n/a | no | **gap — 0 callers** |
| Loading record | yes | **no** | yes | no | no | n/a | no | **gap — 0 callers** |
| Warehouse suggestion | **broken** | yes | yes | no | no | n/a | no | **broken — 42703** |
| Storage request | yes | **no** | yes | no | no | n/a | no | **gap — 0 callers** |
| Warehouse receipt | yes | **no** | yes | no | no | n/a | no | **gap — 0 callers** |
| Settlement (supplier-direct) | yes | **no** | yes | yes | no | yes | **required** | **gap — 0 callers** |
| Ledger / financial activity | yes | yes | yes | yes | no | n/a | no | **complete** |
| Custodial wallet | removed | removed | n/a | yes | n/a | n/a | n/a | **removed** |
| Traceability | yes | yes | yes | yes | partial | n/a | no | partial |
| Intelligence (market) | yes | yes | yes | yes | no | n/a | no | partial |
| Intelligence (bank / seller / prefs) | yes | **no** | yes | yes | no | n/a | no | **gap** |
| Reviews | yes | yes | yes | yes | no | n/a | no | partial |
| Review replies | yes | **no** | yes | no | no | n/a | no | **gap** |
| Referrals / commissions | yes | yes | yes | yes | no | n/a | no | **live defect — see §0a** |
| Copilot | yes | yes | yes | yes | no | yes | optional | flag off |
| Financing provider | n/a | n/a | n/a | yes | n/a | yes | **required** | **seam only** |
| Payment provider | n/a | n/a | n/a | no | n/a | no | **required** | **seam only** |
| KYC provider | n/a | n/a | n/a | no | n/a | no | **required** | **seam only, gated** |
| Weather provider | yes | yes | n/a | yes | no | no | live, non-commercial | **needs licence** |
| Geo / map provider | yes | yes | n/a | yes | no | no | live, non-commercial | **needs licence** |
| Messaging provider | n/a | **no** | n/a | yes | n/a | yes | **required** | **seam only** |
| LLM provider | n/a | n/a | n/a | partial | n/a | yes | optional | **seam only** |

---

## 14. Acceptance criteria

| | Criterion | Met |
|---|---|---|
| A | Every launch-critical capability has a reachable UI workflow | **NO** — §8 |
| B | Every workflow terminates in the authoritative model | partial |
| C | No duplicate transaction/order/deal/money model introduced | **YES** |
| D | Every sensitive operation is server-authorized | **YES** |
| E | External providers have explicit adapter boundaries | **YES** |
| F | Sandbox adapters exist where needed | **YES** |
| G | No provider falsely represented as live | **YES** |
| H | Browser QA covers the golden paths | **NO** |
| I | Security tests cover cross-role/user/bank | existing only |
| J | Suite green, or failures understood and documented | **YES — understood** |
| K | `tsc` passes | **YES** |
| L | `build` passes | **YES** |
| M | Integration contract identifies remaining API work | **YES** |

**Six of thirteen met. A and H are not, and B and I only partly.** The sprint
delivered its three documents, the provider layer, the test-isolation
root-cause fix and the wallet removal. The seven reachability workstreams that
would make Loamy functionally complete were not implemented.

Recommended next step, in dependency order: restore the commission rule (§0a),
apply the pending migration (§0b), then WS1, WS2 and WS4 — none of which needs
further DDL.
