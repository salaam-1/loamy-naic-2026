-- ============================================================================
-- BLOCK 4 (g) — two corrections, applied as their own migration.
-- ----------------------------------------------------------------------------
-- Migrations are forward-only and never edited once pushed, so these are here
-- rather than in 130006.
--
-- 1. The review function in 130006 was reconstructed from memory rather than
--    copied, and invented an entity_observations insert whose columns do not
--    exist. This is the faithful original with only the batch-status branch
--    changed -- the change that was actually intended.
--
-- 2. loamy_trace_financing read financing_events.created_at. That column is
--    occurred_at, so the whole trace failed with a 42703 and every chain
--    reconstruction returned nothing. A trace that errors is worse than one
--    that reports a gap: it looks like the record does not exist.
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

  -- Collector and approver must be different people, always.
  if v_case.assigned_to = v_uid then
    raise exception 'The agent who collected this evidence cannot also approve it.';
  end if;

  insert into public.verification_reviews (case_id, reviewer_id, decision, note, checklist, flags_at_review)
  values (p_case_id, v_uid, p_decision, p_note, coalesce(p_checklist, '{}'::jsonb), v_case.flags);

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

  -- Apply the outcome through the subject's own controlled path.
  if p_decision = 'approved' then
    if v_case.task_type = 'farm_verification' and v_case.subject_farm_id is not null then
      perform set_config('loamy.status_change_authorized', 'true', true);
      update public.farms set verification_status = 'verified' where id = v_case.subject_farm_id;
      perform set_config('loamy.status_change_authorized', 'false', true);
    elsif v_case.subject_type = 'commodity_batch' and v_case.subject_id is not null then
      select * into v_batch from public.commodity_batches where id = v_case.subject_id;

      -- Verification is a FACT ABOUT THE STOCK, not a position in its
      -- commercial life. 'verified' as a LIFECYCLE status is only reachable
      -- from created/listed/pending, so a batch reserved by a buyer -- which
      -- is exactly when financing needs it inspected -- could never be
      -- verified at all. Widening the rule would be worse: it would regress a
      -- sold batch and lose the sale. So past 'listed', record the fact and
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

    -- Provenance: an approved field observation is a first-class fact.
    perform public.loamy_record_observation(
      coalesce(v_case.subject_type, 'farm'),
      coalesce(v_case.subject_id, v_case.subject_farm_id),
      'verification', 'field_captured', null, 'verified', null, null, 1.0,
      jsonb_build_object('case_ref', v_case.ref), p_note, now());
  end if;

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'admin', 'verification_decided', 'verification_case', p_case_id,
          jsonb_build_object('decision', p_decision, 'flags', to_jsonb(v_case.flags),
                             'agent', v_case.assigned_to));
end;
$$;
grant execute on function public.loamy_review_verification_case(uuid,text,text,jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. financing_events.occurred_at, not created_at.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_trace_financing(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope text := public.loamy_trace_scope(p_batch_id);
  v_uid   uuid := auth.uid();
  v_rows  jsonb;
begin
  if v_scope in ('none','public') then
    return jsonb_build_object('available', false, 'reason', 'not_permitted');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', f.ref,
           'status', f.status,
           'purpose', f.purpose,
           'institution', b.name,
           'product_type', f.product_type,
           'disbursement_preference', f.disbursement_preference,
           'requested_at', f.created_at,
           'decided_at', f.decided_at,
           'is_sandbox', f.is_sandbox,
           'decision_source', case when f.v_can then f.decision_source end,

           'amount_requested', case when f.v_can then to_jsonb(f.amount_requested) else 'null'::jsonb end,
           'approved_amount',  case when f.v_can then to_jsonb(f.approved_amount)  else 'null'::jsonb end,
           'disbursed_amount', case when f.v_can then to_jsonb(f.disbursed_amount) else 'null'::jsonb end,
           'tenor_days',       case when f.v_can then to_jsonb(f.tenor_days) else 'null'::jsonb end,
           'bank_reference',   case when f.v_can then to_jsonb(f.bank_reference) else 'null'::jsonb end,

           'settlement', case when f.v_can then (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'at', e.occurred_at, 'amount', e.amount,
                       'provider', e.detail->>'provider',
                       'reference', e.detail->>'provider_reference')
                       order by e.occurred_at), '[]'::jsonb)
              from public.financing_events e
              where e.application_id = f.id and e.event_type = 'supplier_settled'
           ) end,

           'repayment', case when f.v_can and f.repayment_status is not null then
              jsonb_build_object('status', f.repayment_status,
                                 'reported_at', f.repayment_reported_at,
                                 'source', f.repayment_source,
                                 'note', 'As reported by the institution. Loamy does not compute repayment.')
           end)
           order by f.created_at), '[]'::jsonb)
    into v_rows
  from (
    select fa.*,
           (public.loamy_is_admin()
            or fa.applicant_id = v_uid
            or fa.seller_id = v_uid) as v_can
    from public.financing_applications fa
    where fa.batch_id = p_batch_id
  ) f
  left join public.banks b on b.id = f.bank_id;

  if v_rows = '[]'::jsonb then
    return jsonb_build_object('available', false, 'reason', 'never_financed');
  end if;
  return jsonb_build_object('available', true, 'items', v_rows);
end;
$$;

grant execute on function public.loamy_trace_financing(uuid) to authenticated;
