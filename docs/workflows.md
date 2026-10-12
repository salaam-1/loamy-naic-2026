# Workflows and state machines

**Status:** Phase 5. Batch, verification and transaction lifecycles are enforced
state machines. The rest are documented targets, marked as such.

The directive's rule (Part 28): **no arbitrary string mutation from the
frontend.** A transition defines allowed previous states, the new state, who may
initiate it, and server-side validation. Anything not on the list is refused.

---

## Batch lifecycle — IMPLEMENTED AND ENFORCED

Stored in `batch_transition_rules`, applied by `loamy_batch_transition`.

```
                    ┌──────────────── platform ────────────────┐
                    ▼                                          │
  created ──────► verified ──────► listed ──────► reserved ────┤
     │              ▲  │              │  ▲            │        │
     │              │  └── unlisted ──┘  │            ▼        │
     │              │                    └──── partially_sold  │
     │              │                                 │        │
     └── cancelled  └───────── verification_rejected ─┘        │
                                                      ▼        │
                                                    sold ──────┘
                                                      │
                                    loaded ──► in_transit ──► warehouse_received
                                                                     │
                                                              delivered ──► released

  disputed: reachable from every live state
```

### Who may initiate

| Initiator | Events |
|---|---|
| **holder** (current owner) | `listed`, `unlisted`, `loaded`, `disputed`, `cancelled`, `quantity_adjusted`, `split` |
| **platform** (admin) | `verified`, `verification_rejected` |
| **system** (server-side workflow) | `reserved`, `partially_sold`, `sold`, `ownership_transferred`, `in_transit`, `warehouse_received`, `delivered`, `released` |

Two consequences worth stating plainly, both tested:

- **A seller cannot verify their own stock.** Verification is `platform`.
- **A seller cannot mark their own batch sold.** That is `system`, driven by the
  transaction workflow in Phase 5, not by the holder.

`system` events currently reject every direct caller except admin. Phases 4–9
will call them from their own `SECURITY DEFINER` functions, which is the point
of the seam.

### Validation on every transition

1. The batch row is locked `FOR UPDATE` — concurrent sales cannot both pass.
2. The event type must exist in the rules table.
3. The initiator must match.
4. The current status must be in `allowed_from`.
5. Quantity may not go below zero or above the batch's original quantity.
6. An event row is always written — actor, previous status, new status, signed
   delta, resulting balance.

---

## Verification — IMPLEMENTED (Phase 3)

```
requested ─► assigned ─► in_progress ─► submitted ─► approved
                 ▲            │                  ├─► rejected
                 └── resubmit_requested ◄────────┘
```

The property the design exists to guarantee:

> **An agent collects evidence. The platform decides.**

Three entities, deliberately separate:

| | |
|---|---|
| **Case** (`verification_tasks`, generalised) | 12 verification types, a generic subject, expected location, accumulated flags |
| **Evidence** (`verification_evidence`) | One row per capture. Who, when, where, what. Never detached from its case |
| **Review** (`verification_reviews`) | The platform's decision, with the flags as they stood at review time |

### Enforced rules

- Only the **assigned agent** may submit evidence. Not the subject, not a stranger.
- A case cannot be submitted **empty**.
- The agent who collected the evidence **cannot review it**, even if they are also an admin.
- A decided case **cannot be reviewed twice**.
- `can_verify` is **admin-granted only** (Phase 0), so an agent cannot self-assign into the role.
- Evidence has **no client insert, update or delete path** — everything goes through `loamy_submit_evidence`, which stamps the collector and runs the checks.
- The subject being verified **cannot read the raw evidence** about themselves.

### Anti-fraud: flag, don't block

Checks run server-side on every capture and produce flags, which bubble onto the
case so a reviewer cannot miss them:

`future_timestamp` · `captured_before_case_existed` · `no_gps` ·
`low_gps_accuracy` · `gps_far_from_subject` · `duplicate_evidence` ·
`no_reference_location`

Flagging rather than blocking is deliberate. A hard block teaches agents to work
around the check and destroys the signal; the reviewer sees the flag and decides.

Thresholds live in `platform_config.settings`
(`verification_max_distance_m`, `verification_max_gps_accuracy_m`,
`verification_sample_rate_pct`) — configurable, never hardcoded.

**The expected location is DERIVED from the subject**, not set by hand. An
earlier draft required an admin to populate `expected_lat`/`expected_lng`
separately; the Phase 3 tests caught that when it was skipped the GPS check
silently never ran and every capture looked clean. A fraud check that quietly
does nothing is worse than no check, because it reads as a pass. If no reference
point can be resolved, the capture is flagged `no_reference_location` rather
than passing.

Clean work is still spot-checked: `sampled_for_review` is set on a configurable
share of unflagged cases, so "no flags" is not a blind spot.

`loamy_partner_verification_stats` exposes per-agent totals, approval and
rejection counts, flag rate, average time to submit, and duplicate-evidence
count.

---

## Transaction — IMPLEMENTED (Phase 5)

**Three independent machines on one row.** Directive Part 19 is explicit that
one status field must never represent the whole economic workflow, so it
doesn't.

```
status       proposed ─► accepted ─────────────► completed
                │  │         │                       ▲
                │  │         └─► verification_required ─► verified ─┘
                │  └─► rejected
                └─► cancelled / expired
             any live state ─► disputed ─► (platform) ─► completed

payment      not_started ─► pending ─► authorized ─► held ─► released
                                 └─► failed        └─► refunded

fulfilment   not_started ─► awaiting_pickup ─► loaded ─► in_transit
                                                  └─► delivered ─► received
```

A transaction can be `accepted` + `payment not_started` + `fulfilment loaded`
at the same time. Each machine has its own `allowed_from` and its own
initiator.

### Who may initiate

| Machine | buyer | seller | platform | system |
|---|---|---|---|---|
| status | `withdraw`, `cancel`, `dispute` | `accept`, `reject`, `cancel`, `dispute` | verification outcomes, `resolve_dispute` | `complete`, `expire` |
| payment | — | — | — | **all of them** |
| fulfilment | `received` | `ready_for_pickup`, `loaded` | — | `in_transit`, `delivered` |

**No member can assert that money moved.** Every payment event is `system`, so
a buyer cannot claim they paid and a seller cannot claim release. Phase 7 will
drive these from a provider webhook. Tested with all six payment events from
both parties.

### Custody

`payment_state` mirrors **what a provider reported**, against
`payment_reference`. There is no balance, no debit and no credit in the
transaction model. Loamy orchestrates; a licensed provider holds. If the legal
position later supports custody, that is an additive change in Phase 7 rather
than a rewrite here.

### Stock commitment

Proposing reserves nothing — otherwise any member could lock a seller's
inventory for free. **Acceptance** commits stock, via the batch's own
`reserved` transition. Cancelling or rejecting an accepted transaction releases
it again. Completion marks the batch `sold`.

This is where the Phase 2 `system` seam gets used: the transaction RPC raises
`loamy.batch_system_authorized` so it can drive a batch transition no member
could drive directly.

---

## Dispute — IMPLEMENTED (Phase 5)

```
open ─► evidence_requested ─► under_review ─► decided ─► resolved
                                                   └─► escalated
withdrawn from any pre-decision state
```

Either party may raise one; the respondent is filled in automatically. One open
dispute per transaction. An empty description is refused. Raising one moves the
transaction to `disputed` through the normal rules, and writes an audit event.

Platform decision paths (`evidence_requested`, `under_review`, `decided`) are
modelled but not yet wired to an admin surface.

---

## Production cycle — STATUS ONLY

`planned → planted → growing → harvested`, or `failed` / `abandoned`.

Currently a plain column with a CHECK constraint. No transition rules, no
initiator control. Acceptable for now because a cycle's status carries no
commercial consequence on its own; it should be promoted when Phase 4 lets a
cycle drive a listing.

---

## Harvest — STATUS ONLY

`recorded → verified → batched`, or `disputed` / `cancelled`.

The one enforced rule: once a batch exists, the harvest moves to `batched` and
the UPDATE policy pins editable statuses, so quantity stops being freely
editable.

---

## Not yet built

Named so the gap is visible rather than implied.

| Workflow | Phase |
|---|---|
| Financing lifecycle (`DRAFT → SUBMITTED → … → DISBURSED → COMPLETED`) | 6 |
| Payment lifecycle, separate from transaction state | 7 |
| Logistics lifecycle (`REQUESTED → … → DELIVERED`) | 8 |
| Warehouse booking lifecycle | 9 |
| Growth Partner payout lifecycle | with 6 |
| Withdrawal lifecycle | exists as columns; not rule-driven |

**Important design note carried forward from the directive (Part 19):** these
are *separate* state machines. A transaction can be `VERIFIED` while payment is
`PENDING`, financing is `APPROVED` and logistics is `NOT_STARTED`. One status
field must never be made to represent the whole economic workflow.
