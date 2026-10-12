-- ============================================================================
-- Loamy Platform · Stage 5 · Migration 1 of 3
-- Partner banks + bank officer model. THE defining rule of this stage:
-- NO approve/decline exists anywhere in Loamy — the Bank decides inside the
-- Bank; Loamy only records that a decision was communicated.
-- Bank officer accounts are created by ADMIN only (no self-signup path).
-- ============================================================================

create table if not exists public.banks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.banks enable row level security;

-- Names are shown across the UI; admin manages rows.
drop policy if exists "loamy_banks_select" on public.banks;
create policy "loamy_banks_select"
  on public.banks for select to authenticated using (true);

drop policy if exists "loamy_banks_admin_insert" on public.banks;
create policy "loamy_banks_admin_insert"
  on public.banks for insert to authenticated with check (public.loamy_is_admin());

drop policy if exists "loamy_banks_admin_update" on public.banks;
create policy "loamy_banks_admin_update"
  on public.banks for update to authenticated
  using (public.loamy_is_admin()) with check (public.loamy_is_admin());

drop policy if exists "loamy_banks_admin_delete" on public.banks;
create policy "loamy_banks_admin_delete"
  on public.banks for delete to authenticated using (public.loamy_is_admin());

-- Single-bank pilot seed.
insert into public.banks (name) values ('LOTUS Bank') on conflict (name) do nothing;

-- 'bank' platform role (operational — hidden from public signup, which only
-- offers the 8 participant roles).
insert into public.loamy_platform_roles (slug, label, is_operational, sort_order)
values ('bank', 'Bank Officer', true, 10)
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- Officer helpers. An officer is: platform_role='bank', role_data.bank_id set,
-- role_data.active not false, and their bank row active.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_officer_bank(p_user uuid default auth.uid())
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.profiles p
  join public.role_details rd on rd.user_id = p.id
  join public.banks b on b.id = (rd.role_data ->> 'bank_id')::uuid
  where p.id = p_user
    and p.platform_role = 'bank'
    and coalesce((rd.role_data ->> 'active')::boolean, true)
    and b.active;
$$;

revoke all on function public.loamy_officer_bank(uuid) from public;
revoke all on function public.loamy_officer_bank(uuid) from anon;
grant execute on function public.loamy_officer_bank(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Admin-only officer lifecycle. The account itself is created through the
-- standard auth signup (isolated client in the admin UI); this function then
-- ASSIGNS it to a bank. Deactivation flips role_data.active.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: this grants the bank-portal capability. Verify: admin
-- check first; target must be a fresh account (no other platform role usage
-- is overwritten silently); bank must exist. Officers never self-register.
create or replace function public.loamy_setup_bank_officer(p_user uuid, p_bank uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if not exists (select 1 from public.banks where id = p_bank) then
    raise exception 'Bank not found';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'User not found';
  end if;

  update public.profiles
  set platform_role = 'bank', onboarding_complete = true
  where id = p_user;

  insert into public.role_details (user_id, role_data)
  values (p_user, jsonb_build_object('bank_id', p_bank, 'active', true))
  on conflict (user_id)
  do update set role_data = public.role_details.role_data
                || jsonb_build_object('bank_id', p_bank, 'active', true),
                updated_at = now();

  for v_admin in select id from public.profiles where role = 'admin' loop
    perform public.loamy_create_notification_internal(
      v_admin, 'Bank officer account created',
      'A new bank officer was assigned to ' ||
        (select name from public.banks where id = p_bank) || '.',
      'admin');
  end loop;

  perform public.loamy_create_notification_internal(
    p_user, 'Bank portal access granted',
    'Your account has access to the ' ||
      (select name from public.banks where id = p_bank) || ' portal on Loamy.',
    'bank');
end;
$$;

revoke all on function public.loamy_setup_bank_officer(uuid, uuid) from public;
revoke all on function public.loamy_setup_bank_officer(uuid, uuid) from anon;
grant execute on function public.loamy_setup_bank_officer(uuid, uuid) to authenticated;

create or replace function public.loamy_set_bank_officer_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_user and platform_role = 'bank'
  ) then
    raise exception 'User is not a bank officer';
  end if;
  update public.role_details
  set role_data = role_data || jsonb_build_object('active', p_active),
      updated_at = now()
  where user_id = p_user;
end;
$$;

revoke all on function public.loamy_set_bank_officer_active(uuid, boolean) from public;
revoke all on function public.loamy_set_bank_officer_active(uuid, boolean) from anon;
grant execute on function public.loamy_set_bank_officer_active(uuid, boolean) to authenticated;
