-- ============================================================================
-- BLOCK 5 (c) — evidence integrity, and the rest of the fraud signals.
-- ----------------------------------------------------------------------------
-- Extends the LIVE loamy_submit_evidence (last defined in 20260919290001 --
-- checked, not assumed, after that mistake cost three attempts in Block 4).
--
-- THREE ADDITIONS.
--
-- 1. THE CLOCK SKEW IS NOW A NUMBER, not only a flag. Directive 12 asks for
--    device time AND server time; a reviewer looking at a five-second drift
--    and a five-hour one should not see the same thing.
--
-- 2. THREE MORE SIGNALS from directive 18:
--
--      repeated_identical_coordinates  the same point, to five decimals, on
--                                      a different case by the same agent
--      impossible_travel               >120 km/h implied between two of this
--                                      agent's captures
--      rapid_completion                accepted and submitted inside three
--                                      minutes
--
--    Every one of them means REVIEW REQUIRED. None means fraud, and none
--    rejects anything automatically. An agent who genuinely drove fast, or
--    verified two stores in one compound, deserves a human looking rather
--    than an accusation.
--
-- 3. EVIDENCE IS NEVER DELETED OR OVERWRITTEN. A correction supersedes the
--    original and both survive, because a record that can be quietly
--    replaced is not evidence.
-- ============================================================================

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
  v_skew_seconds numeric;
  v_exp_lat   numeric;
  v_exp_lng   numeric;
  v_id        uuid;
  v_prev      record;
  v_speed     numeric;
  v_elapsed   numeric;
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

  -- Directive 12: record the skew, then judge it. The number is kept on the
  -- row either way, so a reviewer can see a five-second drift is not a
  -- five-hour one.
  v_skew_seconds := extract(epoch from (p_captured_at - now()));

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

  -- ---- Directive 18: further signals. Each means REVIEW REQUIRED, never
  -- ---- "fraud". They are appended and routed, not acted on automatically.

  -- The same coordinates, to five decimal places, on a DIFFERENT case by the
  -- same agent. Standing in one place and filing two farms is a pattern.
  if p_lat is not null and p_lng is not null and exists (
       select 1 from public.verification_evidence e
       where e.captured_by = v_uid and e.case_id <> p_case_id
         and round(e.captured_lat, 5) = round(p_lat, 5)
         and round(e.captured_lng, 5) = round(p_lng, 5)) then
    v_flags := array_append(v_flags, 'repeated_identical_coordinates');
  end if;

  -- Impossible travel: this agent's last capture, and how fast they would
  -- have had to move to be here now.
  if p_lat is not null and p_lng is not null then
    select e.captured_lat, e.captured_lng, e.received_at into v_prev
    from public.verification_evidence e
    where e.captured_by = v_uid and e.id is distinct from v_id
      and e.captured_lat is not null and e.captured_lng is not null
    order by e.received_at desc limit 1;

    if v_prev.captured_lat is not null then
      v_elapsed := greatest(extract(epoch from (now() - v_prev.received_at)) / 3600.0, 0.0001);
      v_speed := public.loamy_haversine_m(v_prev.captured_lat, v_prev.captured_lng, p_lat, p_lng)
                 / 1000.0 / v_elapsed;
      -- 120 km/h sustained between two field captures is not a Nigerian
      -- road journey. Below that, no flag: agents do travel.
      if v_speed > 120 then
        v_flags := array_append(v_flags, 'impossible_travel');
      end if;
    end if;
  end if;

  -- Accepted and submitted within three minutes. A real inspection takes
  -- longer than walking to the gate.
  if v_case.accepted_at is not null
     and now() - v_case.accepted_at < interval '3 minutes' then
    v_flags := array_append(v_flags, 'rapid_completion');
  end if;

  insert into public.verification_evidence (
    case_id, evidence_type, storage_path, content_hash, captured_by, captured_at,
    captured_lat, captured_lng, gps_accuracy_m, device_hash, observation,
    quantity, unit, note, distance_from_subject_m, flags, clock_skew_seconds, status
  ) values (
    p_case_id, p_evidence_type, p_storage_path, p_content_hash, v_uid, p_captured_at,
    p_lat, p_lng, p_accuracy_m, p_device_hash, coalesce(p_observation, '{}'::jsonb),
    p_quantity, p_unit, p_note, v_dist, v_flags, v_skew_seconds,
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
                            'distance_m', v_dist,
                            'clock_skew_seconds', round(v_skew_seconds, 1),
                            'received_at', now());
end;
$$;

revoke all on function public.loamy_submit_evidence(uuid,text,timestamptz,text,text,numeric,numeric,numeric,text,jsonb,numeric,text,text) from public, anon;
grant execute on function public.loamy_submit_evidence(uuid,text,timestamptz,text,text,numeric,numeric,numeric,text,jsonb,numeric,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- Evidence is superseded, never replaced or removed.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_evidence_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Evidence is never deleted. Supersede it instead.';
  end if;

  if tg_op = 'UPDATE'
     and coalesce(current_setting('loamy.status_change_authorized', true), '') <> 'true' then
    -- The reviewer's own columns may move through the sanctioned path above.
    -- Everything describing what was CAPTURED is immutable.
    if new.storage_path   is distinct from old.storage_path
       or new.content_hash  is distinct from old.content_hash
       or new.captured_at   is distinct from old.captured_at
       or new.captured_lat  is distinct from old.captured_lat
       or new.captured_lng  is distinct from old.captured_lng
       or new.captured_by   is distinct from old.captured_by
       or new.case_id       is distinct from old.case_id
       or new.quantity      is distinct from old.quantity
       or new.received_at   is distinct from old.received_at then
      raise exception 'Captured evidence cannot be altered. Submit a superseding capture.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists loamy_verification_evidence_guard on public.verification_evidence;
create trigger loamy_verification_evidence_guard
  before update or delete on public.verification_evidence
  for each row execute function public.loamy_evidence_guard();

/**
 * Replace a capture with a better one. Both rows survive; the old one is
 * marked superseded and still carries its flags and its reason for being
 * replaced.
 */
create or replace function public.loamy_supersede_evidence(
  p_evidence_id uuid,
  p_reason      text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_e public.verification_evidence%rowtype;
begin
  select * into v_e from public.verification_evidence where id = p_evidence_id;
  if v_e.id is null then raise exception 'Evidence not found.'; end if;
  if v_e.captured_by <> v_uid and not public.loamy_is_admin() then
    raise exception 'Only the agent who captured this, or an administrator, can supersede it.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Superseding evidence requires a recorded reason.';
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_evidence
     set status = 'superseded',
         note = coalesce(note || ' | ', '') || 'Superseded: ' || trim(p_reason)
   where id = p_evidence_id;
  perform set_config('loamy.status_change_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, case when public.loamy_is_admin() then 'admin' else 'growth_partner' end,
          'evidence_superseded', 'verification_evidence', p_evidence_id,
          jsonb_build_object('reason', trim(p_reason), 'case_id', v_e.case_id));

  return jsonb_build_object('superseded', true);
end;
$$;

revoke all on function public.loamy_supersede_evidence(uuid,text) from public, anon;
grant execute on function public.loamy_supersede_evidence(uuid,text) to authenticated;
