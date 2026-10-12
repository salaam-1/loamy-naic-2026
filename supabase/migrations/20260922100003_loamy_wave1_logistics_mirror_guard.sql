-- ============================================================================
-- WAVE 1 (c) — a carrier could get permanently stuck mid-journey.
-- ----------------------------------------------------------------------------
-- FOUND BY WALKING THE SPINE END TO END, which nothing had done before.
--
-- `loamy_logistics_transition` moves the transport job AND mirrors the move
-- onto the transaction's fulfilment machine. The mirror was unguarded, so if
-- the transaction was ALREADY in the target state the mirror raised and took
-- the whole call down with it -- including the job transition, which was
-- perfectly valid.
--
-- That is not hypothetical. It is the normal path:
--
--   1. The seller records loading complete. `loamy_record_loading` moves the
--      transaction's fulfilment state to `loaded`.
--   2. The carrier collects and reports `loaded`. The JOB may legitimately go
--      booked/assigned -> loaded. But the mirror tries to move the
--      transaction to `loaded` again and raises:
--        "A transaction whose fulfilment is loaded cannot go to loaded"
--   3. The whole transition fails. The job stays `assigned`.
--   4. `departed` is only allowed from `loaded`/`picked_up`, so the carrier
--      can never depart. The purchase is stuck for good.
--
-- THE FIX, AND WHY IT IS THIS ONE
--   The job is authoritative for where the LORRY is; the transaction machine
--   is a mirror of it. A mirror that is already correct is not an error. Each
--   mirror is now attempted independently and a refusal is swallowed at that
--   point only -- exactly the pattern `loamy_record_loading` already uses,
--   and for the same reason.
--
--   What is NOT done: the transaction machine is not loosened, no transition
--   is added, and no state is forced. If the mirror refuses for a real reason
--   the transaction simply does not move, and the next actor sees the true
--   state rather than a fabricated one.
-- ============================================================================

create or replace function public.loamy_logistics_transition(
  p_job_id     uuid,
  p_event_type text,
  p_latitude   numeric default null,
  p_longitude  numeric default null,
  p_location_note text default null,
  p_evidence   jsonb default '{}'::jsonb,
  p_note       text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_j        public.transport_jobs%rowtype;
  v_rule     public.logistics_transition_rules%rowtype;
  v_is_admin boolean := public.loamy_is_admin();
  v_is_req   boolean;
  v_is_prov  boolean;
  v_status   text;
  v_event    uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_j from public.transport_jobs where id = p_job_id for update;
  if v_j.id is null then raise exception 'Transport job not found.'; end if;

  select * into v_rule from public.logistics_transition_rules where event_type = p_event_type;
  if v_rule.event_type is null then raise exception 'Unknown logistics event: %', p_event_type; end if;

  if not (v_j.status = any (v_rule.allowed_from)) then
    raise exception 'A job that is % cannot go to % (allowed from: %).',
      v_j.status, p_event_type, array_to_string(v_rule.allowed_from, ', ');
  end if;

  -- Who may drive this event. A purchase job authorises through the
  -- transaction's parties; an RFQ job through the company that raised it.
  v_is_prov := v_j.assigned_provider_id = v_uid;
  v_is_req  := v_j.requested_by = v_uid
               or (v_j.transaction_id is not null and exists (
                     select 1 from public.transactions t
                      where t.id = v_j.transaction_id and auth.uid() in (t.buyer_id, t.seller_id)))
               or (v_j.company_id is not null
                   and v_j.company_id in (select public.loamy_user_company_ids()));

  if not v_is_admin then
    if v_rule.initiator = 'provider' and not v_is_prov then
      raise exception 'Only the assigned carrier can record that.';
    elsif v_rule.initiator = 'requester' and not v_is_req then
      raise exception 'Only the party that arranged this transport can record that.';
    elsif v_rule.initiator = 'either' and not (v_is_prov or v_is_req) then
      raise exception 'Not authorised for this job.';
    elsif v_rule.initiator = 'platform' then
      raise exception 'That event is recorded by Loamy, not by a member.';
    end if;
  end if;

  v_status := coalesce(v_rule.new_status, v_j.status);

  update public.transport_jobs
     set status = v_status,
         pickup_confirmed_at = case when p_event_type = 'loaded'
                                    then coalesce(pickup_confirmed_at, now())
                                    else pickup_confirmed_at end,
         delivered_at = case when p_event_type = 'delivered'
                             then coalesce(delivered_at, now()) else delivered_at end,
         updated_at = now()
   where id = p_job_id;

  insert into public.shipment_events (
    job_id, event_type, actor_id, previous_status, new_status,
    latitude, longitude, location_note, evidence, note)
  values (p_job_id, p_event_type, v_uid, v_j.status, v_rule.new_status,
          p_latitude, p_longitude, p_location_note, coalesce(p_evidence, '{}'::jsonb), p_note)
  returning id into v_event;

  -- ------------------------------------------------------------------
  -- Mirrors. Each is attempted on its own and a refusal is tolerated:
  -- a mirror that is already in the target state is not an error, and
  -- must never undo the job transition that just succeeded.
  -- ------------------------------------------------------------------
  if v_j.transaction_id is not null then
    perform set_config('loamy.txn_system_authorized', 'true', true);
    perform set_config('loamy.batch_system_authorized', 'true', true);

    if p_event_type = 'loaded' then
      begin
        perform public.loamy_transaction_transition(
          v_j.transaction_id, 'loaded', 'fulfilment', null, '{}'::jsonb, null, null);
      exception when others then null;  -- already loaded; the job is authoritative
      end;

    elsif p_event_type = 'departed' then
      begin
        perform public.loamy_transaction_transition(
          v_j.transaction_id, 'in_transit', 'fulfilment', null, '{}'::jsonb, null, null);
      exception when others then null;
      end;
      if v_j.batch_id is not null then
        begin
          perform public.loamy_batch_transition(
            v_j.batch_id, 'in_transit', null, 'logistics_job', p_job_id,
            p_location_note, null, p_latitude, p_longitude, '{}'::jsonb, '{}'::jsonb, null);
        exception when others then null;
        end;
      end if;

    elsif p_event_type = 'delivered' then
      begin
        perform public.loamy_transaction_transition(
          v_j.transaction_id, 'delivered', 'fulfilment', null, '{}'::jsonb, null, null);
      exception when others then null;
      end;
      if v_j.batch_id is not null then
        begin
          perform public.loamy_batch_transition(
            v_j.batch_id, 'delivered', null, 'logistics_job', p_job_id,
            p_location_note, null, p_latitude, p_longitude, '{}'::jsonb, '{}'::jsonb, null);
        exception when others then null;
        end;
      end if;
    end if;

    perform set_config('loamy.txn_system_authorized', 'false', true);
    perform set_config('loamy.batch_system_authorized', 'false', true);
  end if;

  return v_event;
end;
$$;

revoke all on function public.loamy_logistics_transition(
  uuid,text,numeric,numeric,text,jsonb,text) from public, anon;
grant execute on function public.loamy_logistics_transition(
  uuid,text,numeric,numeric,text,jsonb,text) to authenticated;

comment on function public.loamy_logistics_transition(uuid,text,numeric,numeric,text,jsonb,text) is
  'Moves a transport job and mirrors the move onto the transaction and batch. Mirrors are best-effort: a mirror already in the target state is not an error and must not undo a valid job transition. Before this guard a carrier reporting "loaded" after the seller had already recorded loading complete failed outright, leaving the job stuck at assigned with no route to departed.';
