# UI/UX refinement pass: verification report

Branch `ux-refine-role-aware`, commits `6c54803` and `7b93bb4`.
Verified against staging (`opkcdqtyyrdbrcxegnkq`) on 2026-09-26.
Not pushed, not merged, not deployed.

---

## 1. The duplicate Loamy header

**Fixed and verified.** My earlier conclusion that it was "not reproducible" was
wrong, and it was wrong for a specific reason worth recording: the first probe
sampled five routes and generalised from them. The defect was on
`/dashboard/:role/my-stock`, which was not one of the five.

Cause: `RoleShell` is itself an `AppShell`. Three section components
(`MyStock`, `MarketIntelligence`, `InviteBenefits`) wrapped their output in a
second `RoleShell`, so the shell rendered twice and the member saw two stacked
Loamy identity areas. Those three now render fragments, and a test asserts that
no section component nests a shell inside the one the router already gave it.

This is a structural change, not CSS. Nothing is hidden; the second shell is no
longer constructed.

## 2. The larger defect behind it

The probe kept flagging `My Listings` with `h1=0`, at 390/414/768 in one run and
at 1440 in the next. That inversion is not what a layout rule looks like, and it
is not timing either.

`MyListings` renders its `<h1>` only in the populated branch. Loading returns a
bare skeleton; empty returns an `EmptyState` whose title is a `<p>`, not a
heading. Because `my-listings` is listed in `SECTIONS_WITH_OWN_HEADING`,
`RoleDashboard` suppresses its own `pageTitle` on the promise that the section
supplies one. In two of three states it did not, so the page had no heading at
all. The flag was tracking the test fixture's row count, not the viewport.

Six components shared the shape: `MyListings`, `MyInterests`, `Directory`,
`MyBookings`, `MyStock`, `BookingsInbox`. (An earlier draft of this report said
seven and then listed six. Six is correct: of the ten sections that declare
their own heading, `PrivacySettings`, `FinancialActivity`, `MarketIntelligence`
and `InviteBenefits` were already unconditional.) Four of them had a persistent,
user-visible headingless empty state; the rest were headingless only while
loading. Each heading is now defined once, above the branches, and rendered in
every one of them.

The existing self-verifying test passed through all of this because it asked
only whether a component file *contains* an `<h1>`, which stays true when the
h1 sits behind an early return. The replacement test asserts that no early
return precedes the heading. That test is what found `BookingsInbox`, which I
had not looked at.

## 3. The seven reported issues

| # | Issue | State | How it was verified |
|---|---|---|---|
| 1 | Copy reduction | Done | `copy.ts`, `financingLifecycle.ts`, `Home.tsx`; protected disclosures kept (see item 5) |
| 2 | Footer cleanup | Done | Bare domain link removed; attribution compacted to creators, `CC BY-SA 4.0`, and a "Full credits" link. The licence requires attribution, so it could not simply go |
| 3 | Bank/admin public handle | Done | `isInstitutionalProfile` gates the card; migration `100002` refuses it server-side, so hiding the card is not the control |
| 4 | Duplicate headings | Done | Items 1 and 2 above; 40/40 route-width combinations clean |
| 5 | Financial-activity copy | Done, then corrected | See item 5 |
| 6 | Activate facility | Done | Migration `100001`; 8 new tests in `slice3-bank-decision.test.ts` |
| 7 | Logistics hero | Done | Three missing `HERO_IMAGE`/`HERO_ALT` keys added; no image errors at any width |
| 8 | Platform-wide copy audit | Done, and wider than expected | See item 6 |

## 4. Two corrections to my own earlier work in this pass

**The custody statement.** When I shortened the financial-activity note I
dropped "Loamy does not hold funds on your behalf". That is the custody
distinction, and it was named as protected. It is restored, spelled out, in the
note itself rather than left to the adjacent UI that also says it. A custody
disclosure is a compliance statement, not decoration, and it should not depend
on a neighbouring element surviving a later layout change. The migration header
previously argued for cutting it on exactly that basis; the header has been
rewritten to say why the argument is rejected. The note went from about 200
characters to 140, so the reduction still happened.

**The copy audit was not trustworthy as first run.** It looked for removed lines
in changed files. A `create or replace` migration supersedes text in an older,
untouched file, so nothing appears as a removal and the audit reported zero
protected removals while the custody regression was sitting in the branch. I
found that one by diffing function bodies instead, and redid the audit that way.

## 5. What the em dash audit found

Redone against the *latest* definition of each function rather than against
migration files, because a function redefined later may no longer carry the
wording that a historical file still shows.

- **9 strings in 8 live function definitions.** RPC error messages, notification
  bodies and transaction-journey hints. Members read all of these.
- **8 Copilot concept strings**: 4 rows, each with an English and a Hausa body.
- **6 `comment on column` strings, deliberately left alone.** Engineers read
  those through psql. They are not user-facing copy.

None of the first two groups is reachable from the client, so they could not be
fixed in React. Migration `100004` handles them.

## 6. The four migrations

### `20260925100001_loamy_activate_facility_decision_states.sql`

- **Function:** `public.loamy_activate_facility(uuid, numeric, text, int, date, numeric)`
- **Tables:** reads `financing_applications`, `facilities`; writes `facilities`, `repayment_schedule`, plus audit and notification rows
- **Why required:** the RPC accepted only `decided_external`, dating from when
  that was the only way to decide. The in-Loamy decision lifecycle leaves an
  application `approved` or `partially_approved`, and `BankLoans.tsx` offers
  "Activate facility" for all three. Every activation of an application decided
  inside Loamy failed. On staging that was 6 of 18 applications.
- **Changes production data:** no. Behaviour only.
- **Backward compatible:** yes. `decided_external` still works. Activation also
  became idempotent, so a double submit returns the existing facility instead of
  a raw unique-violation.
- **Not changed:** the bank is still derived server-side from
  `loamy_officer_bank()`, the application must still belong to that bank, the
  principal is still validated, and no client-supplied bank, actor or decision
  provenance is accepted.

### `20260925100002_loamy_username_marketplace_only.sql`

- **Function:** `public.loamy_set_username(text)`
- **Tables:** reads `profiles.platform_role`; writes `profiles`, `username_history`, audit
- **Why required:** the RPC gated on "signed in" and "active" only, so a bank
  officer could claim a public marketplace handle through the API and appear in
  the member directory. Nothing escalated, but public identity exists so a buyer
  can find a seller, and a partner bank is neither.
- **Changes production data:** no. Verified first: 0 of 16 bank profiles on
  production and 0 of 6 on staging hold a username, so nothing existing depends
  on it.
- **Backward compatible:** yes for every non-bank caller. A bank now receives a
  structured `not_applicable` result rather than an exception.
- **One deliberate asymmetry:** this refuses `platform_role = 'bank'` only, not
  the `role = 'admin'` flag. Admin is an overlay on a real platform role, and an
  administrator may legitimately be a farmer or a buyer with a shopfront.
  Blocking them server-side would take away something they are entitled to. The
  admin surface simply does not render the card, which is presentation.

### `20260925100003_loamy_financial_activity_note.sql`

- **Function:** `public.loamy_my_financial_activity(int)`
- **Tables:** reads `ledger_entries`, `ledger_accounts`. No writes.
- **Why required:** the note restated two facts the cards directly beneath it
  already carry in their own sub-labels, so the reader met them twice before
  reaching a number.
- **Changes production data:** no.
- **Backward compatible:** yes. Same payload shape, `custody` is still `none`,
  and the ledger arithmetic is byte-identical. A semantic diff against the
  previous definition shows exactly one changed line, the note string.

### `20260925100004_loamy_copy_em_dash_removal.sql`

- **Functions:** `loamy_checkout_cart`, `loamy_discover_supply`,
  `loamy_interest_notify`, `loamy_place_orders_from_cart`,
  `loamy_request_farm_verification`, `loamy_sandbox_bank_decision`,
  `loamy_set_initial_role`, `loamy_transaction_journey`
- **Tables:** `public.copilot_concepts` (8 rows, `body_en` and `body_ha`)
- **Why required:** the em dash ban applies to user-facing copy, and a real share
  of what a member reads is emitted by Postgres rather than by React.
- **Changes production data:** yes, but only `copilot_concepts`, which is
  platform-authored reference content. No member row is read or written.
- **Backward compatible:** yes. Punctuation only. No signature, body logic,
  grant, security attribute or RLS policy is altered.
- **Why it is shaped the way it is:** each function is rewritten from
  `pg_get_functiondef` of the version actually installed, not from a body pasted
  out of a migration file. An earlier draft justified that by claiming several
  of these functions had been redefined after the wording landed. That claim was
  checked against the migration history and it is FALSE: seven of the eight are
  defined exactly once, and the eighth (`loamy_request_farm_verification`)
  carries the wording in its latest definition, so a paste would have reverted
  nothing. The real reason is drift: a pasted body is a second source of truth,
  and if the installed function ever differs from the file, a paste overwrites
  an out-of-band fix with no diff to show for it. Reading the live definition and substituting only
  punctuation cannot do that. The migration raises rather than half-fixing if it
  meets an em dash it has no substitution for, and a final block refuses to
  complete while any function or concept row still contains one.

## 7. Changeset review

78 files, +1431 / -201.

- **Unrelated changes:** none found. The large per-directory counts
  (16 under `src/pages/bank`, 12 under `src/pages/admin`) are entirely the
  em dash placeholder sweep: `'—'` becoming `'-'` in empty-value cells. 175
  changed lines across those six role directories, none of which touch a query,
  a filter, a role check or a financial value.
- **CSS-only hiding:** none. Every `+` line containing a `hidden` class was
  checked against its removed counterpart; all are pre-existing responsive table
  columns that appear in the diff only because the line changed for punctuation.
  Newly introduced `hidden` classes: 0.
- **Weakened authorization:** none. No removed line touches `allowedRoles`,
  `auth.uid`, `is_admin`, a `platform_role` comparison, a grant, a revoke, a
  policy or a `security definer` attribute. Migration `100002` adds a
  server-side refusal rather than relying on the hidden card.
- **Changed financial semantics:** none. The only financial-looking diff lines
  are the two migrations above, and both were checked by semantic diff against
  the definitions they replace.
- **Test direction:** `tests/unit/identity.test.ts` changed to follow the source,
  not the other way round; it asserts the rendered placeholder.

## 8. A pre-existing bug fixed in passing

`HomeHero.tsx` passed camelCase `fetchPriority`, which React 18 does not
recognise and drops with a console warning on every dashboard load.
`StorefrontHero.tsx:122` already documents that exact trap and works around it
with a lowercase spread. `HomeHero` had the bug its comment describes. Fixed the
same way. This was not introduced by this pass.

## 9. Gates

| Gate | Result |
|---|---|
| TypeScript | clean |
| Unit | 675 / 675 |
| Component | 204 / 204 |
| Build | clean |
| Release env guard | pass, no test credential or foreign project reference in `dist/` |
| Browser QA | 40 / 40 route-width combinations |
| Security suite (before migrations) | 832 / 832 |
| Security suite (after migrations) | 831 / 832, see item 10 |

## 10. The one test that failed, stated plainly

The security run after the migrations reported 831 of 832. The failure was
`phase4-marketplace-batches > listing a batch > allows the genuine remainder`,
and the error was `TypeError: fetch failed` at 10.7 seconds, which is a
transport failure rather than a behavioural assertion. Run on its own, that file
passes 22 of 22.

I am not claiming a clean 832 in a single run, because there was not one.

## 11. Browser QA detail

`scripts/verify-header-hierarchy.mjs`, against staging, at 390, 414, 768 and
1440 px. Ten routes per width, including `my-interests` and `my-bookings`, which
are empty for the test fixture and therefore exercise the empty-state branch
that used to render no heading.

At every width and route: one Loamy banner, one logo mark, one visible `<h1>`,
0 px horizontal overflow, zero em dashes in rendered text, and no console or
image errors.

The probe itself was corrected twice during this work. It now waits on the page
heading specifically, because a loading state can render an `h2` and satisfy a
looser wait before the `h1` exists; and it counts Loamy-branded banners rather
than raw `<header>` elements, because a `<header>` inside `<main>` is valid
sectioning content and not a second site header.

## 12. State

- Branch `ux-refine-role-aware` at `7b93bb4`. `main` unchanged at `972b74e`.
- Staging has all four migrations applied; local and remote histories match with
  nothing pending.
- Production (`lsuqbjwlybzhyuvzgtdj`) was not linked, migrated, written to or
  read from at any point in this pass. The CLI link target was asserted against
  the production ref before each database operation.
- Nothing pushed, merged or deployed.

---

## 13. Final pre-merge review (branch `6c17bf0`)

### Migration 100004, verified rather than argued

For each of the eight functions, the body live on staging was compared against
the body authored at `main` (972b74e) with the migration's substitutions
applied. All eight match, and every substitution matched **exactly once**.

| Property | Result |
|---|---|
| Body == authored + substitution | 8 / 8 |
| Signature and return type | unchanged, matches authored |
| `SECURITY DEFINER` | true on all 8, as authored |
| `search_path` | `public`, pinned on all 8 |
| Volatility | matches authored (`STABLE` on `loamy_discover_supply` and `loamy_transaction_journey`, `VOLATILE` on the rest) |
| Owner | `postgres` on all 8 |
| `EXECUTE` grants | `authenticated` (+ `postgres`, `service_role`); `anon` holds none |
| Functions carrying a substituted string | exactly 8, so nothing else was rewritten |
| Functions still containing an em dash | 0 |
| Re-applying the migration | byte-identical no-op on all 8 |

`CREATE OR REPLACE FUNCTION` does not alter existing privileges or ownership,
and `pg_get_functiondef` reproduces the signature, return type, volatility,
security attribute and `SET search_path` from the catalog. The transformation
therefore cannot change structure even in principle.

**Are the substituted strings load-bearing?** No. Each appears only in its own
defining migration, and nothing in `src` or `tests` compares against any of
them. The one test that touches this wording, `block4-financing-e2e.test.ts:835`,
matches `/pay directly/i`, which the new wording still satisfies.

**Financial functions specifically.** Of the eight, three touch financial
workflow: `loamy_checkout_cart`, `loamy_place_orders_from_cart` and
`loamy_sandbox_bank_decision`. In all three the only difference from the
authored body is the punctuation inside one message string. No state
transition, amount, ledger write, fee, custody flag or decision path differs.
`loamy_transaction_journey` and `loamy_discover_supply` are read-only.
The remaining three are unrelated to financial state.

### Fresh-database and replay safety

`100004` references only the pg catalogs and `public.copilot_concepts`, created
in `20260805150001` with the `body_en` and `body_ha` columns it updates. It
sorts last in the migration chain, so every function it can touch already
exists. It contains three `do` blocks and one `UPDATE`, all transactional, and
no `CREATE INDEX CONCURRENTLY`, `VACUUM` or explicit `COMMIT`, so it cannot
partially apply within a transaction-wrapped migration. Replay was measured, not
assumed: re-applying it left all eight definitions byte-identical.

It does not assume the functions exist. The loop selects whatever is installed
and carries an em dash, so on a database where one is absent it simply does
less, and the closing verification block still holds.

### Pre-existing defects found during this review

None of these were introduced by this branch, and none are fixed in it.

1. **The public storefront has no `h1`.** `/` and `/marketplace` both render
   `PublicMarketplace`, whose hero (`StorefrontHero.tsx:142`) renders the slide
   title as `<h2>`. Byte-identical at `main`. Deciding which carousel slide owns
   the page heading is a design decision, not a mechanical edit.
2. **`/insights` overflows 31px at 390px**, in the "Price ranges" card
   (`Insights.tsx:122`). This branch changed only four StatCard placeholder
   strings in that file; the card is untouched.
3. **An admin's held roles are everybody's held roles.** `fetchMyRoles`
   (`src/lib/userRoles.ts:20`) selects `user_platform_roles` with no own-user
   filter and relies on RLS, but the policy is
   `(user_id = auth.uid()) OR loamy_is_admin()`. An admin therefore loads all
   943 rows on staging as their own. Not an RLS breach, since the policy grants
   admins that read deliberately, but the admin's role card and role switcher
   are wrong, and `MyRoles` keying by `r.role` is where the 1834 duplicate-key
   React warnings on Settings come from. Suggested fix: filter by the caller's
   id in the query rather than leaning on a policy written for a different
   purpose.

### A correction to what the heading tests prove

The source-level check ("no early return precedes the `<h1>`") does **not**
protect the six components it was written for. Once each heading became a const
declared above the branches, `<h1>` appears before any early return, so the
check passes whether or not the branches render it. This was verified by
reintroducing the bug in the `MyListings` loading branch: the source-level test
still passed, and only the rendered test failed.

`tests/components/section-heading-branches.test.tsx` now mounts all six sections
and asserts the heading reaches the DOM while loading, when empty, and when
populated. It is confirmed able to fail.

### Gates at `6c17bf0`

| Gate | Result |
|---|---|
| TypeScript | clean |
| Unit + component | 897 / 897 across 36 files |
| Build | clean |
| Release env guard | pass |
| Staging security suite | **832 / 832**, 31 files, 0 failed, 0 skipped |
| Browser QA | 123 / 128 across 5 personas at 390/414/768/1440 |

The five browser-QA flags are the `/insights` overflow and the admin
duplicate-key warning, both pre-existing and described above.

**On the security suite.** Reaching a clean aggregate took several attempts, and
the intermediate results are recorded here rather than discarded: 832/832, then
831/832, then 800/832, then 750 passed with 82 skipped, then 832/832. Every
failure in those runs was `TypeError: fetch failed` or `ConnectTimeoutError` at
the TCP layer against the Cloudflare-fronted Supabase endpoint, never a
behavioural assertion, and the affected files passed in isolation each time. No
test was modified, skipped or weakened to reach the clean run.

### Production

Untouched. The Supabase CLI stayed linked to `opkcdqtyyrdbrcxegnkq` throughout,
asserted against the production ref before every database operation. No
migration, no mutating test, no account creation and no read against
`lsuqbjwlybzhyuvzgtdj`. `main` is unchanged at `972b74e`, local and remote.

---

## 14. Pre-merge remediation (branch `73810a4`)

Two of the three pre-existing defects from item 13 were fixed. The third is
deliberately left, and is recorded as a follow-up below.

### 14.1 `fetchMyRoles` returned every user's roles to an administrator

**Root cause.** `src/lib/userRoles.ts` selected `user_platform_roles` with no
predicate and relied on RLS to scope the result. The policy is

```
(user_id = auth.uid()) OR loamy_is_admin()
```

The admin arm exists so the admin console can read everyone's roles. It was
never meant to answer "which roles do I hold", but that is the question this
query was asking, so an administrator received the whole table: 943 rows across
921 accounts on staging. Symptoms were an admin role card listing strangers'
roles, a role switcher offering roles the admin does not hold, 1834 React
duplicate-key warnings from `MyRoles` keying that list by `role`, and a needless
bulk fetch on every profile load.

**Fix.** The predicate is stated in the query rather than inferred from a policy
written for a different purpose:

```ts
const { data: auth } = await supabase.auth.getUser()
const uid = auth?.user?.id
if (!uid) return []          // signed out: no roles, and no reason to ask

  .from('user_platform_roles')
  .select('role, onboarded, added_at')
  .eq('user_id', uid)
  .order('added_at', { ascending: true })
```

`supabase.auth.getUser()` is the convention already used throughout `src/lib`.
The signature is unchanged, so neither caller in `AuthContext` needed touching.

**What was deliberately not done.** No RLS policy was altered. No admin
privilege was narrowed. No service-role access was introduced. The admin console
keeps its own broader reads, which the new security test asserts still work.

**Verified on staging.** The admin role card renders 1 role, their own
("Farmer, Active"), at 390px and 1440px, with 0 duplicate-key warnings.

**Regression tests.**

- `tests/unit/fetch-my-roles.test.ts` (4 tests) proves the query shape: the
  filter carries the caller's id, nothing is queried when signed out, and the
  platform-role vocabulary filter still applies. Confirmed able to fail by
  removing the `.eq`.
- `tests/security/admin-own-roles.test.ts` (5 tests) proves the behaviour
  against the real database and the real policy: the admin can still read other
  users' rows, so the test cannot pass vacuously; the scoped query returns only
  their own; the scoped result contains no duplicate role values; an ordinary
  member's results are unchanged; and one member still cannot read another's.

### 14.2 `/insights` overflowed 31px at 390px

**Root cause.** `DashboardCard` already wraps its body in `overflow-x-auto`, and
its comment says why. It never got the chance to work. The card is a grid item,
and a grid item's default `min-width: auto` floors it at its content's
min-content width. The price table cannot shrink below about 366px, so with
`px-5` padding the card resolved to roughly 406px inside a 390px viewport and
pushed the whole document sideways. The scroll container was widened along with
everything else rather than scrolling.

**Fix.** One class on the grid container in `src/pages/public/Insights.tsx`:

```
grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]
grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]
```

The `lg` track already removed the floor with `minmax(0, ...)`; the mobile
column was missed. With the floor gone the card fits its column and the table
scrolls inside the card, which is what `overflow-x-auto` was there for.

No `overflow-x-hidden`, no clipping, no negative margins, no viewport change,
and nothing hidden.

**Measurements after the fix.**

| Width | Page overflow | Card | Scroller client / scroll | Rows x cols rendered |
|---|---|---|---|---|
| 390px | 0px | 360px | 358 / 403 (scrolls) | 6 x 5 |
| 414px | 0px | 384px | 382 / 403 (scrolls) | 6 x 5 |
| 768px | 0px | 723px | 721 / 721 | 6 x 5 |
| 1440px | 0px | 1035px | 698 / 698 | 6 x 5 |

Every element extending past the viewport edge at 390px was confirmed to be
inside the scroll container; none escapes it.

### 14.3 Scope

Two source files changed, two test files added, and nothing else:

```
M src/lib/userRoles.ts
M src/pages/public/Insights.tsx
A tests/security/admin-own-roles.test.ts
A tests/unit/fetch-my-roles.test.ts
```

No migration was added or changed, so this remediation makes no database change.
Migrations 100001 to 100004, the RoleShell/AppShell fix, the rendered heading
tests, empty-state headings, bank and admin username gating, the financial
custody disclosure, activate facility, the logistics hero, footer and copy
cleanup, the em dash cleanup, environment separation and the release guard were
each confirmed untouched.

### 14.4 Gates at `73810a4`

| Gate | Result |
|---|---|
| TypeScript | clean |
| Unit + component | 901 / 901 across 37 files |
| Build | clean |
| Release env guard | pass |
| Staging security suite | **837 / 837**, 32 files, 0 failed, 0 skipped, first attempt |
| Browser QA | **128 / 128**, zero flags, 5 personas at 390/414/768/1440 |

The suite total moved from 832 to 837 because `admin-own-roles.test.ts` adds
five tests. No existing test was modified, skipped or weakened.

### 14.5 Remaining follow-up, not fixed here

**The public storefront has no `h1`.** `/` and `/marketplace` both render
`PublicMarketplace`, whose hero renders the slide title as `<h2>`
(`src/pages/marketplace/StorefrontHero.tsx:142`). The document outline on the
highest-traffic public page therefore starts at `h2`.

This is byte-identical at `main` and predates the branch. It is left alone
deliberately: `StorefrontHero` is a carousel, so promoting the title to `h1`
raises the question of which slide owns the page heading, and possibly whether
the page should carry its own heading independent of the carousel. That is a
design decision, not a mechanical edit, and it deserves its own change.

The browser probe records this as a named, commented allowance rather than
silencing it, so a new regression on those routes still stands out.
