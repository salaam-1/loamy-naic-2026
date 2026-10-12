# Loamy Platform — Engineer Handoff (v2.0-phase2)

> **PHASE 2 IS ACTIVE (owner decision, 2026-07-20).** The standing "no fund flows /
> no financing servicing" exclusions are being lifted deliberately for a bank-partnered
> build. The architecture below keeps Loamy an **origination + record + monitoring** layer,
> NOT a money transmitter: it records and reconciles bank-confirmed references; funds move on
> the bank's/PSP's licensed rails. Two prerequisites gate real go-live — see "Phase 2".

Status: **BUILD-FOR-THE-SHELF.** Complete and verified locally against the live shared
Supabase project, but NOT publicly deployed. It ships when the team activates Phase 2 after
partner-bank approval. Nothing in this document is an invitation to deploy early.

## 1. Architecture summary

Two Vite + React + TypeScript apps share ONE Supabase project:

- **Founding Member Portal** (separate codebase/deployment, pre-existing) — signup, member
  dashboard, referrals. Owns: `profiles` base columns, the auth→profiles signup trigger, the
  digital_id generator, `launch_config`, `feature_suggestions`.
- **Loamy Platform** (this repo) — everything else. All platform objects are `loamy_`-prefixed
  (functions, triggers, policies) or new tables, so nothing collides with portal objects.
  Portal accounts ARE platform accounts: same auth, same `profiles` row.

**Auth model**: Supabase email+password. On signup the portal trigger creates the profiles
row; the platform's `loamy_sync_platform_role` BEFORE-INSERT trigger derives `platform_role`
from `category` (and nullifies empty-string category/state). RLS on every table; the browser
only ever holds the publishable (anon) key — the service_role key appears nowhere in this
codebase and must never be added to it.

**Role system**:
- 8 participant roles (`loamy_platform_roles` reference table) → `/dashboard/{role}` shells.
- `admin` (profiles.role) — granted MANUALLY in Supabase by standing decision; no make-admin
  control exists anywhere.
- `growth_partner` + `role_data.can_verify` capability (admin-granted) = Verification Officer.
- `bank` operational role: admin-created officers only, `role_data.bank_id` scopes them to one
  bank row — multi-bank-ready, single-bank pilot (LOTUS Bank seeded).
- `profiles.active` (Stage 6): suspension — blocks the app UI and the security-definer action
  paths.
- Feature flags in `platform_config.flags` gate every feature surface; unknown keys read false.

## 2. Migration inventory (run order)

| Migration | Purpose |
| --- | --- |
| `20260712100001_loamy_stage1_extend_profiles` | platform_role/onboarding/avatar + reserved bvn/nin columns, roles table, category→role backfill + sync trigger, `loamy_is_admin()` |
| `20260712100002_loamy_stage1_role_details` | Per-user role_data jsonb, owner RLS |
| `20260712100003_loamy_stage1_notifications` | Notifications; inserts via definer fn only |
| `20260712100004_loamy_stage1_platform_config` | Single-row feature flags |
| `20260713090001/2_loamy_tmp_schema_probe` | Temp diagnostic view to read portal CHECK constraints (added, then dropped) |
| `20260713120001_loamy_stage2_farms` | Farms + status-protection trigger + request-verification fn |
| `20260713120002_loamy_stage2_crop_records` | Season records, RLS through farm ownership |
| `20260713120003_loamy_stage2_financing_applications` | Applications (no approve status exists), ₦500k cap, draft rules, self-notify fn |
| `20260713120004_loamy_stage2_avatars_storage` | Public avatar bucket, owner-folder writes |
| `20260713150001_loamy_stage3_badge_public_profiles` | verified_badge + protection trigger + limited `loamy_public_profiles` view |
| `20260713150002_loamy_stage3_listings` | Listings + taxonomy check + photo bucket |
| `20260713150003_loamy_stage3_service_directory` | Warehouse/logistics directory |
| `20260713150004_loamy_stage3_listing_interests` | Interest flow + transition guard + `loamy_get_interest_contacts()` |
| `20260713150005_loamy_stage3_market_prices_flag` | Admin reference prices; flips `marketplace` |
| `20260715090001_loamy_stage4_partners` | Territories, onboarding attribution (`loamy_record_referral`), earnings (tracked-not-paid), can_verify fns |
| `20260715090002_loamy_stage4_verification_tasks` | Task workflow + guards + claim/assign/review + haversine GPS + farmer status-only view |
| `20260715090003_loamy_stage4_evidence_bucket_flag` | PRIVATE evidence bucket; flips `verification_workflow` |
| `20260715090004_loamy_stage4_task_farm_info` | Tiered farm surface for pool/assigned partners |
| `20260715100001/2_loamy_stage4_test_fixture_*` | Temp admin fixture (promoted → reverted) |
| `20260718090001_loamy_stage5_banks_officers` | Banks (LOTUS seed) + officer lifecycle fns |
| `20260718090002_loamy_stage5_bank_access_reports` | Bank RLS, `loamy_application_bundle`, rule-based risk fn, pipeline fn, immutable `credit_reports` |
| `20260718090003_loamy_stage5_milestones_flag` | Monitoring milestones; flips `bank_portal` |
| `20260718100001_loamy_stage5_officer_signup_fix` | Sync trigger nullifies empty-string category/state |
| `20260718100002_loamy_stage5_category_nullable` | **The one portal relaxation**: category NOT NULL → nullable |
| `20260718110001/3_loamy_stage5_test_fixture_*` | Temp admin fixture (promoted → reverted) |
| `20260718110002_loamy_stage5_bundle_null_guard` | NULL-guard fix (bank_id = NULL ≠ false) in bundle/risk fns |
| `20260718130001_loamy_stage6_audit_suspension` | `audit_events` + `profiles.active` + admin set-role/set-active fns |
| `20260718130002_loamy_stage6_audit_wiring` | Audit + suspension checks wired into all key mutation fns/triggers |
| `20260718130003_loamy_stage6_announce_stats_exports` | Announcements, admin stats, user summary, export logging |
| `20260718140001/2_loamy_stage6_test_fixture_*` | Temp admin fixture (promoted → reverted) |

Final state: no test account holds admin. Test users are `usmanyakubu541+loamy…@gmail.com`
aliases — safe to delete in Supabase Auth at any time.

## 3. CONSOLIDATED SECURITY-REVIEW INDEX

Grep the repo for `SECURITY-REVIEW` for full in-context notes. Priority order for the
engineer BEFORE live operations:

1. **BVN/NIN encryption-at-rest design — FIRST.** `profiles.bvn_encrypted` /
   `nin_encrypted` exist but are written by NOTHING (grep confirms). Before any collection:
   envelope encryption (pgsodium/KMS), key rotation, access audit, column-level grants.
   Related: the BACKLOG.md face-verification item is biometric data — same review gate.
2. **Evidence bucket policy** — `verification-evidence` (private): assigned partner writes,
   admin + assigned partner read via signed URLs; the subject farmer has NO read path
   (`20260715090003`). Review retention and confirm nothing widens access.
3. **Contact-disclosure function** — `loamy_get_interest_contacts` (`20260713150004`):
   parties only, post-acceptance only, name+phone only. No other function or view may expose
   `profiles.phone` (except the bank bundle below).
4. **Application-bundle function** — `loamy_application_bundle` (`20260718090002`, guard
   hardened in `110002`): a bank's ONLY window onto applicant data; fixed field set; verify
   the tier checks (active officer, own bank, no drafts) on every future change.
5. **Suspension enforcement** — `profiles.active` gates the app (guards) and the action
   paths: `loamy_officer_bank`, `loamy_can_verify`, `loamy_request_farm_verification_guarded`,
   `loamy_bank_set_status`, `loamy_announce` recipients. RLS reads of the user's OWN data are
   deliberately not blocked — confirm that pilot semantics.
6. **Audit insert paths** — `audit_events` has admin-SELECT only and definer-only writes
   (`loamy_audit_internal`, no client grants). Keep it that way.
7. **Status-integrity triggers** — `loamy_protect_farm_status`, `loamy_protect_profile_badge`,
   `loamy_task_guard`, `loamy_interest_guard`: the transaction-local
   `loamy.status_change_authorized` flag must only ever be set inside the sanctioned workflow
   functions.
8. **Public surfaces** — `loamy_public_profiles` view (fixed minimal column set — the list IS
   the contract), `loamy_task_farm_info` (coordinates + owner name gated to assigned/admin),
   public buckets (`avatars`, `listing-photos`: nothing sensitive may ever be uploaded).
9. **Referral attribution** — `loamy_record_referral`: self-claim, once, 24h window; review
   before commissions carry real money. Assisted signup briefly shares a starting password —
   move to invite links before scale.
10. **loamy_is_admin / loamy_officer_bank / loamy_can_verify** — the three capability
    predicates everything else trusts.

## 4. Deliberate exclusions — do NOT "fix" these

- **No wallets, payments, escrow, checkout, settlement, payout execution.** Regulatory,
  non-negotiable: Loamy is not a lender and never holds funds. Marketplace deals and partner
  payouts conclude on bank rails off-platform. Phase 2, with licensed partners, only.
- **No approve/decline controls for financing.** The Bank decides inside the Bank; the
  terminal state in Loamy is `decided_external` + note. `'approved'` is an invalid status by
  CHECK constraint on purpose.
- **No livestock** in the commodity taxonomy — DB-enforced (farms, crop_records, listings,
  market_prices CHECKs). The 15-crop list is complete.
- **No seeded/demo data.** Every number is live DB state; zeros at launch are correct.
- **Admin grants manual in Supabase only** — no in-app path, by standing decision.
- **Risk scoring is rule-based and labeled as such** — never present it as AI.

## 5. Deployment notes

- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same values as the portal; see
  `.env.example`). Never the service_role key.
- Build: `npm run build` (tsc + vite). Verify suites: `node scripts/verify-stage{1..6}.mjs`
  (stages 4–6 are two-phase and need a temporary admin fixture migration — see script headers).
- **SMTP before launch**: configure a production SMTP provider in Supabase Auth (confirmation
  + portal reset emails currently ride Supabase's rate-limited default sender).
- Leaflet tiles come from openstreetmap.org (no key); Google Fonts serves Inter/JetBrains
  Mono — both external at runtime.
- Storage buckets in use: `avatars` (public), `listing-photos` (public),
  `verification-evidence` (PRIVATE — never flip).
- BUILD-FOR-THE-SHELF: keep it undeployed until the team activates post bank approval.

## 5b. Data visualization layer (v1.1)

Shared chart components in `src/components/charts/` — `TrendLine`, `BarBreakdown`,
`DonutSplit`, `FunnelSteps`, `Sparkline`, `StatusStrip` — over recharts, with data helpers
in `src/lib/charts.ts` (weekly bucketing, yield-by-season shaping, thresholds).

- **SPARSE-DATA RULE (structural)**: every chart has a minimum-real-points threshold; below
  it the component renders raw numbers + "Chart appears as data accumulates." Points are
  never interpolated, duplicated, or fabricated; gap weeks between real endpoints are true
  zeros. Verified in `scripts/verify-dataviz.mjs`.
- **Palette**: categorical series `#00A070 / #C8A045 / #007A55` (fixed order, never cycled;
  gray `#64748B` reserved for "Other" folds), validated with the dataviz six-checks script
  on the white card surface. Sequential emerald ramp for ordered splits (funnel, donut).
  The validator's WARNs (gold contrast; CVD floor band) are covered by standing secondary
  encoding: legends on every multi-series chart, mono tooltips, direct labels, 2px gaps.
- **RLS unchanged**: every chart reads what its role already reads. The only additions are
  two AGGREGATE-ONLY partner functions (`loamy_partner_funnel`, `loamy_partner_territory` —
  migration `20260718150001`, SECURITY-REVIEW flagged: counts only, caller-scoped).
- Chart surfaces: partner funnel/earnings/territory; farmer yield history + financing
  status strip; bank donut/trend/risk distribution + yield chart embedded in the
  application detail and the PRINTED report (fixed-width for print layout); marketplace
  price sparklines (<3 entries = number only); trading-role activity strip; admin
  registrations/verification-throughput/volume.
- **Deferred (unchanged decisions)**: Nigeria choropleth map (needs a maintained SVG asset;
  low value at pilot volumes); any AI-labeled insights/predictions (Phase-2 roadmap — must
  not be faked with chart dressing). The Founding Member Portal codebase is a separate
  workspace, so its registrations chart was skipped rather than guessed at.

## 5c. Provider seams (Phase-2 insertion points) — v1.2

Requested after a gap review against an external MVP that prototyped a money/KYC layer.
Those flows stay EXCLUDED (they violate the standing constraints); instead the codebase now
carries typed seams so a backend engineer can plug providers in later WITHOUT refactoring.
Nothing here is functional — the default providers throw, no UI captures payment or BVN/NIN,
and no column is written.

- **Payment seam** — [src/lib/providers/payments.ts](src/lib/providers/payments.ts):
  `PaymentProvider` interface (`recordDisbursement`, `recordRepaymentStatus`) + a
  `NotConfiguredPaymentProvider` that throws; `setPaymentProvider()` / `isPaymentProviderConfigured()`.
  **Insertion point**: a Phase-2 provider RECORDS bank-confirmed references/status only —
  Loamy still never holds or moves funds. It attaches to the existing status-only
  `repayment_milestones` and the bank's `loamy_bank_set_status` decision flow; it must not add
  any amount/settlement column. TODO(phase-2) + SECURITY-REVIEW markers in-file.
- **KYC seam** — [src/lib/providers/kyc.ts](src/lib/providers/kyc.ts): `KycProvider` interface
  (`verifyIdentity` → pass/fail + provider reference, NEVER the raw number/document) + a
  throwing default; `setKycProvider()` / `isKycProviderConfigured()`. **Insertion point**: the
  reserved `profiles.bvn_encrypted` / `nin_encrypted` columns — WRITE ONLY after the item-1
  encryption-at-rest review. The contract keeps raw BVN/NIN out of the app/DB tier entirely
  (provider-hosted capture → opaque token). This is the same HARD GATE as §3 item 1.

Both seams are documented so implementation is additive. Do not wire either without the
corresponding SECURITY-REVIEW sign-off.

## 5d. Service bookings, weather, profile editors — v1.2

- **Service bookings** ([migration 20260719090001](supabase/migrations/20260719090001_loamy_service_bookings.sql),
  `20260719090002` for the service_type guard): the Stage-3 warehouse/logistics directory now
  supports real BOOKING REQUEST flows — booker requests (dates + details), owner
  accepts/declines/completes, contact revealed on acceptance via
  `loamy_get_booking_contacts`. **NO payment/amount column exists** and none may be added.
  RLS: parties + admin only; transition guard mirrors listing interests; behind the new
  `service_booking` flag (ON). UI: "Request booking" on the Directory, "My Bookings" (booker
  roles), "Bookings" inbox (warehouse/logistics roles). Verified in
  `scripts/verify-extras.mjs` (15 checks).
- **Weather** ([src/lib/weather.ts](src/lib/weather.ts),
  [src/components/WeatherPanel.tsx](src/components/WeatherPanel.tsx)): 7-day forecast from
  **Open-Meteo** (free, no API key) keyed on each farm's stored GPS, shown on the farm detail
  page. **Forecast only** — no soil metrics, no composite "farm health" score (no soil data
  source; inventing one would break real-data-only). Honest states for missing coordinates or
  fetch errors. **DEPLOYMENT NOTE: Open-Meteo's free tier is NON-COMMERCIAL** — a paid tier
  (or another licensed provider behind the same module) is required before live commercial
  operations.
- **Role profile editors** ([src/pages/shared/Profile.tsx](src/pages/shared/Profile.tsx)): a
  "Profile" section for every role that edits `role_details.role_data` post-onboarding, reusing
  each role's onboarding field definitions (one source of truth). Merges onto existing
  role_data so capability flags (e.g. `can_verify`) are preserved. Low-sensitivity keys only.
- **Driver role — considered, NOT split**: the external MVP has a distinct "driver" role; Loamy
  keeps it folded into `logistics_provider` (which already captures fleet/vehicle details).
  Splitting would add a 9th participant role touching signup, routing, nav, and six stages of
  verified RLS/role checks for marginal pilot benefit. If desired later it is a
  `loamy_platform_roles` insert + a role config block + nav/section wiring — the role system
  was built for it — but treat it as a deliberate migration, not a quick edit.
- **Messaging** was offered in the same review and NOT selected; its nav item remains behind
  the still-false `messaging` flag.

## 5e. Phase 2 — financing servicing (Stage 7, v2.0-phase2-wip)

The bank portal extends from decision-support to **facility servicing** (the GreenBank-style
dashboard). **Loamy records; it does not execute.** Every principal/disbursement/repayment is
a **bank-confirmed reference** entered by an officer; the money moves at the bank of record.

- Tables ([migration 20260720090001](supabase/migrations/20260720090001_loamy_stage7_financing_servicing.sql)):
  `facilities` (decided application → serviced loan), `disbursement_records` (bank-confirmed
  refs), `repayment_schedule` (instalments, amounts bank-confirmed, PAR via overdue),
  `collateral` (recorded description + value). RLS: officers of the facility's bank + admin;
  the **borrower sees their own facility summary** (facility/schedule/disbursements) but never
  bank internals or another borrower's data. Servicing happens only through security-definer,
  officer-scoped functions (`loamy_activate_facility`, `loamy_record_disbursement`,
  `loamy_record_repayment`, `loamy_bank_portfolio`); all audited.
- UI: bank **Loans** (activate a decided application → facility; list) + **facility detail**
  (record disbursements/repayments, log collateral); dashboard **Loan portfolio / Disbursed
  MTD / Borrowers / PAR 30+**, portfolio-by-sector donut, top-borrowers-by-exposure — all
  **real** figures from serviced facilities (start empty; populate as facilities open).
  Farmer **Financing** page shows a borrower "My facilities" summary.
- **SECURITY-REVIEW**: no `facilities`/`disbursement_records` column is a balance Loamy holds
  or an account/card credential — verified in `scripts/verify-stage7.mjs` (17 checks). Keep it
  that way: custody stays at the bank.

### Two prerequisites before real money / real identity flow (owner + engineer)

1. **PSP / bank rail credentials + the licensed fund-holding entity.** The payment-provider
   seam ([src/lib/providers/payments.ts](src/lib/providers/payments.ts)) stays the ONLY place
   execution/reconciliation wires in. Until a real provider is registered, servicing records
   references (no live movement) — which is exactly what the dashboards show today.
2. **BVN/NIN encryption-at-rest sign-off** before the KYC flow (Stage 9) captures anything.
   Storage will be a verified-boolean + provider reference ONLY — never the raw number (the
   provider-hosted capture keeps plaintext out of the app/DB), gated by §3 item 1.

### Stage 8 — platform ledger (GMV / revenue / settlements)

[Migration 20260720100001](supabase/migrations/20260720100001_loamy_stage8_platform_ledger.sql):
`platform_transactions` is a **record-only** ledger — rows mirror events that settled on the
bank's/PSP's rails; **no balance is held, no transfer executed, no account/card credential
stored**. Sources: marketplace settlements (a party self-reports the value a concluded deal
settled for → GMV), and facility disbursements/repayments (the Stage-7 servicing functions now
append here — one source of truth). Platform revenue = recorded fees, computed from an
admin-set `platform_config.platform_fee_bps` (0 until a real fee schedule is set, so revenue is
honestly zero by default).

- RLS: admin reads all; a user reads only rows they are a party to; inserts happen ONLY through
  security-definer functions (`loamy_record_marketplace_settlement` — party-only, once per
  deal; the servicing fns; `loamy_platform_metrics` — admin-only). Verified in
  `scripts/verify-stage8.mjs` (15 checks: party-scope, third-party denial, admin-only metrics,
  fee math, duplicate block, no client insert, disbursement mirroring).
- UI: admin dashboard financial row (**GMV / Financing disbursed / Platform revenue /
  Transactions**, MTD) + weekly GMV-vs-financing chart; an admin **Transactions** section
  (ledger table + audited CSV); the fee-rate editor under Configuration; and "Record settled
  value" on concluded marketplace deals (My Interests / My Listings). All real — empty until
  settlements/disbursements are recorded; nothing is seeded.
- SECURITY-REVIEW: keep this ledger record-only. When the payment provider seam is wired
  (Phase-2 prereq 1), settlement rows should be reconciled against provider references, not
  turned into executed transfers.

### Stage 9 — admin completion + KYC status ([migration 20260720120001](supabase/migrations/20260720120001_loamy_stage9_support_content_kyc.sql), + `130002` KYC-protect fix)

- **Disputes / Support**: `support_tickets` + `support_messages`. Members open tickets and
  thread with the team; admins triage/reply/resolve from the **Disputes & Support** admin
  section. RLS opener+admin only; all transitions via security-definer fns
  (`loamy_open_ticket` / `loamy_ticket_reply` / `loamy_admin_resolve_ticket`); notifications
  + audit. The Stage-1 "Support" placeholder is now a real page (published Help/FAQ + ticketing).
- **Content Management**: `content_entries` (faq/notice/page, publish toggle). Admin CRUD;
  members read PUBLISHED only; published FAQ renders on the Support page.
- **Role Management** (`/admin/roles`): canonical roles + live user counts + capability
  tallies (can-verify partners, bank officers). Per-user changes stay under Users; admin
  grants stay manual in Supabase.
- **Listings oversight** (`/admin/listings-oversight`): read-only admin view of all listings.
- **BVN/NIN verified-STATUS** ★: `profiles.bvn_verified` / `nin_verified` / `kyc_reference`
  store only that verification PASSED + a provider reference — **never the raw number**. The
  raw `bvn_encrypted`/`nin_encrypted` columns stay untouched. `loamy_record_kyc_result` is
  **service_role-only** (a Phase-2 edge function calls it after a provider-hosted capture);
  a protection trigger blocks clients from self-setting the status (verified 17/17 in
  `scripts/verify-stage9.mjs`, incl. the closed self-verify hole). Settings shows the status
  and an honest "opens in Phase 2 once the provider is connected" gate. **Do not wire a KYC
  provider before the §3 item-1 encryption-at-rest sign-off.**

**Phase 2 stages 7–9 are complete (v2.0-phase2).** What remains before real go-live is
operational, not code: the two prerequisites (PSP/bank rails + licensed fund-holder; BVN/NIN
encryption sign-off), after which the payment and KYC seams are wired. The dashboards are real
and populate as real facilities/settlements/verifications are recorded — nothing is seeded.

## 5f. Public landing + public marketplace (v2.1)

- **Public landing** at `/` ([src/pages/public/Landing.tsx](src/pages/public/Landing.tsx)):
  marketing page (hero, four pillars, how-it-works, roles, live marketplace preview, founding-member
  CTA, about/contact, footer) in a flat public shell. Signed-in users hitting `/` route to their
  dashboard. No partner logos, no usage statistics, no testimonials, no e-commerce merchandising —
  all forbidden per brief and absent. Hero uses `/public/images/hero.jpg` — a real photograph
  of a Nigerian maize field (Kafanchan, Kaduna) from Wikimedia Commons by Kambai Akau,
  **CC BY-SA 4.0**, attributed in the footer (`public/images/IMAGE-CREDITS.md`). Swap in an
  owned/licensed photo at the same path before launch; the `<img>` falls back cleanly if the
  file is absent — never a fabricated dashboard image.
  - **Licence note**: CC BY-SA 4.0 is *share-alike* — obligations follow any ADAPTATION (crop,
    colour-grade, composite), which would need to be released under the same licence with
    attribution. The hero is used UNMODIFIED (object-cover crops in the browser only; the file
    itself is unedited). If the team wants to freely edit the image, replace it with a Pexels
    or Unsplash photo (no attribution / no share-alike) and remove the footer credit line.
    Do not silently edit the BY-SA file.
- **Public marketplace** at `/marketplace` + `/marketplace/:id`: anyone browses/searches/filters;
  only the **Express Interest** action is gated → `/signup?redirect=/marketplace/:id`
  (`PublicOnly` honors a same-origin `?redirect=`). Reads the anon-safe view only.
- **SECURITY-REVIEW ★ public data surface** — `loamy_public_listings`
  ([migration 20260721110001](supabase/migrations/20260721110001_loamy_public_listings.sql)):
  the ONLY object granted to the `anon` role. Runs with owner rights, returns a FIXED safe column
  set (commodity, qty, price, state, lga, photos, seller_display_name/category/verified) for ACTIVE
  listings — **no seller_id, phone, email, coordinates, or user id**. Base tables keep RLS and are
  NOT granted to anon. Verified in `scripts/verify-public.mjs` (14 checks: anon reads the view,
  cannot read any base table, no PII in payload, cannot moderate or express interest). Any column
  added to this view is a public disclosure — review first.
- **Listing images fixed** ([src/components/ListingImage.tsx](src/components/ListingImage.tsx)):
  never renders an `<img>` with empty src; placeholder for no-photo; `onError` fallback for
  broken photos. Used across public + dashboard marketplace. Only the `listing-photos` bucket is
  public-read; `verification-evidence` stays private.
- **Admin listing moderation** (`loamy_admin_moderate_listing`, audited) lets a super admin
  remove/restore a listing from Listings & Products.

## 6. Known limitations / deferred

- Face verification at signup (BACKLOG.md) — biometric review gate first.
- BVN/NIN collection — blocked on encryption design (item 1 above).
- SMS credential delivery for assisted onboarding (currently email).
- Trader/exporter financing products; warehouse/logistics booking flows; messaging; reports
  dashboards — nav stubs behind false flags.
- role_details.role_data is denormalized jsonb by design (Stage 1 speed); normalize when it
  hurts.
- Admin user table loads up to 500 profiles client-side; paginate server-side beyond that.
- `formatNaira` uses `en-NG` Intl; older browsers may fall back to `NGN` prefix.
- Test users (`+loamy…` aliases) remain in Auth for manual QA; delete when done.

## 7. Loamy Co-pilot v1 (build-for-the-shelf — ships OFF)

Retrieval-only assistant in the dashboard. **Three rules it is built around:**
(1) answers ONLY from uploaded data (`market_prices_history`, `macro_context`, `market_events`)
and admin `copilot_qa_overrides` — never model knowledge or the web; (2) NEVER predicts a price
— only observed values and observed historical patterns (a naive baseline beat every model on the
real data, so no forecast/accuracy claim appears); (3) no financial advice.

- **Feature flags (both OFF):** `copilot` gates the whole assistant; `copilot_predictions` gates
  the empty prediction seam. Nothing renders until the team flips `copilot` on.
- **Migrations (AUTHOR-ONLY — not applied to the live shared DB):**
  `20260804090001_loamy_copilot_v1_schema.sql` (7 tables + empty `predictions` seam, RLS on all)
  and `20260804090002_loamy_copilot_active_views.sql` (active-batch views so deactivating a batch
  = instant rollback). Apply these when activating.
- **Code:** `src/lib/copilot/*` (retrieval, analysis, engine, i18n registry + voice, adapters,
  upload) · `src/components/copilot/Copilot.tsx` (panel, mounted in AppShell) · admin at
  `src/pages/admin/AdminCopilot.tsx` (`/admin/copilot`).

### SECURITY-REVIEW entries (new)
1. **LLM adapter integration** (`src/lib/copilot/llm/adapter.ts`, `config.ts`): provider is a
   placeholder (`// TODO: API KEY`). In production it MUST be proxied through a backend / Edge
   Function — the key must never ship in the browser. The model may only PHRASE from the supplied
   `facts` (strict system prompt: answer only from rows; never predict; never advise) and must
   fall back to the deterministic template phraser on any error. Default = template phraser (cannot
   invent).
2. **STT adapter integration** (`src/lib/copilot/stt/adapter.ts`): same backend-proxy rule; unwired
   in v1 (mic disabled, text fallback).
3. **Conversation privacy** (`copilot_conversations` / `copilot_messages` RLS): a user reads/inserts
   only their own threads; message ownership is proven by joining to the parent conversation, NOT
   trusted from `conversation_id`. Admin may read all (flagged-question loop). Verify no future grant
   widens this and no cross-user read is possible via the messages table.
4. **Prediction seam**: `predictions` ships empty and is never read by the engine or UI. It must stay
   off until a model has been VALIDATED against the naive baseline; only then wire it behind
   `copilot_predictions`.

   > Backtesting on the real dataset showed a naive baseline ("next month ≈ this month")
   > outperformed seasonal and trend models at 1-month horizon — maize 5.9% vs 7.0% and 8.1%.
   > Any future model must beat that baseline on held-out data before being enabled. Model on
   > log-returns or differences, never nominal price levels: the series is dominated by naira
   > devaluation, not agricultural signal.

### Co-pilot v2 (2026-08-05) — data-layer fix + Ambassador Price Network + interactive assistant
- **Price basis**: every price query pins ONE `price_type` (default retail) — retrieval refuses to mix
  retail/wholesale/farmgate (they are incomparable). `loamy_copilot_price_context` aggregates full
  history server-side (no 1000-row cap). Retrieval fetches most-recent-first.
- **Ambassador network** (migration `…140001`): `commodity_varieties`, `commodity_units` (region-aware
  kg lookup — bag weights NOT hardcoded), `ambassador_price_submissions` (writes only via the
  security-definer RPC that normalises to ₦/kg + runs admin-configurable anomaly checks — flags, never
  auto-rejects), identity-safe `loamy_validated_prices` view (no submitter id), `partner_earnings`
  += `price_submission` (validated only). Growth-partner submission UI has an offline queue.
  SECURITY-REVIEW: ambassador identity must not leak to end users (base table is own+admin only).
- **Interactive** (migration `…150001`): flagship "is this a good price?" = current ambassador price +
  historical normal range for the month + position + seasonal, as separate LABELLED facts (never
  merged). Advice questions get the comparison + "the decision is yours". Capabilities: unit conversion
  (`commodity_units`), cross-market compare, seasonal calendar, concept KB (`copilot_concepts`, EN/HA),
  navigation deep-links. Conversational follow-up carries the last commodity.
- **Still to wire (adapters/deps)**: Open-Meteo weather + rainfall history (reuse `src/lib/weather.ts`),
  price alerts (threshold + notify on validated submission), application-status / my-farm reads,
  ambassador phrase-library admin editor. LLM/STT adapters remain placeholder (engine answers
  deterministically without them).

### Co-pilot v2.1 (2026-08-05) — correctness fixes
- **"Normal range" now uses the LAST 24 MONTHS** (not same-month-across-all-history), so it isn't a
  devaluation-inflated 6x band. `loamy_copilot_price_context` returns `recent_low/high/avg/months`.
  **Range sanity guard** in the engine (`SECURITY-REVIEW` tagged): if the recent window has <6 monthly
  observations OR high÷low > 2.5×, the Co-pilot says it lacks enough recent data (and logs it) rather
  than presenting a meaningless range. Do NOT widen the window to fill a gap.
- **Seasonal pattern is devaluation-proof by construction**: each month's average is taken as a RATIO
  to that year's average, then averaged across years (a ratio is level-independent). **CPI deflation
  was NOT used**: the uploaded `macro_context.food_cpi` is several different series mixed together
  (a real ~87→588 index AND a small ~9→29 series), so it can't be cleanly isolated for the
  `real = nominal × cpi_latest/cpi_obs` formula. If a single clean CPI series is uploaded later,
  deflation can replace the ratio method for absolute-level long-window comparisons. **Action: clean
  the macro CPI upload to one series before relying on CPI.**
- **Dataset is fully loaded**: 52,225 rows, 1991→2026-05-15 (verified). Plain `Maize` retail genuinely
  ends 2023-01-15 in the WFP source; `Maize (flour)`, Sorghum, Onions, etc. run to 2026-05. The admin
  **Data health** panel (Co-pilot admin → Data health) shows per-dataset row count / earliest / latest
  and warns when the newest record is >60 days old.
- **Intent parsing understands the whole message**: any known commodity → price flow regardless of
  wording ("what is maize price today"); "why" explains the previous answer's reasoning; unbuilt
  capabilities ("weather") get a specific "not available yet" reply + log; the capability menu is never
  a fallback (unrecognised → one clarifying question, logged).

### To activate (checklist)
1. Apply the two migrations above to the project.
2. Load the cleaned master dataset via **Admin → Loamy Co-pilot → Data uploads** (CSV; the validator
   rejects livestock and malformed rows and shows them). Excel = add a SheetJS reader at the
   `parseCsv` seam in `src/lib/copilot/upload.ts`.
3. (Optional) Wire the LLM/STT providers (backend-proxied) + `VITE_COPILOT_*` env.
4. (Optional) Add the Kano voice clips per `public/audio/copilot/RECORDING-BRIEF.md` and enable them
   in `src/lib/copilot/i18n/voice.ts`.
5. Flip the `copilot` flag to `true` in `platform_config`.
- **Dialect:** Kananci (Kano), Boko script. The source spec's "Sakkwatanci" is the SOKOTO dialect —
  built and labelled as Kananci; a 2nd dialect adds one `Dialect` to `i18n/registry.ts` + clips.
- **Verification status:** code-level checks pass (no predicted price read/rendered anywhere, no
  accuracy claim, verbatim disclaimer, no livestock, tsc + build clean). Runtime checks 1–7 in the
  brief need the migrations applied + dataset loaded.

---

# Processor / Large-Offtaker Dashboard (Parts 1–9, 2026-08-07)

A multi-tenant procurement suite for bulk buyers (mills, processors, exporters). One company =
one tenant; **company isolation is the core security boundary** and is verified live per part.

## Migrations (run order)
- `20260807100001_loamy_processor_companies` — `companies`, `company_members`; membership helpers
  (`loamy_user_company_ids`, `loamy_company_role`, `loamy_company_can_admin`); create/update/member RPCs; roster view.
- `20260807100002/100003` — processor feature flags seeded; `processor` row in `loamy_platform_roles`.
- `20260807110001_loamy_processor_rfqs` — `rfqs`, `rfq_templates`; `loamy_company_can_procure`; publish/close/cancel RPCs.
- `20260807120001_loamy_processor_bids` (+`120002` flag) — `rfq_bids`; submit/withdraw + `loamy_can_bid_on`;
  supplier board view `loamy_open_rfqs`; buyer bids view `loamy_rfq_bids_v` (real track record only).
- `20260807130001_loamy_processor_awards` — `rfq_awards` (multi-supplier split), `rfq_contact_disclosures`;
  award RPC; **contact-disclosure gate** `loamy_supplier_contact` / `loamy_disclose_supplier_contact`.
- `20260807140001_loamy_processor_contracts` — `contracts` (auto-gen trigger + versioning + e-sign),
  `documents` + **private `rfq-documents` bucket** (path-scoped RLS).
- `20260807150001_loamy_processor_inspections` — `inspection_jobs`; territory dispatch (`loamy_covers_location`,
  reuses `partner_assignments`); **private `inspection-evidence` bucket**.
- `20260807160001_loamy_processor_escrow` — `escrow_transactions`, `escrow_events` (immutable audit);
  `loamy_company_can_settle`. Writers are the Edge Functions only.
- `20260807170001_loamy_processor_logistics` (+`170002` awards-view cols) — `transport_jobs`, `transport_offers`,
  `warehouse_reservations`; sources the existing `service_directory`.

## Paystack integration points (escrow)
- Edge Functions: `escrow-initialize` (fund), `escrow-release` (full/partial/refund), and the existing
  `paystack-webhook` (extended with an escrow branch). Deployed to project `lsuqbjwlybzhyuvzgtdj`.
- Secrets reused from the marketplace: `PAYSTACK_SECRET_KEY`, `APP_URL`, service role. No secret in any table.
- Webhook rules enforced: raw-body HMAC-SHA512 signature verify → Paystack re-verify → server-side amount
  cross-check (== `qty*price` in kobo) → idempotent `funded` transition. Replays never double-fund/-release.
- Funds are **held by our payment partner (Paystack)** — never by Loamy. Release requires award `inspected`
  and settle permission (Finance Officer / Procurement Director).
- ENGINEER TODO to finish live money: run a manual test-card fund→release once; enable Transfers (and disable
  OTP for automated test payouts) in Paystack → Settings → Transfers; suppliers need a payout recipient
  (`seller_payout_accounts`, shared with the marketplace).

## Deferred / future adapters (Phase 2)
- **Live GPS truck tracking** — only the milestone timeline is built; wire a telematics provider behind
  `transport_jobs` status. Do NOT simulate a moving truck.
- **Qualified e-signature** — contracts capture typed name + timestamp (+ optional IP) as a v1 acknowledgement;
  `// TODO` in `loamy_sign_contract` / `src/lib/contracts.ts` for a legally-binding provider.
- **NIN / BVN / face-liveness** — UI seams only, behind flag `processor_kyc` (OFF), no write path. Adapters in
  `src/lib/kyc/index.ts` (`lookupCac`, `runFaceLiveness`) are placeholders (`// SECURITY-REVIEW`).
- **Co-pilot procurement retrieval** — the existing RAG Co-pilot is available on the dashboard; extending it to
  answer from this company's own RFQs/bids/spend needs company-scoped retrieval added to `src/lib/copilot/`
  (RLS-enforced; the no-prediction / no-price-forecast constraints apply unchanged).
- **Time-based notifications** ("RFQ closing soon / expired") need a scheduler (pg_cron / edge cron); the
  event-driven notifications (bid, award, inspection, escrow, logistics) already fire.

## Feature flags
- `processor_procurement` (OFF) — gates the full suite's supplier/partner-facing nav (bids board, inspections,
  transport, reservations). Flip ON to launch the whole loop together.
- `supplier_bidding` (OFF) — supplier "Open Buy Requests" board.
- `processor_kyc` (OFF) — identity-verification surface; keep OFF until legally cleared.

## SECURITY-REVIEW index (processor additions)
- Multi-tenant isolation on every table/view (verified live, 8 parts: cross-company reads/writes blocked).
- Contact-disclosure gate: `loamy_supplier_contact` is the ONLY path to a supplier phone (needs company
  membership + award/disclosure). No contact field appears in any bids payload pre-award.
- Private buckets `rfq-documents` and `inspection-evidence` (path/row-scoped; other companies cannot download).
- Escrow tables have NO client write path; Edge Functions (service role) are the sole writers.

## Verification (VERIFY-BEFORE-DONE checklist)
Run live and passing: full loop (register → RFQ → 2 bids → split award → contracts → inspection accepted →
escrow initiated → delivery), company isolation via direct API (B sees none of A's rfqs/bids/awards/contracts/
documents/escrow/inspections/transport), contact hidden pre-award, idempotent + amount-checked webhook (reuses
proven marketplace path), NIN/liveness flag-disabled with no write path, no fabricated scores, no predicted
prices, `tsc --noEmit` + `vite build` clean. Full card→fund→release needs a manual Paystack test-card.
