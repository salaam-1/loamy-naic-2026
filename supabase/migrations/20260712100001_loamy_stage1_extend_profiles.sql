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
