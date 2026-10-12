# Loamy release blockers

**Date:** 2026-09-23
**Audited against:** `docs/platform-completion-inventory.md`
**Deployed commit:** `de90f5f` + `55740ba` (live at https://loamy-platform.vercel.app)
**Method:** every item re-verified against the current codebase, the applied
migration set and the live database. Nothing below is carried over from the
inventory on trust.

**No code was changed during this audit.** Nothing found required a code fix:
the one incomplete surface renders an honest "is being built" state rather than
breaking, and the one piece of dead code is unreachable.

---

## 0. Corrections to the inventory

The inventory predates Wave 1 and is now wrong in four places. Recording this so
the document is not used as-is.

| Inventory says | Actual state |
|---|---|
| Migration `20260921140001` pending; "every workstream queued behind it" | **Applied.** 155 local migrations, 155 applied, 0 pending, 0 orphan. |
| WS11 provider interfaces missing | **Present:** `financing.ts`, `geo.ts`, `messaging.ts`, `weather.ts`, `types.ts`, `index.ts`, plus `kyc.ts` and `payments.ts`. |
| WS12 `docs/external-integration-contract.md` does not exist | **Exists**, 307 lines. |
| 17 user-facing functions with no UI caller | **7.** Nine were wired by Wave 1. One (`loamy_award_transport`) never existed: the real function is `loamy_select_transport_offer`, which is called. |
| 9 nav sections render a placeholder | **1** is reachable in production (§B3). The other flags are absent from `platform_config.flags`, and absent reads as false, so those sections are hidden and redirect on direct URL. |

---

## A. Blocked only by external provider credentials, endpoints, webhooks or provider-specific implementation

No internal work is outstanding on these. Each needs something from outside the
codebase.

### A1. No live bank integration

Every row in `banks` has `integration_mode = 'sandbox'`, including the one
real-named institution (LOTUS Bank). Every method in
`src/lib/providers/financing.ts` resolves to `unconfigured`:
`verifyAccount`, `openAccount`, `submitApplication`, `getApplicationStatus`,
`getDocumentRequirements`, `verifySupplier`, `instructSettlement`, `parseEvent`.

Financing decisions therefore run through the sandbox adapter only. The code is
capability-driven and complete; `is_sandbox` is surfaced to the user in
`FulfilmentPanel.tsx:142` and `JourneyTracker.tsx:120`, and the offer text says
"Sandbox - no real money moves", so nothing is misrepresented today.

**Needs:** a bank API endpoint, credentials, and the bank-specific adapter
implementation behind the existing `FinancingProvider` interface.

### A2. Paystack webhook registration is unverified

`supabase/functions/paystack-webhook/index.ts` exists and reads
`PAYSTACK_SECRET_KEY`. Whether Paystack's dashboard is configured to POST to it
is external state that cannot be read from here.

**Needs:** confirmation in the Paystack dashboard that the webhook URL points at
this function, and that the signing secret matches.

### A3. Paystack key mode is unverified

`PAYSTACK_SECRET_KEY` **is** configured on the Supabase project: invoking
`paystack-banks` returned 284 banks. Whether it is a test or a live key cannot
be determined without exposing the value.

Two live UI surfaces depend on it: `PayoutAccount.tsx` (rendered in Settings as
`PayoutAccountCard`) and `AwardEscrow.tsx`.

Note that this is the **edge-function** layer. The separate client seam
`src/lib/providers/payments.ts` reports `not-configured`, which is a different
thing and is what `AdminSystemHealth` displays.

**Needs:** confirmation of which key mode is installed.

### A4. SMTP is the Supabase default sender

`AdminSystemHealth.tsx:31` carries the product's own warning:
"Email (SMTP) - Default sender - configure SMTP before launch".

This governs signup confirmation and password reset, both of which are live
routes (`/signup`, `/forgot-password`, `/reset-password`).

**Needs:** a real SMTP provider configured in the Supabase dashboard.

### A5. No identity / KYC provider

`src/lib/providers/kyc.ts` reports `name = 'not-configured'`. The UI gates on
`isKycProviderConfigured` in `Settings.tsx` and `AdminSystemHealth.tsx`, so the
absence degrades rather than breaks. No BVN or NIN is collected or stored
anywhere, by design.

**Needs:** a provider and credentials, if identity verification is required at
launch. Verification currently runs on Growth Partner field evidence instead.

### A6. No SMS / messaging provider

`src/lib/providers/messaging.ts` is a seam with no adapter registered.
`AdminSystemHealth` lists SMS as "Not configured - Phase 2 enhancement".

**Needs:** a provider and credentials.

### A7. No geo / address provider

`src/lib/providers/geo.ts:129` returns
`not_configured: "Address search is not available."`

**Needs:** a provider and credentials.

### A8. Copilot has no LLM or STT, and the current variable names cannot be used

`src/lib/copilot/config.ts` reads `VITE_COPILOT_LLM_API_KEY` and
`VITE_COPILOT_STT_API_KEY`. Both are unset in the Vercel production
environment, which is correct: anything `VITE_`-prefixed is compiled into the
browser bundle, so setting either would publish a provider key to every visitor.
The file documents this itself.

**Needs:** a server-side proxy (Supabase Edge Function) holding the key, not a
credential in the current variables. This is provider-specific implementation
work, not configuration.

See also §B4: the Copilot flag is on in production today.

### A9. `support@loamy.ng` must exist

`RoleDashboard.tsx` renders a Support empty state whose action is
`mailto:support@loamy.ng`. That mailbox is the only support channel in the
product.

**Needs:** confirmation the mailbox exists and is monitored.

---

## B. Genuinely incomplete internally

No external dependency. These are Loamy's own work.

### B1. The production member database holds test accounts

| Measure | Value |
|---|---|
| `profiles` rows | **2,011** |
| Created 2026-09 | **1,851** |
| Created 2026-07 | 84 |
| Created 2026-08 | 76 |

`docs/deployment.md` records the real base as 247 Founding Members. The
July/August cohort here totals 160. The 1,851 rows created in September
correspond to the month of repeated security-suite runs; the suite creates
accounts in this project on every run, and `tests/helpers/supabase.ts` records
them in `createdEmails` because auth users cannot be deleted with the anon key.

Only 27 have a name matching a naive test pattern, because fixtures are created
with realistic names. Identification must go through the rule in
`tests/security/test-account-hygiene.test.ts`, not by inspection.

This is the same root cause as B8: one Supabase project serves dev, test and
production.

### B2. Seven deployed user-facing functions have no UI caller

All seven exist in applied migrations, so they are live in the database and
unreachable from the product. Verified by grep against `src/`.

| Function | Consequence |
|---|---|
| `loamy_open_dispute` | No member can raise a dispute anywhere in the product. |
| `loamy_respond_to_review` | A seller cannot reply to a review of them. |
| `loamy_submit_verification_case` | The Block 5 submission path is unused; the app calls the Stage 4 `loamy_request_farm_verification_guarded` instead. |
| `loamy_my_verification_cases` | An agent cannot list their own cases. |
| `loamy_bank_portfolio_intelligence` | Bank portfolio intelligence unreachable. `loamy_bank_portfolio` is called; the intelligence variant is not. |
| `loamy_seller_signals` | Seller-facing demand signals unreachable. |
| `loamy_inferred_preferences` | Buyer preference inference unreachable. |
| `loamy_submit_intelligence_feedback` | No feedback loop on intelligence output. |

### B3. One nav section renders "is being built" in production

`compliance`, for the exporter role, behind flag `verification_workflow`, which
is **true** in production. It has no component and no `href`, so it falls
through to the `Hammer` empty state in `RoleDashboard.tsx`.

Of 47 declared nav sections, 33 map to a component. The remainder are either
hidden by an absent flag (absent reads as false, and flagged-off sections
redirect on direct URL) or served by their own route: `discover` → `/discover`,
`trace` → `/trace`, `field-ops` → `/dashboard/growth_partner/field-ops`, which
is declared at `App.tsx:136`, ahead of the generic `/dashboard/:role/:section`.

### B4. The Copilot is live in production with no model

`platform_config.flags.copilot` is **true**, as is `copilot_predictions`. The
launcher and panel are visible to every signed-in member.

`docs/copilot-ground-truth-audit.md` established that `engine.ts` is a keyword
router with no LLM and no prompt, and that it can see 6 of 23 data categories.
The identity work has since made it warmer and more prominent.

The model half is A8. The data-coverage half is internal.

### B5. All ten feature flags are true in production

`copilot`, `bank_portal`, `marketplace`, `processor_kyc`, `service_booking`,
`supplier_bidding`, `copilot_predictions`, `processor_procurement`,
`verification_workflow`, `financing_applications`.

Four of these front capabilities that depend on unconfigured providers:
`bank_portal` and `financing_applications` (A1), `processor_kyc` (A5),
`copilot` and `copilot_predictions` (A8). `verification_workflow` is what makes
B3 reachable.

### B6. Test bank rows exist in the production `banks` table

**Corrected 2026-09-23.** This originally read "two rows", which was wrong: the
sample that produced it used `.limit(3)` and was never counted.

A full count gives **89 rows, of which 88 are test fixtures**. Only **LOTUS
Bank** is real. The fixtures are `Test Sandbox Bank ...`, `Sandbox Partner Bank
(test ...)`, `No-Supplier-Direct Bank (test ...)` and `Slice3 Bank A/B (test
...)`, each suffixed with a per-run token. Newest row: 2026-09-22T19:41Z. Every
row, including LOTUS Bank, is `integration_mode = 'sandbox'`.

Same root cause as B1, and the same remedy order: staging first, then cleanup.

### B7. Dead code invokes a retired endpoint

`payoutOrder` at `src/lib/payments.ts:83` invokes `paystack-payout`, which was
retired to HTTP 410 on 2026-09-22. It has **no caller**, so no user can reach
it and nothing is broken. It is unreferenced code pointing at a dead endpoint.

### B8. One Supabase project serves dev, test and production

`lsuqbjwlybzhyuvzgtdj` is production and is also the target of the local dev
server and the security suite. This is the root cause of B1 and B6.
`docs/deployment.md` documents the three-environment target and notes the
migration history replays cleanly into a fresh project.

### B9. Backup and point-in-time recovery are unverified

No down migrations exist; migrations are forward-only. Recovery depends
entirely on the Supabase plan's backup/PITR, which is visible only in the
dashboard. No repository documentation references a restore procedure.

### B10. The exposed admin credential has not been rotated

`usmanyakubu541+admin-explore@gmail.com` and its password are published in
`tests/helpers/supabase.ts` across 16 commits on
`origin/sept-2026-platform-changes`. The working tree and all branch tips are
clean; the history is not, and history cannot be un-published.

---

## Verification performed

| Check | Result |
|---|---|
| Migration state, git vs production | 155 / 155 applied, 0 pending, 0 orphan |
| Caller count for all 17 inventory functions | 10 now wired, 7 unreachable, 1 never existed |
| Provider seam state | 6 of 6 report `not_configured`; Paystack edge layer configured |
| `paystack-banks` live invocation | 284 banks returned (read-only, no mutation) |
| `banks` table | 3 rows, all `integration_mode = sandbox` |
| `platform_config.flags` | 10 keys, all true |
| Nav sections vs component maps | 47 declared, 33 mapped, 1 reachable empty state |
| `profiles` census, paginated | 2,011 rows; 1,851 created 2026-09 |
| TypeScript / unit suite / build | exit 0 / 759 passed / clean |
| Browser QA, 390 / 768 / 1440 | 60 / 60 |

The security suite was **not** run: it creates accounts in the production
database, which is item B1.

`banks.is_sandbox` and `banks.decision_source` do not exist as columns. The
actual columns are `adapter_key`, `integration_mode`, `supports_account_opening`,
`supports_supplier_direct`, `supports_status_callback`, `account_opening_url`,
`contact_note`. `decision_source` lives on the financing tables, introduced in
`20260920130001_loamy_block4_bank_adapter.sql`. Earlier summaries of mine
described `is_sandbox` and `decision_source` as `banks` columns; that was wrong.
`is_sandbox` is computed and returned by RPCs, and is surfaced to users.

---

# Update: environment separation delivered (2026-09-23)

Addresses B1, B8 and B10. The findings above are unchanged as a record of what
the audit measured; this section records what has since been built and what
still has to happen.

## B8 - one project for dev, test and production

**Foundation delivered. Staging project not yet created.**

Production is no longer a reachable target for anything that writes:

- `config/environments.json` names the protected project, and is the only place
  it is recorded.
- `tests/helpers/environment.ts` and `scripts/_environment.mjs` both refuse to
  resolve a protected project, and refuse to run at all without `.env.test`.
  Neither falls back to `.env`. There is no override flag.
- `tests/helpers/supabase.ts` no longer reads `VITE_SUPABASE_URL`, so the whole
  security suite fails closed.
- 23 mutation-heavy scripts now resolve staging through `testEnv()` and no
  longer reference `VITE_SUPABASE_URL` at all.
- `npm run dev:test` points the browser app at staging, so browser-driven QA
  writes there too rather than through the UI into production.

**Consequence, stated plainly:** with no `.env.test` on any machine, the
security suite and all 23 mutation-heavy scripts currently refuse to run. That
is the intended state. They could previously only run by writing to production.

**Remaining:** create the staging Supabase project and populate `.env.test`.
The procedure is in `docs/environment-separation.md` section 4; the migration
history replays cleanly, so it is a replay rather than a rebuild.

## B1 - contaminated production records

**Nothing deleted. Plan written, and the tooling to measure it exists.**

- The classification rule is keyed on the **email alias**, never on display
  names, and now has exactly one implementation, in
  `scripts/census-production-accounts.mjs`. The security suite re-exports it.
- `scripts/census-production-accounts.mjs` is read-only, paginated, and proven
  by test to contain no insert, update, upsert or delete.
- `tests/unit/account-classification.test.ts` pins the safety property: an
  account is never deletable on the strength of its display name, and a missing
  email fails safe to `likely_real`.

**Remaining:** the full classification needs `auth.users`, which needs the
service_role key. The SQL is in `docs/environment-separation.md` section 6,
along with the deletion order. Staging must exist first, or the next suite run
re-contaminates what was just cleaned.

## B6 - test bank rows in production

Unchanged. Removal is step 5 of the section 6 procedure, after the dependent
fixture rows.

## B10 - exposed admin credential

**Still not rotated. Recurrence prevented.**

- The exact rotation steps are in `docs/environment-separation.md` section 7.
  No tracked source needs editing: the credential already resolves at run time.
- `tests/unit/no-hardcoded-credentials.test.ts` fails if a credential-shaped key
  is ever assigned a string literal again. It reports file, line and key only,
  never the value, so a failure is not itself a disclosure.
- The staging admin fixture reads `LOAMY_TEST_ADMIN_EMAIL` and
  `LOAMY_TEST_ADMIN_PASSWORD` from `.env.test`, so rotating production does not
  require touching the test path.

## New: production deployment cannot inherit test credentials

`scripts/check-release-env.mjs` runs as the last step of `npm run build` and
refuses a build that carries a `VITE_`-prefixed test variable, contains a test
credential value in `dist/`, or names the wrong Supabase project. Both negative
cases were verified to exit non-zero, and a clean production build passes.

## Unchanged by this work

Every item in sections A1 to A9, and B2, B3, B4, B5, B7 and B9. None of them
was touched: this work changed only how environments are resolved.
