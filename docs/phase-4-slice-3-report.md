# Phase 4 — Slice 3: bank financing decision lifecycle

**Status: implementation complete. BLOCKED on one step — the migration has not
been applied.** See §9. Everything that does not require the database is
finished and green; the database-dependent gates cannot run until the
migration lands.

Companion document: `docs/phase-4-slice-3-financing-lifecycle.md` — the §1
forensic read, written before any code changed.

---

## 1. The finding

`loamy_financing_decision` has existed since Phase 6, carries approve, reject,
amount, tenor, pricing, bank reference, expiry and provenance — and had
**zero callers in `src/`**. The portal called `loamy_bank_set_status`, which
accepts only `under_review`, `info_requested` and `decided_external`.

A bank officer could not approve or decline anything through Loamy. Confirmed
by grep and by driving the live database as a real officer.

Three further defects made an approve button useless even once wired:

1. **`loamy_financing_select_bank` listed the four Stage 5 statuses.** Approve,
   and the row fails the `using` clause — the application vanishes from its own
   bank.
2. **`loamy_bank_pipeline` carried the identical filter**, so a decided
   application dropped out of the queue.
3. **`loamy_application_bundle` predates Phase 6.** Verified live, it returns
   no `ref`, no transaction context, no `approved_amount`, `tenor_days`,
   `pricing_note`, `bank_reference`, `decision_source`, `is_sandbox`,
   `expires_at`, `conditions` or `decided_at`. Since officers have no raw table
   access, the portal could not display the provenance or the sandbox warning
   even if it wanted to.

And a fourth, found while writing the status map: **three separate status maps
covering 4, 5 and ~9 of the 13 statuses the database permits.** A farmer whose
application was approved or declined saw an undefined chip on their own
dashboard.

---

## 2. Files changed

| File | Change |
|---|---|
| `supabase/migrations/20260921140001_…_bank_decision_lifecycle.sql` | **new**, **NOT YET APPLIED** |
| `src/lib/financingLifecycle.ts` | **new** — one status/decision contract for every surface |
| `src/lib/bankDecision.ts` | **new** — the call onto the authoritative function |
| `src/pages/bank/DecisionPanel.tsx` | **new** — where an officer actually decides |
| `src/lib/bank.ts` | bundle + pipeline types extended; `BANK_STATUS_META` replaced by the shared map; stale header corrected |
| `src/lib/farming.ts` | `APPLICATION_STATUS_META` derived from the shared map instead of its own five-value copy |
| `src/lib/financing.ts` | `decisionLabel` completed: `partially_approved`, `completed`, `draft`, `decided_external` |
| `src/pages/bank/BankApplicationDetail.tsx` | decision panel, transaction context, recorded decision, decision trail; `loamy_bank_set_status` path removed |
| `src/pages/bank/BankPipeline.tsx` | full-lifecycle statuses, refs, approved amount, sandbox marker |
| `src/pages/bank/BankHome.tsx` | status chart built from statuses present, not a fixed four |
| `src/pages/bank/BankMonitoring.tsx` | "decided" now means answered, not only `decided_external` |
| `src/pages/bank/BankLoans.tsx` | a facility opens against an approved application, not only an external decision |
| `scripts/visual-qa-financing.mjs` | **new** — the §21 journey |
| `tests/unit/financing-lifecycle.test.ts` | **new** — 64 tests |
| `tests/components/decision-panel.test.tsx` | **new** — 27 tests |
| `tests/security/slice3-bank-decision.test.ts` | **new** — ~45 tests, needs the migration |

### Functions changed

- `loamy_financing_decision` — **one line added**: a `draft` cannot be decided.
  Everything else reproduced verbatim from `20260920130001`.
- `loamy_application_bundle` — extended (see §4).
- `loamy_bank_pipeline` — dropped and recreated with more columns and the full
  lifecycle.
- New SQL: `loamy_financing_permitted_decisions(text)`.
- New TS: `statusMeta`, `offeredDecisions`, `checkApprovalAmount`,
  `checkTenorDays`, `wouldBeSandbox`, `provenanceLabel`,
  `recordFinancingDecision`.

### Routes changed

None. `/bank/application/:appId` changed in behaviour only.

### Tables touched

No table created, dropped or renamed. No column added. Reads and writes go
through `financing_applications`, `financing_events`, `banks`, `transactions`,
`profiles` — all via existing security-definer functions.

---

## 3. The lifecycle implemented

Enforcement stays in `loamy_financing_decision`. What is new is a single
server-side definition of which decisions may be **offered**:

| From | Offered |
|---|---|
| `submitted` | review · request information · approve · approve part · decline |
| `under_review` | request information · approve · approve part · decline |
| `info_requested` *(legacy)* / `additional_information_required` | return to review · approve · approve part · decline |
| `approved`, `partially_approved`, `rejected`, `decided_external` | nothing |
| `draft`, `disbursed`, `completed`, `cancelled`, `expired` | nothing |

`DecisionPanel` renders **exactly** that list and invents nothing — if the
server sends none, none are offered. So Approve cannot appear on an already
approved application, and the transition table cannot drift from the database.

The offer list is deliberately **narrower** than the guard, never wider. The
guard still permits a bank to correct a decision it already made; that is a
path a lender may legitimately need and it was not taken away. It is simply
not offered as a button.

---

## 4. The bank decision workflow

An officer opens `/bank/application/:id` and sees the application reference,
the transaction reference, the commodity, quantity, purchase total, seller
name and state, whether the stock is batch-backed or a declaration, the
requested amount, the risk classification, the farms, and the decision trail.

Actions: **Move to review · Request information · Approve · Approve part ·
Decline**, filtered by the server's list.

Approving collects **approved amount, tenor (days), pricing, your reference,
conditions** — the exact fields the authoritative function takes. A decline or
an information request requires a message, because a refusal without a reason
is useless to the applicant; the submit stays disabled until there is one.

**What is deliberately not sent:** the actor, the bank, the applicant, the
transaction, the status, the provenance. `loamy_financing_decision` derives
the officer from `auth.uid()` and the bank from `loamy_officer_bank()`, and
sets the status from the decision. `p_source` is fixed to `bank_officer` — a
portal button cannot claim to be a bank API or the admin-only simulator. A
component test asserts the absence of all thirteen forbidden keys from the
payload.

### Approval amount

No ladder, no tier, no preset. The field pre-fills with the amount **actually
requested** and accepts anything greater than zero and not greater than that —
the server's own two rules and no third. The ₦500,000 pilot cap was removed
from the check constraint in `20260919100001` and is not reintroduced. A test
asserts that no `₦100,000 / ₦250,000 / ₦500,000 / ₦1,000,000` picker exists.

Requested, approved and disbursed are displayed as three separate figures and
never merged.

---

## 5. Sandbox vs live

`banks.integration_mode` remains the authority and no bank is named anywhere.
Sterling appears in no code path — confirmed again this slice.

- **Before deciding**, an officer at a sandbox institution is told in the form
  that what they are about to record is test data, not a credit decision, and
  commits no funds. Not a footnote afterwards.
- **After deciding**, `provenanceLabel` renders "Produced by the Loamy sandbox
  adapter — sandbox simulation, not a real credit decision" wherever the result
  appears, and the pipeline row carries a `sandbox` marker.
- **The borrower** sees the sandbox wording on their purchase page, through
  `decisionLabel`, which already carried it.
- **An unknown integration mode is treated as sandbox, not live.** Tested
  explicitly — defaulting the unknown case to "live" is the dangerous
  direction.
- The server's existing guards are untouched: `sandbox_adapter` against a
  `live` bank raises, and `loamy_sandbox_bank_decision` stays admin-only.

---

## 6. Information request

Uses the existing mechanism, not a new one:
`loamy_financing_decision(p_decision => 'additional_information_required',
p_note => …)`, which persists the note on the row, writes an append-only
`financing_events` entry and notifies the applicant.

**A real improvement over the deprecated path:** `loamy_bank_set_status` sent
its `p_message` to a *notification only* and persisted nothing, so the
application itself carried no record of what had been asked. The security test
asserts the note is now on the row and visible to the applicant.

No parallel messaging system was created.

---

## 7. Security

The tests are written and cover every item in §17. They **have not been run** —
see §9.

Covered: buyer, seller, growth partner, unrelated member, anon and a
**different bank** all refused a decision; bank B cannot read, bundle or
mutate bank A's application, before or after the decision; the applicant
cannot write `status`, `approved_amount`, `decision_source`, `is_sandbox`,
`bank_id` or a changed `amount_requested`; an invented decision value or
provenance is refused; a never-submitted draft cannot be approved; one active
application per transaction holds, another bank is allowed after a rejection,
and not after an approval; the decision creates no second transaction; one
event per decision, with provenance and the sandbox flag on it; no internal
user id and no BVN/NIN in the bundle.

**RLS was widened in exactly one way and no other:** the bank's select policy
now covers every non-draft status instead of four. `bank_id =
loamy_officer_bank()` is unchanged, drafts stay invisible, and no policy was
added for any other role. That is a stale status list being corrected, not
access being broadened — and the cross-bank assertions are there to keep it
honest.

---

## 8. Quality gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean** |
| `npx vitest run` | **27 files, 644 tests, all passed** (was 553 — 91 added) |
| `npx vite build` | **built in 39.1s** |
| `npm run test:security` | **NOT RUN** — blocked |
| Browser QA @ 390/768/1440 | **NOT RUN** — blocked |

---

## 9. What is blocked, and why

`npx supabase db push --linked` was **refused by this session's
production-deploy policy.** The Supabase CLI is authenticated, the project is
linked, and `supabase migration list` shows a clean history with
`20260921140001` as the single pending migration — so the command is ready to
run, but it needs authorisation this session does not have.

I did not attempt a workaround. Executing the same DDL through a test runner
or a script would be the identical action with the guardrail removed.

**Until it is applied:**

- The bank portal will show the application but **offer no decisions**, because
  the bundle carries no `permitted_decisions`. That is the designed behaviour
  for an unknown state, not a crash — `DecisionPanel` treats a missing `bank`
  as sandbox and a missing list as "offer nothing", and a component test covers
  it.
- `tests/security/slice3-bank-decision.test.ts` will fail, correctly.
- `scripts/visual-qa-financing.mjs` will fail, correctly.

**To finish the slice:**

```
npx supabase db push --linked
node scripts/visual-qa-financing.mjs      # dev server on :5199
npm run test:security
```

The QA script builds its own bank, officer, buyer, seller, listing,
transactions and applications, and deletes the bank afterwards — it never
decides on a real member's financing.

---

## 10. Remaining Sterling limitations

Unchanged and, as the audit concluded, correct. There is **no Sterling
integration anywhere**, and none was built. The abstraction holds: a bank is a
row with capability flags, `integration_mode` decides sandbox/live/disabled,
`decision_source` records who decided, `is_sandbox` marks a simulation.
Onboarding Sterling remains a row plus flags plus a real adapter — a later
integration slice.

---

## 11. Remaining Phase 4 gaps

- **Slice 4** — verification lifecycle; retire the Stage 4
  `loamy_claim_verification_task`, still live in `VerificationTasks.tsx:59`.
- **Slice 5** — logistics and warehouse, including `loamy_suggest_warehouses`,
  still broken with `42703` (reads `v_t.origin_state`, which `transactions`
  lacks). Untouched again this slice.
- **Slice 6** — settlement.
- **Slice 7** — Sterling as data.

### Contract warts found and deliberately deferred

- **Two status values for one state.** `info_requested` and
  `additional_information_required` both exist, both are live, and are written
  by different functions. They render identically and are deduplicated in the
  pipeline filter. Merging them is a data migration on 78 production rows.
- **`loamy_bank_set_status` is deprecated, not removed.** `decided_external`
  has no equivalent in the authoritative function and live rows carry it. A
  SQL comment records the deprecation.
- **`e instanceof Error` remains** at `src/lib/escrow.ts:90`,
  `src/lib/payments.ts:54` and `src/lib/wallet.ts:144` — the PostgrestError
  blind spot from slice 2. Still outside scope; due when those surfaces are
  next touched.

### Slice 2 gate, closed out

The full security suite returned **653 passed / 6 failed**. All six were in
`block6-referrals-commission.test.ts`, which touches none of slice 2's
surfaces. Re-run alone it passes **44/44**, including all six. That file has
now failed in two consecutive full runs and passed in isolation both times —
the second time with no DNS error and a normal duration, so the earlier
network explanation does not cover it. It looks like order- or
contention-sensitivity on shared `partner_earnings` state. **Unresolved, and
worth its own look** — it is not slice 2's doing, and it was out of scope here.
