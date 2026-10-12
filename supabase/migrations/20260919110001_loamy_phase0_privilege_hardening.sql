-- ============================================================================
-- PHASE 0 — privilege-escalation hardening.
-- ----------------------------------------------------------------------------
-- Found by tests/security/privilege-escalation.test.ts, which proved a member
-- could promote themselves. Two client-writable columns formed one chain:
--
--   1. `profiles.platform_role` is directly UPDATE-able by its owner, so the
--      entitlement check inside loamy_switch_role could simply be side-stepped
--      with a plain update.
--   2. `role_details.role_data` is a self-writable jsonb blob, and
--      `can_verify` is read out of it.
--
-- loamy_can_verify(uid) is exactly `platform_role = 'growth_partner' AND
-- role_data.can_verify = true`. Both halves were self-settable, so ANY member
-- could grant themselves the Growth Partner verification capability — which
-- gates claiming verification tasks, submitting evidence, and READING OTHER
-- MEMBERS' PRIVATE FARM DETAIL (20260715090004 line 37).
--
-- Severity: HIGH. No evidence it was exploited (audit_events has no
-- unexplained role_changed rows), but the path was open.
--
-- Approach mirrors the existing loamy_protect_profile_badge trigger: the
-- columns stay where they are, and a BEFORE UPDATE trigger refuses the change
-- unless it arrives through an authorised code path that sets a session flag.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. platform_role may only change through an authorised RPC, or by an admin.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_protect_platform_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- NULL -> value stays permitted: that is the first-role backfill for portal
  -- accounts whose free-text category never mapped to a slug (AuthContext does
  -- this on load, and the Stage 1 sync trigger relies on it). It grants nothing
  -- a fresh onboarding would not, because the account has no role yet.
  if old.platform_role is not null
     and new.platform_role is distinct from old.platform_role
     and coalesce(current_setting('loamy.role_change_authorized', true), '') <> 'true'
     and not public.loamy_is_admin() then
    raise exception 'platform_role can only change through loamy_switch_role or loamy_set_initial_role';
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_profiles_protect_platform_role on public.profiles;
create trigger loamy_profiles_protect_platform_role
  before update on public.profiles
  for each row execute function public.loamy_protect_platform_role();

-- ----------------------------------------------------------------------------
-- 2. can_verify may only change through loamy_set_can_verify (admin-only).
-- ----------------------------------------------------------------------------
-- The rest of role_data stays freely self-writable: it is the member's own
-- business profile. Only this one capability key is privileged.
create or replace function public.loamy_protect_can_verify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old boolean := (old.role_data ->> 'can_verify')::boolean;
  v_new boolean := (new.role_data ->> 'can_verify')::boolean;
begin
  if coalesce(v_new, false) is distinct from coalesce(v_old, false)
     and coalesce(current_setting('loamy.capability_change_authorized', true), '') <> 'true'
     and not public.loamy_is_admin() then
    raise exception 'can_verify is granted by an administrator, not self-assigned';
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_role_details_protect_can_verify on public.role_details;
create trigger loamy_role_details_protect_can_verify
  before update on public.role_details
  for each row execute function public.loamy_protect_can_verify();

-- An INSERT cannot "change" a value, so guard the create path separately:
-- a brand-new row must not arrive with can_verify already true.
create or replace function public.loamy_protect_can_verify_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((new.role_data ->> 'can_verify')::boolean, false)
     and coalesce(current_setting('loamy.capability_change_authorized', true), '') <> 'true'
     and not public.loamy_is_admin() then
    raise exception 'can_verify is granted by an administrator, not self-assigned';
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_role_details_protect_can_verify_ins on public.role_details;
create trigger loamy_role_details_protect_can_verify_ins
  before insert on public.role_details
  for each row execute function public.loamy_protect_can_verify_insert();

-- ----------------------------------------------------------------------------
-- 3. Authorised paths set the session flag.
-- ----------------------------------------------------------------------------

-- Initial role selection at onboarding. Permitted only while the account has
-- not completed onboarding, so it cannot double as a free role switch.
create or replace function public.loamy_set_initial_role(p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_done boolean;
  v_label text;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_role is null or p_role = 'bank' then raise exception 'That role cannot be selected.'; end if;
  if not exists (select 1 from public.loamy_platform_roles
                 where slug = p_role and not is_operational) then
    raise exception 'Unknown role: %', p_role;
  end if;

  select coalesce(onboarding_complete, false) into v_done from public.profiles where id = v_uid;
  if v_done then
    raise exception 'Onboarding is already complete — use loamy_switch_role to change role.';
  end if;

  select label into v_label from public.loamy_platform_roles where slug = p_role;

  perform set_config('loamy.role_change_authorized', 'true', true);
  update public.profiles
    set platform_role = p_role,
        category = coalesce(v_label, category),
        onboarding_complete = true
  where id = v_uid;
  perform set_config('loamy.role_change_authorized', 'false', true);
end;
$$;

revoke all on function public.loamy_set_initial_role(text) from public, anon;
grant execute on function public.loamy_set_initial_role(text) to authenticated;

-- Re-create the switch RPC so it raises the flag before writing.
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

  perform set_config('loamy.role_change_authorized', 'true', true);
  update public.profiles
    set platform_role = p_role,
        category = coalesce(v_label, category)
  where id = v_uid;
  perform set_config('loamy.role_change_authorized', 'false', true);
end;
$$;

revoke all on function public.loamy_switch_role(text) from public, anon;
grant execute on function public.loamy_switch_role(text) to authenticated;

-- The admin capability grant raises its own flag.
-- Signature preserved so AdminPartners.tsx keeps working unchanged.
create or replace function public.loamy_set_can_verify(p_user uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loamy_is_admin() then raise exception 'Admin only.'; end if;

  perform set_config('loamy.capability_change_authorized', 'true', true);
  insert into public.role_details (user_id, role_data)
  values (p_user, jsonb_build_object('can_verify', p_value))
  on conflict (user_id) do update
    set role_data = public.role_details.role_data || jsonb_build_object('can_verify', p_value),
        updated_at = now();
  perform set_config('loamy.capability_change_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (auth.uid(), 'admin', 'capability_changed', 'profile', p_user,
          jsonb_build_object('capability', 'can_verify', 'value', p_value));
end;
$$;

revoke all on function public.loamy_set_can_verify(uuid, boolean) from public, anon;
grant execute on function public.loamy_set_can_verify(uuid, boolean) to authenticated;

comment on function public.loamy_protect_platform_role() is
  'Phase 0 hardening: platform_role is not client-writable. Change it via loamy_switch_role / loamy_set_initial_role.';
comment on function public.loamy_protect_can_verify() is
  'Phase 0 hardening: role_data.can_verify is admin-granted via loamy_set_can_verify, never self-assigned.';
