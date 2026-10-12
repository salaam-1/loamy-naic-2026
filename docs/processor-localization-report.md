# Processor localization report

Written for: the engineer who picks up Wave A.4, and whoever decides when a
language may be described to members as supported.

Wave A.3 localized the Processor and large-offtaker cluster: the procurement
pipeline (buy request → bid → award → contract → inspection → logistics →
escrow), the company and team surfaces, and the analytics screen.

Everything below is the state of the repository at the end of this wave. Where
something is incomplete it says so and says how incomplete.

---

## 1. What was localized

| Surface | File | Status |
| --- | --- | --- |
| Overview / KPIs | `src/pages/processor/ProcessorOverview.tsx` | wired |
| Company profile | `src/pages/processor/CompanyHub.tsx` | wired |
| Company team | `src/pages/processor/CompanyTeam.tsx` | wired |
| Buy requests (list + detail) | `src/pages/processor/BuyRequests.tsx` | wired |
| Buy request wizard (6 steps) | `src/pages/processor/RfqWizard.tsx` | wired |
| Bid ranking + award | `src/pages/processor/RfqBidsPanel.tsx` | wired |
| Escrow (per award) | `src/pages/processor/AwardEscrow.tsx` | wired |
| Inspection (per award) | `src/pages/processor/AwardInspection.tsx` | wired |
| Logistics (per award) | `src/pages/processor/AwardLogistics.tsx` | wired |
| Contracts + documents | `src/pages/processor/Contracts.tsx` | wired |
| Contract detail + e-signature | `src/pages/processor/ContractView.tsx` | wired |
| Inspections overview | `src/pages/processor/Inspections.tsx` | wired |
| Inspection report | `src/pages/processor/InspectionReport.tsx` | wired |
| Logistics overview | `src/pages/processor/Logistics.tsx` | wired |
| Analytics | `src/pages/processor/Analytics.tsx` | wired |

Fifteen components, plus the vocabularies they read from `src/lib/rfqs.ts`,
`src/lib/awards.ts`, `src/lib/bids.ts`, `src/lib/contracts.ts`,
`src/lib/companies.ts` and `src/lib/escrow.ts`.

### The audit was wrong twice, and both corrections are in these numbers

The opening audit reported **278** interface strings across 15 components and 3
lib files. Both halves of that were short:

- **`src/lib/rfqs.ts` and `src/lib/awards.ts` were not in the audited lib
  list.** Between them they hold ~38 user-facing strings: `UNITS`,
  `PACKAGING_TYPES`, `GRADES`, `VISIBILITY_LABELS`, `INSPECTION_LABELS`,
  `PAYMENT_LABELS` and the eight `AWARD_STAGES`. These are the words on the
  wizard's radio cards and the award tracker, i.e. some of the most-read copy
  in the cluster.
- **A whole read-only block in `CompanyHub.tsx` was missed on the first pass**
  (`RC / BN number`, `CAC number`, `TIN`, `Contact person`, `Phone`, `Email`,
  `Business address`), because the grep pattern that found the *form* labels
  did not match `<Field label="…">`.

Final count: **547 canonical keys** under `processor.*`, every one of them
reachable from a component. Platform-wide the canonical pack is now 2,081 keys.

### Thirty keys were deleted rather than counted

The first draft of `en/processor.ts` was written from the route list before the
screens were read, and 29 of its keys turned out to be scaffold that no
component renders (`processor.rfq.deliveryWindow`, `processor.contract.upload`,
`processor.logistics.arrange`, …), plus one error key that was never wired
(`error.paymentRequestFailed`). They were removed. A key nothing renders inflates
the coverage number and sends a translator to work on a string no member will
read. `tests/unit/` has no guard for this; the check is the script in the wave
log, and re-running it is cheap.

---

## 2. Translation coverage, per language

| Language | Translated | English fallback | Review status |
| --- | --- | --- | --- |
| English | 547 / 547 | - | canonical |
| French | 547 / 547 | 0 | **translated, NOT native-reviewed** |
| Hausa | 528 / 547 | 19 | partial by decision, NOT native-reviewed |
| Igbo | 528 / 547 | 19 | partial by decision, NOT native-reviewed |
| Yoruba | 528 / 547 | 19 | partial by decision, NOT native-reviewed |

**No language is native-reviewed.** French reaching 547/547 means extraction
and translation are complete, and nothing more. `REVIEW_STATUS` in
`src/lib/i18n/packs/index.ts` still records `fr: 'unreviewed'` and
`ha | ig | yo: 'partial'`, and this wave did not change any of them.

### What the 19 English-fallback keys are

Long explanatory paragraphs - empty-state prose and two of the longer help
texts. Every one of them is informational: nothing a processor must read in
order to act correctly is among them.

```
processor.analytics.liveFigures          processor.overview.registerPrompt
processor.analytics.noneYetBody          processor.rfq.noneYetCta
processor.analytics.sparse               processor.rfq.registerFirstBody
processor.bid.noneYet                    processor.team.footnote
processor.contract.noDocuments           processor.team.registerFirstBody
processor.contract.noneYetAuto           processor.team.roleHelp.procurementDirector
processor.contract.registerFirstBody     processor.visibility.invited.help
processor.inspection.noneYetRequest      processor.visibility.open.help
processor.logistics.noneAwarded          processor.wizard.templateHint
processor.logistics.registerFirstBody
```

The consequential long-form copy WAS translated into all five languages, because
getting it wrong costs a member money or access:

- `processor.bid.disclosureNote` - when a supplier's phone number is shared.
- `processor.paymentMode.escrow.help` / `.bank_transfer.help` - who holds the
  funds, and that direct transfer has no escrow protection.
- `processor.escrow.noRecipient` - why a release did not reach the supplier.
- `processor.rfq.confirmClose` / `.confirmCancel` - which of the two
  irreversible things is about to happen.
- `processor.team.removeBody` - that removal revokes workspace access.
- `processor.contractView.signExplainer` - what the typed signature amounts to.

### Zero faked translations

Checked mechanically: the only `processor.*` value identical to its English in
`ha`, `ig` or `yo` is `processor.company.tin` (`TIN`, an identifier the glossary
keeps unchanged) plus 11 placeholder-only templates such as
`{quantity} {unit} · {price}/{unit}` which contain no words. French has 23
identical values, all genuine cognates (`kg`, `Inspection`, `Transport`,
`Distance`, `Version`, `Documents`, `score`) or placeholder-only templates.

### Terms that had to be coined

The Igbo and Yoruba packs had no established word for escrow, bid or award. The
choices are recorded in `src/lib/i18n/glossary.md`, and four of them are added
to the "terms a reviewer should challenge first" list:

| Concept | Hausa | Igbo | Yoruba | French |
| --- | --- | --- | --- | --- |
| escrow | `amana` (in use) | `nchekwa ego` *(new)* | `ìpamọ́ owó` *(new)* | `séquestre` (in use) |
| bid / offer | `tayi` (in use) | `onyinye` *(new)* | `àbá` *(new)* | `offre` |
| award | `amincewa` *(new)* | `ikenye` *(new)* | `ìfúnni` *(new)* | `attribution` |
| buy request | `buƙatar siye` *(new)* | `arịrịọ ọzụzụ` *(new)* | `ìbéèrè ìrajà` *(new)* | `demande d'achat` |

The Yoruba `ipò` collision is called out explicitly: it renders both *grade* and
*status*, which appear on the same bid row.

---

## 3. What is NOT translated, and why

### The downloadable purchase contract stays English - by decision

`contractHtml()` in `src/lib/contracts.ts` generates the contract both parties
e-sign and download. Its labels (`Purchase Contract`, `Buyer`, `Total value`,
`Signed`, `Escrow via payment partner (Paystack)`) were left in English
deliberately.

A purchase contract's authoritative wording is the text the parties signed.
Generating a Hausa version from the same row would produce a second document,
with legally different text, that nobody reviewed - and the signature block
records a typed name against "the terms above", which has to be one fixed text.
Localizing this needs a lawyer, not a translator. It is flagged here rather than
changed.

### The analytics CSV export stays English - by decision

`analyticsCsv()` writes the header `Section,Key,Quantity,Avg price,Spend`.
Column names that change with the viewer's UI language break every downstream
spreadsheet and formula built on an earlier export. Export schemas are a
contract with other software.

### Server-generated text

Unchanged from the limitation recorded in Wave A.2: text the database composes
(activity-feed entries, `activity.note`) cannot be translated client-side,
because the words arrive already assembled. Localizing it needs the server to
emit a key and parameters instead of a sentence - a schema change, documented
rather than made.

### One residual English string in an error path

`extractFnError()` in `src/lib/escrow.ts` falls back to
`'Payment request failed.'` when an edge-function rejection is not an `Error`
and carries no message. It is a last-resort branch; it is English, and it is
counted as English.

---

## 4. Two bugs found and fixed on the way

### Counted strings rendered their own key names - in all five languages

Three key families shipped written as `base_one` / `base_other`, which is the
i18next convention and not this engine's. `pluralKey()` returns the bare base
for the `one` category and `base_plural` for `other`, so every one of those
lookups missed:

| Key family | Surface |
| --- | --- |
| `transaction.orderPlaced` | `src/pages/marketplace/OrdersPage.tsx` |
| `verification.fieldOps.evidenceCount` | `src/pages/partner/FieldOps.tsx` |
| `logistics.transport.quoted` | `src/components/fulfilment/TransportCard.tsx` |

A member on the orders screen read the literal text
`transaction.orderPlaced_plural`. **In English too** - this was not a
translation gap, it was a broken lookup. The pack-to-pack parity tests could not
see it because the packs agreed with each other and all three disagreed with the
code.

Fixed by renaming to the convention `pluralKey` actually produces, and guarded
by `tests/unit/plural-keys.test.ts`, which takes each `tPlural(` base out of the
source, runs it through the real `pluralKey` for every locale and several counts,
and requires the resulting key to exist. Reverting the rename makes it fail.

A stale comment in `tests/unit/i18n-engine.test.ts` that asserted the
`_one`/`_other` convention - and was the reason nobody caught this - was
corrected to point at the new guard.

**Still owed:** `ha` is missing the `a11y.addedToCartAnnouncement`, `quoted` and
`evidenceCount` forms; `ig` and `yo` are missing `orderPlaced`, `quoted` and
`evidenceCount`. They fall back to correct English now rather than to a key
name, so this is a coverage gap, not a defect. Note for whoever closes it: Igbo
and Yoruba have a single plural category, so for them even a count of one
resolves to `_plural`, and that form must read naturally for one as well as many.

### Browser number formatting ignored the member's language

`Analytics.tsx` formatted supplier volumes with `n.toLocaleString()`, which uses
the *browser's* locale, not the language the member chose in Loamy. Now uses the
i18n contract's `num()`.

---

## 5. Unbounded reads

Nineteen unbounded `.select()` reads existed in the procurement cluster.
Sixteen - every one the Processor can reach - are now bounded by
`PROCUREMENT_LIST_LIMIT` (500) in `src/lib/limits.ts`, each with an `id`
tiebreaker so the capped page is stable between loads.

The `id` column was verified against the migration that creates each view, not
assumed.

**This is a bound, not pagination.** PostgREST already truncated these at 1000
rows silently; the change makes the cap explicit, legible and stable, and
`isCapped()` lets a surface say so. No cursor, no page 2. The surfaces that will
need real paging first are contracts and the company document repository, since
those accumulate without bound over a company's life.

Three reads remain unbounded, deliberately - they belong to the carrier and
warehouse-owner boards, not Processor:

```
loamy_open_transport_jobs        the carrier's job board
loamy_transport_jobs_v           a carrier's own assigned jobs
loamy_warehouse_reservations_v   a warehouse owner's own reservations
```

They are listed in `KNOWN_OUT_OF_WAVE` in
`tests/unit/procurement-bounded.test.ts`, which fails if a new unbounded read
appears in the cluster **and** fails if one of those three gets bounded without
being removed from the list.

`src/lib/procurement.ts` (analytics) was already bounded by
`ANALYTICS_MAX_ROWS`. Worth knowing: it aggregates in the browser, so a company
with more awards than that ceiling gets totals computed over a subset. Fixing
that properly needs a server-side aggregate; per the standing instruction it is
documented, not changed.

---

## 6. Touch targets

The root font is 15px, so every rem-based Tailwind height is multiplied by
0.9375 and `h-10` renders at 37.5px, not 40.

Six undersized interactive controls were found in the cluster and fixed with
`min-h-touch`:

| File | Control | Was |
| --- | --- | --- |
| `AwardEscrow.tsx` | partial-release amount input | 30.0px |
| `AwardInspection.tsx` | inspection date input | 30.0px |
| `RfqBidsPanel.tsx` | award quantity input | 30.0px |
| `CompanyHub.tsx` | industry select | 37.5px |
| `CompanyTeam.tsx` | role select | 37.5px |
| `RfqWizard.tsx` | `selectCls`, shared by **7 selects** | 37.5px |

The wizard one is the interesting one: the height lived in a module constant, so
the first scan - which looked at JSX only - missed all seven. That is the same
blind spot that made the string audit undercount, showing up in styling. The
scan was extended to resolve class constants before judging an element, and
reports zero remaining.

### Parts 9 and 10 are BLOCKED, not done

Authenticated responsive and touch QA at 390 / 768 / 1440 could not be run.
`scripts/verify-touch-targets.mjs` measures real boxes in a real browser and
needs a signed-in processor; `.env.test` has accounts for ADMIN, BUYER, FARMER
and LOGISTICS only. There is no `processor` fixture.

This is the same blocker that stopped the Wave A.2 field-ops QA for the missing
`growth_partner` fixture. The static audit above is what could be done without a
browser session, and it is weaker: it proves no source class is undersized, not
that no rendered box is. **Do not read this section as a passed browser QA.**

---

## 7. Tests added

| File | What it holds |
| --- | --- |
| `tests/components/processor-i18n.test.tsx` | 31 tests. All 547 keys render in five languages; en+fr complete; the lib vocabularies match the packs word for word; 15 pairs of load-bearing states must not collapse **in any language**; the escrow custody claim must not name Loamy; placeholders survive translation. |
| `tests/unit/plural-keys.test.ts` | Source-to-engine: every `tPlural(` base resolves through the real `pluralKey` for every locale and count. |
| `tests/unit/procurement-bounded.test.ts` | No unbounded read in the cluster; every cap has a unique tiebreaker; the out-of-wave list stays honest. |

All three were mutation-checked rather than assumed: collapsing two Hausa
money stages, dropping a `{amount}` placeholder, claiming Loamy holds the funds,
reverting the plural rename, and removing one `.limit()` each produce a failure.

Suite at end of wave: **52 files, 1,191 tests, all passing.** `tsc --noEmit`
clean.

---

## 8. What was deliberately not touched

- **The security suite was not re-run.** No security test, retry, timeout,
  concurrency, provisioning or staging configuration was modified. The RLS
  failure outstanding from the last completed run is untouched and unmasked.
  Nothing here should be read as a claim that the security gate is green.
- **Production.** No deployment, no production migration, no production data or
  configuration change.
- **Copilot / Loam / LiyaEngine.** Out of scope, untouched.
- **Procurement, transaction, financing, fee, logistics, warehouse, batch,
  permission, RLS, verification, settlement and payment rules; the database
  schema.** Unchanged. Role strings stay the DB's `company_role` values and
  stored units, grades, packaging types and industries stay English - only the
  labels a member reads were translated, so a request posted in Hausa and a bid
  placed in English still describe the same goods.
- **`src/pages/supplier/TransportBoard.tsx`.** It renders `TRANSPORT_LABEL`, and
  the `logistics.transportStatus.*` keys this wave added now exist for it, but
  the file belongs to the supplier wave and was left alone.

---

## 9. Honest summary

The Processor interface is operable end to end in English and French, and
operable - every status, label, button, column, form field, validation message
and failure - in Hausa, Igbo and Yoruba, with 19 informational paragraphs
falling back to English.

**The platform is not fully multilingual, and no language has been reviewed by a
native speaker.** The Igbo and Yoruba procurement vocabulary in particular
contains coined terms that a reviewer is likely to improve on; `glossary.md`
names them.
