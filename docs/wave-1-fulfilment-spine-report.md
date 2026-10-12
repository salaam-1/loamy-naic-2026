# Wave 1 — Fulfilment Spine

**Date:** 2026-09-22. **Status: CLOSED.** All twelve acceptance criteria met.

The four closeout items raised after the first draft are resolved —
non-custodial money, partial sale, the carrier workflow and harness integrity.
§G2 has the defect, root cause, fix and regression test for each; §G3 has the
final gates and what is deliberately deferred.

---

## The finding that mattered

The audit blamed the UI for the unreachable spine. The UI was only half of it.

**Three views filtered on `company_id`.** `transport_jobs` and
`warehouse_reservations` were generalised in Phase 9 to belong to *either* an
RFQ award *or* a transaction. The views were not. Each still read
`... company_id in (select loamy_user_company_ids())`, and a
transaction-linked row has `company_id = NULL`. In SQL `NULL in (...)` is
NULL, not false — so those rows were filtered out **silently**:

- `loamy_open_transport_jobs` — a carrier **never** saw a marketplace purchase
  needing haulage. A buyer could request transport and no offer could ever
  arrive.
- `loamy_transport_offers_v` — a buyer could not see offers on their own job,
  so `loamy_select_transport_offer` had no caller *and no way to get one*.
- `loamy_warehouse_reservations_v` — a facility never saw a purchase storage
  request, so `loamy_request_storage` was writing into a table nobody read.

No amount of UI work would have fixed any of that.

**And `loamy_suggest_warehouses` had never executed successfully — not once.**
It referenced three columns that do not exist: `transactions.origin_state`,
`service_directory.verified`, `service_directory.active`. plpgsql resolves
column references at run time, so nothing caught it, and nothing called it
successfully to notice.

---

## A. Previously zero-caller functions → new UI entry points

| Function | Entry point | Actor |
|---|---|---|
| `loamy_record_loading` | [LoadingCard.tsx](../src/components/fulfilment/LoadingCard.tsx) on `/purchase/:txnId` | Seller |
| `loamy_select_transport_offer` | [TransportCard.tsx](../src/components/fulfilment/TransportCard.tsx) | Buyer |
| `loamy_logistics_transition` | [TransportBoard.tsx](../src/pages/supplier/TransportBoard.tsx) | Carrier |
| `loamy_request_storage` | [StorageCard.tsx](../src/components/fulfilment/StorageCard.tsx) | Buyer/seller |
| `loamy_respond_storage` | [WarehouseInbox.tsx](../src/pages/supplier/WarehouseInbox.tsx) | Facility owner |
| `loamy_record_warehouse_receipt` | WarehouseInbox "Sign goods in" | Facility owner |
| `loamy_record_supplier_settlement` | [SettlementPanel.tsx](../src/pages/bank/SettlementPanel.tsx) | Bank officer |
| `loamy_accept_task` / `loamy_decline_task` | [TaskDetail.tsx](../src/pages/partner/TaskDetail.tsx) | Growth Partner |
| `loamy_suggest_warehouses` | StorageCard (was called, but **always failed**) | Buyer/seller |
| `loamy_transaction_fulfilment` *(new)* | [FulfilmentPanel.tsx](../src/components/fulfilment/FulfilmentPanel.tsx) | Buyer/seller |

**Deprecated path retired:** `loamy_claim_verification_task` (Stage 4) has no
production caller. `VerificationTasks.tsx` now claims through Block 5's
`loamy_claim_task`.

## B. Lifecycle transitions now enabled

`not_started → loading_scheduled → loading_started → loaded` (seller) →
transport requested → offers → **exclusive award** → `loading → loaded →
departed → in_transit → arrived → delivered` (carrier) → `received` (buyer
confirms — deliberately a *separate* claim from the carrier's) → storage
requested → accepted → receipt → settlement.

Transport is gated on loading by the server, not by the UI:
`loamy_request_transport_for_transaction` refuses while `fulfilment_state` is
`not_started`.

## C. Migrations added

| Migration | What |
|---|---|
| `20260922100001_..._wave1_fulfilment_spine` | `loamy_transaction_origin_state`; the three views widened; `loamy_transaction_fulfilment` |
| `20260922100002_..._wave1_column_corrections` | `service_directory.verified`/`active` → `verification_status`; `shipment_events.occurred_at` |
| `20260922100003_..._wave1_logistics_mirror_guard` | The carrier deadlock (see below) |
| `20260922100004_..._bundle_event_detail_leak` | **Security fix** (see E) |
| `20260922110001_..._close_custodial_wallet` | **P0** — wallet/withdrawals closed; `loamy_record_escrow_release` |
| `20260922120001_..._partial_sale_batch_state` | `sold` only at zero, `partially_sold` otherwise |

### Two defects found by walking the spine, which nothing had done before

**A carrier could get permanently stuck.** `loamy_logistics_transition`
mirrors the job move onto the transaction. The mirror was unguarded, so when
the seller had *already* recorded loading complete, the carrier's `loaded`
event raised — taking down the whole call, including the valid job
transition. `departed` is only allowed from `loaded`/`picked_up`, so the
carrier could never depart. **The purchase was stuck for good.** Each mirror
is now best-effort: a mirror already in the target state is not an error. The
transaction machine was not loosened and no transition was added.

**A partially-sold batch could not be signed into a warehouse.** Deferred at
the time, **FIXED in the closeout round** — and the root cause turned out to
be the opposite of the symptom. See §G2.2.

## D. Files changed

New: `src/lib/fulfilment.ts`, `src/components/fulfilment/{FulfilmentPanel,
LoadingCard,TransportCard,StorageCard,DeliveryCard}.tsx`,
`src/pages/bank/SettlementPanel.tsx`, `scripts/visual-qa-fulfilment.mjs`,
`tests/unit/fulfilment.test.ts`, `tests/security/wave1-fulfilment-spine.test.ts`.

Changed: `PurchaseDetail.tsx` (panel replaces a "next step" card that could
only request transport, and a warehouse list with no way to ask for space),
`WarehouseInbox.tsx`, `TransportBoard.tsx`, `TaskDetail.tsx`,
`VerificationTasks.tsx`, `BankApplicationDetail.tsx`, `src/lib/logistics.ts`,
`src/lib/bank.ts`.

No new table. No second logistics, storage, order or delivery model. Same
tables, same statuses, same transition rules — one more authorisation branch
each, exactly as `20260920130005` did for the functions.

## E. Security / RLS

`tests/security/wave1-fulfilment-spine.test.ts` — **41 tests, all passing.**
Negative cases throughout: a stranger recording loading, a party quoting on
their own freight, a non-carrier quoting, a losing carrier moving the job, a
buyer awarding twice, a requester accepting their own storage request, a buyer
signing goods in at someone else's warehouse, an unrelated member reading a
reservation, a signed-out visitor.

**Widening a view is widening access**, so each new branch names a party to
the row. A carrier still cannot see a rival's quote — asserted.

### A real leak, found and fixed

`loamy_application_bundle` **leaked the seller's internal user id** to the
bank. Slice 3 added the financing event trail and returned
`financing_events.detail` verbatim; that column is an internal record, and
`loamy_apply_financing_for_transaction` writes `'seller', v_t.seller_id` into
it.

It was caught by slice 3's own test "exposes no internal user id" — which had
been **passing vacuously** because that suite's setup was failing silently on
a wrong column name (`quantity` for `quantity_kg`), skipping all 55 tests.
**Two defects hiding each other.** Both fixed; the trail now returns named
fields only, because whitelisting keys in a shared blob would break again.

## F. Browser QA

`scripts/visual-qa-fulfilment.mjs`, real Chrome, live database, 390/768/1440.
**39/39 in a single clean run** after the closeout fixes (was 34/39). See
§G2.3 and §G3.

**Verified in-browser:** the panel renders for both parties at all three
widths with no overflow and no sub-32px targets; the buyer is told whose move
it is; the buyer is *not* offered the seller's actions; the seller schedules,
starts and confirms loading; evidence gaps are shown **to both sides**; the
buyer arranges transport; warehouse suggestions resolve (for the first time
ever); a storage request is sent and reads "Awaiting the facility", never
"booked"; the **warehouse sees the purchase request, marked as a purchase, and
accepts it**.

**The carrier board was NOT the problem** — see §G2.3. It renders marketplace
freight correctly; the harness was blaming it for its own swallowed timeouts.
The full carrier journey is now verified in-browser.

## G2. Closeout round — the four items raised after the first report

### 1. Non-custodial money model (P0)

**Original defect.** A `wallet_entries` row written by the live product on
2026-09-21: `kind: 'order_settlement'`, "Marketplace order … released by the
buyer".

**Root cause.** The custodial wallet MODULE was deleted in the completion
sprint; four DEPLOYED EDGE FUNCTIONS still wrote the TABLE, and a grep of
`src/` cannot see them:

| Function | Wrote | Reachable from |
|---|---|---|
| `paystack-payout` | `order_settlement` | `/orders` → "Confirm receipt & release" |
| `escrow-release` | `escrow_release` | processor RFQ escrow |
| `wallet-withdraw` | `withdrawal_reversal` | direct invoke |
| `paystack-webhook` | `withdrawal_reversal` | Paystack callback |

**Exact fix.**

1. `20260922110001` — a BEFORE trigger on `wallet_entries` and
   `wallet_withdrawals` refusing INSERT, UPDATE and DELETE. A trigger, not an
   RLS policy, because **service_role does not bypass a trigger** and all four
   writers ran as service_role. Repointing the functions alone would not have
   been an invariant: they are deployed artefacts, they can be rolled back,
   and a fifth writer can appear.
2. `loamy_record_escrow_release` — the non-custodial replacement. Posts a
   memorandum pair across `partner_funding` / `external_settlement`.
   Service-role only: a member must never declare their own escrow released.
3. `escrow-release` repointed at it.
4. `paystack-payout` and `wallet-withdraw` **retired** — they return 410 with
   an explanation rather than 404, so a stale caller gets an answer. Retired
   rather than repointed: `paystack-payout` settles an ORDER, and repointing
   it would keep the deprecated model alive at the moment it should end.
5. `paystack-webhook` acknowledges `transfer.*` events and writes an
   `audit_events` row instead of a reversal credit, so a straggler is visible
   to whoever reconciles it rather than silently discarded.
6. `/orders` is now **history only** — every lifecycle action removed, with a
   banner explaining why. The page stays because members are entitled to see
   what they did.

**No historical row was deleted.** All are readable; UPDATE and DELETE are
blocked, because an audit record that can be edited is not one.

**Regression test.** `tests/security/non-custodial-money.test.ts` — 15 tests:
the table refuses writes from a member AND from an admin; withdrawals refused;
history intact and readable; the real purchase lifecycle (loading → transport)
creates no entry; every ledger group balances; memorandum accounts stay
unowned.

**phase6and7 fixed.** Its assertion was `count === 0`. Emptiness was only ever
a *proxy* for "nothing writes it", and it stopped being valid the moment a row
appeared. Deleting the row would have made it green and changed nothing. It
now asserts the invariant directly — a write is refused and the count does not
move — plus a second test that history is still readable. Strictly stronger.

> **A `member_receivable` balance is not custody.** It is a double-entry
> position recording what is owed once an institution settles. My first draft
> of this test forbade any owned account holding value, which would have
> outlawed ordinary accounting. The custodial line is a *withdrawable*
> balance, and both tables that could represent one now refuse every write.

### 2. Partial sale → warehouse

**Original defect.** A warehouse receipt was refused for a 12t sale from a
100t batch.

**Root cause — the opposite of what it looked like.**
`loamy_transaction_transition` fired the batch event `'sold'` on *every*
completed transaction, unconditionally. So completing a 12t purchase against a
100t batch marked the **whole batch sold** with 88t still available: the
seller's remaining stock silently became unsellable and the trace said the
batch was gone when it was not.

`partially_sold` has existed since Phase 2, and `20260919220001` already
widened every rule for it. Every piece was in place. **Nothing ever fired the
event.**

**Authoritative representation** (unchanged by the fix): `quantity` as
harvested, never mutates · `available_quantity` what is left · committed =
the difference, derived not stored · status `sold` only at zero.

**Exact fix.** `20260922120001` — one decision in the completion branch, on
the quantity actually left. No new column, no new state, no rule change, no
quantity written.

> I first rewrote the function from a partial view of it and **diffed before
> applying**. My reproduction would have changed the signature and dropped
> three authorisation checks — "not signed in", "not your transaction", and
> the `platform` initiator branch. It was rebuilt from the original body with
> exactly one branch changed.

**Regression test.** `tests/security/partial-sale-batch.test.ts` — 13 tests:
100t → 12t sale → `partially_sold` with 88 left; a second 20t sale from the
same batch; quantity never mutates; both sales on the SAME batch; exhaustion →
`sold`; over-sale refused **at commitment**; the batch state a sale leaves is
one `warehouse_received` accepts; trace still resolves and every sale left its
own event.

> Over-sale is refused at ACCEPTANCE, not at proposal. That is deliberate:
> refusing at proposal would let the first buyer to click hold an option over
> stock they have not paid for. What must never succeed is the commitment.

### 3. Carrier browser workflow

**Original defect.** The authenticated carrier appeared to land on the public
home instead of the carrier board.

**Root cause: there was no redirect.** Tracing auth → role → guard → shell
showed the URL was correct, the profile role correct, `processor_procurement`
true, and `TransportBoard` rendering — with three marketplace jobs, "Maize ·
12 tonne", "Benue → Makurdi depot" and "Submit offer" buttons.

**The defect was in my QA harness**, not the product. Every wait used
`.catch(() => {})`, swallowing its own timeout and carrying on into a broken
state — so one slow step reported itself as five unrelated failures further
down and the run blamed the wrong component. **The same vacuous-green pattern
the security suite was being audited for.**

**Exact fix.** A `settled()` helper that throws a named error instead of
swallowing; waits on actual content rather than fixed sleeps; row-scoped
locators instead of `.first()` on a shared board; cached accounts so signups
stop hitting the auth rate limit.

**Result.** A **38/39** run with the complete carrier journey green: carrier
sees marketplace freight → submits an offer → buyer sees it → buyer awards →
warehouse sees the storage request → accepts. The panel renders at 390/768/
1440 with no overflow and no sub-32px targets. The single flag was the harness
matching "Loaded" before the evidence flags rendered; that wait is now
specific.

### 4. Test-harness integrity

**Original defect.** `quantity` vs `quantity_kg` made a `beforeAll` fail
silently, skipping 55 slice-3 tests — among them "exposes no internal user
id", which would have caught a real leak.

**Root cause.** Two patterns. `adminClient()` returns null by design so admin
tests skip rather than false-fail, which means ~150 `if (!admin) return` sites
pass vacuously if admin sign-in ever fails. And fixture guards like
`if (!earningId) return` skip when setup failed.

**Exact fix.**
- `tests/security/preflight.test.ts` — the skip stays, but it can no longer be
  silent: if the admin fixture cannot sign in, is not actually an admin, or
  `makeUser` is broken, **this fails** and the run is red however many tests
  skipped themselves. It also asserts the anon client really is signed out.
- Fixture guards converted to assertions in `block5-gp-security` (3),
  `checkout-transaction-spine`, `fee-immutability`, `block2-trace-explorer`.
- Setup steps in `wave1-fulfilment-spine`, `slice3-bank-decision`,
  `partial-sale-batch` and `non-custodial-money` now throw a named error.

**No test was weakened.** Assertions were added; none removed.

**Slice 3 re-run: 144/144** across preflight, block5-gp-security, checkout
spine, fee-immutability, block2 trace and slice 3 itself.

---

## G3. Final gates and acceptance

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | **30 files, 735 tests** |
| `npm run test:security` | **31 files, 824 tests, all passing** |
| `npm run build` | built in 50.5s |
| `phase6and7` | passing |
| Slice 3 security suite | 144/144 (with preflight + neighbours) |
| Wave 1 browser QA @ 390/768/1440 | **39/39** |
| Carrier browser QA | included above, green |
| Warehouse partial-sale QA | `partial-sale-batch.test.ts` 13/13 |

That security run is the first fully clean one this session: 824 tests, no
failures, **no silently-skipped files**.

### Acceptance

| | Criterion | |
|---|---|---|
| ✅ | no production code writes `wallet_entries` | trigger + four functions repointed/retired |
| ✅ | current transaction lifecycle is non-custodial | asserted end to end |
| ✅ | `phase6and7` passes | assertion corrected to the real invariant |
| ✅ | partial-sale warehouse flow works | 13 regression tests |
| ✅ | carrier browser workflow works | 39/39 run |
| ✅ | verification has no Stage 4 production callers | grep clean |
| ✅ | nine zero-caller functions have UI entry points | §A |
| ✅ | security suite passes | 824/824 |
| ✅ | setup failures cannot silently produce green tests | preflight + assertions |
| ✅ | `tsc` passes | |
| ✅ | `build` passes | |
| ✅ | browser QA at 390/768/1440 | |

### Deliberately deferred

1. **The browser QA is timing-sensitive.** It drives a six-actor chain against
   a live remote database and a rate-limited auth service. It now fails fast
   with a named step instead of cascading, and retries sign-in — but a run can
   still abort on a transient. The 39/39 above is a real single clean run, not
   an aggregate; re-running is occasionally necessary. Running it against a
   dedicated staging project would remove this, and that is the standing
   recommendation.
2. **`/orders` remains readable.** Deliberate: members are entitled to their
   history. No lifecycle action remains on it.
3. **Over-sale is refused at acceptance, not proposal.** A design choice, not
   a gap — see §G2.2.
4. **Four intelligence functions, `loamy_request_listing_verification`,
   `loamy_open_dispute` and `loamy_my_verification_cases`** still have no UI.
   Outside Wave 1 scope.
5. **`escrow-release` now posts to the ledger but has not been exercised
   end-to-end in this round** — the processor RFQ escrow path was not part of
   Wave 1's spine. Its unit of change is small and the function it calls is
   covered, but a full RFQ escrow walk is worth doing in Wave 2.

## H. External provider integrations — the only remaining production work

Unchanged by this wave, and still the honest answer: **financing provider,
payment provider, KYC provider, messaging provider, LLM provider** — plus
commercial terms for weather and map tiles. Every adapter boundary exists
(`src/lib/providers/`); no adapter is registered; no sandbox fabricates a
decision. Full detail in `docs/external-integration-contract.md` §8.

Nothing in the fulfilment spine needs an external provider to function.
Loading, transport, storage and delivery are Loamy's own data. Only
**settlement** touches a provider, and it remains a *record* of what the
institution did, posted as a memorandum pair across `partner_funding` and
`external_settlement` — never a member balance.

---
