# Loamy Platform — Stages 1–6 (v1.0-shelf-ready)

> Engineer handoff: see [HANDOFF.md](HANDOFF.md) — architecture, migration inventory,
> consolidated SECURITY-REVIEW index, deliberate exclusions, deployment notes.

Loamy is Nigeria's Agricultural Operating System: digital identity, verification, credit
intelligence, and a marketplace connecting farmers, traders, exporters, and other agricultural
participants with partner banks that provide Shariah-compliant financing.

**Loamy is NOT a lender and NEVER holds, moves, or processes money.** All financing decisions
and disbursements happen at the partner bank. This is regulatory, deliberate, and
non-negotiable — there are no wallets, payments, or fund flows anywhere in this codebase,
and there never will be until Phase 2 with licensed partners.

This app is a **separate codebase and deployment** from the Loamy Founding Member Portal, but
talks to the **same Supabase project**. Founding Members log in here with their existing
credentials — that continuity is the point of the shared database.

## Stage 1 scope

- Loamy-branded login / signup / password reset against the EXISTING Supabase Auth
- Role-based routing to 8 role dashboards (`/dashboard/{role}`), shipped as designed empty
  shells with real stat queries (zeros for new users — correct, never seeded)
- First-login onboarding (role-details form → `role_details.role_data`)
- Admin guard → `/admin` placeholder shell (Stage 6 fills it)
- Feature-flag system (`platform_config.flags`) hiding every un-built surface
- Additive migrations extending the live portal schema

Explicitly NOT in Stage 1: marketplace, financing applications, verification workflows,
messaging, bank dashboard, Credit Intelligence Report, admin analytics. Their nav items exist
but are feature-flag hidden.

## Stage 2 scope — the full Farmer experience

- **My Farm**: multiple farm plots per farmer; add/edit with GPS capture (browser geolocation,
  click-the-map and manual-entry fallbacks) on an embedded Leaflet + OpenStreetMap map; farm
  detail with a season-by-season crop-records timeline; "Request Verification" (moves the farm
  to `pending` via a security-definer function and notifies admins — nothing in Loamy approves
  it; Stage 4 builds the field workflow).
- **Financing**: Input Financing product card — Murabaha (cost-plus, non-interest), capped at
  ₦500,000 for the pilot (enforced in the form AND at the DB). Multi-step application (farm →
  amount/purpose → items → disbursement → review) that saves a draft on every step. Honest
  statuses only: `draft`, `submitted`, `under_review`, `info_requested`, `decided_external` —
  there is deliberately no approve/decline anywhere in Loamy; the bank decides at the bank.
- **Dashboard overview**: live stat cards (farms, hectares, active applications, verified
  farms) + a recent-activity feed from notifications. No "farm health" card — no data source
  exists for it, and we never fake metrics.
- **Settings**: name/phone edit, avatar upload (owner-folder-scoped storage policy), password
  change. **Notifications**: full page + bell dropdown.
- Farm `verification_status` is workflow-owned: a DB trigger blocks any direct change (a
  farmer cannot mark themselves verified), and the taxonomy check on `primary_crops` makes
  livestock unrepresentable at the schema level.

Stage 2 migrations (applied via `npx supabase db push`; files in
[supabase/migrations/](supabase/migrations/)):

| File | Creates |
| --- | --- |
| `20260713120001_loamy_stage2_farms.sql` | `farms` + status-protection trigger + `loamy_request_farm_verification()` |
| `20260713120002_loamy_stage2_crop_records.sql` | `crop_records` (RLS through farm ownership) |
| `20260713120003_loamy_stage2_financing_applications.sql` | `financing_applications` (cap + completeness constraints) + `loamy_log_my_event()` |
| `20260713120004_loamy_stage2_avatars_storage.sql` | `avatars` bucket + owner-folder-scoped storage policies |

Live verification: `node scripts/verify-stage2.mjs` (23 checks, two disposable farmer accounts).

## Stage 3 scope — Marketplace (browse & list, NO payments)

**The defining constraint:** no payments, no escrow, no wallets, no checkout, no carts, no
"Pay" button — anywhere. The marketplace connects buyers and sellers and lets them agree
intent; payment and settlement happen OUTSIDE Loamy on bank rails. Checkout is replaced by
the interest flow: buyer expresses interest → seller accepts/declines → **on acceptance
only**, both parties can retrieve each other's name + phone via a security-definer function →
the deal concludes off-platform and either party marks it "concluded externally".

- **Marketplace home** (Farmer, Trader, Exporter, Buyer, Input Supplier): search, fixed-taxonomy
  commodity chips, state filter, newest/price sort, paginated grid. Seller identity on cards is
  limited to name, category, state, and verification badge via the `loamy_public_profiles`
  view — never phone/email.
- **Listing detail** with photo gallery, seller card, express-interest form, and the
  market-price reference panel for that commodity (honest empty state when no prices exist).
- **My Listings** (sellers): create/edit with multi-photo upload (seller-folder-scoped public
  bucket `listing-photos`), pause/activate/mark-sold, per-listing interests inbox with
  accept/decline, post-acceptance contact reveal, and mark-concluded.
- **My Interests** (buyers; farmers may express interest in INPUT listings only): statuses,
  withdraw, contact reveal, mark-concluded.
- **Directory**: browsable warehouse & logistics entries with the same interest→accept contact
  pattern; **My Directory Listing** editor for those two roles. Booking workflows come later.
- **Market prices**: admin-entered reference prices (entry page in the admin shell) with a
  trend arrow vs the previous entry. Prices are never invented; the field-agent price network
  is a labeled future enhancement.
- **Trust layer**: `profiles.verified_badge` (set only by Stage 4's approval workflow — a
  trigger blocks self-set) shown on every participant card.
- Interest state transitions are enforced by a DB trigger (buyer: withdraw/conclude; seller:
  accept/decline/conclude); notifications fire on new interest and accept/decline.

Stage 3 migrations (applied via `npx supabase db push`):

| File | Creates |
| --- | --- |
| `20260713150001_loamy_stage3_badge_public_profiles.sql` | `verified_badge` + protection trigger + `loamy_public_profiles` view |
| `20260713150002_loamy_stage3_listings.sql` | `listings` + `listing-photos` bucket/policies |
| `20260713150003_loamy_stage3_service_directory.sql` | `service_directory` |
| `20260713150004_loamy_stage3_listing_interests.sql` | `listing_interests` + transition guard + notification triggers + `loamy_get_interest_contacts()` |
| `20260713150005_loamy_stage3_market_prices_flag.sql` | `market_prices` + flips `marketplace` flag ON |

Live verification: `node scripts/verify-stage3.mjs` (27 checks, four disposable accounts).

## Stage 4 scope — Growth Partner & field verification

The trust layer: the field workflow that turns unverified farms into verified ones, with
**two-layer integrity** — a can_verify Growth Partner gathers evidence at the farm; an ADMIN
reviews and decides. Approval (and only approval) flips `farms.verification_status`, the
marketplace badge, and the partner's verification earning. **Commissions are tracked, not
paid** — every earnings surface carries: "Payouts are processed outside the platform during
the pilot period."

- **Role architecture**: Verification Officer is a CAPABILITY inside Growth Partner
  (`role_data.can_verify`), granted/revoked by admin via a security-definer function. A
  partner without it sees no verification surface at all (nav + pages + RLS).
- **Onboarding attribution**: assisted signup in the field (isolated client — the partner's
  session is never touched) and referral links/QR (`/signup?ref=DIGITALID`). Attribution is
  SELF-claimed by the new farmer's own session (`loamy_record_referral`) with guards: once,
  within 24h of signup, to a real growth partner. Onboarding commission accrues at the
  configured rate.
- **Verification workflow**: farmer requests (Stage 2 flow now also creates a
  `verification_task` and notifies territory partners) → territory pool → self-claim or admin
  assignment → evidence capture (server-side haversine GPS check vs the registered pin,
  2–6 photos to a PRIVATE bucket, 4-item checklist, field note) → submit → admin review queue
  (photos via signed URLs, GPS distance, checklist) → approve / reject / request-resubmit.
  A GPS mismatch does not auto-fail — it flags for admin attention.
- **Farmer visibility**: status-only progress steps (requested → assigned → visit → review →
  decision) via the `loamy_verification_progress` view. The farmer has NO path to raw
  evidence — not the table, not the bucket, not signed URLs.
- **Admin additions**: Verification Review queue (`/admin/verification`) and Partner
  management (`/admin/partners`) — grant/revoke can_verify, territories, partner rates,
  mark earnings paid-externally.

Stage 4 migrations (applied via `npx supabase db push`):

| File | Creates |
| --- | --- |
| `20260715090001_loamy_stage4_partners.sql` | `partner_assignments`, `onboarded_farmers`, `partner_earnings`, `partner_rates` config, can_verify + attribution + accrual functions |
| `20260715090002_loamy_stage4_verification_tasks.sql` | `verification_tasks` + guards, haversine + GPS check, claim/assign/review functions, extended request-verification, farmer progress view |
| `20260715090003_loamy_stage4_evidence_bucket_flag.sql` | PRIVATE `verification-evidence` bucket + policies; flips `verification_workflow` ON |
| `20260715090004_loamy_stage4_task_farm_info.sql` | Tiered farm-info surface for pool/assigned partners |
| `20260715100001/2_…test_fixture_*` | Temporary test fixture (promote → verified loop → demote); final state: no test account is admin |

Live verification: `node scripts/verify-stage4.mjs` (two phases, 34 checks, five disposable accounts).

## Stage 5 scope — Bank Portal & Credit Intelligence Report

**The defining rule: NO approve/decline control exists anywhere in Loamy. The Bank decides
inside the Bank.** Loamy records only that a decision was communicated
(`decided_external` + a bank-entered note). Grep the bank surfaces — the words do not appear.

- **Access model**: `bank` is an operational platform role. Officers are created by ADMIN
  only (`/admin/bank-officers` — isolated-client signup + `loamy_setup_bank_officer`);
  there is no self-signup path. Officers see ONLY submitted+ applications of THEIR bank
  (drafts are invisible by construction) and applicant data exclusively through the
  security-definer `loamy_application_bundle` — zero raw access to profiles/farms/records
  (live-verified). Deactivation flips `role_data.active`; multi-bank-ready, single-bank
  pilot (seeded: LOTUS Bank).
- **Pipeline** (`/bank/pipeline`): dense table — applicant + Digital ID + badge, product with
  Murabaha tag, amount (mono), state, submitted date, risk tier, review status; filters for
  product/state/tier/status; row → full bundle detail.
- **Status controls** (the complete set): Under review · Request info (message → applicant
  notification) · Mark decision communicated (note required). Every transition appends to
  `status_history` via trigger.
- **Risk classification — rule-based, from platform records** (never labeled AI): a
  deterministic server-side function scoring verification, production history, marketplace
  connections, amount-vs-cap, prior decisions, and milestones (missed = strong minus). The
  factor breakdown always renders with the tier.
- **Credit Intelligence Report**: immutable snapshots (`credit_reports` — no update/delete
  policies; regeneration inserts a new row; live-verified that old snapshots survive source
  changes). Print-clean A4 at `/bank/reports/:id` with the five Architecture Guide sections
  and the verbatim footer: *"Decision support only. All financing decisions rest with the
  Bank."*
- **Monitoring**: milestone status only (instalment/Murabaha · delivery/Salam), possible only
  after a recorded decision; early-warning flags (missed / overdue) computed live, never
  stored. No payment recording exists.

**Documented portal-constraint relaxation (the only one across all stages):**
`profiles.category` NOT NULL → nullable (migration `20260718100002`). Bank officers are not
agricultural participants; the portal's own signup always supplies a category, so no portal
write path is affected and the allowed-values CHECK stays intact. Additionally, our
`loamy_sync_platform_role` trigger now nullifies empty-string category/state (the portal
trigger writes `''` when metadata omits them, which its own CHECK constraints reject).

Stage 5 migrations: `20260718090001` (banks + officers) · `090002` (bank access, bundle,
risk, reports) · `090003` (milestones + `bank_portal` flag) · `100001/100002` (officer
signup compatibility) · `110001/110003` (temporary admin test fixture, promoted then
reverted) · `110002` (NULL-guard fix in bundle/risk — caught by the live suite).

Live verification: `node scripts/verify-stage5.mjs` (two phases, 37 checks, five disposable
accounts; the one initial failure — applicant reaching the bank bundle through a NULL
comparison — was fixed in `110002` and re-verified).

## Stage 6 scope — Platform administration & handoff (final)

- **Admin home**: live stat tiles (users by role, verifications + avg turnaround, listings,
  applications by status, monitored facilities, banks) + audit-event stream.
- **User management** (`/admin/users`): search/filter table, per-user operational summary
  (counts + recency, never evidence), role change (participant roles only, confirmed,
  audited), deactivate/reactivate. Suspension blocks the app AND the security-definer action
  paths. Admin grants stay manual in Supabase (stated in the UI).
- **Audit trail** (`audit_events`): definer-only writes wired into every key mutation (role
  changes, verification decisions, application transitions, officer lifecycle, price entry,
  deactivations, config changes, announcements, exports); admin-only viewer with filters +
  CSV.
- **Announcements**: batched notifications to all active users or a role segment, audited
  with recipient counts.
- **Configuration** (`/admin/configuration`): feature-flag editor (confirm + audit), partner
  rates (relocated from Partners), link to market-price entry.
- **Exports**: audit-logged CSVs (users, applications, verifications, listings, partner
  earnings) with identifiers limited to name + Digital ID + state.

Final regression: `node scripts/verify-stage6.mjs` — 26/26, including the compressed
end-to-end story (farm → field verification → badge → financing → bank decision →
monitoring) with every step confirmed in notifications AND the audit trail, and portal
tables verified intact. Tagged `v1.0-shelf-ready`.

## Tech stack

Vite · React 18 · TypeScript · Tailwind CSS (shadcn-style components) · React Router ·
@supabase/supabase-js · lucide-react · Recharts (later stages)

## Environment setup

```bash
npm install
cp .env.example .env    # then paste the SAME values the portal uses
npm run dev
```

`.env`:

```
VITE_SUPABASE_URL=<the portal's Supabase project URL>
VITE_SUPABASE_ANON_KEY=<the portal's anon key>
```

The anon key is browser-safe; every query relies on RLS. **Never put the `service_role` key
in this app or its env files.** Until real values are pasted, `npm run dev` renders a
friendly configuration notice instead of crashing.

## The 8 platform roles

`farmer`, `trader`, `exporter`, `buyer`, `warehouse_owner`, `logistics_provider`,
`growth_partner`, `input_supplier` — defined in the `loamy_platform_roles` reference table
and mirrored in [src/lib/types.ts](src/lib/types.ts). Adding a role later (e.g. Stage 4's
Verification Officer capability) is a single `INSERT` into the reference table plus a config
entry in [src/lib/roles.ts](src/lib/roles.ts) — no constraint rewrites.

## Database migrations (run in this exact order)

All migrations are **ADDITIVE** against the live portal schema: new tables, new columns, new
policies — nothing existing is dropped, renamed, or retyped. Every new function, trigger, and
policy is prefixed `loamy_` to avoid any collision with the portal's existing objects
(signup trigger, digital_id generator, admin check, etc.).

Files live in [supabase/migrations/](supabase/migrations/). Run them via the Supabase SQL
editor (paste the blocks below in order) or `supabase db push`.

### Migration 1 — extend `profiles` (+ roles reference, sync trigger, helpers)

```sql
-- ============================================================================
-- Loamy Platform · Stage 1 · Migration 1 of 4
-- Extends the EXISTING Founding Member Portal `profiles` table.
--
-- ADDITIVE ONLY. Nothing existing is dropped, renamed, or altered in type.
-- Every new function / trigger / table created here is prefixed `loamy_`
-- so it cannot collide with the portal's existing objects (digital_id
-- generator, signup trigger, admin check, etc.).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Canonical platform roles (reference table)
--    Adding a role later (e.g. 'verification_officer' in Stage 4) is a single
--    INSERT — no constraint rewrites, no schema change.
-- ----------------------------------------------------------------------------
create table if not exists public.loamy_platform_roles (
  slug           text primary key,
  label          text not null,
  is_operational boolean not null default false, -- staff roles (Stage 4's Verification Officer) vs. participant roles
  sort_order     int  not null default 0
);

alter table public.loamy_platform_roles enable row level security;

-- Read-only reference data: everyone may read, nobody may write via the API.
drop policy if exists "loamy_platform_roles_read" on public.loamy_platform_roles;
create policy "loamy_platform_roles_read"
  on public.loamy_platform_roles for select
  to anon, authenticated
  using (true);

insert into public.loamy_platform_roles (slug, label, sort_order) values
  ('farmer',             'Farmer',             1),
  ('trader',             'Trader',             2),
  ('exporter',           'Exporter',           3),
  ('buyer',              'Buyer',              4),
  ('warehouse_owner',    'Warehouse Owner',    5),
  ('logistics_provider', 'Logistics Provider', 6),
  ('growth_partner',     'Growth Partner',     7),
  ('input_supplier',     'Input Supplier',     8)
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- 2) New columns on profiles
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists platform_role       text,
  add column if not exists onboarding_complete boolean not null default false,
  add column if not exists avatar_url          text;

-- SECURITY-REVIEW: bvn_encrypted / nin_encrypted are RESERVED placeholders for
-- Nigerian BVN / NIN identity numbers. Stage 1 creates the columns ONLY.
-- No UI, query, function, or trigger anywhere in this codebase writes to them
-- (grep the repo for "bvn_encrypted" / "nin_encrypted" to confirm — the only
-- hits are this migration and the README's SECURITY-REVIEW index).
-- Before ANY collection begins, the backend engineer must design:
--   * encryption at rest (e.g. pgsodium / KMS envelope encryption — the app
--     must never see or store plaintext BVN/NIN),
--   * key management and rotation,
--   * access auditing and a strict column-level grant model.
-- Until that review, these columns stay NULL and unused.
alter table public.profiles
  add column if not exists bvn_encrypted text,
  add column if not exists nin_encrypted text;

comment on column public.profiles.bvn_encrypted is
  'RESERVED — do not write. Awaits engineer-designed encryption-at-rest before any BVN collection. See SECURITY-REVIEW index in the platform README.';
comment on column public.profiles.nin_encrypted is
  'RESERVED — do not write. Awaits engineer-designed encryption-at-rest before any NIN collection. See SECURITY-REVIEW index in the platform README.';
comment on column public.profiles.platform_role is
  'Canonical platform role slug (FK loamy_platform_roles). Backfilled from the portal''s free-text `category`; kept in sync by trigger loamy_sync_platform_role.';

-- FK to the roles reference table (guarded — ADD CONSTRAINT has no IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_platform_role_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_platform_role_fkey
      foreign key (platform_role) references public.loamy_platform_roles (slug);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3) category → platform_role normalisation
--    The portal's `category` is free-ish text; this maps it onto a canonical
--    slug. Returns NULL when there is no confident match — those users simply
--    pick their role during platform onboarding. We never guess and risk
--    routing someone to the wrong dashboard.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_normalize_role(raw text)
returns text
language sql
immutable
as $$
  select case norm
    when 'farmer'             then 'farmer'
    when 'farming'            then 'farmer'
    when 'trader'             then 'trader'
    when 'trading'            then 'trader'
    when 'exporter'           then 'exporter'
    when 'export'             then 'exporter'
    when 'buyer'              then 'buyer'
    when 'warehouse_owner'    then 'warehouse_owner'
    when 'warehouse'          then 'warehouse_owner'
    when 'warehousing'        then 'warehouse_owner'
    when 'logistics_provider' then 'logistics_provider'
    when 'logistics'          then 'logistics_provider'
    when 'growth_partner'     then 'growth_partner'
    when 'input_supplier'     then 'input_supplier'
    when 'input_supply'       then 'input_supplier'
    when 'input_suppliers'    then 'input_supplier'
    else null
  end
  from (select regexp_replace(lower(trim(coalesce(raw, ''))), '[\s/-]+', '_', 'g') as norm) t;
$$;

-- Keep platform_role in sync going forward: portal signups keep writing
-- `category` (via the portal's existing signup trigger); this BEFORE trigger
-- derives platform_role from it whenever platform_role is not already set.
create or replace function public.loamy_sync_platform_role()
returns trigger
language plpgsql
as $$
begin
  if new.platform_role is null and new.category is not null then
    new.platform_role := public.loamy_normalize_role(new.category);
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_sync_platform_role on public.profiles;
create trigger loamy_sync_platform_role
  before insert or update of category, platform_role on public.profiles
  for each row execute function public.loamy_sync_platform_role();

-- One-time backfill for existing Founding Member Portal rows.
update public.profiles
set platform_role = public.loamy_normalize_role(category)
where platform_role is null
  and category is not null
  and public.loamy_normalize_role(category) is not null;

-- ----------------------------------------------------------------------------
-- 4) Admin check helper for the NEW tables' policies.
--    Same security-definer pattern the portal already uses for its admin
--    policies; named loamy_is_admin so it cannot collide with the portal's
--    existing helper. SECURITY DEFINER so RLS policies can test admin-ness
--    without recursive policy evaluation on profiles.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: security-definer function — verify it only reads
-- profiles.role, keeps `set search_path = public`, and is granted to
-- `authenticated` only (no anon, no public).
create or replace function public.loamy_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.loamy_is_admin() from public;
grant execute on function public.loamy_is_admin() to authenticated;

-- Shared updated_at touch trigger for the new tables.
create or replace function public.loamy_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
```

### Migration 2 — `role_details`

```sql
-- ============================================================================
-- Loamy Platform · Stage 1 · Migration 2 of 4
-- `role_details`: one row per user, role-specific structured data as jsonb.
-- (jsonb keeps Stage 1 simple; the backend engineer can normalize later.)
-- ============================================================================

create table if not exists public.role_details (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  role_data  jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- SECURITY-REVIEW: role_data holds user-supplied business/farm details
-- (business names, farm size, LGA, commodities). It must NEVER hold BVN, NIN,
-- bank account numbers, or any government-ID data — the onboarding field
-- definitions in src/lib/roles.ts are the ONLY keys the app writes here;
-- review that list before any stage extends it. RLS below is strict
-- owner-only (plus admin read) because location + livelihood data is
-- personally identifying in aggregate.
alter table public.role_details enable row level security;

drop policy if exists "loamy_role_details_select_own" on public.role_details;
create policy "loamy_role_details_select_own"
  on public.role_details for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "loamy_role_details_insert_own" on public.role_details;
create policy "loamy_role_details_insert_own"
  on public.role_details for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "loamy_role_details_update_own" on public.role_details;
create policy "loamy_role_details_update_own"
  on public.role_details for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admin read-all (security-definer role check; same pattern as the portal).
drop policy if exists "loamy_role_details_select_admin" on public.role_details;
create policy "loamy_role_details_select_admin"
  on public.role_details for select
  to authenticated
  using (public.loamy_is_admin());

-- No delete policy: rows are removed only via the FK cascade when the
-- auth user / profile is deleted.

drop trigger if exists loamy_role_details_updated_at on public.role_details;
create trigger loamy_role_details_updated_at
  before update on public.role_details
  for each row execute function public.loamy_set_updated_at();
```

### Migration 3 — `notifications`

```sql
-- ============================================================================
-- Loamy Platform · Stage 1 · Migration 3 of 4
-- `notifications`: per-user in-app notifications.
-- Owners read and mark-as-read; INSERTS ONLY via security-definer function.
-- ============================================================================

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  body       text not null default '',
  type       text not null default 'general',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "loamy_notifications_select_own" on public.notifications;
create policy "loamy_notifications_select_own"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

-- Owners may update their own rows (mark as read). WITH CHECK pins user_id
-- so a row can never be reassigned to another user.
drop policy if exists "loamy_notifications_update_own" on public.notifications;
create policy "loamy_notifications_update_own"
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Deliberately NO insert and NO delete policies: with RLS enabled and no
-- policy, client inserts/deletes are denied outright.

-- SECURITY-REVIEW: the ONLY sanctioned write path into notifications.
-- SECURITY DEFINER bypasses RLS, so EXECUTE is revoked from public/anon/
-- authenticated and granted to service_role only (server-side code / edge
-- functions / later-stage admin tooling). Verify: (1) grants below stay
-- service_role-only, (2) `set search_path = public` remains, (3) no caller
-- is ever added that lets one user push notifications to another.
create or replace function public.loamy_create_notification(
  target_user uuid,
  n_title     text,
  n_body      text default '',
  n_type      text default 'general'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nid uuid;
begin
  insert into public.notifications (user_id, title, body, type)
  values (target_user, n_title, coalesce(n_body, ''), coalesce(n_type, 'general'))
  returning id into nid;
  return nid;
end;
$$;

revoke all on function public.loamy_create_notification(uuid, text, text, text) from public;
revoke all on function public.loamy_create_notification(uuid, text, text, text) from anon;
revoke all on function public.loamy_create_notification(uuid, text, text, text) from authenticated;
grant execute on function public.loamy_create_notification(uuid, text, text, text) to service_role;
```

### Migration 4 — `platform_config` (feature flags)

```sql
-- ============================================================================
-- Loamy Platform · Stage 1 · Migration 4 of 4
-- `platform_config`: single-row feature-flag store (same shape idea as the
-- portal's launch_config). Later stages flip flags on; the UI hides any
-- feature whose flag is false or absent, so Stage 1 deploys safely while
-- later stages are built.
-- ============================================================================

create table if not exists public.platform_config (
  id         int primary key default 1 check (id = 1), -- enforce single row
  flags      jsonb not null default '{
    "marketplace": false,
    "financing_applications": false,
    "verification_workflow": false
  }'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.platform_config enable row level security;

-- Any signed-in user may read the flags (the UI needs them to build nav).
drop policy if exists "loamy_platform_config_read" on public.platform_config;
create policy "loamy_platform_config_read"
  on public.platform_config for select
  to authenticated
  using (true);

-- Only admins may change flags. No insert/delete policies: the single row
-- below is seeded here and never removed via the API.
drop policy if exists "loamy_platform_config_update_admin" on public.platform_config;
create policy "loamy_platform_config_update_admin"
  on public.platform_config for update
  to authenticated
  using (public.loamy_is_admin())
  with check (public.loamy_is_admin());

drop trigger if exists loamy_platform_config_updated_at on public.platform_config;
create trigger loamy_platform_config_updated_at
  before update on public.platform_config
  for each row execute function public.loamy_set_updated_at();

-- Seed the single row (no-op if it already exists).
insert into public.platform_config (id) values (1)
on conflict (id) do nothing;
```

## The `category` → `platform_role` backfill

The portal's signup already collects a `category` that holds the same concept as the
platform's role. Migration 1 handles the transition in three layers:

1. **One-time backfill** — `UPDATE profiles SET platform_role = loamy_normalize_role(category)`
   for existing rows. The normaliser maps common spellings (`Farming` → `farmer`,
   `Warehouse` → `warehouse_owner`, …) and returns `NULL` when unsure — we never guess a
   role and risk routing a member to the wrong dashboard.
2. **Ongoing sync trigger** — `loamy_sync_platform_role` (BEFORE INSERT/UPDATE on
   `profiles`) derives `platform_role` from `category` whenever `platform_role` is unset.
   Portal signups keep writing `category` and automatically gain a `platform_role`.
3. **App-side safety net** — on login, if `platform_role` is still null,
   [AuthContext](src/context/AuthContext.tsx) tries the same normalisation from signup
   metadata/category and persists it; if that also fails, the user simply picks their role
   at the top of [Onboarding](src/pages/Onboarding.tsx).

Members whose category never maps (or predates categories) lose nothing — they choose a role
on first platform login.

## Signup compatibility

Platform signup ([src/pages/auth/Signup.tsx](src/pages/auth/Signup.tsx)) submits the same
minimal fields as the portal via auth metadata (`full_name`, `phone`, `category`, `state`,
plus `platform_role`), so the portal's existing `handle_new_user`-style trigger creates a
valid portal-style profile row. A platform account is also a valid portal account, and vice
versa.

Verified against the live schema (2026-07-13): the portal's `profiles` table enforces CHECK
constraints that signup values must match exactly —

- `profiles_category_check`: the 8 Title-case labels `'Farmer'`, `'Trader'`, `'Exporter'`,
  `'Buyer'`, `'Warehouse Owner'`, `'Logistics Provider'`, `'Growth Partner'`,
  `'Input Supplier'`. Signup therefore sends the role's **label** as `category` and the
  **slug** as `platform_role`.
- `profiles_state_check`: the 36 states plus `'FCT'` (not "FCT (Abuja)") — mirrored in
  [src/lib/nigeria.ts](src/lib/nigeria.ts).

A live verification suite covering signup, the sync trigger, onboarding writes, and
cross-user RLS denial exists at [scripts/verify-stage1.mjs](scripts/verify-stage1.mjs)
(`node scripts/verify-stage1.mjs` — creates two disposable test accounts).

## The feature-flag system

`platform_config.flags` is a single jsonb row read at login. In the UI, every nav item may
carry a `flag` key ([src/lib/roles.ts](src/lib/roles.ts)); items whose flag is not
**explicitly `true`** are hidden from the sidebar AND unreachable by direct URL
([RoleDashboard](src/pages/RoleDashboard.tsx) redirects). Absent keys read as `false`, so
un-built features stay hidden by default and later stages simply flip flags on:

```sql
update public.platform_config
set flags = flags || '{"marketplace": true}'::jsonb
where id = 1;
```

Stage 1 ships with `marketplace`, `financing_applications`, and `verification_workflow` all
`false`.

## SECURITY-REVIEW index (for the backend engineer)

Grep for `SECURITY-REVIEW` to find every flagged surface. Current index:

| Location | What to review |
| --- | --- |
| [supabase/migrations/…extend_profiles.sql](supabase/migrations/20260712100001_loamy_stage1_extend_profiles.sql) (`bvn_encrypted` / `nin_encrypted`) | Reserved identity columns. NO code path writes them. Design encryption-at-rest, key management, and column-level grants BEFORE any BVN/NIN collection begins. |
| [supabase/migrations/…extend_profiles.sql](supabase/migrations/20260712100001_loamy_stage1_extend_profiles.sql) (`loamy_is_admin`) | Security-definer admin check: must only read `profiles.role`, keep `set search_path = public`, grant to `authenticated` only. |
| [supabase/migrations/…role_details.sql](supabase/migrations/20260712100002_loamy_stage1_role_details.sql) | `role_data` jsonb: business/farm details only, never government-ID or bank data; owner-only RLS + admin read. |
| [supabase/migrations/…notifications.sql](supabase/migrations/20260712100003_loamy_stage1_notifications.sql) (`loamy_create_notification`) | The only write path into notifications; EXECUTE must stay service_role-only. |
| [src/lib/supabase.ts](src/lib/supabase.ts) | Anon-key-only client; service_role key must never enter this codebase. All queries rely on RLS. |
| [src/lib/types.ts](src/lib/types.ts) (`Profile`) | `bvn_encrypted`/`nin_encrypted` deliberately excluded from the app's Profile type. |
| [src/context/AuthContext.tsx](src/context/AuthContext.tsx) | Profile select names columns explicitly so BVN/NIN columns are never fetched into the browser. |
| [src/pages/auth/Signup.tsx](src/pages/auth/Signup.tsx) | Signup metadata carries only low-sensitivity portal fields (name, phone, category/role, state). |
| [src/pages/Onboarding.tsx](src/pages/Onboarding.tsx) | The single write path into `role_data`; keys limited to the onboarding field definitions. |
| [supabase/migrations/…stage2_farms.sql](supabase/migrations/20260713120001_loamy_stage2_farms.sql) (`latitude`/`longitude`) | Precise farm GPS is sensitive location data — owner/admin-only reads; marketplace must never expose more than state/LGA. |
| [supabase/migrations/…stage2_farms.sql](supabase/migrations/20260713120001_loamy_stage2_farms.sql) (`loamy_protect_farm_status`) | Integrity boundary of the trust layer: only workflow functions may change `verification_status`; verify nothing else can set the authorization flag. |
| [supabase/migrations/…stage2_farms.sql](supabase/migrations/20260713120001_loamy_stage2_farms.sql) (`loamy_request_farm_verification`) | Security-definer: ownership check first, only `unverified`/`rejected` may transition, grants authenticated-only. |
| [supabase/migrations/…stage2_crop_records.sql](supabase/migrations/20260713120002_loamy_stage2_crop_records.sql) | Yield history feeds credit intelligence — access strictly through farm ownership; never expose via marketplace. |
| [supabase/migrations/…stage2_financing_applications.sql](supabase/migrations/20260713120003_loamy_stage2_financing_applications.sql) | Financing data: applicant-only visibility; clients can only hold `draft`/`submitted`; `decision_note` is bank-authored. Review before real applicants. |
| [supabase/migrations/…stage2_financing_applications.sql](supabase/migrations/20260713120003_loamy_stage2_financing_applications.sql) (`loamy_log_my_event`) | Security-definer self-notify: `user_id` pinned to `auth.uid()` — must never take a target parameter. |
| [supabase/migrations/…stage2_avatars_storage.sql](supabase/migrations/20260713120004_loamy_stage2_avatars_storage.sql) | Public-read avatar bucket (profile photos only); all writes path-scoped to the caller's own folder. Stage 4 evidence uses a PRIVATE bucket instead. |
| [src/components/FarmMap.tsx](src/components/FarmMap.tsx) | Renders farm GPS — must only ever mount on owner/admin-scoped pages. |
| [src/pages/shared/Settings.tsx](src/pages/shared/Settings.tsx) | Avatar upload path + profile writes; collects low-sensitivity fields only, never BVN/NIN. |
| [supabase/migrations/…stage3_badge_public_profiles.sql](supabase/migrations/20260713150001_loamy_stage3_badge_public_profiles.sql) | `loamy_public_profiles` view deliberately bypasses profiles RLS with a FIXED minimal column set (name/category/state/avatar/badge). The column list IS the contract — never add phone/email/IDs. Badge protection trigger blocks self-verification. |
| [supabase/migrations/…stage3_listing_interests.sql](supabase/migrations/20260713150004_loamy_stage3_listing_interests.sql) (`loamy_get_interest_contacts`) | **The key Stage 3 entry.** Contact disclosure: parties only, post-acceptance only, name+phone only. Verify no other function or view exposes `profiles.phone`. |
| [supabase/migrations/…stage3_listing_interests.sql](supabase/migrations/20260713150004_loamy_stage3_listing_interests.sql) (`loamy_interest_guard`) | Interest transition matrix (who may accept/decline/withdraw/conclude) and frozen party columns. |
| [supabase/migrations/…stage3_listings.sql](supabase/migrations/20260713150002_loamy_stage3_listings.sql) | Public-read `listing-photos` bucket (listing photos ONLY); writes path-scoped to seller's folder. |
| [src/components/ContactReveal.tsx](src/components/ContactReveal.tsx) | The only UI path that renders another user's phone number. |
| [supabase/migrations/…stage4_evidence_bucket_flag.sql](supabase/migrations/20260715090003_loamy_stage4_evidence_bucket_flag.sql) | **The key Stage 4 entry.** PRIVATE evidence bucket: assigned partner writes, admin + assigned partner read (signed URLs); the subject farmer has NO read path. Review retention policy. |
| [supabase/migrations/…stage4_verification_tasks.sql](supabase/migrations/20260715090002_loamy_stage4_verification_tasks.sql) | Evidence jsonb (GPS + photos + identity checklist); farmer excluded from table reads (status-only view); two-layer approval boundary in `loamy_review_verification_task`. |
| [supabase/migrations/…stage4_partners.sql](supabase/migrations/20260715090001_loamy_stage4_partners.sql) (`loamy_record_referral`) | Self-attribution model (once, 24h window, real partner only) — review before commissions carry real money. |
| [supabase/migrations/…stage4_task_farm_info.sql](supabase/migrations/20260715090004_loamy_stage4_task_farm_info.sql) | Tiered farm exposure to non-owners: coordinates + owner name gated to assigned partner/admin. |
| [src/pages/partner/OnboardFarmer.tsx](src/pages/partner/OnboardFarmer.tsx) | Assisted signup: partner momentarily knows the farmer's starting password — invite-link flow recommended before scale. |
| [supabase/migrations/…stage5_bank_access_reports.sql](supabase/migrations/20260718090002_loamy_stage5_bank_access_reports.sql) (`loamy_application_bundle`) | **The key Stage 5 entry.** The bank's ONLY window onto applicant data: fixed field set (name, digital_id, phone for KYC contact, state, badge, farms+records, activity counts, financing context). No BVN/NIN/email/referral data; counterparties never named. NULL-guard hardened in `110002`. |
| [supabase/migrations/…stage5_bank_access_reports.sql](supabase/migrations/20260718090002_loamy_stage5_bank_access_reports.sql) (`credit_reports`) | Immutable confidential snapshots: bank-scoped read, function-only insert, no update/delete path. Review retention. |
| [supabase/migrations/…stage5_banks_officers.sql](supabase/migrations/20260718090001_loamy_stage5_banks_officers.sql) (`loamy_setup_bank_officer`) | Grants bank-portal capability — admin-only; officers never self-register. |
| [supabase/migrations/…stage5_category_nullable.sql](supabase/migrations/20260718100002_loamy_stage5_category_nullable.sql) | The single deliberate portal-constraint relaxation (category NOT NULL → nullable) — engineer to confirm no portal assumption breaks. |

## Hard constraints (permanent, all stages)

1. No wallets, payments, or fund flows — that data lives at the partner bank, not in Loamy.
2. No livestock — the commodity taxonomy in [src/lib/nigeria.ts](src/lib/nigeria.ts) is the
   complete, fixed list.
3. Real data only — every displayed number comes from actual database state, starting at zero.
4. No financing approval inside Loamy — farmers apply through Loamy; banks decide at the bank.
5. RLS on every table, no exceptions.
6. `SECURITY-REVIEW` comment flags on every sensitive surface.

## Verification checklist (Stage 1)

- [ ] `npm run dev` runs clean; existing portal account logs in and routes by role
- [ ] New signup → onboarding → correct empty dashboard
- [ ] Two accounts of different roles cannot access each other's dashboards or data
- [ ] Migrations run cleanly against the live portal schema (all objects `loamy_`-prefixed)
- [ ] README covers env, migrations, backfill, flags, SECURITY-REVIEW index
- [ ] Git history has meaningful per-feature commits
