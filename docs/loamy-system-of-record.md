# Loamy system of record

The architectural truth: what every core entity is, what owns it, and how it
relates to everything else.

Read this before adding a table. The failure mode this document exists to
prevent is an engineer creating a ninth table that means "a deal" because they
could not tell which of the existing eight to use. That has already happened
here — see [Known duplication](#known-duplication).

Verified against the live schema on 2026-09-20: **100 tables in `public`**.

---

## FROZEN — the authoritative model

**Frozen 2026-09-20, before Block 3.**

For each concept there is **one** authoritative table. Everything else that
looks like it is retained history, not an alternative. This list is mirrored
machine-readably in [`model-freeze.json`](model-freeze.json), and
`tests/security/model-freeze.test.ts` holds the live database to it — a new
table in a frozen concept area is a **failing test**, not a discovery six
months later.

| Concept | Authoritative | Retained, NOT authoritative |
|---|---|---|
| Identity | `profiles` | — |
| Reputation | `reviews` | — |
| Traceability | `commodity_batches` | — |
| **A deal** | **`transactions`** | `orders`, `order_items`, `platform_transactions`, `escrow_transactions` |
| **Money movement** | **`ledger_entries`** | `wallet_entries`, `order_payments`, `order_payouts` |
| Escrow | `escrow_workflows` | `escrow_transactions`, `escrow_events` |
| Verification | `verification_tasks` | `inspection_jobs` |
| Financing | `financing_applications` | — |
| Market reference price | `market_price_updates` | `market_prices`, `market_prices_history` |
| Discovery / behaviour | `discovery_events` | — |
| Logistics | `transport_jobs` | — |
| Loading | `loading_confirmations` | — |
| Field operations | `growth_partner_operations` | — |
| Referrals | `referrals` | — |
| Intelligence | `intelligence_outputs` | — |
| Storage | `warehouse_receipts` | — |

### Authoritative functions

| Concept | Entry points |
|---|---|
| Identity | `loamy_set_username`, `loamy_username_available`, `loamy_profile_by_username` |
| Reputation | `loamy_submit_review`, `loamy_can_review`, `loamy_profile_reviews`, `loamy_rating_summary`, `loamy_respond_to_review`, `loamy_hide_review` |
| Traceability | `loamy_trace`, `loamy_trace_scope`, `loamy_trace_batch`, `loamy_trace_resolve`, `loamy_trace_batch_for_ref`, `loamy_trace_financing`, `loamy_trace_identity` |
| Discovery | `loamy_discover_supply`, `loamy_record_discovery_event`, `loamy_inferred_preferences`, `loamy_seller_signals`, `loamy_reference_price`, `loamy_price_comparison`, `loamy_logistics_estimate`, `loamy_unit_kg` |

### What the freeze forbids

A new public table whose name reads as another *deal*, *money movement*,
*identity*, *reputation* or *recommendation* fails the freeze test. That does
not make it wrong — it makes it a **model change**, which must update
`model-freeze.json` and this document **in the same commit as the migration**.

Extending `transactions` is cheap. A sixth table meaning "a deal" is not.

---

## The one rule

**An entity is real when it has a row, a ref, an owner, an RLS policy, and an
event log.** A screen is not an entity. A jsonb blob inside another table is
not an entity. If you cannot say who owns a row and who may read it, it is not
ready to exist.

Business refs come from `loamy_entity_refs` + `loamy_next_ref` and look like
`FARM-000091`, `BATCH-000982`, `TXN-000244`, `WH-000032`. They are the handle a
human types. *(Note: the product brief writes these as `LM-BATCH-000481`. The
implemented prefix has no `LM-` segment. Changing it now would orphan every ref
already issued, so the implementation stands and this note records the
difference.)*

---

## Core spine

```text
User
 ├── Digital Identity        profiles.digital_id            one, immutable
 ├── Roles                   user_platform_roles            many; one active
 ├── Profile                 profiles                       private
 ├── Public profile          loamy_public_profiles (view)   the security contract
 ├── Farms                   farms                          owner_id
 ├── Businesses              companies / company_members    multi-tenant
 ├── Listings                listings                       seller_id
 ├── Transactions            transactions                   buyer_id | seller_id
 ├── Financing               financing_applications         applicant_id
 ├── Verification cases      verification_tasks             requested_by | subject_user_id | assigned_to
 ├── Reviews                 reviews                        about a transaction
 └── Activity                audit_events, entity_observations
```

### The public handle

```text
profiles.username            lowercase [a-z0-9_], 3-30, unique
profiles.profile_visibility  public | members (default) | private
reserved_usernames           names that imply Loamy or an official function
username_history             every handle a member has held, with released_at
```

A username is a security object, not a profile field. It is written only by
`loamy_set_username` (a trigger refuses the column outright), changeable once
every 30 days, and a released handle is quarantined for 90 days against reuse
**by a different person** — otherwise a rival picks up `@kano_maize` the
afternoon it is dropped and inherits its reputation.

`loamy_profile_by_username` is the public surface, and its payload is the
security contract: no phone, no email, no `digital_id`, no `role_data`. A
profile that exists but may not be seen returns **exactly** what a
non-existent one returns, so the endpoint cannot enumerate members.

### Reviews

```text
reviews
 ├── transaction_id     REQUIRED. A review is about a deal, not a person
 ├── reviewer_id        internally attributed, never published
 ├── subject_id
 ├── direction          buyer_on_seller | seller_on_buyer
 ├── rating 1-5         + optional quality / communication / timeliness
 ├── response_text      the subject's single reply, editable for 24h
 └── status             visible | hidden_by_admin (+ reason, never deleted)
```

Eligibility is decided by `loamy_can_review`: you must have been a party, and
the deal must have concluded (`status = completed` or
`fulfilment_state = received`). One review per party per transaction. There is
**no insert policy on the table for anyone**, including admins.

`loamy_rating_summary` **withholds the average below three reviews**. Three
five-star reviews from a seller's own network is not a 5.0, and rendering one
as though it were is the most common way these systems mislead a buyer.

```text
Farm  (farms)
 ├── Owner                   owner_id → profiles
 ├── Location                state, lga, latitude, longitude
 ├── Geometry                boundary GeoJSON in jsonb; area via
 │                           loamy_geojson_area_hectares (no PostGIS yet)
 ├── Crop cycles             crop_records
 ├── Weather                 weather_observations
 ├── Verification            verification_tasks.subject_farm_id
 └── Harvests                harvests.farm_id
```

```text
Crop cycle  (crop_records)
 └── Harvest  (harvests)
      └── Commodity batch  (commodity_batches)
```

```text
Commodity batch  (commodity_batches)          the unit of traceable stock
 ├── Source farm             farm_id
 ├── Origin owner            origin_owner_id      who grew it — never changes
 ├── Current owner           owner_id             moves on sale
 ├── Quantity                quantity / available_quantity
 ├── Listing                 listings.batch_id
 ├── Transaction             transactions.batch_id
 ├── Warehouse               warehouse_receipts.batch_id
 ├── Logistics               transport_jobs.batch_id
 ├── Verification            verification_tasks.subject_id
 └── Trace events            batch_events         append-only, no client write
```

`origin_owner_id` and `owner_id` are separate on purpose. Selling a batch moves
possession; it never rewrites provenance. A partial sale splits quantity
without splitting identity, which is why `available_quantity` exists and why
`batch_events` records `quantity_after` on every move.

---

## State, and where it lives

A transaction carries **three independent machines on one row**:

| Column | Question it answers | Rules table |
|---|---|---|
| `status` | is there an agreement? | `transaction_transition_rules` |
| `payment_state` | where is the money? | same table, `machine='payment'` |
| `fulfilment_state` | where are the goods? | same table, `machine='fulfilment'` |

They move independently because they genuinely are independent: goods can be
delivered before payment releases, and an agreement can stand while payment
fails. Collapsing them into one column is how platforms end up marking unpaid
deliveries "complete".

The same pattern governs `commodity_batches` (`batch_transition_rules`),
`transport_jobs` (`logistics_transition_rules`) and `escrow_workflows`
(`escrow_transition_rules`). Transitions are **data, not code** — a matrix of
`allowed_from[] → new_status`, with an `initiator` saying who may fire it.

---

## Money

```text
ledger_accounts ──< ledger_entries         double-entry; a group sums to zero
escrow_workflows ──< escrow_workflow_events
transactions.fee_snapshot                  the rule frozen at acceptance
fee_schedules                              scope × type × role × partner × commodity
reconciliation_runs                        classifies; never auto-corrects
```

Account types: `member_receivable`, `member_payable`, `provider_clearing`,
`platform_escrow`, `platform_revenue`, `suspense`.

A member balance is **what Loamy owes them once the provider settles** — not
cash Loamy holds. `docs/financial-boundaries.md` is authoritative here.

---

## Financing

A financing application is **tied to a commercial transaction**, not a naira
request:

```text
financing_applications
 ├── applicant_id
 ├── transaction_id ── batch_id, listing_id, seller_id   what is being bought
 ├── amount_requested     what the applicant asked
 ├── approved_amount      what the BANK approved      ← client writes refused
 ├── disbursed_amount     what actually moved          ← client writes refused
 └── bank_id                                           ← client writes refused
```

Loamy is not the lender and never writes the bank's three columns; only
`loamy_financing_decision`, called by an officer of the **assigned** bank, can.

No BVN is stored anywhere. `bvn_verified` / `nin_verified` are status booleans
— they record that a bank verified someone, not what the number is.

---

## Verification

```text
verification_tasks  (the case)
 ├── requested_by        who asked
 ├── subject_user_id     who is being inspected
 ├── subject_farm_id | subject_id (+ subject_type)
 ├── assigned_to         the Growth Partner   ← NOT visible to the parties
 └── verification_evidence   append-only, GPS + hash + flags
```

The parties see `agent_display` = **"Loamy Verification Agent"**. Only the
agent themselves and admins resolve the identity. Internally the full chain
(agent → assignment → location → case → evidence → transaction → commission)
is intact; `loamy_agent_conflict_signals` surfaces repeated pairings.

Collection is not approval. Evidence submission never approves anything; a
separate review step does.

---

## Known duplication

These are real and should be resolved rather than added to. Listed because
pretending otherwise is how a tenth table gets created.

| Concept | Tables that claim it | What is authoritative |
|---|---|---|
| A deal | `transactions`, `orders`, `order_items`, `platform_transactions`, `escrow_transactions` | **`transactions`** — it carries the three state machines and the batch link |
| Money movement | `ledger_entries`, `wallet_entries`, `order_payments`, `order_payouts` | **`ledger_entries`** — double-entry. `wallet_entries` is deprecated and empty |
| Escrow | `escrow_workflows`, `escrow_transactions`, `escrow_events` | **`escrow_workflows`** + `escrow_workflow_events` |
| Market price | `market_prices`, `market_price_updates`, `market_prices_history` | `market_price_updates` for the daily ranges; the others predate it |
| Inspection | `verification_tasks`, `inspection_jobs` | **`verification_tasks`** |

The older tables are retained rather than dropped because dropping a table that
might hold history is not a casual act. Retained ≠ authoritative.

---

## Trace, both directions

Forward, from a batch:

```text
Farm → Crop cycle → Harvest → Batch → Listing → Transaction
     → Financing → Verification → Warehouse → Logistics → Delivery
```

Reverse, from an identity or any ref:

```text
Farmer → Farms → Cycles → Harvests → Batches → (each batch's forward chain)
Transaction ref → Batch → full chain
Listing ref    → Batch → full chain
```

Entry points:

| Function | Takes | Gives |
|---|---|---|
| `loamy_trace` | **any** business ref, or a uuid | the scoped chain, financing included |
| `loamy_trace_resolve` | a ref | `(entity_type, entity_id)` from `loamy_entity_refs` |
| `loamy_trace_batch_for_ref` | a ref | the batch it hangs off, and how we got there |
| `loamy_trace_identity` | a username | that person's farms → cycles → harvests → batches |

The downward direction is deliberately narrow — **self, admin, or a Growth
Partner with an open assigned case**. A buyer who bought one batch may trace
that batch upward; they may not enumerate everything its producer has grown.
A refusal is worded identically to an unknown handle.

Authorisation is a **scope**, resolved per batch by `loamy_trace_scope`:

| Scope | Sees |
|---|---|
| `none` | nothing — and the answer is indistinguishable from "no such ref" |
| `public` | commodity, origin **state**, verification status. No identities |
| `party` | + counterparties, quantities, transaction and logistics detail |
| `origin` | + the origin farm's identity |
| `admin` | everything |

A missing link returns `available: false` with a **reason** — `not_recorded`,
`never_listed`, `never_verified`, `not_permitted`. History is never fabricated,
and "you may not see this" is never disguised as "this did not happen".

---

## Discovery (Block 3)

```text
discovery_events        append-only; a member reads ONLY their own rows
buyer_preferences       what the buyer SAID
loamy_inferred_preferences()   what their behaviour SUGGESTS — labelled as such
```

The two are kept apart so a recommendation can always say which it used.

**Ranking is deterministic and returns its own weights.** Three views — `buy`,
`source`, `opportunity` — change the weights, never the facts. Every item
carries a `score_breakdown`, so the ordering can be argued with.

Four refusals are built in, because each is a way to mislead while being
technically truthful:

| Claim | Only when |
|---|---|
| a price comparison | a **named market** with a **dated** observation, and units that actually convert |
| "lowest observed price" | the **comparison population** and the moment are attached |
| a landed cost | the freight half comes from **observed** corridor data |
| "recommended" | the engine can name a **reason with evidence** |

There is no `BEST PRICE` badge and no national benchmark, because Loamy has
the data for neither. A price per litre is refused against a grain reference
rather than silently converted.

Seller standing is **individual facts, never a score**: verified, completed
transactions, fulfilment rate (withheld below 5 deliveries), rating (withheld
below 3 reviews), active listings. An opaque score is unappealable — the
seller cannot tell what to fix and the buyer cannot tell what it weighed.

**Order of work, per the directive:** behavioural data first, then
deterministic logic, and statistical models only once there is enough data to
fit one. Nothing here is learned.

---

## Buyer financing (Block 4)

The golden path, and what gates each step:

```text
listing -> cart -> TRANSACTION -> financing application -> bank decision
       -> commodity verification -> settlement gate -> supplier-direct
       settlement -> loading -> logistics -> delivery -> completion
```

**The amount is derived, never typed.** `loamy_apply_financing_for_transaction`
takes the transaction's subtotal. A buyer may ask for less; the function
refuses more. The application carries `transaction_id`, `batch_id`,
`listing_id` and `seller_id`, so an institution can see exactly what it funds.

**Loamy writes none of the bank's numbers.** `approved_amount`,
`disbursed_amount`, `bank_id` and decision statuses are refused to every
client; only `loamy_financing_decision`, called by an officer of the
**assigned** bank, sets them.

**Capabilities are data.** No bank is named in the model.
`loamy_bank_capabilities` returns what a given institution supports, every
flag defaulting to **no**, and `supports_supplier_direct` is the authoritative
gate for the supplier-direct route.

**A sandbox decision is marked everywhere.** `is_sandbox` and
`decision_source` sit on the row; the simulator is admin-only and **refuses to
decide for a bank whose `integration_mode` is `live`**.

### The settlement gate

"Approved" never means "pay the seller". `loamy_settlement_readiness` reports
**ten conditions individually**, so a blocked settlement says which condition
blocked it:

`bank_approved`, `approval_current`, `supplier_direct_supported`,
`transaction_live`, `commodity_verified`, `verification_current`,
`seller_payout_ready`, `no_blocking_flags`, `not_over_committed`,
`not_already_settled`.

Settlement itself is recorded as a **memorandum** against `partner_funding` /
`external_settlement`. The institution moves the funds; Loamy does not hold
them, and no member balance is touched. Idempotency is the institution's own
reference, so a replayed callback cannot pay twice.

### Double financing

Committed quantity is **derived** from live financing applications joined to
their transactions — deliberately not a separate table, which would be a
second home for the same truth. A 100 MT batch with 40 committed leaves 60
financeable; the batch is not locked because one deal exists.

### Repayment

`repayment_status` is what the institution **reported**, with the moment and
the source. Loamy never computes it — a wrong "overdue" on a member's record
is a real harm Loamy has no standing to assert.

---

## Growth Partner field operations (Block 5)

**The rule the whole block exists to hold:**

```text
FIELD EVIDENCE  ->  LOAMY REVIEW  ->  VERIFIED RECORD
```

never

```text
FIELD AGENT  ->  VERIFIED
```

An agent collects. They cannot approve their own work, cannot approve anyone
else's (review is administrative), cannot edit or delete a capture, cannot
clear a flag, and cannot move their own commission. Each of those is a test.

### Two-way anonymity

| Who | Sees |
|---|---|
| The inspected party | `Loamy Verification Agent`, never the person |
| The requesting buyer | the same |
| **The agent** | the subject and the location — **not who requested it** |

The last row is Block 5's addition. §7 stopped the requester resolving the
agent; the mirror image was still open, and a buyer's sourcing intention is
exactly what a field agent working for a competitor would want. Agents reach
their work through `loamy_my_tasks` and `loamy_task_detail`; neither returns
`requested_by`. Internally `loamy_trace_agent_chain` gives administrators the
whole chain, because commission and fraud investigation need it.

### Tasks

`pending → available → assigned → accepted → in_progress → submitted →
under_review → approved | rejected | needs_more_information`, plus `expired`
and `cancelled`.

Claiming is **one atomic conditional UPDATE**, so two agents tapping accept in
the same second are serialised by the row lock and the second is told the task
is gone — which is what happened. Before assignment an agent sees the **state
and LGA only**; coordinates and subject identity arrive with the task.

Assignment returns **factors, never a score** — service area, LGA match,
commodity match, availability, training, workload, approvals, open flags and
prior pairings with the same subject. Repeat pairings push an agent *down*, as
a conflict-of-interest signal. The chosen factors are written onto the task.

### Flags mean review, never fraud

`no_gps`, `low_gps_accuracy`, `gps_far_from_subject`, `no_reference_location`,
`future_timestamp`, `captured_before_case_existed`, `duplicate_evidence`,
`repeated_identical_coordinates`, `impossible_travel`, `rapid_completion`.

None rejects anything. Three were tuned *down* during this block because they
fired on honest work — a slow phone, an agent accepting a task on arrival, and
one farmer's farm and store sharing coordinates. A check that fires on
ordinary work trains everyone to ignore it.

Device time and server time are both recorded, with the skew as a **number**;
server time is authoritative for ordering.

### Commission

Entitlement and money are separate, and neither duplicates the other:

| | |
|---|---|
| `partner_earnings` | the entitlement: `estimated → pending → approved → payable → paid`, plus `reversed` / `disputed` |
| `ledger_entries` | the money: double-entry at `payable` (liability) and `paid` (settlement) |

There is no wallet and no commission-money table. **Who pays comes from the
fee schedule** — Loamy, an institution, a buyer, a seller, an enterprise
client or a programme partner — and is frozen onto the earning at accrual.

Commission follows **completed, approved work**. `loamy_accrue_commission`
refuses anyone who is not a Growth Partner, which is where the referral rule
is actually enforced: an ordinary member's referral can never become cash,
because that function is the only door to one.

### Suspension

Stops new work. Never erases history, evidence or commission — a record that
disappears when someone is stood down makes every past verification
unauditable.

---

## Referrals and commission (Block 6)

**Two graphs that must never meet.**

```text
ORDINARY REFERRAL      referrals → referral_benefits        non-cash
GROWTH PARTNER WORK    verification_tasks → partner_earnings → ledger_entries
```

If User A refers Farmer B, and Growth Partner C verifies B's farm, **C is paid
and A is not.** That is the block's defining test.

### The guarantee is structural

`referral_benefits` has **no `amount` column and no `currency` column**, and a
CHECK constraint permitting only `recognition`, `badge`, `access`,
`early_access`, `visibility`, `resource`. An ordinary referral has nowhere to
record money. `loamy_upsert_referral_programme` additionally refuses a
programme whose benefit carries an `amount`, a `currency`, or a `cash` kind.

The member-facing surface shows **"None yet"**, never "₦0 earned" — a zero
implies an affiliate programme that has not paid out, which is the opposite of
true.

### Nothing is hard-coded

`referral_programmes` holds the qualifying condition (`profile_complete`,
`identity_verified`, `first_transaction`, `first_listing`, `manual`), the
attribution window, the eligible roles and the benefits. A referral is **bound
to the programme active when it was made**, so editing the programme later
never rewrites what an existing referral was promised — the same principle as
the fee snapshot on a transaction.

An unrecognised rule qualifies **nothing**. Failing open there would hand out
benefits on a typo.

### Attribution

One per person, ever, enforced by a unique constraint. The referrer is
immutable: a trigger refuses any change to `referrer_id` or `referred_id`.
Fraud controls refuse self-referral, circular chains (two levels), a closed
attribution window, an inactive referrer and an ineligible one; high referral
velocity is **flagged for review**, not refused.

**Registered is not successful.** A signup alone earns nothing, and the
referrer is shown what is still missing.

### The line through the legacy path

`loamy_record_referral` used to pay cash for a shared link. It is now split:

| Method | Meaning | Pays |
|---|---|---|
| `field_assisted` | a Growth Partner physically onboarded someone | commission, via the fee schedule |
| `referral_link` | someone shared a link | platform benefits only |

### Commission governance

Unchanged from Block 5 and still authoritative: `partner_earnings` for the
entitlement, `fee_schedules` for the rate and payer (frozen at accrual),
`ledger_entries` for the money. Rejected work never accrues. A reversal is a
**counter-entry**, never a deletion.

---

## Intelligence (Block 7)

**No second event table.** Behaviour still lives in `discovery_events` from
Block 3 — actor-stamped from `auth.uid()`, readable only by its own actor.
Block 7 adds analysis, not collection.

### Classification is a column, not a convention

`intelligence_outputs.classification` is NOT NULL and one of:

| | |
|---|---|
| `observed` | counted from records that exist |
| `user_generated` | reported by a member, unverified |
| `model_inference` | computed. Not an observation, and not a forecast |

A seasonal pattern is `model_inference` even though it is built entirely from
observations — a mean over real data is still a calculation.

### The evidence hierarchy

`evidence_weights`, as data so it can be tuned:

```text
complete_transaction 100   verified_batch 60   accepted_order 40
request_financing     25   start_checkout 15   add_to_cart 12
enquire               10   save_listing    6   listing      5
view_listing           2   view_seller     2   search       1
```

**A view is not demand.** Every signal returns its breakdown and each signal's
contribution, so the band can be argued with rather than trusted.

### Three refusals

| Situation | Answer |
|---|---|
| too few participants | `insufficient_data` — **withheld, never rounded into a band** |
| no commodity named | refused; there is no "overall demand" |
| no market named | refused; there is no national price series |

The floor counts **distinct people**, not events — one person searching ninety
times is one person. It reuses `institutional_min_group_size`, the same
setting Phase 12 already applied.

### Supply is three numbers

`listed` (claimed by sellers, not inspected) → `verified` (an agent physically
saw it) → `transacted` (it actually moved). **Never summed.** Collapsing them
is how a platform reports supply that does not exist.

### History is never rewritten

An insight cannot be edited or deleted. A new version **supersedes** the old
and both survive with their own `model_key` and `model_version`, so a model
change never silently rewrites an earlier answer.

### Feedback cannot reach the source

`intelligence_feedback` is a separate table with no write path to
`market_price_updates` or anything else factual. "Not useful" is an opinion
about an insight, not an edit to an observation.

### Scoping

A bank sees **its own pipeline** at every step — there is no cross-institution
view. Government aggregates go through the existing `loamy_institutional_*`
functions, which already carry the floor. Funnel analytics are administrative.

### What deliberately does not exist

No credit score, no personality score, no inference of wealth, income,
ethnicity, religion, health or character. A test asserts no such function or
table exists, so adding one is a failing build.

---

## Permissions

- RLS is on for every table in `public`. Frontend role checks are convenience,
  never the boundary.
- Every `SECURITY DEFINER` function pins `set search_path = public`.
- Append-only logs (`batch_events`, `transaction_events`, `entity_observations`,
  `verification_evidence`, `shipment_events`, `financing_events`,
  `escrow_workflow_events`, `ledger_entries`, `audit_events`) have **no client
  write path at all**. Workflow functions write them, guarded by session flags
  like `loamy.txn_system_authorized` that only a definer function can set.
- `service_role` exists nowhere in the client or in `.env`.

---

## Where to look next

| For | Read |
|---|---|
| Money rules and what Loamy is not | `docs/financial-boundaries.md` |
| RLS and definer patterns | `docs/security.md` |
| Running the suites | `docs/testing.md` |
| Table-by-table detail | `docs/data-model.md` |
| State machines end to end | `docs/workflows.md` |
| Trace scopes | `docs/traceability.md` |
| Environments and gates | `docs/deployment.md` |
| Current status and gaps | `docs/reconciliation-report.md` |
