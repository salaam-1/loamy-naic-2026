-- ============================================================================
-- Multi-role accounts: one login, several roles, a switcher.
-- ----------------------------------------------------------------------------
-- A member can now hold more than one role on the SAME account (same email,
-- same password, same Digital ID) -- e.g. a trader who also owns a warehouse --
-- and switch between them.
--
-- DESIGN NOTE, and the reason this migration is small:
--   `profiles.platform_role` keeps its exact meaning -- the user's ACTIVE role.
--   Every existing RLS policy, helper and view that reads platform_role
--   therefore keeps working unchanged, and a switch is simply a change of the
--   active role. The new table records which roles a user is ENTITLED to;
--   switching is only ever allowed into a role they already hold.
--
-- SECURITY-REVIEW: this is an authorisation surface. Two things must hold and
-- are enforced below:
--   1. a user can only switch into a role present in their own
--      user_platform_roles rows -- checked inside a SECURITY DEFINER RPC, never
--      trusted from the client;
--   2. the operational 'bank' role can never be added or switched into by a
--      member. Bank officers are admin-created and are excluded from this
--      whole mechanism.
-- Verify: a second account cannot read or write another user's role rows, and
-- loamy_switch_role('bank') is rejected for every non-admin caller.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. user_platform_roles -- the roles each account holds.
-- ----------------------------------------------------------------------------
create table if not exists public.user_platform_roles (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null references public.loamy_platform_roles (slug),
  -- Has this role's onboarding detail form been completed?
  onboarded  boolean not null default false,
  added_at   timestamptz not null default now(),
  primary key (user_id, role),
  -- Operational roles are never self-service.
  constraint user_platform_roles_no_operational check (role <> 'bank')
);

create index if not exists user_platform_roles_user_idx
  on public.user_platform_roles (user_id);

alter table public.user_platform_roles enable row level security;

-- Read: own rows (and admins). There is deliberately NO client insert/update/
-- delete policy -- every write goes through the definer RPCs below.
drop policy if exists "loamy_user_roles_select_own" on public.user_platform_roles;
create policy "loamy_user_roles_select_own"
  on public.user_platform_roles for select to authenticated
  using (user_id = auth.uid() or public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 2. Backfill + keep in sync.
-- ----------------------------------------------------------------------------
-- Every existing account's current role becomes its first held role.
insert into public.user_platform_roles (user_id, role, onboarded)
select p.id, p.platform_role, coalesce(p.onboarding_complete, false)
from public.profiles p
where p.platform_role is not null
  and p.platform_role <> 'bank'
on conflict (user_id, role) do nothing;

-- Whenever a profile's active role is set (signup, onboarding, or a switch),
-- make sure it is recorded as held. Keeps the two in step even for write paths
-- that predate this migration.
create or replace function public.loamy_record_held_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.platform_role is not null and new.platform_role <> 'bank' then
    insert into public.user_platform_roles (user_id, role, onboarded)
    values (new.id, new.platform_role, coalesce(new.onboarding_complete, false))
    on conflict (user_id, role) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists loamy_profiles_record_held_role on public.profiles;
create trigger loamy_profiles_record_held_role
  after insert or update of platform_role on public.profiles
  for each row execute function public.loamy_record_held_role();

-- ----------------------------------------------------------------------------
-- 3. RPCs.
-- ----------------------------------------------------------------------------

-- Add a role to the caller's own account. Does NOT switch into it: the client
-- collects that role's onboarding details first, then calls loamy_switch_role.
create or replace function public.loamy_add_role(p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current text;
  v_active boolean;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_role is null or p_role = 'bank' then raise exception 'That role cannot be added.'; end if;
  if not exists (select 1 from public.loamy_platform_roles r
                 where r.slug = p_role and not r.is_operational) then
    raise exception 'Unknown role: %', p_role;
  end if;

  select platform_role, coalesce(active, true) into v_current, v_active
  from public.profiles where id = v_uid;
  if not v_active then raise exception 'This account is suspended.'; end if;
  -- Bank officers are a separate, admin-created population.
  if v_current = 'bank' then raise exception 'Bank officer accounts cannot add member roles.'; end if;

  insert into public.user_platform_roles (user_id, role, onboarded)
  values (v_uid, p_role, false)
  on conflict (user_id, role) do nothing;
end;
$$;

revoke all on function public.loamy_add_role(text) from public, anon;
grant execute on function public.loamy_add_role(text) to authenticated;

-- Mark a held role's onboarding as done (called after its detail form saves).
create or replace function public.loamy_mark_role_onboarded(p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  update public.user_platform_roles
    set onboarded = true
  where user_id = auth.uid() and role = p_role;
end;
$$;

revoke all on function public.loamy_mark_role_onboarded(text) from public, anon;
grant execute on function public.loamy_mark_role_onboarded(text) to authenticated;

-- Switch the caller's ACTIVE role. Only into a role they already hold.
-- `category` is kept in step so marketplace cards and the portal agree with the
-- active role; it is set from loamy_platform_roles.label, whose nine
-- participant labels are exactly the values profiles_category_check allows.
create or replace function public.loamy_switch_role(p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_label text;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_role = 'bank' then raise exception 'That role cannot be switched into.'; end if;
  if not exists (select 1 from public.user_platform_roles
                 where user_id = v_uid and role = p_role) then
    raise exception 'You do not have that role on this account.';
  end if;
  if not coalesce((select active from public.profiles where id = v_uid), true) then
    raise exception 'This account is suspended.';
  end if;

  select label into v_label from public.loamy_platform_roles where slug = p_role;

  update public.profiles
    set platform_role = p_role,
        category = coalesce(v_label, category)
  where id = v_uid;
end;
$$;

revoke all on function public.loamy_switch_role(text) from public, anon;
grant execute on function public.loamy_switch_role(text) to authenticated;

comment on table public.user_platform_roles is
  'Roles each account is entitled to. profiles.platform_role remains the ACTIVE role; loamy_switch_role moves between the roles recorded here.';
