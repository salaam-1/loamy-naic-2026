# Data model

**Status:** Phases 1–4 — identity, provenance, farm → cycle → harvest, the
`CommodityBatch` spine with its event log, the verification engine, and
listings backed by real batches.

---

## The spine

```
USER ─owns→ FARM ─has→ PRODUCTION CYCLE ─yields→ HARVEST ─becomes→ COMMODITY BATCH
                                                                          │
                                        every state change ──────────→ BATCH EVENT
```

Everything else in Loamy hangs off that line. A listing sells a batch, a
transaction moves a batch, a warehouse receives a batch, and traceability walks
it backwards to a farm.

---

## Identity

Two identifiers per entity, on purpose.

| | Purpose |
|---|---|
| `id` (uuid) | Internal primary key. Joins, foreign keys, RLS. Never shown to a person |
| `ref` (text) | Business identity. `FARM-000091`, `HARV-000044`. Quoted in support, printed on documents, resolved by traceability |

`loamy_entity_refs` maps every `ref` → `(entity_type, entity_id)`. One registry,
not one per dashboard, so "enter an ID and show me what it is" needs no
knowledge of which table to look in.

**Resolving a ref proves existence only.** The registry is readable by any
signed-in member; the *entity* behind it keeps its own RLS. Knowing
`FARM-000091` exists tells you nothing about that farm.

Prefixes in use: `FARM`, `PROD`, `HARV`, `OBS`. Reserved for later phases:
`BATCH`, `LIST`, `TXN`, `WH`, `LOG`, `VER`, `FIN`, `PAY`.

Allocation is a single UPSERT … RETURNING, so concurrent callers serialise on
the row lock and can never receive the same number.

---

## Provenance — `entity_observations`

The rule from the directive: **never overwrite an important observation.**

A farmer declaring 10 hectares, an agent measuring 8.7, and a polygon computing
8.4 are three facts with different weight. Collapsing them into one column
destroys exactly the information a bank needs.

| Column | Meaning |
|---|---|
| `subject_type` / `subject_id` | What the observation is about |
| `attribute` | `area_hectares`, `location`, `quantity`, `grade` … |
| `value_numeric` / `value_text` / `value_json` | The observed value |
| `source` | **The important one.** `user_declared`, `field_captured`, `system_derived`, `satellite_derived`, `partner_reported` |
| `actor_id` | Stamped from `auth.uid()` server-side — never client-supplied |
| `confidence` | 0–1, nullable |
| `status` | `recorded` → `superseded` / `disputed` / `rejected` |
| `evidence` | Private-bucket references, GPS, checklist answers |

Recording a new value marks earlier ones `superseded`. It does not delete them.

**Append-only is enforced, not just intended:** there is no client `UPDATE` or
`DELETE` policy on the table, and none may be added. Tested in
`tests/security/phase1-entities.test.ts`.

`satellite_derived` is a distinct source because the directive is explicit that
remote sensing is never equivalent to a physical visit. The type system should
make that impossible to blur.

---

## Farm

Existing table, extended in Phase 1.

| Field | Note |
|---|---|
| `size_hectares` | **DECLARED** by the farmer. Never overwritten |
| `mapped_area_hectares` | **COMPUTED** from `boundary`. Null until a boundary is walked |
| `boundary` | GeoJSON Polygon captured in the field |
| `community`, `size_unit`, `status`, `ref` | Added Phase 1 |

Keeping declared and mapped side by side is the point. A 10 ha claim against an
8.4 ha polygon is a credit signal; silently replacing one with the other throws
it away.

### Why GeoJSON in `jsonb` and not PostGIS

A deliberate trade-off, not an oversight.

PostGIS is the right tool for proximity search and will be adopted with the
geospatial work in **Phase 11**. It was not adopted now because it is an
extension-level change to a live database serving real accounts, and nothing in
Phase 1 queries by proximity. The column is `jsonb`, so moving to
`geography(Polygon)` later is a backfill, not a redesign.

Area is computed by `loamy_geojson_area_hectares` using the spherical-excess
formula on the earth's mean radius — accurate to well under a percent at farm
scale, which is finer than the GPS input supports. It returns `null` rather
than throwing on malformed input: a bad boundary must never block saving a farm.

---

## Production cycle

**Stored in `crop_records`**, extended rather than replaced.

That table already modelled a production cycle almost exactly (farm, crop,
season, planting date, expected/actual harvest, yields). Creating a parallel
`production_cycles` table would have produced two sources of truth and a data
migration for no gain. Phase 1 added `ref`, `status`, `expected_quantity`,
`actual_quantity`, `quantity_unit`, `updated_at`.

The view `loamy_production_cycles` exposes it under the directive's name, joined
to the farm, with `security_invoker = on` so the caller's RLS still applies.

Status: `planned` → `planted` → `growing` → `harvested`, or `failed` /
`abandoned`.

Historical cycles are never overwritten — last season's record is the
intelligence.

---

## Harvest

New in Phase 1. An **event** against a production cycle; one cycle may yield
several.

Carries commodity, date, quantity + unit, quality grade, condition, physical
location (which need not be the farm), evidence references, and status
(`recorded` → `verified` → `batched`, or `disputed` / `cancelled`).

Two integrity rules enforced in RLS rather than the form:

1. The cycle must belong to the same farm as the harvest.
2. The caller must own that farm.

Once Phase 2 creates a batch, status moves to `batched` and quantity stops
being freely editable — from then on it changes through batch events.

---

## Ownership

| Entity | Owner | Who may change it |
|---|---|---|
| Farm | Farmer (`owner_id`) | Owner; verification status only via the verification workflow |
| Production cycle | Farm owner | Owner |
| Harvest | Farm owner | Owner, while `recorded` |
| Observation | The actor who made it | Nobody — append-only |
| Reference registry | Platform | Nobody directly; assigned by trigger |

---

## Read boundaries

Farms, cycles and harvests are **owner + admin only** at this phase.

A harvest states how much stock exists and where it physically is. That is
commercially sensitive and a theft risk. Phase 4 will expose a *derived*
summary to buyers through the marketplace — commodity, quantity band, state —
never this table and never the coordinates.

---

## Commodity batch

The traceability spine. A specific quantity of a specific commodity that can be
followed through the ecosystem, created **from a harvest** and outliving the
listing that sells it.

`quantity` is what the batch was created with; `available_quantity` is the
uncommitted remainder. `origin_owner_id` is the farmer who created it and never
changes; `owner_id` is whoever controls it now and moves on sale.

`origin_traced` is a boolean rather than an inference. A trader aggregating
stock that never passed through a Loamy farm gets a batch with
`origin_traced = false` — the data says the origin is declared, instead of
quietly implying it was traced.

### Two guarantees, enforced in the database

**1. Quantity never mutates silently.** There is no client `INSERT` or `UPDATE`
policy on `commodity_batches` at all. `available_quantity` moves only through
`loamy_batch_transition`, which records a signed `quantity_delta` and the
`quantity_after` balance it produced. The row is locked `FOR UPDATE`, so two
concurrent sales cannot both pass the balance check.

`loamy_create_batch_from_harvest` also refuses to over-issue: batches created
from a harvest can never exceed the harvest quantity, so 100 tonnes harvested
cannot become 200 tonnes of traceable maize.

**2. Status never moves arbitrarily.** `batch_transition_rules` is an explicit
matrix of `event_type → (allowed_from[], new_status, initiator)`. An event type
with no rule is refused — the safe default. `initiator` is one of:

| | Meaning |
|---|---|
| `holder` | The member who currently controls the batch |
| `platform` | Admin only — verification outcomes |
| `system` | Server-side workflow (Phases 4–9 call these from their own definer functions) |

So a seller can list and unlist their own batch, but **cannot mark it verified
and cannot mark it sold.** Both are tested.

### Batch events

Append-only. Each records actor, previous and new status, quantity delta and
resulting balance, location, and a `subject_type`/`subject_id` pointing at the
listing, order, shipment or warehouse that caused it.

No client insert, update or delete policy exists, and none may be added — an
editable evidence log is worth nothing. The ordered history replays to the
batch's current balance, which is what Phase 10 traceability will walk.

## Listing

A listing is now one of two honestly-labelled things, and `claim_basis` says
which:

| `claim_basis` | Meaning |
|---|---|
| `batch_backed` | A real `CommodityBatch` stands behind it. Commodity, unit and grade are copied FROM the batch, not typed |
| `seller_declared` | The seller typed it. Nothing verifies the stock exists |

`batch_id` and `claim_basis` are **not seller-writable**. A trigger refuses a
direct insert carrying a `batch_id`, refuses `claim_basis = 'batch_backed'`
without one, and refuses upgrading a declared listing by update. The only way
to a backed listing is `loamy_list_batch`, which checks ownership and refuses
to over-list — one 60-tonne batch cannot be advertised twice as 60 tonnes.

**Declared listings still work.** Input listings have no harvest and never
will, and live accounts already have declared inventory. Forcing a batch would
delete working listings to satisfy a model. Over-claiming is the failure mode
worth preventing, not declared listings existing.

### Three things a buyer must not confuse

The public view returns all three separately, because they are easy to blur:

| | Means |
|---|---|
| `seller_verified` | This **seller's identity** is verified |
| `claim_basis = batch_backed` | Real traceable stock stands behind **this listing** |
| `verification_status = verified` | Someone **physically went and looked** at it |

A verified seller with a declared listing is still a declared listing. The
`StockClaim` component renders this distinction and never invents a middle
state.

The public view exposes `verification_status`, `origin_traced`, `batch_ref` and
`origin_state` — and deliberately not `farm_id`, coordinates, `current_location`
or the origin farmer's identity. A batch's physical whereabouts must never reach
an untransacted buyer.

### Buyer-requested verification

`loamy_request_listing_verification` is the remote-sourcing trust feature: a
buyer in Lagos looking at maize in Benue can ask Loamy to send someone. It opens
a `commodity_verification` case with the buyer as requester, is idempotent per
buyer per batch, refuses a seller verifying their own listing, and refuses
outright on a declared listing — there is no stock record to inspect.

## Still missing after Phase 4

Named so nothing reads as more complete than it is.

- Verification cases/evidence/reviews as entities — **Phase 3**
- Listings referencing real batches — **Phase 4**
- Transaction, financing, payment and logistics entities — Phases 5–9
- Multi-business ownership (`businesses` / `business_memberships`) for all roles
- PostGIS, proximity search, route estimation — **Phase 11**
