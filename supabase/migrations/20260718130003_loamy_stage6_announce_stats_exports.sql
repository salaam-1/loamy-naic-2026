-- ============================================================================
-- Loamy Platform · Stage 6 · Migration 3 of 3
-- Announcements (batch notifications), admin dashboard stats, per-user
-- operational summary, and export audit logging.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Announcements: admin composes → notification per (active) user, whole
--    platform or one role segment. Audited with recipient count.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_announce(
  p_title text, p_body text, p_role text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Title is required';
  end if;
  if p_role is not null and not exists (
    select 1 from public.loamy_platform_roles where slug = p_role
  ) then
    raise exception 'Unknown role segment';
  end if;

  insert into public.notifications (user_id, title, body, type)
  select p.id, p_title, coalesce(p_body, ''), 'announcement'
  from public.profiles p
  where p.active
    and (p_role is null or p.platform_role = p_role);
  get diagnostics v_count = row_count;

  perform public.loamy_audit_internal('announcement_sent', null, null,
    jsonb_build_object('title', p_title, 'segment', coalesce(p_role, 'all'),
                       'recipients', v_count));
  return v_count;
end;
$$;

revoke all on function public.loamy_announce(text, text, text) from public;
revoke all on function public.loamy_announce(text, text, text) from anon;
grant execute on function public.loamy_announce(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Admin dashboard stats — one call, all live counts.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_active', (select count(*) from public.profiles where active),
    'users_by_role', (
      select coalesce(jsonb_object_agg(coalesce(platform_role, 'unassigned'), n), '{}'::jsonb)
      from (select platform_role, count(*) n from public.profiles group by platform_role) t),
    'verifications', jsonb_build_object(
      'pending', (select count(*) from public.verification_tasks where status in ('pending','assigned','in_progress','submitted','resubmit_requested')),
      'approved', (select count(*) from public.verification_tasks where status = 'approved'),
      'rejected', (select count(*) from public.verification_tasks where status = 'rejected'),
      'avg_turnaround_days', (
        select round(avg(extract(epoch from (completed_at - created_at)) / 86400.0)::numeric, 1)
        from public.verification_tasks where completed_at is not null)),
    'active_listings', (select count(*) from public.listings where status = 'active'),
    'applications_by_status', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) n from public.financing_applications group by status) t),
    'facilities_monitored', (select count(distinct application_id) from public.repayment_milestones),
    'banks_active', (select count(*) from public.banks where active));
end;
$$;

revoke all on function public.loamy_admin_stats() from public;
revoke all on function public.loamy_admin_stats() from anon;
grant execute on function public.loamy_admin_stats() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Per-user operational summary for the admin user-detail view. Counts and
--    recency only — never verification evidence, never notification contents.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_admin_user_summary(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  return jsonb_build_object(
    'farms', (select count(*) from public.farms where owner_id = p_user),
    'listings', (select count(*) from public.listings where seller_id = p_user),
    'applications', (select count(*) from public.financing_applications where applicant_id = p_user and status <> 'draft'),
    'interests', (select count(*) from public.listing_interests where buyer_id = p_user),
    'last_activity', (
      select max(t) from (
        select max(updated_at) t from public.farms where owner_id = p_user
        union all select max(updated_at) from public.listings where seller_id = p_user
        union all select max(updated_at) from public.financing_applications where applicant_id = p_user
        union all select max(created_at) from public.notifications where user_id = p_user
      ) x));
end;
$$;

revoke all on function public.loamy_admin_user_summary(uuid) from public;
revoke all on function public.loamy_admin_user_summary(uuid) from anon;
grant execute on function public.loamy_admin_user_summary(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Export audit logging (each admin CSV export records an event).
-- ----------------------------------------------------------------------------
create or replace function public.loamy_admin_log_export(p_kind text, p_rows int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  perform public.loamy_audit_internal('export_generated', null, null,
    jsonb_build_object('kind', p_kind, 'rows', p_rows));
end;
$$;

revoke all on function public.loamy_admin_log_export(text, int) from public;
revoke all on function public.loamy_admin_log_export(text, int) from anon;
grant execute on function public.loamy_admin_log_export(text, int) to authenticated;
