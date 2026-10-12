-- ============================================================================
-- BLOCK 4 (d) — financing in Trace, and the buyer's journey.
-- ----------------------------------------------------------------------------
-- Two read surfaces, both derived entirely from real state.
--
-- 1. FINANCING AS A FIRST-CLASS TRACE NODE (directive 20). The existing node
--    showed amounts and a status. It now carries the decision, the
--    settlement and the reported repayment -- scope-controlled, because a
--    marketplace buyer must never see another party's financial position.
--
-- 2. THE JOURNEY (directive 25). Ten stages, each with its status, WHO is
--    responsible, and what happens next. Computed from the database, never
--    assembled in the browser, so the tracker cannot drift from the truth.
--
--    It will not say "payment completed" until a settlement is on record.
--    Every stage that can fail says what failed and what to do about it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The financing node, deepened.
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
           -- A sandbox decision is labelled wherever it appears.
           'is_sandbox', f.is_sandbox,
           'decision_source', case when f.v_can then f.decision_source end,

           -- Money, only for the parties to the financed deal and admins. A
           -- warehouse operator is a 'party' to the batch; they have no
           -- business knowing the buyer's approved credit.
           'amount_requested', case when f.v_can then to_jsonb(f.amount_requested) else 'null'::jsonb end,
           'approved_amount',  case when f.v_can then to_jsonb(f.approved_amount)  else 'null'::jsonb end,
           'disbursed_amount', case when f.v_can then to_jsonb(f.disbursed_amount) else 'null'::jsonb end,
           'tenor_days',       case when f.v_can then to_jsonb(f.tenor_days) else 'null'::jsonb end,
           'bank_reference',   case when f.v_can then to_jsonb(f.bank_reference) else 'null'::jsonb end,

           -- Settlement, as reported by the institution.
           'settlement', case when f.v_can then (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'at', e.created_at, 'amount', e.amount,
                       'provider', e.detail->>'provider',
                       'reference', e.detail->>'provider_reference')
                       order by e.created_at), '[]'::jsonb)
              from public.financing_events e
              where e.application_id = f.id and e.event_type = 'supplier_settled'
           ) end,

           -- Repayment is what the institution REPORTED, never computed here.
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

-- ----------------------------------------------------------------------------
-- 2. Loading, in the trace.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_trace_loading(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope text := public.loamy_trace_scope(p_batch_id);
  v_rows  jsonb;
begin
  if v_scope in ('none','public') then
    return jsonb_build_object('available', false, 'reason', 'not_permitted');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', l.ref, 'stage', l.stage,
           'quantity_confirmed', l.quantity_confirmed, 'unit', l.unit,
           'waybill', l.waybill_ref, 'vehicle', l.vehicle_registration,
           'photos', coalesce(array_length(l.photos, 1), 0),
           'flags', to_jsonb(l.flags),
           'at', l.occurred_at) order by l.occurred_at), '[]'::jsonb)
    into v_rows
  from public.loading_confirmations l
  where l.batch_id = p_batch_id;

  if v_rows = '[]'::jsonb then
    return jsonb_build_object('available', false, 'reason', 'never_loaded');
  end if;
  return jsonb_build_object('available', true, 'items', v_rows);
end;
$$;

grant execute on function public.loamy_trace_loading(uuid) to authenticated;

create or replace function public.loamy_trace(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lookup jsonb := public.loamy_trace_batch_for_ref(p_ref);
  v_batch  uuid;
  v_out    jsonb;
  v_bref   text;
begin
  if not (v_lookup->>'found')::boolean then return v_lookup; end if;
  v_batch := (v_lookup->>'batch_id')::uuid;

  select ref into v_bref from public.commodity_batches where id = v_batch;
  v_out := public.loamy_trace_batch(v_bref);
  if not (v_out->>'found')::boolean then return v_out; end if;

  v_out := v_out || jsonb_build_object(
    'financing', public.loamy_trace_financing(v_batch),
    'loading',   public.loamy_trace_loading(v_batch),
    'entered_via', jsonb_build_object(
      'ref', v_lookup->>'via_ref', 'entity_type', v_lookup->>'via_type'));

  return v_out;
end;
$$;

grant execute on function public.loamy_trace(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The buyer's journey — ten stages, from real state.
-- ----------------------------------------------------------------------------
/**
 * Every stage carries: status, who is responsible, what the buyer must do,
 * and what happens next.
 *
 * Status vocabulary, deliberately small:
 *   done | active | waiting | blocked | failed | skipped | pending
 *
 * 'waiting' means someone else owes an action; 'active' means the buyer does.
 * The distinction is the whole value of a tracker.
 */
create or replace function public.loamy_transaction_journey(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_t      public.transactions%rowtype;
  v_f      public.financing_applications%rowtype;
  v_ver    public.verification_tasks%rowtype;
  v_ready  jsonb;
  v_stages jsonb := '[]'::jsonb;
  v_job    public.transport_jobs%rowtype;
  v_load   public.loading_confirmations%rowtype;
  v_settled boolean;
  v_financed boolean;

  -- Small helper values.
  v_s text; v_who text; v_next text; v_action text;
begin
  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then
    return jsonb_build_object('found', false, 'reason', 'no_such_transaction');
  end if;
  if not (public.loamy_is_admin() or v_t.buyer_id = v_uid or v_t.seller_id = v_uid) then
    -- Indistinguishable from a transaction that does not exist.
    return jsonb_build_object('found', false, 'reason', 'no_such_transaction');
  end if;

  select * into v_f from public.financing_applications
   where transaction_id = p_transaction_id order by created_at desc limit 1;
  v_financed := v_f.id is not null;

  if v_t.batch_id is not null then
    select * into v_ver from public.verification_tasks
     where subject_type = 'commodity_batch' and subject_id = v_t.batch_id
     order by created_at desc limit 1;
  end if;

  select * into v_load from public.loading_confirmations
   where transaction_id = p_transaction_id order by occurred_at desc limit 1;

  select * into v_job from public.transport_jobs
   where transaction_id = p_transaction_id order by created_at desc limit 1;

  v_settled := v_financed and coalesce(v_f.disbursed_amount, 0) > 0;

  -- 1. Purchase requested
  v_stages := v_stages || jsonb_build_object(
    'step', 1, 'code', 'purchase_requested', 'label', 'Purchase requested',
    'status', case
      when v_t.status in ('cancelled','rejected','expired') then 'failed'
      when v_t.status = 'proposed' then 'waiting'
      else 'done' end,
    'responsible', case when v_t.status = 'proposed' then 'seller' else 'buyer' end,
    'detail', v_t.status,
    'next', case when v_t.status = 'proposed' then 'The seller accepts or declines your offer.' end,
    'your_action', case when v_t.status = 'proposed' then 'Nothing yet — wait for the seller.' end);

  -- 2. Financing submitted
  v_stages := v_stages || jsonb_build_object(
    'step', 2, 'code', 'financing_submitted', 'label', 'Financing submitted',
    'status', case when not v_financed then 'skipped' else 'done' end,
    'responsible', 'buyer',
    'detail', coalesce(v_f.ref, 'paying directly'),
    'next', case when not v_financed then 'You chose to pay directly — no financing application exists.' end);

  -- 3. Bank assessment
  v_stages := v_stages || jsonb_build_object(
    'step', 3, 'code', 'bank_assessment', 'label', 'Bank assessment',
    'status', case
      when not v_financed then 'skipped'
      when v_f.status in ('submitted','under_review') then 'waiting'
      when v_f.status in ('info_requested','additional_information_required') then 'active'
      when v_f.status in ('approved','partially_approved','disbursed','completed') then 'done'
      when v_f.status in ('rejected','expired','cancelled') then 'failed'
      else 'pending' end,
    'responsible', case when v_f.status in ('info_requested','additional_information_required')
                        then 'buyer' else 'bank' end,
    'detail', v_f.status,
    'is_sandbox', coalesce(v_f.is_sandbox, false),
    'next', case
      when v_f.status in ('submitted','under_review')
        then 'The institution is assessing your application. Loamy does not make this decision.'
      when v_f.status in ('info_requested','additional_information_required')
        then 'The institution needs more information from you.'
      end,
    'your_action', case when v_f.status in ('info_requested','additional_information_required')
                        then 'Provide the information the institution asked for.' end);

  -- 4. Financing decision
  v_stages := v_stages || jsonb_build_object(
    'step', 4, 'code', 'financing_decision', 'label', 'Financing decision',
    'status', case
      when not v_financed then 'skipped'
      when v_f.status in ('approved','partially_approved','disbursed','completed') then 'done'
      when v_f.status = 'rejected' then 'failed'
      when v_f.status = 'expired' then 'failed'
      else 'pending' end,
    'responsible', 'bank',
    'detail', case
      when v_f.status = 'rejected' then coalesce(v_f.decision_note, 'Declined by the institution.')
      when v_f.status = 'expired' then 'The approval expired before settlement.'
      when v_f.approved_amount is not null then 'Approved: ' || v_f.approved_amount::text
      end,
    'is_sandbox', coalesce(v_f.is_sandbox, false),
    'next', case
      when v_f.status = 'rejected'
        then 'You can pay directly instead, or apply to another institution.'
      when v_f.status = 'expired'
        then 'Apply again, or pay directly.'
      end);

  -- 5. Commodity verification
  v_stages := v_stages || jsonb_build_object(
    'step', 5, 'code', 'commodity_verification', 'label', 'Commodity verification',
    'status', case
      when v_t.batch_id is null then 'skipped'
      when v_ver.id is null then 'pending'
      when v_ver.status = 'approved' then 'done'
      when v_ver.status = 'rejected' then 'failed'
      when v_ver.status in ('pending','assigned','in_progress','submitted','resubmit_requested') then 'waiting'
      else 'pending' end,
    'responsible', 'loamy',
    -- The agent is never named to the parties.
    'agent_display', case when v_ver.assigned_to is not null then 'Loamy Verification Agent' end,
    'detail', coalesce(v_ver.status, case when v_t.batch_id is null
                                          then 'seller-declared stock' else 'not requested' end),
    'next', case
      when v_ver.status = 'rejected' then 'Verification failed. The purchase cannot proceed on this stock.'
      when v_ver.id is not null and v_ver.status <> 'approved'
        then 'A Loamy verification agent is inspecting the stock.'
      end);

  -- 6. Supplier settlement
  v_ready := case when v_financed then public.loamy_settlement_readiness(v_f.id) end;
  v_stages := v_stages || jsonb_build_object(
    'step', 6, 'code', 'supplier_settlement', 'label', 'Supplier settlement',
    'status', case
      when not v_financed then 'skipped'
      when v_settled then 'done'
      when v_f.status in ('rejected','expired','cancelled') then 'failed'
      when v_ready is not null and (v_ready->>'ready')::boolean then 'waiting'
      else 'blocked' end,
    'responsible', 'bank',
    'detail', case when v_settled then 'Settled: ' || v_f.disbursed_amount::text end,
    'blocked_by', case when v_ready is not null and not (v_ready->>'ready')::boolean
                       then v_ready->'blocked_by' end,
    'is_sandbox', coalesce(v_f.is_sandbox, false),
    -- Never "payment completed" before a settlement is actually on record.
    'next', case
      when v_settled then null
      when v_ready is not null and (v_ready->>'ready')::boolean
        then 'All conditions are met. The institution settles the seller directly.'
      when v_financed then 'Settlement is waiting on the conditions listed.'
      end);

  -- 7. Loading
  v_stages := v_stages || jsonb_build_object(
    'step', 7, 'code', 'loading', 'label', 'Loading',
    'status', case
      when v_t.fulfilment_state in ('loaded','in_transit','delivered','received') then 'done'
      when v_t.fulfilment_state in ('loading_requested','loading_scheduled','loading_started') then 'waiting'
      when v_t.fulfilment_state = 'failed' then 'failed'
      else 'pending' end,
    'responsible', 'seller',
    'detail', coalesce(v_load.stage, v_t.fulfilment_state),
    'flags', case when v_load.id is not null then to_jsonb(v_load.flags) end,
    'next', case
      when v_t.fulfilment_state = 'not_started' then 'The seller schedules loading once the deal is settled.'
      when v_t.fulfilment_state in ('loading_requested','loading_scheduled','loading_started')
        then 'The seller is loading the goods and will confirm quantity and waybill.'
      end);

  -- 8. Logistics
  v_stages := v_stages || jsonb_build_object(
    'step', 8, 'code', 'logistics', 'label', 'Logistics',
    'status', case
      when v_t.fulfilment_state in ('delivered','received') then 'done'
      when v_t.fulfilment_state = 'in_transit' then 'waiting'
      when v_job.id is not null then 'waiting'
      when v_t.fulfilment_state = 'loaded' then 'active'
      else 'pending' end,
    'responsible', case when v_job.id is null then 'buyer' else 'logistics_provider' end,
    'detail', coalesce(v_job.status, 'no transport arranged'),
    'mode', v_job.mode,
    'next', case
      when v_t.fulfilment_state = 'loaded' and v_job.id is null
        then 'Choose a carrier, or record your own haulage. Loamy does not require Loamy logistics.'
      when v_job.id is not null and v_t.fulfilment_state <> 'delivered'
        then 'The carrier is moving the goods.'
      end,
    'your_action', case when v_t.fulfilment_state = 'loaded' and v_job.id is null
                        then 'Accept a transport offer, pick another provider, or use your own.' end);

  -- 9. Delivery
  v_stages := v_stages || jsonb_build_object(
    'step', 9, 'code', 'delivery', 'label', 'Delivery',
    'status', case
      when v_t.fulfilment_state = 'received' then 'done'
      when v_t.fulfilment_state = 'delivered' then 'active'
      when v_t.fulfilment_state = 'failed' then 'failed'
      else 'pending' end,
    'responsible', 'buyer',
    'detail', v_t.fulfilment_state,
    'next', case when v_t.fulfilment_state = 'delivered'
                 then 'Confirm you have received the goods.' end,
    'your_action', case when v_t.fulfilment_state = 'delivered'
                        then 'Confirm receipt to close the purchase.' end);

  -- 10. Completed
  v_stages := v_stages || jsonb_build_object(
    'step', 10, 'code', 'completed', 'label', 'Completed',
    'status', case
      when v_t.status = 'completed' then 'done'
      when v_t.status in ('cancelled','rejected','expired') then 'failed'
      when v_t.status = 'disputed' then 'blocked' else 'pending' end,
    'responsible', 'loamy',
    'detail', v_t.status,
    'next', case when v_t.status = 'disputed'
                 then 'This purchase is in dispute and is being reviewed.' end);

  return jsonb_build_object(
    'found', true,
    'transaction', jsonb_build_object(
      'ref', v_t.ref, 'commodity', v_t.commodity,
      'quantity', v_t.quantity, 'unit', v_t.unit,
      'subtotal', v_t.subtotal, 'currency', v_t.currency,
      'status', v_t.status, 'payment_state', v_t.payment_state,
      'fulfilment_state', v_t.fulfilment_state),
    'financing', case when v_financed then jsonb_build_object(
      'ref', v_f.ref, 'status', v_f.status, 'is_sandbox', v_f.is_sandbox,
      'amount_requested', v_f.amount_requested,
      'approved_amount', v_f.approved_amount,
      'disbursed_amount', v_f.disbursed_amount,
      'repayment_status', v_f.repayment_status) end,
    'stages', v_stages,
    'generated_at', now());
end;
$$;

revoke all on function public.loamy_transaction_journey(uuid) from public, anon;
grant execute on function public.loamy_transaction_journey(uuid) to authenticated;

comment on function public.loamy_transaction_journey(uuid) is
  'BLOCK 4, directive 25/26. Ten stages computed from real state. Distinguishes waiting (someone else owes an action) from active (the buyer does), and never reports payment complete before a settlement is recorded.';
