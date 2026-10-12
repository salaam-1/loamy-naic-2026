-- ============================================================================
-- §14 — device clock skew must not read as fraud.
-- ----------------------------------------------------------------------------
-- Found by a rerun of tests/security/phase3-verification.test.ts, which passed
-- an hour earlier and then failed with:
--
--   expected [ 'captured_before_case_existed' ] to deeply equal []
--
-- Nothing had changed. The check was:
--
--   if p_captured_at < v_case.created_at then flag 'captured_before_case_existed'
--
-- p_captured_at comes from the AGENT'S DEVICE. v_case.created_at comes from
-- Postgres. Comparing them with zero tolerance means a field phone whose clock
-- is a few seconds slow flags an honest capture as backdated -- and the flag
-- says the agent photographed the farm before anyone asked them to, which is
-- an accusation.
--
-- The future_timestamp check on the line above already allowed five minutes of
-- skew. Only the backward direction was absolute. That asymmetry was an
-- oversight, not a decision.
--
-- Both directions now use one configurable tolerance. Real backdating fraud --
-- reusing last season's photograph -- is hours or days out, not seconds, so
-- the check still catches what it is for.
-- ============================================================================

update public.platform_config
   set settings = coalesce(settings, '{}'::jsonb)
                  || jsonb_build_object('verification_clock_skew_tolerance_s', 300)
 where id = 1
   and not (coalesce(settings, '{}'::jsonb) ? 'verification_clock_skew_tolerance_s');

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
  v_skew      interval;
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
         coalesce((settings->>'verification_max_gps_accuracy_m')::numeric, 100),
         make_interval(secs => coalesce((settings->>'verification_clock_skew_tolerance_s')::numeric, 300)::int)
    into v_max_dist, v_max_acc, v_skew
  from public.platform_config where id = 1;

  select lat, lng into v_exp_lat, v_exp_lng
  from public.loamy_case_expected_point(p_case_id);

  -- One tolerance, both directions. A device clock is not evidence.
  if p_captured_at > now() + v_skew then
    v_flags := array_append(v_flags, 'future_timestamp');
  end if;
  if p_captured_at < v_case.created_at - v_skew then
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
