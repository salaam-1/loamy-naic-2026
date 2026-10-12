-- ============================================================================
-- BLOCK 5 (e) — performance, the work board, checklists and disputes.
-- ----------------------------------------------------------------------------
-- PERFORMANCE IS A LIST OF FACTS (directive 19). There is no agent score, for
-- the same reason there is no seller score: a single number is unappealable.
-- An agent passed over cannot tell what to improve, and a reviewer cannot
-- tell what it weighed.
--
-- A CHECKLIST IS ANSWERED AGAINST A VERSION. The task recorded which version
-- it was published with; the answers are stored with that version, so a later
-- edit to the question set cannot change what a past answer meant.
--
-- A DISPUTE NEVER OVERWRITES THE EVIDENCE (directive 30). The original
-- capture, its flags and the original decision all survive. The dispute is a
-- separate record pointing at them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Performance — individual facts, never a score.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_gp_performance(p_user uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ops public.growth_partner_operations%rowtype;
  v_turnaround numeric;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  -- Directive 33: one agent may not inspect another's private history.
  if p_user <> v_uid and not public.loamy_is_admin() then
    raise exception 'You can only see your own performance record.';
  end if;

  select * into v_ops from public.growth_partner_operations where user_id = p_user;

  select avg(extract(epoch from (t.completed_at - t.accepted_at)) / 3600.0)
    into v_turnaround
  from public.verification_tasks t
  where t.assigned_to = p_user and t.completed_at is not null and t.accepted_at is not null;

  return jsonb_build_object(
    'partner_id', p_user,
    'training_status', coalesce(v_ops.training_status, 'pending_training'),
    'cleared_task_types', to_jsonb(coalesce(v_ops.cleared_task_types, '{}')),
    'availability', coalesce(v_ops.availability, 'available'),
    'suspended', coalesce(v_ops.suspended, false),
    'suspension_reason', v_ops.suspension_reason,

    -- Counts. Each stands on its own.
    'tasks', (
      select jsonb_build_object(
        'assigned',  count(*) filter (where status = 'assigned'),
        'accepted',  count(*) filter (where status = 'accepted'),
        'in_progress', count(*) filter (where status = 'in_progress'),
        'submitted', count(*) filter (where status in ('submitted','under_review')),
        'approved',  count(*) filter (where status = 'approved'),
        'rejected',  count(*) filter (where status = 'rejected'),
        'needs_more_information', count(*) filter (where status in ('needs_more_information','resubmit_requested')),
        'expired',   count(*) filter (where status = 'expired'),
        'total',     count(*))
      from public.verification_tasks where assigned_to = p_user),

    'average_turnaround_hours', round(coalesce(v_turnaround, 0)::numeric, 1),

    'review_outcomes', (
      select jsonb_build_object(
        'approved', count(*) filter (where decision = 'approved'),
        'rejected', count(*) filter (where decision = 'rejected'),
        'more_evidence_required', count(*) filter (where decision = 'more_evidence_required'))
      from public.verification_reviews r
      join public.verification_tasks t on t.id = r.case_id
      where t.assigned_to = p_user),

    'evidence', (
      select jsonb_build_object(
        'submitted', count(*),
        'flagged',   count(*) filter (where coalesce(array_length(flags, 1), 0) > 0),
        'superseded', count(*) filter (where status = 'superseded'))
      from public.verification_evidence where captured_by = p_user),

    -- Flags are reported by KIND, so a reviewer sees what kind of problem it
    -- is rather than a single alarming total.
    'flags_by_kind', (
      select coalesce(jsonb_object_agg(f, n), '{}'::jsonb)
      from (select unnest(e.flags) as f, count(*) as n
            from public.verification_evidence e
            where e.captured_by = p_user
            group by 1) d),

    'commission', (
      select jsonb_build_object(
        'pending',  coalesce(sum(amount) filter (where status = 'pending'), 0),
        'approved', coalesce(sum(amount) filter (where status = 'approved'), 0),
        'payable',  coalesce(sum(amount) filter (where status = 'payable'), 0),
        'paid',     coalesce(sum(amount) filter (where status = 'paid'), 0))
      from public.partner_earnings where partner_id = p_user),

    'service_areas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'state', a.state, 'lgas', to_jsonb(a.lgas),
        'commodities', to_jsonb(a.commodities)) order by a.state), '[]'::jsonb)
      from public.partner_assignments a where a.partner_id = p_user and a.active),

    'note', 'Individual facts. Loamy does not compute an agent score -- a single number would be unappealable.');
end;
$$;

revoke all on function public.loamy_gp_performance(uuid) from public, anon;
grant execute on function public.loamy_gp_performance(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. The agent's own work board.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_my_tasks(p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_rows jsonb;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select coalesce(jsonb_agg(x order by x->>'updated_at' desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'task_id', t.id, 'ref', t.ref, 'task_type', t.task_type,
      'status', t.status, 'priority', t.priority,
      -- Now that it is theirs, the agent gets what they need to do the job.
      'state', t.expected_state, 'lga', t.expected_lga,
      'expected_lat', t.expected_lat, 'expected_lng', t.expected_lng,
      'subject_type', t.subject_type, 'subject_id', t.subject_id,
      'checklist', jsonb_build_object('key', t.checklist_key, 'version', t.checklist_version),
      'expires_at', t.expires_at,
      'assigned_at', t.assigned_at, 'accepted_at', t.accepted_at,
      'submitted_at', t.submitted_at, 'completed_at', t.completed_at,
      'flags', to_jsonb(t.flags),
      'reviewer_note', case when t.status in ('rejected','needs_more_information','resubmit_requested')
                            then t.reviewer_note end,
      'evidence_count', (select count(*) from public.verification_evidence e
                          where e.case_id = t.id and e.status <> 'superseded'),
      'commission', (select jsonb_build_object('ref', pe.ref, 'amount', pe.amount,
                                               'status', pe.status)
                     from public.partner_earnings pe where pe.task_id = t.id),
      'updated_at', t.updated_at
    ) as x
    from public.verification_tasks t
    where t.assigned_to = v_uid
    order by t.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 300))
  ) s;

  return jsonb_build_object('items', v_rows);
end;
$$;

revoke all on function public.loamy_my_tasks(int) from public, anon;
grant execute on function public.loamy_my_tasks(int) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The checklist, answered against its version.
-- ----------------------------------------------------------------------------
/**
 * Validates required items and stores the answers WITH the version they were
 * answered against.
 *
 * Refuses an agent who is not the one holding the task, which is the same
 * boundary evidence submission already enforces.
 */
create or replace function public.loamy_submit_checklist(
  p_case_id uuid,
  p_answers jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_t    public.verification_tasks%rowtype;
  v_cl   public.verification_checklists%rowtype;
  v_item jsonb;
  v_missing text[] := '{}';
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_t from public.verification_tasks where id = p_case_id;
  if v_t.id is null then raise exception 'Verification case not found.'; end if;
  if v_t.assigned_to is distinct from v_uid then
    raise exception 'Only the agent holding this case can answer its checklist.';
  end if;
  if v_t.status not in ('assigned','accepted','in_progress','resubmit_requested','needs_more_information') then
    raise exception 'This case is % and is not accepting a checklist.', v_t.status;
  end if;

  select * into v_cl from public.verification_checklists
   where task_type = v_t.task_type
     and version = coalesce(v_t.checklist_version,
                            (select max(version) from public.verification_checklists
                              where task_type = v_t.task_type));
  if v_cl.id is null then
    return jsonb_build_object('saved', false, 'reason', 'no_checklist_for_task_type');
  end if;

  for v_item in select * from jsonb_array_elements(v_cl.items) loop
    if coalesce((v_item->>'required')::boolean, false)
       and (p_answers->>(v_item->>'key')) is null then
      v_missing := array_append(v_missing, v_item->>'key');
    end if;
  end loop;

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    return jsonb_build_object('saved', false, 'reason', 'missing_required',
      'missing', to_jsonb(v_missing),
      'message', 'Answer every required item before submitting. An agent cannot simply declare a case verified.');
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
     set evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
           'checklist', jsonb_build_object(
             'task_type', v_cl.task_type,
             'version', v_cl.version,
             'answers', p_answers,
             'answered_by', v_uid,
             'answered_at', now())),
         status = case when status in ('assigned','accepted') then 'in_progress' else status end,
         updated_at = now()
   where id = p_case_id;
  perform set_config('loamy.status_change_authorized', 'false', true);

  return jsonb_build_object('saved', true, 'checklist_version', v_cl.version);
end;
$$;

revoke all on function public.loamy_submit_checklist(uuid,jsonb) from public, anon;
grant execute on function public.loamy_submit_checklist(uuid,jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Disputing a verification.
-- ----------------------------------------------------------------------------
/**
 * A party to the verification, or an administrator, may dispute the outcome.
 * Nothing is overwritten: the original case, its evidence and its decision
 * all stay exactly as they were.
 */
create or replace function public.loamy_dispute_verification(
  p_case_id uuid,
  p_reason  text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.verification_tasks%rowtype;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A dispute needs a stated reason.';
  end if;

  select * into v_t from public.verification_tasks where id = p_case_id;
  if v_t.id is null then raise exception 'Verification case not found.'; end if;

  if not (public.loamy_is_admin()
          or v_t.subject_user_id = v_uid
          or v_t.requested_by = v_uid) then
    -- Same wording as a missing case: a refusal must not confirm one exists.
    raise exception 'Verification case not found.';
  end if;
  if v_t.status not in ('approved','rejected') then
    return jsonb_build_object('raised', false, 'reason', 'not_decided_yet',
      'status', v_t.status);
  end if;
  if exists (select 1 from public.disputes
             where verification_case_id = p_case_id and status = 'open') then
    return jsonb_build_object('raised', false, 'reason', 'already_open');
  end if;

  insert into public.disputes (
    transaction_id, verification_case_id, raised_by, against_id,
    category, detail, status,
    -- The evidence is REFERENCED, never copied and never altered.
    evidence)
  values (
    v_t.related_transaction_id, p_case_id, v_uid,
    coalesce(v_t.subject_user_id, v_uid),
    'verification', trim(p_reason), 'open',
    jsonb_build_object(
      'original_status', v_t.status,
      'original_decided_at', v_t.completed_at,
      'original_flags', to_jsonb(v_t.flags),
      'evidence_ids', (select coalesce(jsonb_agg(e.id), '[]'::jsonb)
                       from public.verification_evidence e where e.case_id = p_case_id)))
  returning id into v_id;

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'member', 'verification_disputed', 'verification_case', p_case_id,
          jsonb_build_object('dispute_id', v_id, 'reason', trim(p_reason)));

  return jsonb_build_object('raised', true, 'dispute_id', v_id);
end;
$$;

revoke all on function public.loamy_dispute_verification(uuid,text) from public, anon;
grant execute on function public.loamy_dispute_verification(uuid,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Internal-only: which agent did this work.
-- ----------------------------------------------------------------------------
/**
 * Directive 31. Loamy must be able to follow agent -> case -> subject ->
 * transaction -> commission for accountability, commission and fraud
 * investigation. The PARTIES must not.
 *
 * Administrative only, and the refusal is worded as a missing record so it
 * cannot be used to confirm who inspected what.
 */
create or replace function public.loamy_trace_agent_chain(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_t public.verification_tasks%rowtype;
begin
  if not public.loamy_is_admin() then
    return jsonb_build_object('found', false, 'reason', 'no_such_reference');
  end if;

  select * into v_t from public.verification_tasks where id = p_case_id;
  if v_t.id is null then
    return jsonb_build_object('found', false, 'reason', 'no_such_reference');
  end if;

  return jsonb_build_object(
    'found', true,
    'case', jsonb_build_object('ref', v_t.ref, 'type', v_t.task_type,
                               'status', v_t.status, 'flags', to_jsonb(v_t.flags)),
    'agent', (select jsonb_build_object(
                'id', p.id, 'name', p.full_name, 'username', p.username,
                'state', p.state)
              from public.profiles p where p.id = v_t.assigned_to),
    'assignment', v_t.assignment_factors,
    'subject', jsonb_build_object('type', v_t.subject_type, 'id', v_t.subject_id,
                                  'user_id', v_t.subject_user_id),
    'requested_by', v_t.requested_by,
    'transaction_id', v_t.related_transaction_id,
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object(
                   'ref', e.ref, 'type', e.evidence_type,
                   'captured_at', e.captured_at, 'received_at', e.received_at,
                   'clock_skew_seconds', e.clock_skew_seconds,
                   'lat', e.captured_lat, 'lng', e.captured_lng,
                   'accuracy_m', e.gps_accuracy_m,
                   'flags', to_jsonb(e.flags), 'status', e.status)
                   order by e.received_at), '[]'::jsonb)
                 from public.verification_evidence e where e.case_id = p_case_id),
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object(
                  'decision', r.decision, 'reviewer_id', r.reviewer_id,
                  'note', r.note, 'at', r.created_at) order by r.created_at), '[]'::jsonb)
                from public.verification_reviews r where r.case_id = p_case_id),
    'commission', (select jsonb_build_object('ref', pe.ref, 'amount', pe.amount,
                                             'status', pe.status, 'payer_kind', pe.payer_kind)
                   from public.partner_earnings pe where pe.task_id = p_case_id),
    'disputes', (select coalesce(jsonb_agg(jsonb_build_object(
                   'ref', d.ref, 'status', d.status, 'detail', d.detail)), '[]'::jsonb)
                 from public.disputes d where d.verification_case_id = p_case_id));
end;
$$;

revoke all on function public.loamy_trace_agent_chain(uuid) from public, anon;
grant execute on function public.loamy_trace_agent_chain(uuid) to authenticated;

comment on function public.loamy_trace_agent_chain(uuid) is
  'BLOCK 5, directive 31. The INTERNAL chain: agent, assignment factors, evidence, reviews, commission, disputes. Administrative only -- the parties see "Loamy Verification Agent" and nothing more.';
