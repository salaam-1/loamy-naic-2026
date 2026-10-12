-- ---------------------------------------------------------------------------
-- loamy_task_detail: give the reviewer the distance number back.
--
-- P0-3 moved field capture from `loamy_gps_check` (which wrote a distance into
-- a JSON blob on the task row) to `loamy_submit_evidence` (which writes a real
-- verification_evidence row and stores the distance on it). The admin review
-- screen read the old blob, so repointing it would have lost a number a human
-- reviewer actually uses: how far from the registered pin the agent stood.
--
-- `distance_from_subject_m` is already computed and stored per evidence row.
-- This only surfaces it. The body below is copied verbatim from
-- 20260920140010 with one key added -- nothing else about the function,
-- including the deliberate withholding of `requested_by` from the field, is
-- changed.
-- ---------------------------------------------------------------------------

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
        'distance_m', e.distance_from_subject_m,
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

grant execute on function public.loamy_task_detail(uuid) to authenticated;
