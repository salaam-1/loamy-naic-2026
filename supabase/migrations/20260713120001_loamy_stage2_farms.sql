-- ============================================================================
-- Loamy Platform · Stage 2 · Migration 1 of 4
-- `farms`: one farmer can register multiple farm plots.
-- ADDITIVE ONLY, loamy_-prefixed helpers, RLS strict owner + admin read.
-- ============================================================================

create table if not exists public.farms (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  farm_name           text not null,
  state               text not null,
  lga                 text not null,
  address_description text,
  -- SECURITY-REVIEW: latitude/longitude are precise GPS coordinates of private
  -- farmland — sensitive location data. RLS below restricts reads to the owner
  -- (and admin); Stage 4's verification evidence will reference them.
  -- Engineer to review every future exposure path (marketplace must NEVER
  -- surface farm coordinates; only state/LGA granularity may be public).
  latitude            numeric check (latitude  is null or (latitude  between -90  and 90)),
  longitude           numeric check (longitude is null or (longitude between -180 and 180)),
  size_hectares       numeric not null check (size_hectares > 0),
  -- Fixed commodity taxonomy — crops only, NO livestock, enforced at the DB.
  primary_crops       text[] not null check (
    array_length(primary_crops, 1) >= 1
    and primary_crops <@ array[
      'Maize','Rice','Sorghum','Millet','Soybeans','Cowpea','Groundnut',
      'Sesame','Cassava','Yam','Cocoa','Cashew','Ginger','Chili Pepper','Hibiscus'
    ]::text[]
  ),
  ownership_type      text not null check (ownership_type in ('owned','leased','family')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','pending','verified','rejected')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists farms_owner_idx on public.farms (owner_id);

alter table public.farms enable row level security;

drop policy if exists "loamy_farms_select_own" on public.farms;
create policy "loamy_farms_select_own"
  on public.farms for select to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "loamy_farms_select_admin" on public.farms;
create policy "loamy_farms_select_admin"
  on public.farms for select to authenticated
  using (public.loamy_is_admin());

-- Owners create farms; new farms always start 'unverified'.
drop policy if exists "loamy_farms_insert_own" on public.farms;
create policy "loamy_farms_insert_own"
  on public.farms for insert to authenticated
  with check (auth.uid() = owner_id and verification_status = 'unverified');

drop policy if exists "loamy_farms_update_own" on public.farms;
create policy "loamy_farms_update_own"
  on public.farms for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "loamy_farms_delete_own" on public.farms;
create policy "loamy_farms_delete_own"
  on public.farms for delete to authenticated
  using (auth.uid() = owner_id);

drop trigger if exists loamy_farms_updated_at on public.farms;
create trigger loamy_farms_updated_at
  before update on public.farms
  for each row execute function public.loamy_set_updated_at();

-- ----------------------------------------------------------------------------
-- verification_status is workflow-owned: farmers may edit their farm freely
-- but must NEVER set their own verification status (a farmer could otherwise
-- mark themselves 'verified' via the API). Direct changes are rejected unless
-- the sanctioned workflow function (below) has set a transaction-local flag.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: this trigger is the integrity boundary for the trust layer.
-- Verify no path can set 'loamy.status_change_authorized' except the
-- security-definer workflow functions (Stage 2: request; Stage 4: approve).
create or replace function public.loamy_protect_farm_status()
returns trigger
language plpgsql
as $$
begin
  if new.verification_status is distinct from old.verification_status
     and coalesce(current_setting('loamy.status_change_authorized', true), '') <> 'true' then
    raise exception 'verification_status can only change through the verification workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_farms_protect_status on public.farms;
create trigger loamy_farms_protect_status
  before update on public.farms
  for each row execute function public.loamy_protect_farm_status();

-- ----------------------------------------------------------------------------
-- Request verification: the ONLY way a farmer moves a farm to 'pending'.
-- Notifies all admins + logs an activity notification for the farmer.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: security-definer. Verify: (1) ownership check on auth.uid()
-- stays first, (2) only 'unverified'/'rejected' farms can transition, (3) the
-- transaction-local authorization flag is cleared after the update, (4) grants
-- stay authenticated-only.
create or replace function public.loamy_request_farm_verification(p_farm_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_name   text;
  v_status text;
  v_admin  uuid;
begin
  select owner_id, farm_name, verification_status
    into v_owner, v_name, v_status
    from public.farms where id = p_farm_id;

  if v_owner is null then
    raise exception 'Farm not found';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'You can only request verification for your own farm';
  end if;
  if v_status not in ('unverified','rejected') then
    raise exception 'This farm is already %', v_status;
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.farms set verification_status = 'pending' where id = p_farm_id;
  perform set_config('loamy.status_change_authorized', '', true);

  for v_admin in select id from public.profiles where role = 'admin' loop
    insert into public.notifications (user_id, title, body, type)
    values (v_admin, 'Farm verification requested',
            '"' || v_name || '" has requested verification. A field visit needs to be scheduled.',
            'verification');
  end loop;

  insert into public.notifications (user_id, title, body, type)
  values (auth.uid(), 'Verification requested',
          'Your farm "' || v_name || '" is pending verification. A field visit will be arranged.',
          'verification');
end;
$$;

revoke all on function public.loamy_request_farm_verification(uuid) from public;
revoke all on function public.loamy_request_farm_verification(uuid) from anon;
grant execute on function public.loamy_request_farm_verification(uuid) to authenticated;
