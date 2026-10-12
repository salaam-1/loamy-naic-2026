# Traceability

**Status:** Phase 10 complete. Phase 12 adds a separate, narrower institutional
lookup.

## The chain

```
FARM → PRODUCTION CYCLE → HARVEST → BATCH → VERIFICATION
     → LISTING → TRANSACTION (+ payment state) → LOGISTICS → WAREHOUSE → DELIVERY
```

`loamy_trace_batch(ref)` reconstructs it. It accepts either the printed
reference (`BATCH-000982`) or a raw uuid, so the thing a person is holding is
the thing they can type.

## The rule that shapes everything

> *"The system must never fabricate missing history. If an event does not
> exist: display that it is unavailable. Do not infer it."*

Every link returns one of three shapes, never an empty success:

```json
{ "available": true,  "ref": "HARV-000044", "...": "..." }
{ "available": false, "reason": "never_listed" }
{ "available": false, "reason": "not_permitted" }
```

Reasons in use: `origin_not_traced`, `record_missing`, `not_recorded`,
`never_verified`, `never_listed`, `never_sold`, `no_transport_recorded`,
`never_warehoused`, `not_permitted`.

A batch a trader aggregated from off-platform stock returns
`origin_not_traced` — it does not silently omit the farm and let the reader
assume one existed.

## Scopes

`loamy_trace_batch` is `SECURITY DEFINER`, so it crosses every RLS boundary.
Entitlement is computed **once** by `loamy_trace_scope`, and every section
redacts against it.

| Scope | Who | Sees |
|---|---|---|
| `none` | Everyone else | Nothing. Same response as a nonexistent ref |
| `public` | Any member, when the batch is **actively listed** | Commodity, origin **state**, verification status, event spine. No identities, no quantities, no prices |
| `party` | A counterparty, carrier or storer | + transactions, logistics, warehouse, quantities |
| `origin` | The farmer who grew it, or the current holder | + farm name, LGA, declared vs mapped hectares |
| `admin` | Platform | + counterparty names, transaction values |

**`none` and "not found" return the identical response.** Otherwise the
function is an oracle for guessing which batch references are real.

## Institutional lookup is separate

`loamy_institutional_trace` does **not** reuse the scope ladder. An institution
is never a party, and letting them inherit `party` would be exactly the scope
creep Part 26 warns about. They get the public shape, always, and every call is
audited — including the refusals.

### Why denial is a return value, not an exception

The institutional functions return `{ "allowed": false, "reason": ... }`
instead of raising. Postgres has no autonomous transactions, so a `RAISE` rolls
back the audit row written moments earlier — meaning every *refused* query
would vanish from the log while every *allowed* one was recorded. That is
backwards: an institution probing scopes it does not hold is the thing a
reviewer most wants to see.

It also lets a caller distinguish "you may not ask that" from "that region has
no activity", which an exception and an empty set cannot.

## Adding a field

Any new field in `loamy_trace_batch` is a disclosure decision. Check it against
the scope table above before adding it, and default to the most restrictive
scope that still makes the field useful.
