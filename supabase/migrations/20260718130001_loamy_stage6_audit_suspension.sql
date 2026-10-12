-- ============================================================================
-- Loamy Platform · Stage 6 · Migration 1 of 3
-- Audit trail foundation + account suspension model + admin user-management
-- functions. ADDITIVE; all writes flow through security-definer paths.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) audit_events — append-only operational log. Key mutations only, never
--    routine reads.
-- ----------------------------------------------------------------------------
create table if not exists public.audit_events (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_role   text,
  event_type   text not null,
  subject_type text,
  subject_id   uuid,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_events_time_idx on public.audit_events (created_at desc);
create index if not exists audit_events_type_idx on public.audit_events (event_type, created_at desc);

-- SECURITY-REVIEW: audit integrity. Admin SELECT only; NO client insert/
-- update/delete policies exist — rows enter exclusively through
-- loamy_audit_internal below (called from security-definer functions and
-- definer triggers). Verify no future grant widens this.
alter table public.audit_events enable row level security;

drop policy if exists "loamy_audit_select_admin" on public.audit_events;
create policy "loamy_audit_select_admin"
  on public.audit_events for select to authenticated
  using (public.loamy_is_admin());

create or replace function public.loamy_audit_internal(
  p_event text, p_subject_type text default null, p_subject uuid default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (
    auth.uid(),
    coalesce((select case when role = 'admin' then 'admin'
                          else coalesce(platform_role, role) end
              from public.profiles where id = auth.uid()), 'system'),
    p_event, p_subject_type, p_subject, coalesce(p_detail, '{}'::jsonb));
$$;

revoke all on function public.loamy_audit_internal(text, text, uuid, jsonb) from public;
revoke all on function public.loamy_audit_internal(text, text, uuid, jsonb) from anon;
revoke all on function public.loamy_audit_internal(text, text, uuid, jsonb) from authenticated;

-- ----------------------------------------------------------------------------
-- 2) Suspension model: profiles.active. Deactivation blocks the app UI
--    (checked at load) AND the security-definer action paths (below +
--    migration 2). Admin grant itself stays MANUAL in Supabase — deliberate;
--    there is no make-admin function anywhere.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: suspension enforcement paths. App-side gate lives in
-- AuthContext/guards; server-side, loamy_is_active() is checked in:
-- loamy_officer_bank (kills all bank access), loamy_can_verify (kills the
-- verification workflow), loamy_request_farm_verification,
-- loamy_record_referral, and loamy_bank_set_status. RLS reads themselves are
-- not blocked (the account still sees its OWN data) — verify that is the
-- intended pilot semantics before live operations.
alter table public.profiles
  add column if not exists active boolean not null default true;

create or replace function public.loamy_is_active(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select active from public.profiles where id = p_user), false);
$$;

revoke all on function public.loamy_is_active(uuid) from public;
revoke all on function public.loamy_is_active(uuid) from anon;
grant execute on function public.loamy_is_active(uuid) to authenticated;

create or replace function public.loamy_admin_set_user_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot deactivate your own account';
  end if;
  update public.profiles set active = p_active where id = p_user;
  perform public.loamy_audit_internal(
    case when p_active then 'user_reactivated' else 'user_deactivated' end,
    'profile', p_user, '{}'::jsonb);
end;
$$;

revoke all on function public.loamy_admin_set_user_active(uuid, boolean) from public;
revoke all on function public.loamy_admin_set_user_active(uuid, boolean) from anon;
grant execute on function public.loamy_admin_set_user_active(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Admin role change (participant roles only — 'bank' has its own flow,
--    'admin' is manual in Supabase by standing decision).
-- ----------------------------------------------------------------------------
create or replace function public.loamy_admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if p_role not in ('farmer','trader','exporter','buyer','warehouse_owner',
                    'logistics_provider','growth_partner','input_supplier') then
    raise exception 'Role changes here are limited to the 8 participant roles';
  end if;
  select platform_role into v_old from public.profiles where id = p_user;
  if v_old is null and not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'User not found';
  end if;
  update public.profiles set platform_role = p_role where id = p_user;
  perform public.loamy_audit_internal('role_changed', 'profile', p_user,
    jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

revoke all on function public.loamy_admin_set_role(uuid, text) from public;
revoke all on function public.loamy_admin_set_role(uuid, text) from anon;
grant execute on function public.loamy_admin_set_role(uuid, text) to authenticated;
