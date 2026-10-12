-- ============================================================================
-- Processor / Large-Offtaker Dashboard — PART 1: role, registration, companies
-- ============================================================================
-- Adds the `processor` platform role and the multi-tenant company backbone that
-- every later part (RFQs, bids, awards, contracts, escrow, logistics) hangs off.
--
-- SECURITY-REVIEW: multi-tenant company isolation is the core boundary of this
-- whole epic. Every companies / company_members read is scoped to the caller's
-- own memberships via the SECURITY DEFINER helper loamy_user_company_ids();
-- verify no cross-company leakage before shipping any later part.
--
-- Identity data (NIN / BVN / face-liveness) is NOT collected here. The KYC
-- surface is built behind the `processor_kyc` flag (default OFF) with no write
-- path; adapters are placeholder seams only. See src/lib/kyc/*.
-- ============================================================================

-- 1. Role plumbing --------------------------------------------------------------

-- Allow 'Processor' as a signup category (portal CHECK constraint currently
-- permits exactly the 8 Title-case labels — see 20260713090002).
alter table public.profiles drop constraint if exists profiles_category_check;
alter table public.profiles add constraint profiles_category_check
  check (category in (
    'Farmer','Trader','Exporter','Warehouse Owner','Logistics Provider',
    'Growth Partner','Input Supplier','Buyer','Processor'
  ));

-- Teach the normaliser about processor so category → platform_role stays in sync.
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
    when 'processor'          then 'processor'
    when 'processing'         then 'processor'
    when 'offtaker'           then 'processor'
    when 'off_taker'          then 'processor'
    when 'miller'             then 'processor'
    else null
  end
  from (select regexp_replace(lower(trim(coalesce(raw, ''))), '[\s/-]+', '_', 'g') as norm) t;
$$;

-- 2. companies ------------------------------------------------------------------

create table if not exists public.companies (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  cac_number        text,               -- CAC registration (RC/BN), free text
  rc_number         text,
  business_address  text,
  industry          text,               -- e.g. 'Flour milling', 'Feed', 'Export'
  contact_person    text,
  email             text,
  phone             text,
  logo_url          text,
  tin               text,               -- nullable
  verified          boolean not null default false,
  verified_at       timestamptz,
  verified_by       uuid references auth.users(id),
  created_by        uuid not null default auth.uid() references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 3. company_members ------------------------------------------------------------
-- company_role is one of the fixed procurement-org roles (validated in the app
-- and by the add/update RPCs). is_owner marks the founder (registrant) who can
-- never be removed or demoted by anyone but themselves.

create table if not exists public.company_members (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  company_role text not null default 'Executive Viewer',
  permissions  jsonb not null default '{}'::jsonb,
  is_owner     boolean not null default false,
  invited_by   uuid references auth.users(id),
  joined_at    timestamptz not null default now(),
  unique (company_id, user_id)
);

create index if not exists company_members_user_idx on public.company_members(user_id);
create index if not exists company_members_company_idx on public.company_members(company_id);

-- 4. Membership helpers (SECURITY DEFINER — bypass RLS to avoid policy recursion)

-- All company_ids the calling user is an active member of.
create or replace function public.loamy_user_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.company_members where user_id = auth.uid();
$$;

-- The caller's company_role in a given company (null if not a member).
create or replace function public.loamy_company_role(target uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select company_role from public.company_members
  where company_id = target and user_id = auth.uid()
  limit 1;
$$;

-- True when the caller may administer a company (founder or Procurement Director).
create or replace function public.loamy_company_can_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target and user_id = auth.uid()
      and (is_owner or company_role = 'Procurement Director')
  );
$$;

-- 5. RLS ------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.company_members enable row level security;

-- companies: a member (or platform admin) can read; only company admins can edit.
-- Direct INSERT is disallowed — creation goes through loamy_create_company so the
-- founder membership is always created atomically with the company.
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select to authenticated
  using (id in (select public.loamy_user_company_ids()) or public.loamy_is_admin());

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update to authenticated
  using (public.loamy_company_can_admin(id))
  with check (public.loamy_company_can_admin(id));

-- company_members: co-members (or admin) can see the roster; writes go through
-- the SECURITY DEFINER RPCs only (no direct insert/update/delete policy).
drop policy if exists company_members_select on public.company_members;
create policy company_members_select on public.company_members
  for select to authenticated
  using (company_id in (select public.loamy_user_company_ids()) or public.loamy_is_admin());

-- 6. Registration + membership RPCs --------------------------------------------

-- Register a company and make the caller its founding Procurement Director.
create or replace function public.loamy_create_company(
  p_name text,
  p_cac_number text default null,
  p_rc_number text default null,
  p_business_address text default null,
  p_industry text default null,
  p_contact_person text default null,
  p_email text default null,
  p_phone text default null,
  p_tin text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Company name is required';
  end if;

  insert into public.companies (
    name, cac_number, rc_number, business_address, industry,
    contact_person, email, phone, tin, created_by
  ) values (
    trim(p_name), nullif(trim(p_cac_number), ''), nullif(trim(p_rc_number), ''),
    nullif(trim(p_business_address), ''), nullif(trim(p_industry), ''),
    nullif(trim(p_contact_person), ''), nullif(trim(p_email), ''),
    nullif(trim(p_phone), ''), nullif(trim(p_tin), ''), auth.uid()
  )
  returning id into v_id;

  insert into public.company_members (company_id, user_id, company_role, is_owner, invited_by)
  values (v_id, auth.uid(), 'Procurement Director', true, auth.uid());

  return v_id;
end;
$$;

-- Update the caller's own company profile (admins only).
create or replace function public.loamy_update_company(
  p_company_id uuid,
  p_name text,
  p_cac_number text default null,
  p_rc_number text default null,
  p_business_address text default null,
  p_industry text default null,
  p_contact_person text default null,
  p_email text default null,
  p_phone text default null,
  p_tin text default null,
  p_logo_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loamy_company_can_admin(p_company_id) then
    raise exception 'Not authorised to edit this company';
  end if;
  update public.companies set
    name             = coalesce(nullif(trim(p_name), ''), name),
    cac_number       = nullif(trim(p_cac_number), ''),
    rc_number        = nullif(trim(p_rc_number), ''),
    business_address = nullif(trim(p_business_address), ''),
    industry         = nullif(trim(p_industry), ''),
    contact_person   = nullif(trim(p_contact_person), ''),
    email            = nullif(trim(p_email), ''),
    phone            = nullif(trim(p_phone), ''),
    tin              = nullif(trim(p_tin), ''),
    logo_url         = coalesce(nullif(trim(p_logo_url), ''), logo_url),
    updated_at       = now()
  where id = p_company_id;
end;
$$;

-- Add a teammate by their Loamy phone number. Admins only; must be an existing
-- platform user. Idempotent on (company, user).
create or replace function public.loamy_add_company_member(
  p_company_id uuid,
  p_phone text,
  p_company_role text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.loamy_company_can_admin(p_company_id) then
    raise exception 'Not authorised to manage this team';
  end if;
  if p_company_role not in (
    'Procurement Director','Procurement Manager','Finance Officer',
    'Warehouse Manager','Logistics Coordinator','Quality Assurance Officer',
    'Executive Viewer'
  ) then
    raise exception 'Unknown company role: %', p_company_role;
  end if;

  select id into v_user from public.profiles
  where phone = regexp_replace(trim(p_phone), '\s+', '', 'g')
     or phone = trim(p_phone)
  limit 1;
  if v_user is null then
    raise exception 'No Loamy account found for that phone number';
  end if;

  insert into public.company_members (company_id, user_id, company_role, invited_by)
  values (p_company_id, v_user, p_company_role, auth.uid())
  on conflict (company_id, user_id)
    do update set company_role = excluded.company_role
  returning id into v_user;

  return v_user;
end;
$$;

create or replace function public.loamy_update_company_member_role(
  p_company_id uuid,
  p_user_id uuid,
  p_company_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loamy_company_can_admin(p_company_id) then
    raise exception 'Not authorised to manage this team';
  end if;
  if exists (select 1 from public.company_members
             where company_id = p_company_id and user_id = p_user_id and is_owner) then
    raise exception 'The company owner role cannot be changed';
  end if;
  update public.company_members
  set company_role = p_company_role
  where company_id = p_company_id and user_id = p_user_id;
end;
$$;

create or replace function public.loamy_remove_company_member(
  p_company_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loamy_company_can_admin(p_company_id) then
    raise exception 'Not authorised to manage this team';
  end if;
  if exists (select 1 from public.company_members
             where company_id = p_company_id and user_id = p_user_id and is_owner) then
    raise exception 'The company owner cannot be removed';
  end if;
  delete from public.company_members
  where company_id = p_company_id and user_id = p_user_id;
end;
$$;

grant execute on function public.loamy_create_company(text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.loamy_update_company(uuid,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.loamy_add_company_member(uuid,text,text) to authenticated;
grant execute on function public.loamy_update_company_member_role(uuid,uuid,text) to authenticated;
grant execute on function public.loamy_remove_company_member(uuid,uuid) to authenticated;
grant execute on function public.loamy_user_company_ids() to authenticated;
grant execute on function public.loamy_company_role(uuid) to authenticated;
grant execute on function public.loamy_company_can_admin(uuid) to authenticated;

-- 7. Roster view ----------------------------------------------------------------
-- Members need to see co-members' names/phones, but profiles RLS blocks
-- cross-user reads. This view is SECURITY DEFINER (security_invoker=false, the
-- default) and re-applies the company-membership scope itself, so a caller only
-- ever sees the roster of companies they belong to.
-- SECURITY-REVIEW: the WHERE clause is the isolation boundary — do not remove.
create or replace view public.loamy_company_members_v as
  select
    cm.id,
    cm.company_id,
    cm.user_id,
    cm.company_role,
    cm.is_owner,
    cm.joined_at,
    p.full_name,
    p.phone
  from public.company_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.company_id in (select public.loamy_user_company_ids())
     or public.loamy_is_admin();

grant select on public.loamy_company_members_v to authenticated;
