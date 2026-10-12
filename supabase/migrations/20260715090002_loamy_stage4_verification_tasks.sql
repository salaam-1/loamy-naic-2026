-- ============================================================================
-- Loamy Platform · Stage 4 · Migration 2 of 3
-- `verification_tasks`: the core field-verification workflow object.
-- Two-layer integrity: a can_verify Growth Partner gathers evidence in the
-- field; an ADMIN reviews and approves/rejects. Approval — and only approval —
-- flips farms.verification_status and the profile's marketplace badge.
-- ============================================================================

create table if not exists public.verification_tasks (
  id              uuid primary key default gen_random_uuid(),
  task_type       text not null default 'farm_verification'
    check (task_type in ('farm_verification','identity_verification','business_verification')),
  subject_farm_id uuid references public.farms (id) on delete cascade,
  subject_user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_to     uuid references public.profiles (id) on delete set null,
  status          text not null default 'pending'
    check (status in ('pending','assigned','in_progress','submitted','approved','rejected','resubmit_requested')),
  priority        text not null default 'normal' check (priority in ('low','normal','high')),
  -- SECURITY-REVIEW: evidence holds device GPS, references to private-bucket
  -- photos, and an in-person identity checklist — location + imagery of
  -- private property. The subject farmer must NEVER read this column (their
  -- visibility is the status-only view below). Engineer to review all access
  -- paths + the private bucket policy in migration 3.
  evidence        jsonb not null default '{}'::jsonb,
  reviewer_id     uuid references public.profiles (id) on delete set null,
  reviewer_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists verification_tasks_pool_idx
  on public.verification_tasks (status) where assigned_to is null;
create index if not exists verification_tasks_assignee_idx
  on public.verification_tasks (assigned_to, status);
create index if not exists verification_tasks_subject_idx
  on public.verification_tasks (subject_user_id);

-- Territory check: does the (can_verify) caller cover this farm's location?
create or replace function public.loamy_covers_farm(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.partner_assignments pa
    join public.farms f on f.id = p_farm
    where pa.partner_id = auth.uid()
      and pa.active
      and pa.state = f.state
      and (coalesce(array_length(pa.lgas, 1), 0) = 0 or f.lga = any (pa.lgas))
  );
$$;

revoke all on function public.loamy_covers_farm(uuid) from public;
revoke all on function public.loamy_covers_farm(uuid) from anon;
grant execute on function public.loamy_covers_farm(uuid) to authenticated;

alter table public.verification_tasks enable row level security;

-- Assigned partner sees their tasks; can_verify partners see the UNASSIGNED
-- pool within their territory; admins see all. The subject farmer is
-- DELIBERATELY excluded — they read status via the view below, never evidence.
drop policy if exists "loamy_tasks_select" on public.verification_tasks;
create policy "loamy_tasks_select"
  on public.verification_tasks for select to authenticated
  using (
    assigned_to = auth.uid()
    or public.loamy_is_admin()
    or (
      status = 'pending' and assigned_to is null
      and public.loamy_can_verify(auth.uid())
      and subject_farm_id is not null
      and public.loamy_covers_farm(subject_farm_id)
    )
  );

-- Assigned partner updates their own task (evidence capture, progress,
-- submit). The guard trigger below enforces WHICH fields/transitions.
drop policy if exists "loamy_tasks_update_assignee" on public.verification_tasks;
create policy "loamy_tasks_update_assignee"
  on public.verification_tasks for update to authenticated
  using (assigned_to = auth.uid() and status in ('assigned','in_progress','resubmit_requested'))
  with check (assigned_to = auth.uid() and status in ('in_progress','submitted'));

-- No client INSERT (tasks are created by the request-verification function)
-- and no client DELETE. Admin decisions flow through the review function.

-- SECURITY-REVIEW: partner-side guard. The assigned partner may edit evidence
-- and move assigned/resubmit_requested → in_progress → submitted. They can
-- NEVER touch approval fields, reassign, or change the subject. Approval
-- happens only in loamy_review_verification_task (admin, below).
create or replace function public.loamy_task_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('loamy.status_change_authorized', true), '') = 'true' then
    return new; -- sanctioned workflow functions bypass the client guard
  end if;
  if new.assigned_to  is distinct from old.assigned_to
     or new.subject_farm_id is distinct from old.subject_farm_id
     or new.subject_user_id is distinct from old.subject_user_id
     or new.task_type   is distinct from old.task_type
     or new.priority    is distinct from old.priority
     or new.reviewer_id is distinct from old.reviewer_id
     or new.reviewer_note is distinct from old.reviewer_note
     or new.completed_at  is distinct from old.completed_at then
    raise exception 'These task fields can only change through the verification workflow';
  end if;
  if new.status is distinct from old.status then
    if old.status in ('assigned','resubmit_requested') and new.status = 'in_progress' then
      null;
    elsif old.status = 'in_progress' and new.status = 'submitted' then
      null;
    else
      raise exception 'Transition % -> % is not allowed here', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_tasks_guard on public.verification_tasks;
create trigger loamy_tasks_guard
  before update on public.verification_tasks
  for each row execute function public.loamy_task_guard();

drop trigger if exists loamy_tasks_updated_at on public.verification_tasks;
create trigger loamy_tasks_updated_at
  before update on public.verification_tasks
  for each row execute function public.loamy_set_updated_at();

-- Notify admins when a partner submits evidence.
create or replace function public.loamy_task_notify_submit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
begin
  if new.status = 'submitted' and old.status is distinct from new.status then
    for v_admin in select id from public.profiles where role = 'admin' loop
      perform public.loamy_create_notification_internal(
        v_admin, 'Verification submission awaiting review',
        'A field partner submitted verification evidence. Review it in the admin verification queue.',
        'verification');
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_tasks_notify_submit on public.verification_tasks;
create trigger loamy_tasks_notify_submit
  after update on public.verification_tasks
  for each row execute function public.loamy_task_notify_submit();

-- ----------------------------------------------------------------------------
-- Farmer-visible progress: STATUS ONLY, never evidence.
-- ----------------------------------------------------------------------------
create or replace view public.loamy_verification_progress as
select id, subject_farm_id, task_type, status, created_at, updated_at, completed_at
from public.verification_tasks
where subject_user_id = auth.uid();

revoke all on public.loamy_verification_progress from public;
revoke all on public.loamy_verification_progress from anon;
grant select on public.loamy_verification_progress to authenticated;

-- ----------------------------------------------------------------------------
-- Haversine distance (meters) — server-side GPS comparison.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_haversine_m(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
)
returns numeric
language sql
immutable
as $$
  select round(6371000 * 2 * asin(sqrt(
    power(sin(radians((lat2 - lat1) / 2)), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
      * power(sin(radians((lng2 - lng1) / 2)), 2)
  ))::numeric, 1);
$$;

grant execute on function public.loamy_haversine_m(numeric, numeric, numeric, numeric) to authenticated;

-- Capture the partner's device GPS AT the farm; compare server-side against
-- the registered pin; store both + distance in evidence. Mismatch does NOT
-- auto-fail (registered pins can be imprecise) — it flags for admin attention.
create or replace function public.loamy_gps_check(p_task uuid, p_lat numeric, p_lng numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.verification_tasks%rowtype;
  v_farm public.farms%rowtype;
  v_distance numeric;
begin
  select * into v_task from public.verification_tasks where id = p_task;
  if v_task.id is null or v_task.assigned_to is distinct from auth.uid() then
    raise exception 'Not your task';
  end if;
  if v_task.status not in ('assigned','in_progress','resubmit_requested') then
    raise exception 'Task is not editable in status %', v_task.status;
  end if;
  select * into v_farm from public.farms where id = v_task.subject_farm_id;
  if v_farm.latitude is null or v_farm.longitude is null then
    v_distance := null; -- no registered pin to compare against; store capture only
  else
    v_distance := public.loamy_haversine_m(p_lat, p_lng, v_farm.latitude, v_farm.longitude);
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
  set evidence = evidence || jsonb_build_object('gps_check', jsonb_build_object(
        'partner_lat', p_lat, 'partner_lng', p_lng,
        'farm_lat', v_farm.latitude, 'farm_lng', v_farm.longitude,
        'distance_meters', v_distance, 'captured_at', now())),
      status = case when status = 'assigned' then 'in_progress' else status end
  where id = p_task;
  perform set_config('loamy.status_change_authorized', '', true);

  return v_distance;
end;
$$;

revoke all on function public.loamy_gps_check(uuid, numeric, numeric) from public;
revoke all on function public.loamy_gps_check(uuid, numeric, numeric) from anon;
grant execute on function public.loamy_gps_check(uuid, numeric, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- Claim from the territory pool (self-claim) / admin assignment.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_claim_verification_task(p_task uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.verification_tasks%rowtype;
begin
  select * into v_task from public.verification_tasks where id = p_task for update;
  if v_task.id is null then
    raise exception 'Task not found';
  end if;
  if v_task.status <> 'pending' or v_task.assigned_to is not null then
    raise exception 'Task is no longer available';
  end if;
  if not public.loamy_can_verify(auth.uid()) then
    raise exception 'You do not have verification capability';
  end if;
  if v_task.subject_farm_id is null or not public.loamy_covers_farm(v_task.subject_farm_id) then
    raise exception 'This task is outside your territory';
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
  set assigned_to = auth.uid(), status = 'assigned' where id = p_task;
  perform set_config('loamy.status_change_authorized', '', true);

  perform public.loamy_create_notification_internal(
    v_task.subject_user_id, 'Verification visit scheduled',
    'A Loamy field partner has taken up your farm verification. You will be contacted to arrange the visit.',
    'verification');
end;
$$;

revoke all on function public.loamy_claim_verification_task(uuid) from public;
revoke all on function public.loamy_claim_verification_task(uuid) from anon;
grant execute on function public.loamy_claim_verification_task(uuid) to authenticated;

create or replace function public.loamy_assign_verification_task(p_task uuid, p_partner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.verification_tasks%rowtype;
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  select * into v_task from public.verification_tasks where id = p_task for update;
  if v_task.id is null or v_task.status not in ('pending','assigned') then
    raise exception 'Task cannot be (re)assigned in status %', v_task.status;
  end if;
  if not public.loamy_can_verify(p_partner) then
    raise exception 'That partner does not have verification capability';
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
  set assigned_to = p_partner, status = 'assigned' where id = p_task;
  perform set_config('loamy.status_change_authorized', '', true);

  perform public.loamy_create_notification_internal(
    p_partner, 'Verification task assigned to you',
    'An administrator assigned you a farm verification task. Open Verification Tasks to begin.',
    'verification');
  perform public.loamy_create_notification_internal(
    v_task.subject_user_id, 'Verification visit scheduled',
    'A Loamy field partner has been assigned to verify your farm.', 'verification');
end;
$$;

revoke all on function public.loamy_assign_verification_task(uuid, uuid) from public;
revoke all on function public.loamy_assign_verification_task(uuid, uuid) from anon;
grant execute on function public.loamy_assign_verification_task(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- ADMIN review: the ONLY approval path in the system. Approval flips
-- farms.verification_status → 'verified' AND the farmer's marketplace badge,
-- and accrues the partner's verification earning at the configured rate.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: two-layer integrity boundary. Verify: admin check first;
-- only 'submitted' tasks are reviewable; the authorized flag wraps ONLY the
-- intended updates; badge/farm changes happen nowhere else.
create or replace function public.loamy_review_verification_task(
  p_task uuid, p_decision text, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.verification_tasks%rowtype;
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if p_decision not in ('approved','rejected','resubmit_requested') then
    raise exception 'Invalid decision';
  end if;
  select * into v_task from public.verification_tasks where id = p_task for update;
  if v_task.id is null or v_task.status <> 'submitted' then
    raise exception 'Only submitted tasks can be reviewed';
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);

  update public.verification_tasks
  set status = p_decision,
      reviewer_id = auth.uid(),
      reviewer_note = p_note,
      completed_at = case when p_decision in ('approved','rejected') then now() else null end
  where id = p_task;

  if p_decision = 'approved' then
    update public.farms set verification_status = 'verified' where id = v_task.subject_farm_id;
    update public.profiles set verified_badge = true where id = v_task.subject_user_id;
    perform public.loamy_accrue_earning_internal(v_task.assigned_to, 'verification', v_task.id);
  elsif p_decision = 'rejected' then
    update public.farms set verification_status = 'rejected' where id = v_task.subject_farm_id;
  end if;

  perform set_config('loamy.status_change_authorized', '', true);

  -- Notify both sides honestly.
  if v_task.assigned_to is not null then
    perform public.loamy_create_notification_internal(
      v_task.assigned_to,
      case p_decision
        when 'approved' then 'Verification approved'
        when 'rejected' then 'Verification rejected'
        else 'Resubmission requested' end,
      coalesce(p_note, ''), 'verification');
  end if;
  perform public.loamy_create_notification_internal(
    v_task.subject_user_id,
    case p_decision
      when 'approved' then 'Your farm is now verified'
      when 'rejected' then 'Farm verification unsuccessful'
      else 'Verification needs another visit' end,
    case p_decision
      when 'approved' then 'Your farm passed field verification. Your marketplace profile now carries the verified badge.'
      when 'rejected' then 'The field verification could not confirm your farm details. Review your farm profile and request verification again.'
      else 'The review team asked the field partner to gather more evidence. No action needed from you yet.' end,
    'verification');
end;
$$;

revoke all on function public.loamy_review_verification_task(uuid, text, text) from public;
revoke all on function public.loamy_review_verification_task(uuid, text, text) from anon;
grant execute on function public.loamy_review_verification_task(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Requesting verification (Stage 2 fn, extended): now ALSO creates the
-- verification_task and notifies can_verify partners covering the territory.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_request_farm_verification(p_farm_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_name    text;
  v_status  text;
  v_state   text;
  v_lga     text;
  v_admin   uuid;
  v_partner uuid;
  v_task    uuid;
begin
  select owner_id, farm_name, verification_status, state, lga
    into v_owner, v_name, v_status, v_state, v_lga
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

  insert into public.verification_tasks (task_type, subject_farm_id, subject_user_id)
  values ('farm_verification', p_farm_id, v_owner)
  returning id into v_task;
  perform set_config('loamy.status_change_authorized', '', true);

  for v_admin in select id from public.profiles where role = 'admin' loop
    perform public.loamy_create_notification_internal(
      v_admin, 'Farm verification requested',
      '"' || v_name || '" (' || v_lga || ', ' || v_state || ') needs a field visit — assign or await self-claim.',
      'verification');
  end loop;

  -- Alert can_verify partners whose active territory covers this farm.
  for v_partner in
    select distinct pa.partner_id
    from public.partner_assignments pa
    where pa.active and pa.state = v_state
      and (coalesce(array_length(pa.lgas, 1), 0) = 0 or v_lga = any (pa.lgas))
      and public.loamy_can_verify(pa.partner_id)
  loop
    perform public.loamy_create_notification_internal(
      v_partner, 'New verification task in your territory',
      'A farm in ' || v_lga || ', ' || v_state || ' requested verification. Claim it from your task pool.',
      'verification');
  end loop;

  perform public.loamy_create_notification_internal(
    auth.uid(), 'Verification requested',
    'Your farm "' || v_name || '" is pending verification. A field visit will be arranged.',
    'verification');
end;
$$;
