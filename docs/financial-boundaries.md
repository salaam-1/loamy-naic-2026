# Financial boundaries

**Status:** Phases 6 and 7 complete. Both are built behind isolated integration
boundaries — **no bank and no payment provider is live.**

This document exists because the money layer is where a mistake is a regulatory
incident rather than a bug.

---

## What Loamy is not

| Not | Because |
|---|---|
| A lender | Loamy never decides credit. `approved_amount` is writable only by the assigned bank |
| A deposit-taking institution | No member balance represents cash Loamy holds |
| A custodian of funds | Escrow records what a **provider** holds, against `provider_reference` |
| A holder of BVN | Not a column, not a payload, not a log. The bank collects it |

Each of these is enforced by a trigger or a policy, not by convention. The
tests assert the refusals.

---

## The ledger is double-entry

The previous wallet was **single-entry**: one row per movement, balance = sum
of credits minus debits. Nothing recorded where money came *from* or went *to*,
so nothing could be reconciled against a provider and a missing row was
invisible. It also read, to a member, like a Loamy-held balance.

Now every economic event writes **at least two lines that sum to zero**, against
named accounts:

| Account type | Meaning |
|---|---|
| `member_receivable` | What Loamy owes this member once a provider settles |
| `member_payable` | What this member owes Loamy (fees) |
| `provider_clearing` | Funds sitting with the payment provider |
| `platform_escrow` | Provider-held funds against a specific deal |
| `platform_revenue` | Loamy's earned fees |
| `suspense` | Unmatched. Must be cleared by reconciliation |

`loamy_post_ledger` refuses an unbalanced post outright, and is **not granted to
`authenticated` at all** — only other definer functions may call it. There is no
client write path to `ledger_entries` of any kind.

A member's balance is *what Loamy owes them once the provider settles*. The UI
must say that, not "your money".

**The old `wallet_entries` table is kept, empty and deprecated.** It had zero
rows in production, so there was nothing to convert. Dropping a money table —
even an empty one — is not something to do casually.

### Reconciliation

`loamy_reconciliation_exceptions` returns three things that should never exist:
unbalanced groups, verified provider events with no ledger post, and entries
unreconciled after 48 hours. **It should always be empty.** If it isn't, stop
and investigate before processing more payments.

---

## Fees are a schedule, and the schedule is frozen per deal

`platform_fee_bps` was one global number. It is now a fallback. Fees live in
`fee_schedules`, narrowed by any combination of **scope, transaction type, user
role, partner and commodity group**, expressed as `bps` or `flat`, with an
optional floor and cap and an effective-from/to window.

`loamy_resolve_fee` picks the **most specific** rule that matches — specificity
is just how many narrowing dimensions are non-null, so adding a dimension later
does not mean rewriting the ordering. When nothing matches it returns
`resolved: false, reason: 'no_rule'` rather than quietly charging zero as though
a rule had applied.

Members can read the schedule. Only an admin can write it.

### Why the rule is snapshot

On acceptance, a trigger freezes the whole resolved rule onto
`transactions.fee_snapshot` — basis, value, floor, cap, schedule ref, and when
it was resolved. Escrow release then re-applies **that frozen rule** to the
amount being released.

The *rule* is frozen rather than the naira figure, because the figure was
computed against the transaction subtotal and a partial release moves something
else. And the snapshot is read instead of joining back to `fee_schedules`,
because a frozen rule that consults a live table is not frozen.

If a deal has no snapshot — escrow with no transaction, or a deal accepted
before the schedule existed — release falls back to the global bps and records
`source: 'platform_config_fallback'` with the reason on the escrow event. It
never presents a fallback as though a schedule applied.

---

## Escrow is a workflow

```
created → funded → held → verification → loading → in_transit
                                              → delivered → accepted → released
        refunded ← (funded | held | verification | disputed)
        disputed ← any live state
```

**Release is deliberately the narrowest path in the system.** It is reachable
*only* from `accepted`, `accepted` is reachable *only* from `delivered`, and
only the **buyer** can set it. There is no shortcut from `held` to `released`,
and the test suite asserts that all three parties are refused if they try.

Funding and holding are `provider`-initiated: a member cannot declare their own
payment funded.

### Escrow ↔ transaction payment mapping

The two state machines are kept aligned deliberately:

| Escrow event | Transaction payment event |
|---|---|
| `funded` | `payment_initiated` (not_started → pending) |
| `held` | `payment_held` |
| `released` | `payment_released` |
| `refunded` | `payment_refunded` |

Escrow only ever speaks about **money**. It never moves the agreement or
fulfilment machines.

---

## Financing inherits its transaction

A buyer is not asking "give me ₦10m". They are asking "finance *this* purchase"
— this batch, this seller, this price. So `loamy_apply_financing_for_transaction`
derives the amount from the transaction subtotal rather than accepting a typed
figure, and carries `transaction_id`, `batch_id`, `listing_id` and `seller_id`
so a bank can see exactly what it is funding.

**Three amounts, kept apart:**

| | |
|---|---|
| `amount_requested` | What the applicant asked for |
| `approved_amount` | What the bank approved |
| `disbursed_amount` | What actually moved |

A trigger refuses any client write to `approved_amount`, `disbursed_amount`,
`bank_id`, or a decision status. Only `loamy_financing_decision` can set them,
and only an officer of the **assigned** bank.

---

## The bank integration boundary

Per-bank capability flags, all defaulting to **no**:

- `supports_account_opening`
- `supports_supplier_direct` — never assumed; the directive is explicit that not
  every bank can pay a seller directly
- `supports_status_callback`
- `integration_mode` — `sandbox` until a real integration is signed off, then
  switched to `live` deliberately, per bank, by an admin

### Bank accounts without BVN

"Do you have a *[Bank]* account?"

- **Yes** → link it. Loamy stores the **last four digits only** and an opaque
  bank-issued reference. A full account number is not needed for Loamy's side
  of the workflow, and a column that cannot hold one cannot leak one.
- **No** → routed to the bank's own account-opening flow. Loamy collects
  nothing further.

---

## The eligibility signal is a recommendation

`loamy_eligibility_signal` returns **factors and a band** — never a naira
entitlement, and never the hard-coded ₦100k–₦500k ladder the directive
prohibits. Weights live in `platform_config.settings` and are configurable.

The payload carries its own disclaimer, so no UI can accidentally present it as
an offer:

> *A Loamy eligibility signal based on platform activity. It is not a credit
> decision, not an offer, and not a guarantee. The bank decides.*

---

## Before any of this goes live

1. **Confirm the legal position on escrow.** The model says a provider holds the
   funds. That must be true in the contract too.
2. **Name a partner bank** and move its `integration_mode` off `sandbox`.
3. **Prove the webhook end to end** with a real signed event — currently only
   *rejection* is tested (see `docs/testing.md`).
4. **Stand up reconciliation as a scheduled job**, not a view somebody
   remembers to open. `loamy_run_reconciliation` exists and records a run; what
   is missing is something that calls it without being asked.
5. **Populate the fee schedule.** The mechanism is in place and the migrated
   global rule is the only row in it. The commercial rates — per user type,
   transaction type, partner and volume — are a business decision, not a
   code one.
