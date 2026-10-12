# Phase 4 — Slice 3: the financing lifecycle as it actually is

Written before any code changed, per §1. Everything here was read from the
migrations and then **verified against the live database**, not inferred from
function names.

---

## 1. The two decision mechanisms, and why the UI cannot approve

There are two bank-facing status functions. They were written eighteen months
apart and do not know about each other.

### `loamy_bank_set_status(p_app, p_status, p_message)` — the one the UI calls

Defined `20260718090002`, re-defined with audit wiring in `20260718130002`.

| Aspect | Actual behaviour |
|---|---|
| Accepts | `under_review`, `info_requested`, `decided_external` — **and nothing else** |
| Requires | current status in `submitted`, `under_review`, `info_requested` |
| Authority | `loamy_officer_bank()` must be non-null and equal `bank_id` |
| Writes | `status`, `reviewed_by`, and `decision_note` **only** for `decided_external` |
| Audit | `loamy_audit_internal` + applicant notification |

`p_message` for an information request is **passed to the notification only**.
It is never persisted on the application row. That is a real gap: the applicant
gets a notification, but the application itself carries no record of what was
asked.

There is no approve. There is no reject. `decided_external` means "the bank
decided somewhere else and we are noting that it happened" — the Stage 5
premise, stated verbatim in `src/lib/bank.ts`:

> THE rule of this stage: no approve/decline exists in Loamy.

### `loamy_financing_decision(...)` — the authoritative one, with **zero UI callers**

Defined `20260919240001`, extended `20260920130001`. The five-argument overload
was dropped in `20260920130010` after it caused `PGRST203` on every call, so
**one** signature survives:

```
loamy_financing_decision(
  p_application_id uuid, p_decision text, p_approved_amount numeric,
  p_conditions text, p_note text, p_tenor_days int, p_pricing_note text,
  p_bank_reference text, p_expires_at timestamptz, p_source text)
```

| Aspect | Actual behaviour |
|---|---|
| Accepts | `approved`, `partially_approved`, `rejected`, `additional_information_required`, `under_review` |
| Refuses current status | `disbursed`, `completed`, `cancelled`, `expired` |
| Authority | admin, or `loamy_officer_bank() = bank_id` |
| Approval rules | amount required and `> 0`; **`> amount_requested` refused** |
| Provenance | `p_source` ∈ `bank_officer` \| `bank_api` \| `sandbox_adapter`; anything else refused |
| Sandbox | `is_sandbox := bank.integration_mode = 'sandbox' OR source = 'sandbox_adapter'` |
| Sandbox guard | `sandbox_adapter` against a `live` bank **raises** |
| Writes | status, approved_amount, conditions, decision_note, tenor_days, pricing_note, bank_reference, expires_at, decision_source, is_sandbox, reviewed_by, decided_at |
| Actor | `reviewed_by := auth.uid()` — **server-derived, not a parameter** |
| Audit | one `financing_events` row + one `notifications` row + one `audit_events` row |

**Verified live:** `grep -rn 'loamy_financing_decision' src/` returns nothing.
A bank officer cannot reach any of this through the product.

---

## 2. Status values — there are two words for one state

`financing_applications_status_check` (live) permits:

```
draft, submitted, under_review, info_requested,
additional_information_required, approved, partially_approved, rejected,
expired, cancelled, disbursed, completed, decided_external
```

`info_requested` and `additional_information_required` **both exist and mean
the same thing**. `loamy_bank_set_status` writes the first;
`loamy_financing_decision` writes the second. Live data contains both.

This slice does not merge them — that is a data migration on 78 production
rows and is not what was asked. The authoritative function writes
`additional_information_required`, so that is what new information requests
use, and the UI renders the legacy value identically. Recorded as a deferred
contract wart.

Live tally at the time of writing (78 applications):

```
partially_approved 24 · rejected 22 · disbursed 19 · submitted 4
decided_external 3 · approved 3 · under_review 1 · info_requested 1 · draft 1
```

---

## 3. Three defects that would make an approve button useless

### (a) The bank loses read access the moment it decides

`loamy_financing_select_bank` (`20260718090002`):

```sql
using (
  status in ('submitted','under_review','info_requested','decided_external')
  and bank_id = public.loamy_officer_bank()
)
```

The status list predates the Phase 6 lifecycle. An officer who sets
`approved` immediately fails the `using` clause and **the row disappears from
their own portal**. Same for `rejected` and `additional_information_required`.

### (b) The pipeline filters on the same stale list

`loamy_bank_pipeline` carries the identical `status in (...)` four-value
filter, so a decided application vanishes from the queue as well.

**Verified live:** the LOTUS officer sees 8 applications; admin sees 9 for the
same bank. The one hidden row is a `draft`, which is correct. The bank simply
has no decided application yet, so the vanishing is latent rather than
currently visible — the regression test added in this slice makes it explicit.

### (c) The bundle predates everything

`loamy_application_bundle` is the bank's **entire** window onto an application
— officers have no raw table access. Verified live, `bundle.application`
returns exactly:

```
id, status, purpose, structure, updated_at, product_type, submitted_at,
decision_note, intended_items, status_history, amount_requested,
disbursement_preference
```

Absent, and all required by §15/§6: `ref`, `transaction_id` and any
transaction context, `bank_id`, `approved_amount`, `tenor_days`,
`pricing_note`, `bank_reference`, `decision_source`, `is_sandbox`,
`expires_at`, `conditions`, `decided_at`.

So the bank portal currently **cannot** display the application reference, the
transaction reference, the commodity, the decision provenance, or the sandbox
warning — not because the UI omits them, but because its only data source does
not carry them.

---

## 4. What is already correct and must not be disturbed

- **Actor identity is server-derived.** `reviewed_by := auth.uid()`. There is
  no parameter a browser could use to name a different officer.
- **Bank identity is server-derived.** `loamy_officer_bank()` reads
  `profiles.platform_role = 'bank'` joined to `role_details.role_data->>'bank_id'`,
  requiring both the profile and the bank to be active.
- **The applicant cannot write a decision.** The
  `loamy_protect_financing_decision` trigger blocks any change to
  `approved_amount`, `disbursed_amount`, `bank_id`, or a status in
  `(approved, partially_approved, rejected, disbursed, completed)` unless the
  session flag `loamy.financing_decision_authorized` is set — and only the
  security-definer functions set it.
- **One active application per transaction** is enforced inside
  `loamy_apply_financing_for_transaction`: it raises if a non-terminal
  application already exists for that transaction and applicant. Terminal for
  this purpose = `rejected, cancelled, expired, completed`.
- **Financing attaches to an existing transaction.**
  `loamy_apply_financing_for_transaction` reads the transaction, refuses a
  non-buyer, and writes `transactions.financing_application_id` back. It never
  creates a transaction.
- **No BVN, no NIN.** Verified against the live column list:

  ```
  amount_requested, applicant_id, approved_amount, bank_id, bank_link_id,
  bank_reference, batch_id, conditions, created_at, decided_at, decision_note,
  decision_source, disbursed_amount, disbursement_preference, expires_at,
  farm_id, id, intended_items, is_sandbox, listing_id, pricing_note,
  product_type, purpose, ref, repayment_reported_at, repayment_source,
  repayment_status, reviewed_by, seller_id, status, status_history, structure,
  tenor_days, transaction_id, updated_at
  ```

  `bank_account_links` stores `account_last4` and an opaque bank reference —
  by design there is no column either could hold.
- **The sandbox cannot impersonate a live bank.** `loamy_sandbox_bank_decision`
  is admin-only and returns `{simulated:false, reason:'bank_not_in_sandbox'}`
  rather than deciding; `loamy_financing_decision` independently raises if
  `sandbox_adapter` is used against a `live` integration.
- **No bank is named in the model.** `banks.integration_mode`,
  `supports_supplier_direct`, `supports_account_opening`,
  `supports_status_callback` are data. Sterling appears nowhere. Confirmed
  again in this slice.

---

## 5. One genuinely impossible transition that is not blocked

`loamy_financing_decision` does not check for `draft`. The insert policy lets
an applicant create a `draft` naming a bank, so an officer of that bank could
decide an application that was **never submitted**. RLS and the bundle both
hide drafts, so this is narrow — but a draft is in no permitted path, and §2
says impossible transitions must be refused. Closed in this slice.

---

## 6. The lifecycle this slice implements

Enforcement stays where it already is, in `loamy_financing_decision`. What is
added is a single server-side definition of which decisions may be **offered**,
so the portal and the database cannot drift:

| From | May be offered |
|---|---|
| `draft` | nothing — not visible to banks |
| `submitted` | under review · request information · approve · partially approve · reject |
| `under_review` | request information · approve · partially approve · reject |
| `info_requested` *(legacy)* | return to review · approve · partially approve · reject |
| `additional_information_required` | return to review · approve · partially approve · reject |
| `approved`, `partially_approved`, `rejected`, `decided_external` | nothing — already decided |
| `disbursed`, `completed`, `cancelled`, `expired` | nothing — terminal |

The offer list is deliberately **narrower** than the enforcement guard, never
wider. The guard remains authoritative and its refusals are surfaced verbatim
through `src/lib/errors.ts`.
