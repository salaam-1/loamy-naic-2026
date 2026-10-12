-- ============================================================================
-- BLOCK 4 (h) — the review function, corrected from the RIGHT original.
-- ----------------------------------------------------------------------------
-- 130007 rebuilt loamy_review_verification_case from 20260919140001. That was
-- the wrong source: 20260919140002 had already superseded it, and the live
-- version wraps the whole body in
--
--   set_config('loamy.status_change_authorized', 'true')
--
-- which loamy_task_guard requires before reviewer_id or completed_at may
-- change. Rebuilding from the earlier file silently dropped that, and every
-- review then failed with "These task fields can only change through the
-- verification workflow".
--
-- The lesson is the one that has now cost three attempts: when replacing a
-- function, copy the version that is actually live, do not reconstruct it,
-- and check which migration last defined it.
--
-- This is 140002's version verbatim, with only the batch-status branch
-- changed -- verification records a fact about the stock and no longer
-- overwrites where that stock is in its commercial life.
-- ============================================================================

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
  v_batch public.commodity_batches%rowtype;
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
      select * into v_batch from public.commodity_batches where id = v_case.subject_id;

      -- Verification is a FACT ABOUT THE STOCK, not a position in its
      -- commercial life. 'verified' as a LIFECYCLE status is reachable only
      -- from created/listed/pending, so a batch reserved by a buyer -- which
      -- is exactly when financing needs it inspected -- could never be
      -- verified at all. Widening the rule would be worse: it would regress
      -- a sold batch and lose the sale. Past 'listed', record the fact and
      -- leave the commercial status alone.
      if v_batch.status in ('created','listed','pending') then
        perform public.loamy_batch_transition(
          v_case.subject_id, 'verified', null, 'verification_case', p_case_id,
          null, null, null, null, '{}'::jsonb, '{}'::jsonb, 'Approved verification');
      else
        perform set_config('loamy.batch_system_authorized', 'true', true);
        update public.commodity_batches
           set verification_status = 'verified', updated_at = now()
         where id = v_case.subject_id;
        perform set_config('loamy.batch_system_authorized', 'false', true);

        insert into public.batch_events (
          batch_id, event_type, actor_id, previous_status, new_status,
          quantity_after, subject_type, subject_id, note)
        values (v_case.subject_id, 'verified', v_uid, v_batch.status, v_batch.status,
                v_batch.available_quantity, 'verification_case', p_case_id,
                'Verified while ' || v_batch.status || ' -- commercial status unchanged');
      end if;
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
grant execute on function public.loamy_review_verification_case(uuid,text,text,jsonb) to authenticated;
