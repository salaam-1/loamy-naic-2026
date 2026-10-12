-- ============================================================================
-- BLOCK 5 (j) — the agent must not learn who ordered the inspection.
-- ----------------------------------------------------------------------------
-- Found by tests/security/block5-gp-security.test.ts.
--
-- The §7 hardening took raw task reads away from the REQUESTER so they could
-- not resolve the agent. It left the mirror image open: the assigned AGENT
-- still read the whole row, including requested_by.
--
-- That is a live disclosure. The buyer who ordered a commodity inspection is
-- signalling a sourcing intention, and handing that to a field agent who may
-- also work for a competitor is exactly the leak anonymity is meant to
-- prevent. The agent needs to know WHERE to go and WHOSE stock to look at.
-- They have no need for who asked.
--
-- Postgres has no column-level RLS, and revoking the column outright would
-- break every `select *` an administrator makes. So this follows the pattern
-- §7 already established: the agent no longer reads the raw row at all, and
-- reaches their work through a function that returns what they need and
-- nothing else.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Everything an agent needs to do the job.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_task_detail(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_t    public.verification_tasks%rowtype;
  v_mine boolean;
begin
  if v_uid is null then
    return jsonb_build_object('found', false, 'reason', 'not_signed_in');
  end if;

  select * into v_t from public.verification_tasks where id = p_task_id;
  if v_t.id is null then
    return jsonb_build_object('found', false, 'reason', 'no_such_task');
  end if;

  v_mine := v_t.assigned_to = v_uid;
  if not (v_mine or public.loamy_is_admin()) then
    -- Same shape as a missing task: a refusal must not confirm one exists.
    return jsonb_build_object('found', false, 'reason', 'no_such_task');
  end if;

  return jsonb_build_object(
    'found', true,
    'task_id', v_t.id,
    'ref', v_t.ref,
    'task_type', v_t.task_type,
    'status', v_t.status,
    'priority', v_t.priority,

    -- Where to go, and whose stock. Both are necessary to do the work.
    'subject_type', v_t.subject_type,
    'subject_id', v_t.subject_id,
    'subject_farm_id', v_t.subject_farm_id,
    'subject_user_id', v_t.subject_user_id,
    'expected_state', v_t.expected_state,
    'expected_lga', v_t.expected_lga,
    'expected_lat', v_t.expected_lat,
    'expected_lng', v_t.expected_lng,

    'checklist', jsonb_build_object('key', v_t.checklist_key, 'version', v_t.checklist_version),
    'checklist_definition', public.loamy_checklist_for(v_t.task_type),
    'answers', v_t.evidence -> 'checklist',

    'assigned_at', v_t.assigned_at,
    'accepted_at', v_t.accepted_at,
    'submitted_at', v_t.submitted_at,
    'completed_at', v_t.completed_at,
    'expires_at', v_t.expires_at,
    'created_at', v_t.created_at,

    'flags', to_jsonb(v_t.flags),
    'reviewer_note', case when v_t.status in ('rejected','needs_more_information','resubmit_requested')
                          then v_t.reviewer_note end,

    'evidence', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'ref', e.ref, 'type', e.evidence_type,
        'storage_path', e.storage_path,
        'captured_at', e.captured_at, 'received_at', e.received_at,
        'clock_skew_seconds', e.clock_skew_seconds,
        'lat', e.captured_lat, 'lng', e.captured_lng,
        'accuracy_m', e.gps_accuracy_m,
        'quantity', e.quantity, 'unit', e.unit, 'note', e.note,
        'flags', to_jsonb(e.flags), 'status', e.status)
        order by e.received_at), '[]'::jsonb)
      from public.verification_evidence e where e.case_id = p_task_id),

    'commission', (select jsonb_build_object('ref', pe.ref, 'amount', pe.amount,
                                             'status', pe.status)
                   from public.partner_earnings pe where pe.task_id = p_task_id),

    -- requested_by is DELIBERATELY ABSENT for the agent. An administrator
    -- gets it, because accountability needs it; the field does not.
    'requested_by', case when public.loamy_is_admin() then v_t.requested_by end,

    'note', case when v_mine and not public.loamy_is_admin()
                 then 'Who requested this inspection is not disclosed to the field.' end);
end;
$$;

revoke all on function public.loamy_task_detail(uuid) from public, anon;
grant execute on function public.loamy_task_detail(uuid) to authenticated;

comment on function public.loamy_task_detail(uuid) is
  'BLOCK 5, directive 35. The agent''s view of their own case. Deliberately omits requested_by: knowing WHO ordered a commodity inspection reveals a buyer''s sourcing intention.';

-- ----------------------------------------------------------------------------
-- 2. A working state the agent can move, without the raw row.
-- ----------------------------------------------------------------------------
/**
 * Replaces the direct UPDATE the field page used to make. The agent may move
 * their own case between working states and attach a note -- nothing else.
 */
create or replace function public.loamy_update_task_progress(
  p_task_id uuid,
  p_note    text default null,
  p_submit  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_t public.verification_tasks%rowtype;
begin
  select * into v_t from public.verification_tasks where id = p_task_id;
  if v_t.id is null or v_t.assigned_to is distinct from v_uid then
    raise exception 'Verification case not found.';
  end if;
  if v_t.status not in ('assigned','accepted','in_progress',
                        'resubmit_requested','needs_more_information') then
    return jsonb_build_object('saved', false, 'reason', 'wrong_status',
      'status', v_t.status);
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  update public.verification_tasks
     set evidence = coalesce(evidence, '{}'::jsonb)
                    || jsonb_build_object('partner_note', p_note),
         status = case when p_submit then 'submitted' else 'in_progress' end,
         submitted_at = case when p_submit then now() else submitted_at end,
         updated_at = now()
   where id = p_task_id;
  perform set_config('loamy.status_change_authorized', 'false', true);

  return jsonb_build_object('saved', true, 'submitted', p_submit);
end;
$$;

revoke all on function public.loamy_update_task_progress(uuid,text,boolean) from public, anon;
grant execute on function public.loamy_update_task_progress(uuid,text,boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Narrow the policy: no raw row for the field.
-- ----------------------------------------------------------------------------
drop policy if exists "loamy_tasks_select" on public.verification_tasks;
create policy "loamy_tasks_select"
  on public.verification_tasks for select to authenticated
  using (
    public.loamy_is_admin()
    -- Agents reach their own work through loamy_my_tasks and
    -- loamy_task_detail; the open pool through loamy_available_tasks. All
    -- three are security definer, so none of them needs this policy -- and
    -- none of them returns requested_by.
    --
    -- Requesters and subjects reach their case through
    -- loamy_my_verification_cases, which masks the agent (§7).
  );
