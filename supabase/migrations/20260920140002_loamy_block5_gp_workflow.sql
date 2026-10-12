-- ============================================================================
-- BLOCK 5 (b) — the operational workflow.
-- ----------------------------------------------------------------------------
-- Admin control, auditable assignment, and a claim that is exclusive by
-- construction rather than by convention.
--
-- TWO DESIGN POSITIONS WORTH STATING.
--
-- 1. ASSIGNMENT RETURNS FACTORS, NOT A SCORE. The directive is explicit, and
--    it is right: an opaque "best agent" number is unappealable. An agent
--    passed over cannot tell what to improve, and an administrator cannot
--    tell whether the allocation was reasonable. So the candidate list
--    carries every factor that went into the ordering, and the chosen
--    factors are written onto the task when it is assigned.
--
-- 2. THE CLAIM IS ONE STATEMENT. Double assignment is prevented by an atomic
--    conditional UPDATE, not by reading then writing. Two agents tapping
--    "accept" in the same second are serialised by the row lock; the second
--    one is told the task is gone, which is true.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Admin control of a Growth Partner.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_gp_set_training(
  p_user          uuid,
  p_status        text,
  p_cleared_types text[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not public.loamy_is_admin() then
    raise exception 'Only an administrator records training.';
  end if;
  if p_status not in ('pending_training','training_required','trained','suspended') then
    raise exception 'Unknown training status: %', p_status;
  end if;

  perform set_config('loamy.gp_ops_authorized', 'true', true);
  insert into public.growth_partner_operations (
    user_id, training_status, trained_at, trained_by, cleared_task_types)
  values (p_user, p_status,
          case when p_status = 'trained' then now() end, v_uid,
          coalesce(p_cleared_types, '{}'))
  on conflict (user_id) do update
    set training_status = excluded.training_status,
        trained_at = case when excluded.training_status = 'trained' then now()
                          else public.growth_partner_operations.trained_at end,
        trained_by = v_uid,
        cleared_task_types = coalesce(p_cleared_types,
                                      public.growth_partner_operations.cleared_task_types),
        updated_at = now();
  perform set_config('loamy.gp_ops_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'admin', 'gp_training_set', 'profile', p_user,
          jsonb_build_object('status', p_status, 'cleared_task_types', to_jsonb(p_cleared_types)));

  return jsonb_build_object('saved', true, 'training_status', p_status);
end;
$$;

revoke all on function public.loamy_gp_set_training(uuid,text,text[]) from public, anon;
grant execute on function public.loamy_gp_set_training(uuid,text,text[]) to authenticated;

/**
 * Suspension stops NEW work. It never erases history, commission or evidence
 * -- the record of what an agent did has to survive them being stood down,
 * or every past verification becomes unauditable.
 */
create or replace function public.loamy_gp_set_suspension(
  p_user      uuid,
  p_suspended boolean,
  p_reason    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not public.loamy_is_admin() then
    raise exception 'Only an administrator can suspend a Growth Partner.';
  end if;
  if p_suspended and coalesce(trim(p_reason), '') = '' then
    raise exception 'A suspension requires a recorded reason.';
  end if;

  perform set_config('loamy.gp_ops_authorized', 'true', true);
  insert into public.growth_partner_operations (
    user_id, suspended, suspended_at, suspended_by, suspension_reason)
  values (p_user, p_suspended, case when p_suspended then now() end, v_uid, p_reason)
  on conflict (user_id) do update
    set suspended = p_suspended,
        suspended_at = case when p_suspended then now() else null end,
        suspended_by = v_uid,
        suspension_reason = case when p_suspended then p_reason else null end,
        updated_at = now();
  perform set_config('loamy.gp_ops_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'admin',
          case when p_suspended then 'gp_suspended' else 'gp_reactivated' end,
          'profile', p_user, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('saved', true, 'suspended', p_suspended);
end;
$$;

revoke all on function public.loamy_gp_set_suspension(uuid,boolean,text) from public, anon;
grant execute on function public.loamy_gp_set_suspension(uuid,boolean,text) to authenticated;

/** The one thing the agent controls about themselves. */
create or replace function public.loamy_gp_set_availability(
  p_availability text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if not public.loamy_can_verify(v_uid) then
    raise exception 'This account is not a Growth Partner.';
  end if;
  if p_availability not in ('available','busy','unavailable') then
    raise exception 'Unknown availability: %', p_availability;
  end if;

  perform set_config('loamy.gp_ops_authorized', 'true', true);
  insert into public.growth_partner_operations (user_id, availability, availability_note)
  values (v_uid, p_availability, p_note)
  on conflict (user_id) do update
    set availability = p_availability, availability_note = p_note, updated_at = now();
  perform set_config('loamy.gp_ops_authorized', 'false', true);

  return jsonb_build_object('saved', true, 'availability', p_availability);
end;
$$;

revoke all on function public.loamy_gp_set_availability(text,text) from public, anon;
grant execute on function public.loamy_gp_set_availability(text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. May this agent take this kind of work?
-- ----------------------------------------------------------------------------
/**
 * Returns every reason, not the first. An agent told only "not eligible"
 * cannot fix anything; one told "suspended, and not cleared for commodity
 * verification" can.
 */
create or replace function public.loamy_gp_can_take(
  p_user uuid,
  p_task_type text,
  p_state text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ops    public.growth_partner_operations%rowtype;
  v_reasons text[] := '{}';
  v_open   int;
  v_restricted boolean;
  v_area   boolean;
begin
  if not public.loamy_can_verify(p_user) then
    return jsonb_build_object('allowed', false, 'reasons', to_jsonb(array['not_a_growth_partner']));
  end if;
  if not public.loamy_is_active(p_user) then
    v_reasons := array_append(v_reasons, 'account_inactive');
  end if;

  select * into v_ops from public.growth_partner_operations where user_id = p_user;

  if coalesce(v_ops.suspended, false) then
    v_reasons := array_append(v_reasons, 'suspended');
  end if;
  if coalesce(v_ops.availability, 'available') = 'unavailable' then
    v_reasons := array_append(v_reasons, 'marked_unavailable');
  end if;

  select exists (select 1 from public.restricted_task_types where task_type = p_task_type)
    into v_restricted;
  if v_restricted then
    if coalesce(v_ops.training_status, 'pending_training') <> 'trained' then
      v_reasons := array_append(v_reasons, 'training_incomplete');
    end if;
    if not (p_task_type = any (coalesce(v_ops.cleared_task_types, '{}'))) then
      v_reasons := array_append(v_reasons, 'not_cleared_for_this_task_type');
    end if;
  end if;

  select count(*) into v_open
  from public.verification_tasks
  where assigned_to = p_user
    and status in ('assigned','accepted','in_progress');
  if v_open >= coalesce(v_ops.max_open_tasks, 5) then
    v_reasons := array_append(v_reasons, 'workload_at_capacity');
  end if;

  if p_state is not null then
    select exists (
      select 1 from public.partner_assignments a
      where a.partner_id = p_user and a.active and a.state = p_state
    ) into v_area;
    if not v_area then
      v_reasons := array_append(v_reasons, 'outside_service_area');
    end if;
  end if;

  return jsonb_build_object(
    'allowed', coalesce(array_length(v_reasons, 1), 0) = 0,
    'reasons', to_jsonb(v_reasons),
    'open_tasks', v_open,
    'max_open_tasks', coalesce(v_ops.max_open_tasks, 5),
    'training_status', coalesce(v_ops.training_status, 'pending_training'),
    'restricted_task_type', v_restricted);
end;
$$;

grant execute on function public.loamy_gp_can_take(uuid,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Candidates, with their factors on show.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_assignment_candidates(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_task public.verification_tasks%rowtype;
  v_rows jsonb;
begin
  if not public.loamy_is_admin() then
    raise exception 'Candidate lists are administrative.';
  end if;

  select * into v_task from public.verification_tasks where id = p_task_id;
  if v_task.id is null then
    return jsonb_build_object('found', false, 'reason', 'no_such_task');
  end if;

  select coalesce(jsonb_agg(c order by (c->>'rank_key')::numeric desc), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
      'partner_id', p.id,
      'eligibility', public.loamy_gp_can_take(p.id, v_task.task_type, v_task.expected_state),

      -- Every factor, named. Nothing is folded into a single number.
      'factors', jsonb_build_object(
        'in_service_area', exists (
          select 1 from public.partner_assignments a
          where a.partner_id = p.id and a.active
            and a.state = v_task.expected_state),
        'lga_match', exists (
          select 1 from public.partner_assignments a
          where a.partner_id = p.id and a.active and a.state = v_task.expected_state
            and (cardinality(a.lgas) = 0 or v_task.expected_lga = any (a.lgas))),
        'commodity_match', exists (
          select 1 from public.partner_assignments a
          where a.partner_id = p.id and a.active
            and (cardinality(a.commodities) = 0
                 or exists (select 1 from public.commodity_batches b
                            where b.id = v_task.subject_id and b.commodity = any (a.commodities)))),
        'availability', coalesce(o.availability, 'available'),
        'training_status', coalesce(o.training_status, 'pending_training'),
        'suspended', coalesce(o.suspended, false),
        'open_tasks', (select count(*) from public.verification_tasks t
                        where t.assigned_to = p.id
                          and t.status in ('assigned','accepted','in_progress')),
        'completed_tasks', (select count(*) from public.verification_tasks t
                             where t.assigned_to = p.id and t.status = 'approved'),
        'rejected_tasks', (select count(*) from public.verification_tasks t
                            where t.assigned_to = p.id and t.status = 'rejected'),
        'open_flags', (select count(*) from public.verification_tasks t
                        where t.assigned_to = p.id
                          and coalesce(array_length(t.flags, 1), 0) > 0
                          and t.status not in ('approved','rejected')),
        'prior_pairings_with_subject', (
          select count(*) from public.verification_tasks t
          where t.assigned_to = p.id and t.subject_user_id = v_task.subject_user_id)
      ),

      -- A transparent ordering key. It is derived from the factors above and
      -- shown alongside them, so an administrator can disagree with it.
      'rank_key',
        (case when exists (select 1 from public.partner_assignments a
                           where a.partner_id = p.id and a.active
                             and a.state = v_task.expected_state) then 40 else 0 end)
      + (case when coalesce(o.availability, 'available') = 'available' then 20 else 0 end)
      + (case when coalesce(o.training_status, '') = 'trained' then 15 else 0 end)
      + least(15, (select count(*) from public.verification_tasks t
                    where t.assigned_to = p.id and t.status = 'approved'))
      - (10 * (select count(*) from public.verification_tasks t
                where t.assigned_to = p.id
                  and t.status in ('assigned','accepted','in_progress')))
      - (case when coalesce(o.suspended, false) then 1000 else 0 end)
      -- A repeat pairing with the same subject is a conflict-of-interest
      -- signal, so it pushes an agent DOWN rather than up.
      - (5 * (select count(*) from public.verification_tasks t
               where t.assigned_to = p.id and t.subject_user_id = v_task.subject_user_id))
    ) as c
    from public.profiles p
    left join public.growth_partner_operations o on o.user_id = p.id
    where public.loamy_can_verify(p.id)
      and p.active is true
      and p.id <> v_task.subject_user_id      -- never inspect yourself
      and p.id <> v_task.requested_by         -- nor work your own request
    limit 50
  ) s;

  return jsonb_build_object(
    'found', true,
    'task', v_task.ref,
    'task_type', v_task.task_type,
    'expected_state', v_task.expected_state,
    'note', 'Factors are shown individually and deliberately. There is no opaque agent score.',
    'candidates', v_rows);
end;
$$;

revoke all on function public.loamy_assignment_candidates(uuid) from public, anon;
grant execute on function public.loamy_assignment_candidates(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Publishing, claiming, accepting, declining.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_publish_task(
  p_task_id uuid, p_expires_in_hours int default 72
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_t public.verification_tasks%rowtype; v_cl jsonb;
begin
  if not public.loamy_is_admin() then
    raise exception 'Only an administrator publishes a task to the field.';
  end if;

  select * into v_t from public.verification_tasks where id = p_task_id;
  if v_t.id is null then raise exception 'Task not found.'; end if;
  if v_t.status not in ('pending','available') then
    return jsonb_build_object('published', false, 'reason', 'wrong_status', 'status', v_t.status);
  end if;

  -- Stamp the checklist VERSION now, so a later edit cannot change what this
  -- task was answered against.
  v_cl := public.loamy_checklist_for(v_t.task_type);

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
     set status = 'available',
         expires_at = now() + make_interval(hours => greatest(1, coalesce(p_expires_in_hours, 72))),
         checklist_key = case when (v_cl->>'available')::boolean then v_cl->>'task_type' end,
         checklist_version = case when (v_cl->>'available')::boolean
                                  then (v_cl->>'version')::int end,
         updated_at = now()
   where id = p_task_id;
  perform set_config('loamy.status_change_authorized', 'false', true);

  return jsonb_build_object('published', true, 'checklist', v_cl);
end;
$$;

revoke all on function public.loamy_publish_task(uuid,int) from public, anon;
grant execute on function public.loamy_publish_task(uuid,int) to authenticated;

/**
 * Claim an available task.
 *
 * The whole allocation is ONE conditional UPDATE. Two agents tapping accept
 * in the same second serialise on the row lock, and the loser is told the
 * task is gone -- which is what actually happened.
 */
create or replace function public.loamy_claim_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_t     public.verification_tasks%rowtype;
  v_check jsonb;
  v_rows  int;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_t from public.verification_tasks where id = p_task_id;
  if v_t.id is null then
    return jsonb_build_object('claimed', false, 'reason', 'no_such_task');
  end if;

  v_check := public.loamy_gp_can_take(v_uid, v_t.task_type, v_t.expected_state);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('claimed', false, 'reason', 'not_eligible',
      'reasons', v_check->'reasons');
  end if;

  if v_t.subject_user_id = v_uid or v_t.requested_by = v_uid then
    return jsonb_build_object('claimed', false, 'reason', 'conflict_of_interest');
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
     set assigned_to = v_uid,
         status = 'assigned',
         assigned_at = now(),
         assignment_factors = jsonb_build_object(
           'mode', 'self_claimed',
           'eligibility', v_check,
           'claimed_at', now()),
         updated_at = now()
   where id = p_task_id
     and assigned_to is null
     and status in ('pending','available')
     and (expires_at is null or expires_at > now());
  get diagnostics v_rows = row_count;
  perform set_config('loamy.status_change_authorized', 'false', true);

  if v_rows = 0 then
    return jsonb_build_object('claimed', false, 'reason', 'already_taken',
      'message', 'Another agent took this task first.');
  end if;

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'growth_partner', 'task_claimed', 'verification_case', p_task_id,
          jsonb_build_object('task_type', v_t.task_type));

  return jsonb_build_object('claimed', true, 'task_id', p_task_id);
end;
$$;

revoke all on function public.loamy_claim_task(uuid) from public, anon;
grant execute on function public.loamy_claim_task(uuid) to authenticated;

create or replace function public.loamy_accept_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_rows int;
begin
  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
     set status = 'accepted', accepted_at = now(), updated_at = now()
   where id = p_task_id and assigned_to = v_uid and status = 'assigned';
  get diagnostics v_rows = row_count;
  perform set_config('loamy.status_change_authorized', 'false', true);

  if v_rows = 0 then
    return jsonb_build_object('accepted', false, 'reason', 'not_yours_or_wrong_status');
  end if;
  return jsonb_build_object('accepted', true);
end;
$$;

revoke all on function public.loamy_accept_task(uuid) from public, anon;
grant execute on function public.loamy_accept_task(uuid) to authenticated;

/** Handing a task back is normal and must stay cheap, or agents sit on work. */
create or replace function public.loamy_decline_task(p_task_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_rows int;
begin
  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
     set assigned_to = null, status = 'available',
         assigned_at = null, accepted_at = null,
         assignment_factors = assignment_factors
           || jsonb_build_object('declined_by', v_uid, 'declined_at', now(),
                                 'decline_reason', p_reason),
         updated_at = now()
   where id = p_task_id and assigned_to = v_uid
     and status in ('assigned','accepted');
  get diagnostics v_rows = row_count;
  perform set_config('loamy.status_change_authorized', 'false', true);

  if v_rows = 0 then
    return jsonb_build_object('declined', false, 'reason', 'not_yours_or_wrong_status');
  end if;

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'growth_partner', 'task_declined', 'verification_case', p_task_id,
          jsonb_build_object('reason', p_reason));

  return jsonb_build_object('declined', true);
end;
$$;

revoke all on function public.loamy_decline_task(uuid,text) from public, anon;
grant execute on function public.loamy_decline_task(uuid,text) to authenticated;

/** Admin reassignment. The prior holder is recorded, never erased. */
create or replace function public.loamy_reassign_task(
  p_task_id uuid, p_partner uuid, p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_t public.verification_tasks%rowtype; v_check jsonb;
begin
  if not public.loamy_is_admin() then
    raise exception 'Only an administrator reassigns a task.';
  end if;

  select * into v_t from public.verification_tasks where id = p_task_id for update;
  if v_t.id is null then raise exception 'Task not found.'; end if;
  if v_t.status in ('approved','rejected','cancelled') then
    return jsonb_build_object('reassigned', false, 'reason', 'task_closed');
  end if;

  v_check := public.loamy_gp_can_take(p_partner, v_t.task_type, v_t.expected_state);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('reassigned', false, 'reason', 'candidate_not_eligible',
      'reasons', v_check->'reasons');
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
     set assigned_to = p_partner, status = 'assigned',
         assigned_at = now(), accepted_at = null,
         assignment_factors = jsonb_build_object(
           'mode', 'admin_reassigned', 'by', v_uid, 'at', now(),
           'previous_agent', v_t.assigned_to, 'reason', p_reason,
           'eligibility', v_check),
         updated_at = now()
   where id = p_task_id;
  perform set_config('loamy.status_change_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'admin', 'task_reassigned', 'verification_case', p_task_id,
          jsonb_build_object('from', v_t.assigned_to, 'to', p_partner, 'reason', p_reason));

  return jsonb_build_object('reassigned', true, 'previous_agent', v_t.assigned_to);
end;
$$;

revoke all on function public.loamy_reassign_task(uuid,uuid,text) from public, anon;
grant execute on function public.loamy_reassign_task(uuid,uuid,text) to authenticated;

/** Expiry. Unclaimed or abandoned work goes back, rather than rotting. */
create or replace function public.loamy_expire_tasks()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_expired int; v_released int;
begin
  if not public.loamy_is_admin() then
    raise exception 'Task expiry is administrative.';
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);

  -- Never claimed: the task itself expires.
  update public.verification_tasks
     set status = 'expired', updated_at = now()
   where status in ('pending','available')
     and expires_at is not null and expires_at <= now();
  get diagnostics v_expired = row_count;

  -- Claimed but not progressed: released back to the pool, not expired --
  -- the work is still needed, just not by that agent.
  update public.verification_tasks
     set assigned_to = null, status = 'available',
         assigned_at = null, accepted_at = null,
         assignment_factors = assignment_factors
           || jsonb_build_object('released_at', now(), 'released_reason', 'expired_unstarted'),
         updated_at = now()
   where status in ('assigned','accepted')
     and expires_at is not null and expires_at <= now();
  get diagnostics v_released = row_count;

  perform set_config('loamy.status_change_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, detail)
  values (auth.uid(), 'admin', 'tasks_expired', 'verification_case',
          jsonb_build_object('expired', v_expired, 'released', v_released));

  return jsonb_build_object('expired', v_expired, 'released_back_to_pool', v_released);
end;
$$;

revoke all on function public.loamy_expire_tasks() from public, anon;
grant execute on function public.loamy_expire_tasks() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. What an agent may SEE before they hold the task.
-- ----------------------------------------------------------------------------
/**
 * Directive 26: do not expose exact locations before assignment.
 *
 * An unassigned task shows the STATE and LGA and what kind of work it is --
 * enough to decide whether to take it. Coordinates, the subject's identity
 * and the transaction behind it appear only once the task is theirs.
 */
create or replace function public.loamy_available_tasks(p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_rows jsonb;
begin
  if v_uid is null or not public.loamy_can_verify(v_uid) then
    return jsonb_build_object('available', false, 'reason', 'not_a_growth_partner');
  end if;

  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'task_id', t.id,
      'ref', t.ref,
      'task_type', t.task_type,
      'priority', t.priority,
      -- Coarse location only. No coordinates before it is yours.
      'state', t.expected_state,
      'lga', t.expected_lga,
      'expires_at', t.expires_at,
      'created_at', t.created_at,
      'checklist', jsonb_build_object('key', t.checklist_key, 'version', t.checklist_version),
      'eligibility', public.loamy_gp_can_take(v_uid, t.task_type, t.expected_state)
    ) as x
    from public.verification_tasks t
    where t.status = 'available'
      and t.assigned_to is null
      and (t.expires_at is null or t.expires_at > now())
      and t.subject_user_id <> v_uid
      and coalesce(t.requested_by, '00000000-0000-0000-0000-000000000000'::uuid) <> v_uid
      -- Only where this agent actually works.
      and exists (select 1 from public.partner_assignments a
                  where a.partner_id = v_uid and a.active
                    and (t.expected_state is null or a.state = t.expected_state))
    order by t.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) s;

  return jsonb_build_object('available', true, 'items', v_rows);
end;
$$;

revoke all on function public.loamy_available_tasks(int) from public, anon;
grant execute on function public.loamy_available_tasks(int) to authenticated;
