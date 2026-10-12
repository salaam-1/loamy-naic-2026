-- ============================================================================
-- PHASE 3 (b) — two corrections found by the Phase 3 tests.
-- ----------------------------------------------------------------------------
-- 1. `loamy_task_guard` (Stage 4) refuses direct writes to verification_tasks
--    unless the session flag `loamy.status_change_authorized` is set. The new
--    Phase 3 RPCs are exactly the "sanctioned workflow functions" that guard
--    was written for, so they must raise the flag — otherwise reviewing a case
--    fails with "These task fields can only change through the verification
--    workflow". Found by tests/security/phase3-verification.test.ts.
--
-- 2. Expected location is now DERIVED from the subject rather than set by hand.
--    A farm verification's expected location is the farm's coordinates; making
--    an admin populate expected_lat/expected_lng separately was both an extra
--    step and a silent failure mode — if it was skipped, the GPS plausibility
--    check simply never ran and every capture looked clean.
--
-- The second is the more important fix: a fraud check that quietly does
-- nothing is worse than no check, because it reads as a pass.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Resolve where the agent is expected to be, from the case's subject.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_case_expected_point(p_case_id uuid)
returns table (lat numeric, lng numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_case public.verification_tasks%rowtype;
begin
  select * into v_case from public.verification_tasks where id = p_case_id;
  if v_case.id is null then return; end if;

  -- An explicitly set expectation always wins.
  if v_case.expected_lat is not null and v_case.expected_lng is not null then
    lat := v_case.expected_lat; lng := v_case.expected_lng; return next; return;
  end if;

  -- Otherwise derive it from whatever the case is about.
  if v_case.subject_farm_id is not null then
    select f.latitude, f.longitude into lat, lng
    from public.farms f where f.id = v_case.subject_farm_id;
    if lat is not null then return next; end if;
    return;
  end if;

  if v_case.subject_type = 'commodity_batch' and v_case.subject_id is not null then
    select f.latitude, f.longitude into lat, lng
    from public.commodity_batches b
    join public.farms f on f.id = b.farm_id
    where b.id = v_case.subject_id;
    if lat is not null then return next; end if;
    return;
  end if;

  if v_case.subject_type = 'harvest' and v_case.subject_id is not null then
    select coalesce(h.latitude, f.latitude), coalesce(h.longitude, f.longitude)
      into lat, lng
    from public.harvests h
    join public.farms f on f.id = h.farm_id
    where h.id = v_case.subject_id;
    if lat is not null then return next; end if;
    return;
  end if;

  return;
end;
$$;

grant execute on function public.loamy_case_expected_point(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Evidence submission: derive the expected point, and raise the guard flag.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_submit_evidence(
  p_case_id       uuid,
  p_evidence_type text,
  p_captured_at   timestamptz,
  p_storage_path  text default null,
  p_content_hash  text default null,
  p_lat           numeric default null,
  p_lng           numeric default null,
  p_accuracy_m    numeric default null,
  p_device_hash   text default null,
  p_observation   jsonb default '{}'::jsonb,
  p_quantity      numeric default null,
  p_unit          text default null,
  p_note          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_case      public.verification_tasks%rowtype;
  v_flags     text[] := '{}';
  v_dist      numeric;
  v_max_dist  numeric;
  v_max_acc   numeric;
  v_exp_lat   numeric;
  v_exp_lng   numeric;
  v_id        uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_case from public.verification_tasks where id = p_case_id;
  if v_case.id is null then raise exception 'Verification case not found.'; end if;

  if v_case.assigned_to is distinct from v_uid then
    raise exception 'Only the agent assigned to this case can submit evidence.';
  end if;
  if v_case.status not in ('assigned','in_progress','resubmit_requested') then
    raise exception 'This case is % and is not accepting evidence.', v_case.status;
  end if;

  select coalesce((settings->>'verification_max_distance_m')::numeric, 5000),
         coalesce((settings->>'verification_max_gps_accuracy_m')::numeric, 100)
    into v_max_dist, v_max_acc
  from public.platform_config where id = 1;

  select lat, lng into v_exp_lat, v_exp_lng
  from public.loamy_case_expected_point(p_case_id);

  if p_captured_at > now() + interval '5 minutes' then
    v_flags := array_append(v_flags, 'future_timestamp');
  end if;
  if p_captured_at < v_case.created_at then
    v_flags := array_append(v_flags, 'captured_before_case_existed');
  end if;

  if p_evidence_type in ('photo','video','gps_point','measurement') then
    if p_lat is null or p_lng is null then
      v_flags := array_append(v_flags, 'no_gps');
    else
      if p_accuracy_m is not null and p_accuracy_m > v_max_acc then
        v_flags := array_append(v_flags, 'low_gps_accuracy');
      end if;
      if v_exp_lat is not null and v_exp_lng is not null then
        v_dist := public.loamy_haversine_m(p_lat, p_lng, v_exp_lat, v_exp_lng);
        if v_dist > v_max_dist then
          v_flags := array_append(v_flags, 'gps_far_from_subject');
        end if;
      else
        -- Be explicit that the check could not run, rather than implying a pass.
        v_flags := array_append(v_flags, 'no_reference_location');
      end if;
    end if;
  end if;

  if p_content_hash is not null and exists (
       select 1 from public.verification_evidence
       where content_hash = p_content_hash and case_id <> p_case_id) then
    v_flags := array_append(v_flags, 'duplicate_evidence');
  end if;

  insert into public.verification_evidence (
    case_id, evidence_type, storage_path, content_hash, captured_by, captured_at,
    captured_lat, captured_lng, gps_accuracy_m, device_hash, observation,
    quantity, unit, note, distance_from_subject_m, flags, status
  ) values (
    p_case_id, p_evidence_type, p_storage_path, p_content_hash, v_uid, p_captured_at,
    p_lat, p_lng, p_accuracy_m, p_device_hash, coalesce(p_observation, '{}'::jsonb),
    p_quantity, p_unit, p_note, v_dist, v_flags,
    case when array_length(v_flags, 1) is null then 'submitted' else 'flagged' end
  ) returning id into v_id;

  -- loamy_task_guard only permits assigned/resubmit_requested -> in_progress
  -- without the flag; flags[] is not in its protected list, but the status move
  -- and the flag write happen together, so raise it for the whole statement.
  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
     set status = case when status in ('assigned','resubmit_requested') then 'in_progress' else status end,
         flags  = (select array(select distinct unnest(flags || v_flags))),
         updated_at = now()
   where id = p_case_id;
  perform set_config('loamy.status_change_authorized', 'false', true);

  return jsonb_build_object('evidence_id', v_id, 'flags', to_jsonb(v_flags),
                            'distance_m', v_dist);
end;
$$;

revoke all on function public.loamy_submit_evidence(uuid,text,timestamptz,text,text,numeric,numeric,numeric,text,jsonb,numeric,text,text) from public, anon;
grant execute on function public.loamy_submit_evidence(uuid,text,timestamptz,text,text,numeric,numeric,numeric,text,jsonb,numeric,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Case submission: raise the guard flag.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_submit_verification_case(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_case public.verification_tasks%rowtype;
  v_n    int;
  v_rate numeric;
begin
  select * into v_case from public.verification_tasks where id = p_case_id;
  if v_case.id is null then raise exception 'Verification case not found.'; end if;
  if v_case.assigned_to is distinct from v_uid then
    raise exception 'Only the assigned agent can submit this case.';
  end if;
  if v_case.status not in ('assigned','in_progress','resubmit_requested') then
    raise exception 'This case is % and cannot be submitted.', v_case.status;
  end if;

  select count(*) into v_n from public.verification_evidence where case_id = p_case_id;
  if v_n = 0 then
    raise exception 'Submit at least one piece of evidence before sending this case for review.';
  end if;

  select coalesce((settings->>'verification_sample_rate_pct')::numeric, 10)
    into v_rate from public.platform_config where id = 1;

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
     set status = 'submitted',
         submitted_at = now(),
         sampled_for_review = (array_length(flags, 1) is not null)
                              or (random() * 100 < coalesce(v_rate, 10)),
         updated_at = now()
   where id = p_case_id;
  perform set_config('loamy.status_change_authorized', 'false', true);
end;
$$;

revoke all on function public.loamy_submit_verification_case(uuid) from public, anon;
grant execute on function public.loamy_submit_verification_case(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Review: raise the guard flag around the decision write.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_review_verification_case(
  p_case_id  uuid,
  p_decision text,
  p_note     text default null,
  p_checklist jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_case public.verification_tasks%rowtype;
begin
  if not public.loamy_is_admin() then
    raise exception 'Only the platform can decide a verification.';
  end if;
  if p_decision not in ('approved','rejected','more_evidence_required') then
    raise exception 'Unknown decision: %', p_decision;
  end if;

  select * into v_case from public.verification_tasks where id = p_case_id for update;
  if v_case.id is null then raise exception 'Verification case not found.'; end if;
  if v_case.status <> 'submitted' then
    raise exception 'Only a submitted case can be reviewed (this one is %).', v_case.status;
  end if;
  if v_case.assigned_to = v_uid then
    raise exception 'The agent who collected this evidence cannot also approve it.';
  end if;

  insert into public.verification_reviews (case_id, reviewer_id, decision, note, checklist, flags_at_review)
  values (p_case_id, v_uid, p_decision, p_note, coalesce(p_checklist, '{}'::jsonb), v_case.flags);

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
     set status = case p_decision
                    when 'approved' then 'approved'
                    when 'rejected' then 'rejected'
                    else 'resubmit_requested' end,
         reviewer_id = v_uid,
         reviewer_note = p_note,
         completed_at = case when p_decision in ('approved','rejected') then now() else null end,
         updated_at = now()
   where id = p_case_id;

  update public.verification_evidence
     set status = case when p_decision = 'approved' then 'accepted'
                       when p_decision = 'rejected' then 'rejected'
                       else status end
   where case_id = p_case_id and status in ('submitted','flagged');

  if p_decision = 'approved' then
    if v_case.task_type = 'farm_verification' and v_case.subject_farm_id is not null then
      update public.farms set verification_status = 'verified' where id = v_case.subject_farm_id;
    elsif v_case.subject_type = 'commodity_batch' and v_case.subject_id is not null then
      perform public.loamy_batch_transition(
        v_case.subject_id, 'verified', null, 'verification_case', p_case_id,
        null, null, null, null, '{}'::jsonb, '{}'::jsonb, 'Approved verification');
    end if;

    perform public.loamy_record_observation(
      coalesce(v_case.subject_type, 'farm'),
      coalesce(v_case.subject_id, v_case.subject_farm_id),
      'verification', 'field_captured', null, 'verified', null, null, 1.0,
      jsonb_build_object('case_ref', v_case.ref), p_note, now());
  end if;
  perform set_config('loamy.status_change_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'admin', 'verification_decided', 'verification_case', p_case_id,
          jsonb_build_object('decision', p_decision, 'flags', to_jsonb(v_case.flags),
                             'agent', v_case.assigned_to));
end;
$$;

revoke all on function public.loamy_review_verification_case(uuid,text,text,jsonb) from public, anon;
grant execute on function public.loamy_review_verification_case(uuid,text,text,jsonb) to authenticated;
