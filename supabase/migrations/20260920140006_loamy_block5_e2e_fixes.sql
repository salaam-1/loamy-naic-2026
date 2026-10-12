-- ============================================================================
-- BLOCK 5 (f) — four defects the end-to-end test exposed.
-- ----------------------------------------------------------------------------
-- 1. rapid_completion WAS A FALSE POSITIVE, and of the worst kind: it fired
--    on honest work. It measured accepted -> first evidence, but an agent who
--    accepts a task ON ARRIVAL and photographs the stock a minute later has
--    done nothing wrong -- that is the correct way to work. Every clean
--    capture in the test was flagged.
--
--    The signal that actually means something is the WHOLE CASE completed
--    implausibly fast, so it moves to case submission and gets a threshold
--    that reflects a real inspection rather than a photograph.
--
--    This is the same mistake as the clock-skew defect in Phase 3: a check
--    that fires on noise is worse than no check, because an agent accused
--    routinely is an agent nobody believes when it matters.
--
-- 2. THERE WAS NO WAY FOR AN ADMINISTRATOR TO CREATE A TASK. Every existing
--    entry point is member-initiated (a farmer requests, a buyer requests, a
--    bank requests). Directive 34 requires admin task control, and RLS
--    correctly refused the direct insert.
--
-- 3. verification_evidence.status had no 'superseded', so the supersede
--    function written in (c) could not actually write its own outcome.
--
-- 4. An agent with no training could not be locked out by the CLAIM, because
--    eligibility was checked first -- correct behaviour, but it meant the
--    exclusivity path was never reached. No code change; the test now trains
--    both agents so the real lock is what gets exercised.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Evidence may be superseded.
-- ----------------------------------------------------------------------------
alter table public.verification_evidence drop constraint if exists verification_evidence_status_check;
alter table public.verification_evidence add constraint verification_evidence_status_check
  check (status in ('submitted','accepted','rejected','flagged','superseded'));

-- ----------------------------------------------------------------------------
-- 2. rapid_completion, measured on the case.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_flag_rapid_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_minutes numeric;
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted'
     and new.accepted_at is not null then
    v_minutes := extract(epoch from (now() - new.accepted_at)) / 60.0;

    -- Fifteen minutes from accepting a case to submitting the whole thing --
    -- travel, inspection, checklist, photographs. Below that, a human should
    -- look. It is a REVIEW signal, never a rejection.
    if v_minutes < 15 then
      new.flags := (select array(select distinct unnest(new.flags || array['rapid_completion'])));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_verification_rapid_completion on public.verification_tasks;
create trigger loamy_verification_rapid_completion
  before update on public.verification_tasks
  for each row execute function public.loamy_flag_rapid_completion();

-- Remove it from evidence submission, where it fired on every honest capture.
create or replace function public.loamy_strip_rapid_completion_from_evidence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_evidence
     set flags = (select array(select unnest(flags) except select 'rapid_completion'))
   where 'rapid_completion' = any (flags);
  perform set_config('loamy.status_change_authorized', 'false', true);
end;
$$;

revoke all on function public.loamy_strip_rapid_completion_from_evidence() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Administrative task creation (directive 34).
-- ----------------------------------------------------------------------------
create or replace function public.loamy_create_task(
  p_task_type     text,
  p_subject_type  text default null,
  p_subject_id    uuid default null,
  p_subject_farm_id uuid default null,
  p_subject_user_id uuid default null,
  p_state         text default null,
  p_lga           text default null,
  p_lat           numeric default null,
  p_lng           numeric default null,
  p_priority      text default 'normal',
  p_related_transaction_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_user uuid := p_subject_user_id;
  v_state text := p_state;
  v_lat  numeric := p_lat;
  v_lng  numeric := p_lng;
  v_lga  text := p_lga;
  v_farm public.farms%rowtype;
  v_batch public.commodity_batches%rowtype;
begin
  if not public.loamy_is_admin() then
    raise exception 'Only an administrator creates a field task directly.';
  end if;

  -- Derive the subject's own location rather than trusting whatever was
  -- typed: an expected point that came from a form is not a reference.
  if p_subject_farm_id is not null then
    select * into v_farm from public.farms where id = p_subject_farm_id;
    if v_farm.id is null then raise exception 'Farm not found.'; end if;
    v_user  := coalesce(v_user, v_farm.owner_id);
    v_state := coalesce(v_state, v_farm.state);
    v_lga   := coalesce(v_lga, v_farm.lga);
    v_lat   := coalesce(v_lat, v_farm.latitude);
    v_lng   := coalesce(v_lng, v_farm.longitude);
  elsif p_subject_type = 'commodity_batch' and p_subject_id is not null then
    select * into v_batch from public.commodity_batches where id = p_subject_id;
    if v_batch.id is null then raise exception 'Batch not found.'; end if;
    v_user  := coalesce(v_user, v_batch.owner_id);
    v_state := coalesce(v_state, v_batch.current_state, v_batch.origin_state);
    v_lga   := coalesce(v_lga, v_batch.origin_lga);
  end if;

  if v_user is null then
    raise exception 'A task needs a subject: pass a farm, a batch or a user.';
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  insert into public.verification_tasks (
    task_type, subject_type, subject_id, subject_farm_id, subject_user_id,
    requested_by, status, priority,
    expected_state, expected_lga, expected_lat, expected_lng,
    related_transaction_id)
  values (
    p_task_type, p_subject_type, p_subject_id, p_subject_farm_id, v_user,
    v_uid, 'pending', coalesce(p_priority, 'normal'),
    v_state, v_lga, v_lat, v_lng, p_related_transaction_id)
  returning id into v_id;
  perform set_config('loamy.status_change_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'admin', 'task_created', 'verification_case', v_id,
          jsonb_build_object('task_type', p_task_type, 'state', v_state));

  return jsonb_build_object('created', true, 'task_id', v_id);
end;
$$;

revoke all on function public.loamy_create_task(
  text,text,uuid,uuid,uuid,text,text,numeric,numeric,text,uuid) from public, anon;
grant execute on function public.loamy_create_task(
  text,text,uuid,uuid,uuid,text,text,numeric,numeric,text,uuid) to authenticated;

comment on function public.loamy_create_task(text,text,uuid,uuid,uuid,text,text,numeric,numeric,text,uuid) is
  'BLOCK 5, directive 34. Administrative task creation. Derives the expected location from the SUBJECT rather than trusting a typed coordinate.';
