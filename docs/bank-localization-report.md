# Bank portal localization report

Written for: the engineer who picks up Wave A.5, and whoever decides when a
language may be described to members as supported.

Wave A.4 localized the bank portal: the interface a lending officer works in.
Dashboard, application queue, application detail, decision panel, settlement,
facility servicing, collateral, disbursements, repayments, transactions, risk
and compliance, alerts, monitoring, reports and the credit report.

Everything below is the state of the repository at the end of this wave. Where
something is incomplete or was not done, it says so and says how.

---

## 1. The actual Bank baseline

**The portal does not use the generic dashboard tree.** 17 routes under `/bank`,
each wrapped in `RequireBank`, which gates on `profile.platform_role === 'bank'`
with an admin override. That is a different mechanism from Processor's
`PROCUREMENT_ROLES` role list. The portal has its own `BankShell` driven by a
14-item `BANK_NAV` module constant.

| Route | Component | Strings | Already keyed | New |
| --- | --- | --- | --- | --- |
| `/bank` | BankHome | 36 | 7 | 29 |
| `/bank/pipeline` | BankPipeline | 26 | 9 | 17 |
| `/bank/application/:appId` | BankApplicationDetail | 3 | 0 | 3 (already wired) |
| (in detail) | DecisionPanel | 28 | 5 | 23 |
| (in detail) | SettlementPanel | 22 | 3 | 19 |
| `/bank/loans` | BankLoans | 17 | 7 | 10 |
| `/bank/loans/:facilityId` | BankFacilityDetail | 32 | 11 | 21 |
| `/bank/customers` | BankCustomers | 7 | 1 | 6 |
| `/bank/collateral` | BankCollateral | 9 | 0 | 9 |
| `/bank/disbursements` | BankDisbursements | 8 | 3 | 5 |
| `/bank/repayments` | BankRepayments | 16 | 4 | 12 |
| `/bank/transactions` | BankTransactions | 11 | 5 | 6 |
| `/bank/risk` | BankRiskCompliance | 15 | 3 | 12 |
| `/bank/alerts` | BankAlerts | 8 | 0 | 8 |
| `/bank/monitoring` | BankMonitoring | 16 | 5 | 11 |
| `/bank/reports` | BankReports | 6 | 1 | 5 |
| `/bank/reports/:reportId` | ReportView | 26 | 8 | 18 |
| `/bank/messages` | BankMessages | 2 | 0 | 2 |
| `/bank/settings` | BankSettings | 0 | - | delegates to shared `Settings` |
| (chrome) | BankShell | 16 | 13 | 3 |
| `src/lib/financing.ts` | | 47 | 11 | 36 |
| `src/lib/financingLifecycle.ts` | | 48 | 28 | 20 |
| `src/lib/bank.ts` | | 15 | 3 | 12 |
| `src/lib/bankDecision.ts` | | 1 | 0 | 1 |
| **Total** | | **415** | **127** | **288** |

**19 of 20 components were unwired.** Only `BankApplicationDetail` used
`useT()` (62 calls): Phase 6 localized the financing APPLICATION path, not the
bank PORTAL. The 127 "already keyed" are literals whose English coincides with
an existing canonical key; they needed wiring to that key, not a new one.

### Three corrections to my own audit

The audit was wrong three times and each correction is in the numbers above.

1. **The first scan subtracted any value appearing in some pack**, conflating
   "keyed here" with "the same word exists elsewhere". It scored `BankShell` at
   3 strings while `BANK_NAV` holds 14 labels.
2. **`AppShell` already renders nav labels** through
   `tOr('nav.<section>', item.label)`, so `BANK_NAV` needed pack ENTRIES, not
   wiring. Nine of the fourteen `nav.*` keys did not exist.
3. **The JSX matcher missed interpolated text nodes.** `ReportView` was scored
   at 26 strings; `Purpose: {app.purpose}`, `Itemised use: {...}`,
   `Prior applications: {...}` and `Monitored milestones: N met, N missed...`
   were all invisible to a `>[A-Z]...<` pattern. Six more keys were added after
   a second pass.

Final: **321 canonical keys** under `bank.*`, every one reachable from a
component (one scaffold key, `bank.monitoring.milestone`, was deleted rather
than counted after it turned out to match a TypeScript type name rather than
any copy).

---

## 2. Coverage

The portal REUSES `financing.*` rather than coining a second status vocabulary,
so its real coverage is `bank.*` plus the financing keys its own screens render.
Counting only `bank.*` would overstate how usable the portal is.

**Keys the Bank portal asks for: 404.**

| Language | Bank portal | Global canonical | Review status |
| --- | --- | --- | --- |
| English | 404 / 404 | 2,402 | canonical |
| French | 404 / 404 | 2,385 / 2,401 (99%) | **translated, NOT native-reviewed** |
| Hausa | 392 / 404 | 1,971 / 2,401 (82%) | partial by decision, NOT native-reviewed |
| Igbo | 392 / 404 | 1,755 / 2,401 (73%) | partial by decision, NOT native-reviewed |
| Yoruba | 392 / 404 | 1,755 / 2,401 (73%) | partial by decision, NOT native-reviewed |

`REVIEW_STATUS` is unchanged: `fr: 'unreviewed'`, `ha | ig | yo: 'partial'`.
French at 404/404 means extraction and translation are complete and nothing more.

Hausa, Igbo and Yoruba also gained the 62 `financing.bank.*` keys the
application-detail screen renders, which Phase 6 had left English in those three
languages. That screen was localized but unreadable in them; it is readable now.

### The 12 keys left in English for ha / ig / yo

All informational empty-state bodies. Nothing a bank officer must read in order
to act correctly is among them:

```
bank.home.noApplications          bank.loans.noneBody
bank.home.requestedNotOutstanding bank.messages.comingBody
bank.customers.noneBody           bank.monitoring.noDecided
bank.facility.noSchedule          bank.reports.noneYet
bank.alerts.noneBody              bank.settlement.referenceHint
bank.collateral.noneBody          bank.disbursements.noneBody
```

The consequential long-form copy WAS translated into all five, because getting
it wrong misleads an officer about somebody else's money:

- `bank.decision.sandboxWarning` - that a decision is a simulation, said BEFORE
  it is recorded.
- `bank.decision.pricingNote` - Loamy holds no pricing policy of its own.
- `bank.decision.requestedHint` - the institution sets the figure.
- `bank.decision.giveReason` / `writeWhatYouNeed` - what the applicant will see.
- `bank.settlement.institutionPaysDirect` / `recordedNotice` - that Loamy never
  holds or moves the funds.
- `bank.decisionSupportOnly` - all financing decisions rest with the Bank.
- all ten `bank.condition.*` settlement preconditions.

### Zero faked translations

Checked mechanically. The only `bank.*` value identical to its English in ha, ig
or yo is `PAR 30+`, an industry acronym retained in all five languages. French
has 20 identical values: `Date`, `Type`, `Action`, `Actions`, `Description`,
`Principal`, `Note`, `Conditions`, `active`, `score` are the same word in French,
plus `PAR 30+`.

---

## 3. Financial terminology challenges

**This is the least certain translation work in the project.** It is financial,
it is read by professionals who have their own words, and a plausible-sounding
wrong term here is worse than anywhere else in the product.

`src/lib/i18n/glossary.md` records the full table. Six new entries were added to
the "terms a reviewer should challenge first" list:

| Term | Why it needs review |
| --- | --- |
| **facility** (ha/ig/yo) | Rendered as a "loan account". A facility is not an account, and it is the most-used noun in the portal. |
| **principal** (ha/ig/yo) | "original capital" / "head money". All read sensibly; none confirmed as what a lender writes on a statement. |
| **tenor** (ha/ig/yo) | "length of time". Correct in substance, probably longer than a practitioner's word. |
| **collateral** (ig/yo) | Coined. Hausa `jingina` is well attested and is the model for what good looks like. |
| **settlement vs repayment** (ig) | Both land near `ịkwụ ụgwọ`. Kept apart, but one is the bank paying a supplier and the other a borrower paying the bank. |
| **risk** (ig `ize ndụ`) | The ordinary sense is *danger to life*. May be too strong for credit, or exactly right. |

### The lending word is correct here, and only here

`rance` (ha), `agbazinye ego` (ig) and `yá owó` (yo) are the words for LENDING.
Elsewhere in the packs they appear only inside the sentence that says Loamy does
not lend, and the per-language disclaimer test matches on exactly those words.

In the bank portal they are correct, because **the bank is the lender**. What
differs is who lends, not the word. Each pack's header states this so nobody
reading `nav.loans: 'Rance'` concludes the disclaimer was contradicted.

---

## 4. The source-to-engine i18n contract (Part 3)

`tests/unit/i18n-source-contract.test.ts`, 6 tests. It starts from the SOURCE,
takes the key the application passes, and requires the ENGINE to resolve it. The
pack is data, not the authority.

The A.3 incident is the reason: three key families used i18next's
`_one`/`_other` while `pluralKey()` produces base and `_plural`. Five parity
tests were green at the time and **all of them compared pack to pack**. The packs
agreed with each other perfectly and all disagreed with the code.

All five failure classes Part 3 names were mutation-tested:

| Injected fault | Caught |
| --- | --- |
| nonexistent key | yes |
| namespace typo in an interpolated prefix | yes |
| wrong plural suffix in a pack | yes |
| dropped interpolation variable | yes |
| stale key removed from the pack | yes |

Two bugs in the guard itself were found and fixed before it was trusted: it read
only the remainder of a call's own LINE (reporting ten multi-line calls as
passing no variables), and it missed shorthand properties, so `t('k', { email })`
counted as supplying nothing. Both produced false positives; a guard that cries
wolf gets switched off.

---

## 5. Number, date and money formatting (Part 5)

**The A.3 defect had recurred, in two places.**

| Site | Was | Now |
| --- | --- | --- |
| `financingLifecycle.ts:260` | `requested.toLocaleString('en-NG')` | `formatNaira(requested)` |
| `BankApplicationDetail.tsx:154` | `Number(txn.quantity).toLocaleString('en-NG')` | `num()` from the i18n contract |

The two follow OPPOSITE rules and both are asserted:

- **Money keeps the Nigerian convention in every language.** `formatNaira`
  produces one identical string for all five locales; `₦250,000` is not a
  localization choice.
- **Counts and dates follow the member's chosen locale.** The test proves French
  grouping actually differs from English (`1,234,567` vs a narrow-space form),
  that every locale formats without going blank, and that a date never renders
  as the raw ISO string.

### The behavioural check could not catch the money regression, so a source rule does

Reverting `formatNaira(requested)` to `'₦' + requested.toLocaleString('en-NG')`
produces the **identical string**. The mutation was injected and the suite stayed
green. What makes a hardcoded locale wrong is not the output for one number, it
is that the output can never follow the member.

So the rule is asserted as a rule: `no bank source hardcodes a locale in a
formatter` greps every bank file for `toLocaleString('xx')` and
`new Intl.X('xx')` and fails. Re-injecting the same mutation now fails at
`financingLifecycle.ts:296`.

**Platform finding, out of this wave:** `src/lib/utils.ts` exports its own
`formatDateShort` which hardcodes `'en-NG'`, separate from the locale-aware one
on the i18n contract. **83 files platform-wide import it.** The 13 bank files
were moved to the i18n contract's `dateShort`; the other 70 still render dates in
en-NG whatever language the member chose. That is a platform-wide change and
belongs to its own wave.

---

## 6. Large reads (Part 14)

**20 unbounded reads, all in the COMPONENTS** - the bank screens query Supabase
directly rather than through a lib. The tables are a loan book: `facilities`,
`repayment_schedule`, `disbursement_records`, `collateral`, `credit_reports`,
`repayment_milestones`. A silent truncation here hides an instalment.

All 20 are now bounded, with an `id` tiebreaker so the capped page is stable
between loads. Two constants, because the reads do two different jobs:

- **`BANK_LIST_LIMIT` (500)** for list displays. An honest, legible cap.
- **`BANK_AGGREGATE_CEILING` (5000)** for reads that are AGGREGATED or used as a
  lookup map for name resolution. These must cover the whole set to be
  arithmetically right, so a cap cannot make them correct; it states the
  assumption in the code.

### `BankRepayments` needed a semantic change, not just a limit

It fetched every instalment and filtered by status in the browser. Bounding that
read would have quietly broken the filter: cap at the first N by due date, filter
for `overdue` over those N, and an officer looking for an overdue instalment that
sorts later sees an empty table and concludes nothing is overdue.

The status filter now runs **in the query**, so the question the officer asked
and the rows they get back describe the same set. `overdue` still sorts first.

### Still owed, and honest about it

`BankHome` computes its KPI tiles and donut from the full pipeline RPC, then
`.slice(0, 8)` for display. PostgREST stops at its own `db-max-rows` (1000 by
default) whatever the client asks for, so **an institution with more facilities
than that ceiling is already getting totals computed over a subset, today, with
nothing saying so.** Writing the limit down does not repair the arithmetic. The
fix is a server-side aggregate, which is a schema and function change rather than
a localization one, and is recorded here instead of attempted.

`tests/unit/procurement-bounded.test.ts` was extended to the bank files and
mutation-tested (removing one `.limit()` fails it). It also learned the
query-builder pattern: a `let q = supabase.from(...)` finished with `.limit()`
six lines later is bounded, and judging the declaration line alone called
`BankRepayments` unbounded when it was not.

---

## 7. Responsive and authenticated QA (Parts 12 and 13)

**Bank browser QA RAN.** This is the first wave where it was not blocked.

`.env.test` has no bank account, but `RequireBank` admits
`profile.role === 'admin'`, so the **existing admin fixture reaches every
`/bank` route by the guard's own rule**. No credential was created and no
staging row was written: `scripts/verify-bank-qa.mjs` signs in, navigates,
measures and leaves.

117 page scans: 14 routes at 390 / 768 / 1440, plus the 5 densest screens at all
three widths in all five languages.

| Check | Result |
| --- | --- |
| Document horizontal overflow | **0** |
| Elements overflowing the viewport right edge | **0** |
| Visible translation keys | **0** |
| Undersized controls in Bank code | **0** |
| Undersized controls in shared chrome | 10 distinct (see below) |

A source-level scan with class constants resolved agrees: **0 undersized
controls across all 20 bank components.** Both methods were used because A.3
showed the browser alone misses a height living in a module constant.

### What the QA does NOT cover, stated plainly

An admin session is **not scoped to an institution**, so several screens rendered
their empty state. This measured chrome, layout, controls, and the empty and
loading states. **Populated tables with many rows were not exercised.** Do not
read this section as full bank QA with a bank officer's data on screen.

The smallest fixture a future wave needs: one staging profile with
`platform_role = 'bank'`, linked to one institution that has at least one
submitted application, one active facility and one repayment schedule with an
overdue instalment. That would exercise the dense tables, the decision panel
with real `permitted_decisions`, and the overdue-first ordering.

### The 10 shared-chrome findings, out of wave

Real, measured, and **not Bank code**. They appear on every page in the app:

| Control | Rendered | Source |
| --- | --- | --- |
| `Accept all` | 335.5 x 32 @390, 74.33 x 32 @768 | `src/components/PrivacyNotice.tsx` |
| `Essential only` | 335.5 x 32 @390, 96.52 x 32 @768 | `src/components/PrivacyNotice.tsx` |
| `Manage preferences` | 335.5 x 32 @390, 131.14 x 32 @768 | `src/components/PrivacyNotice.tsx` |
| `Read the Privacy Policy` | 335.5 x 17.39 @390 | `src/components/PrivacyNotice.tsx` |
| Loamy wordmark link | 91.77 x 30 @390, 187.86 x 38.75 @1440 (ha) | header |

The consent banner is 32px tall against a 44px minimum. Left alone because this
wave is Bank, and changing shared chrome changes every role's screens.

---

## 8. Business logic, data and privacy (Parts 7, 8, 9, 15)

Unchanged: financing decisions, the application lifecycle and its allowed
transitions, facility activation, bank authorization, RLS, SECURITY DEFINER
functions, fees, settlement rules, transaction state, payment logic, the
database schema, migrations, provider behaviour.

- **The server remains the authority.** `DecisionPanel` renders
  `permitted_decisions` from `loamy_financing_permitted_decisions` and invents
  nothing. `DECISION_META` gained a comment saying so; it did not gain a rule.
- **Stored values stay English.** Company roles, loan sectors, facility and
  repayment statuses, milestone types. Only the label a member reads is
  translated, so a decision recorded in Hausa and an export read in English
  describe the same row. `BankPipeline`'s tier filter still matches the stored
  tier while the chart axis shows the translated one.
- **The status filter dedupes by label.** `info_requested` and
  `additional_information_required` are two DB values meaning one thing, and the
  dropdown dedupes on the rendered label. A translation giving them different
  words would show one state twice and silently exclude the other from a filter.
  Asserted per language.
- **No new sensitive data.** No BVN or NIN storage, no additional account
  identifiers, no applicant profiling, no credit-score or wealth inference. No
  field was added because a screen displays it, and no authorization boundary
  moved.
- **Data not translated:** applicant, company and bank names, digital IDs,
  application / facility / transaction / bank references, addresses, officer
  notes, uploaded document names, business descriptions.

---

## 9. Server-generated and legally significant text (Part 16)

### The credit report WAS localized, and here is why that is not the contract case

`ReportView` renders a credit report that prints to PDF. It was localized, which
looks like the opposite of the A.3 decision to leave downloadable purchase
contracts in English. The distinction is real:

- A **purchase contract** is an instrument two parties SIGN. Generating a second
  language version creates a second, unreviewed contractual text, and the
  signature block records a typed name against "the terms above", which has to
  be one fixed text.
- A **credit report** is decision support. Nobody signs it, it creates no
  obligation, and its own footer says "Decision support only. All financing
  decisions rest with the Bank." Localizing it lets a Hausa-speaking officer
  read their own institution's analysis.

If the bank's record-keeping requires one authoritative language per report ID,
this is the surface to revisit. The report ID identifies the underlying data,
which is unchanged.

### Risk factors are server-generated and historical

`risk.factors[].label` and `.detail` are composed by the server. In a stored
report they come from `report.snapshot`, which makes them **historical text**.
They render as written, in every language. Localizing them needs the server to
emit a code and parameters instead of a sentence - an API change, documented
rather than attempted, and it must not rewrite rows already stored.

### Other text that stays as the server wrote it

- `readiness.reason` from `loamy_settlement_readiness`, when the server supplies
  a sentence rather than codes. The CODES in `blocked_by` ARE localized: they go
  through `CONDITION_HELP` on the client, so all ten became
  `bank.condition.<code>`.
- A PostgREST or edge-function error message, surfaced through `errorMessage`.
  Recognised failures carry an i18n key; an unrecognised one keeps the server's
  own English, because a guessed translation of a sentence we have not seen is
  worse than true English.

---

## 10. Tests, build and verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| Unit + component tests | **54 files, 1,239 tests, all passing** |
| `npm run build` | passes (2,883 modules; 2.6 MB bundle warning pre-existing) |
| Release env guard | OK: no test credential or foreign project reference |
| Bank browser QA | ran, 117 scans, 0 Bank failures |
| Touch-target source scan | 0 undersized in 20 bank components |

New test files:

| File | What it holds |
| --- | --- |
| `tests/components/bank-i18n.test.tsx` | 41 tests. All 321 bank keys render in five languages; en+fr complete; lib vocabularies match the packs; 13 pairs of load-bearing states must not collapse in any language; Loamy is not the lender in any language; money keeps the naira convention while counts and dates follow the locale; no bank source hardcodes a locale; placeholders survive. |
| `tests/unit/i18n-source-contract.test.ts` | The source-to-engine contract, 6 tests, all five failure classes mutation-tested. |

Mutation-tested rather than assumed. Each of these was injected and failed the
suite before being reverted: collapsing two Igbo decisions, splitting
`info_requested` from `additional_information_required`, dropping the custody
claim from the Yoruba settlement notice, reverting the naira formatter to a
hardcoded locale, removing one `.limit()`, and all five i18n contract faults.

### Security suite: carried forward unchanged, NOT re-run

```
820 passed
0 assertion failures
27 assertions did not execute
rls-cross-user.test.ts beforeAll failed: Supabase provisioning hit ECONNRESET
```

**The security suite is NOT green.** It was not re-run in this wave, and no
security test, provisioning, retry, timeout or concurrency setting was modified.

---

## 11. Production

Untouched. No Vercel deployment, no production migration, no production data
mutation, no production configuration change. The browser QA ran against the
staging dev server (`vite --mode test`), guarded by
`assertServedProjectNotProduction`, and only read.

---

## 12. Honest summary

The bank portal is operable end to end in English and French, and operable -
every status, label, button, column, form field, validation message and failure -
in Hausa, Igbo and Yoruba, with 12 informational empty-state paragraphs falling
back to English.

**The platform is not fully multilingual, and no language has been reviewed by a
native speaker.** The bank financial terminology in Hausa, Igbo and Yoruba is the
least certain work in the project and contains coined terms for *facility*,
*principal*, *tenor* and *collateral* that a reviewer with banking vocabulary is
likely to improve on. `glossary.md` names every one.
