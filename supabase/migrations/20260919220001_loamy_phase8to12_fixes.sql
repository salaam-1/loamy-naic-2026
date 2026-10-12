-- ============================================================================
-- PHASES 8-12 (b) — three real bugs found by the chain test.
-- ----------------------------------------------------------------------------
-- 1. A BATCH COULD ONLY BE SOLD ONCE. The 'reserved' rule allowed_from was
--    ['listed'], so the moment one buyer's transaction was accepted the batch
--    became 'reserved' and every SUBSEQUENT buyer's acceptance failed. A
--    40-tonne batch listed to several buyers could only ever serve the first.
--    Partial sale is the normal case in commodity trading, so this was a real
--    functional hole, not an edge case.
--
-- 2. INSTITUTIONAL FUNCTIONS WERE DECLARED `stable` BUT AUDIT-LOG BY INSERT.
--    Postgres refuses a write inside a STABLE function ("cannot execute INSERT
--    in a read-only transaction"), so EVERY institutional call failed --
--    including the refusals. The scope checks appeared to work in testing only
--    because the read-only error arrived first. The audit trail Part 26
--    requires was writing nothing at all.
--
-- 3. NO WAY TO SELECT A TRANSPORTER. Part 21 requires "receive bids, select
--    transporter", and transport_offers existed, but nothing connected an
--    offer to a job for transaction-backed haulage.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A batch may take several reservations.
-- ----------------------------------------------------------------------------
update public.batch_transition_rules
   set allowed_from = array['listed','reserved','partially_sold']
 where event_type = 'reserved';

-- Selling part of a batch must also be reachable from an already-reserved one.
update public.batch_transition_rules
   set allowed_from = array['listed','reserved','partially_sold']
 where event_type = 'partially_sold';

update public.batch_transition_rules
   set allowed_from = array['listed','reserved','partially_sold']
 where event_type = 'sold';

-- And a reserved batch can still be loaded and shipped.
update public.batch_transition_rules
   set allowed_from = array['sold','partially_sold','reserved']
 where event_type = 'loaded';
update public.batch_transition_rules
   set allowed_from = array['loaded','reserved','sold','partially_sold']
 where event_type = 'in_transit';
update public.batch_transition_rules
   set allowed_from = array['in_transit','loaded','reserved','sold','partially_sold']
 where event_type = 'warehouse_received';

-- ----------------------------------------------------------------------------
-- 2. Institutional functions must be VOLATILE so they can audit.
-- ----------------------------------------------------------------------------
-- Re-declared without `stable`. The audit write is not incidental — Part 26
-- makes it a condition of the access, so a version that cannot log must not
-- be able to answer either.
create or replace function public.loamy_institutional_production()
returns table (
  state text, verified_farms bigint, total_hectares_declared numeric,
  commodities bigint, batches bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare v_min int; v_n int := 0;
begin
  if not (public.loamy_has_institutional_scope('aggregate_production') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('aggregate_production', 'production', '{}'::jsonb, false, 0);
    raise exception 'This account does not hold the aggregate_production scope.';
  end if;

  select coalesce((settings->>'institutional_min_group_size')::int, 5)
    into v_min from public.platform_config where id = 1;

  return query
  select f.state,
         count(*) filter (where f.verification_status = 'verified')::bigint,
         round(sum(f.size_hectares), 1),
         count(distinct c.crop)::bigint,
         count(distinct b.id)::bigint
  from public.farms f
  left join public.crop_records c on c.farm_id = f.id
  left join public.commodity_batches b on b.farm_id = f.id
  group by f.state
  having count(distinct f.id) >= v_min;

  get diagnostics v_n = row_count;
  perform public.loamy_log_institutional_query('aggregate_production', 'production', '{}'::jsonb, true, v_n);
end;
$$;

create or replace function public.loamy_institutional_trade()
returns table (
  state text, commodity text, transactions bigint, total_quantity numeric, unit text
)
language plpgsql
security definer
set search_path = public
as $$
declare v_min int; v_n int := 0;
begin
  if not (public.loamy_has_institutional_scope('aggregate_trade') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('aggregate_trade', 'trade', '{}'::jsonb, false, 0);
    raise exception 'This account does not hold the aggregate_trade scope.';
  end if;

  select coalesce((settings->>'institutional_min_group_size')::int, 5)
    into v_min from public.platform_config where id = 1;

  return query
  select coalesce(b.origin_state, t.delivery_state) as state,
         t.commodity, count(*)::bigint, round(sum(t.quantity), 2), min(t.unit)
  from public.transactions t
  left join public.commodity_batches b on b.id = t.batch_id
  where t.status = 'completed'
  group by coalesce(b.origin_state, t.delivery_state), t.commodity
  having count(*) >= v_min;

  get diagnostics v_n = row_count;
  perform public.loamy_log_institutional_query('aggregate_trade', 'trade', '{}'::jsonb, true, v_n);
end;
$$;

create or replace function public.loamy_institutional_storage()
returns table (
  state text, facilities bigint, capacity_tonnes numeric, receipts bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare v_min int; v_n int := 0;
begin
  if not (public.loamy_has_institutional_scope('aggregate_storage') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('aggregate_storage', 'storage', '{}'::jsonb, false, 0);
    raise exception 'This account does not hold the aggregate_storage scope.';
  end if;

  select coalesce((settings->>'institutional_min_group_size')::int, 5)
    into v_min from public.platform_config where id = 1;

  return query
  select d.state, count(distinct d.id)::bigint,
         round(coalesce(sum(d.capacity_tonnes), 0), 1), count(r.id)::bigint
  from public.service_directory d
  left join public.warehouse_receipts r on r.facility_id = d.id
  where d.service_type = 'warehouse'
  group by d.state
  having count(distinct d.id) >= v_min;

  get diagnostics v_n = row_count;
  perform public.loamy_log_institutional_query('aggregate_storage', 'storage', '{}'::jsonb, true, v_n);
end;
$$;

create or replace function public.loamy_institutional_trace(p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_b        public.commodity_batches%rowtype;
  v_rows     jsonb;
begin
  if not (public.loamy_has_institutional_scope('trace_lookup') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('trace_lookup', 'trace',
              jsonb_build_object('ref', p_ref), false, 0);
    raise exception 'This account does not hold the trace_lookup scope.';
  end if;

  select entity_id into v_batch_id from public.loamy_entity_refs
  where ref = upper(trim(p_ref)) and entity_type = 'commodity_batch';

  if v_batch_id is null then
    perform public.loamy_log_institutional_query('trace_lookup', 'trace',
              jsonb_build_object('ref', p_ref), true, 0);
    return jsonb_build_object('found', false, 'reason', 'no_such_reference');
  end if;

  select * into v_b from public.commodity_batches where id = v_batch_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'event', e.event_type, 'to', e.new_status, 'at', e.occurred_at)
           order by e.occurred_at), '[]'::jsonb)
    into v_rows
  from public.batch_events e where e.batch_id = v_batch_id;

  perform public.loamy_log_institutional_query('trace_lookup', 'trace',
            jsonb_build_object('ref', p_ref, 'batch', v_b.ref), true, 1);

  return jsonb_build_object(
    'found', true, 'scope', 'institutional',
    'batch', jsonb_build_object(
      'ref', v_b.ref, 'commodity', v_b.commodity,
      'origin_state', v_b.origin_state, 'origin_traced', v_b.origin_traced,
      'verification_status', v_b.verification_status, 'status', v_b.status,
      'created_at', v_b.created_at),
    'events', v_rows);
end;
$$;

grant execute on function public.loamy_institutional_production() to authenticated;
grant execute on function public.loamy_institutional_trade() to authenticated;
grant execute on function public.loamy_institutional_storage() to authenticated;
grant execute on function public.loamy_institutional_trace(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Select a transporter.
-- ----------------------------------------------------------------------------
/**
 * Part 21: "receive bids, select transporter".
 *
 * Either the requester picks a provider directly, or they accept a standing
 * offer. Both land in the same place: the job is booked to one provider and
 * every other offer on it is declined, so a job can never be live with two
 * hauliers believing they have it.
 */
create or replace function public.loamy_assign_transport(
  p_job_id      uuid,
  p_provider_id uuid,
  p_agreed_price numeric default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_j   public.transport_jobs%rowtype;
  v_is_req boolean;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_j from public.transport_jobs where id = p_job_id for update;
  if v_j.id is null then raise exception 'Transport job not found.'; end if;

  v_is_req := v_j.requested_by = v_uid
              or exists (select 1 from public.transactions t
                         where t.id = v_j.transaction_id
                           and (t.buyer_id = v_uid or t.seller_id = v_uid));
  if not (v_is_req or public.loamy_is_admin()) then
    raise exception 'Only the party who requested this transport can choose a provider.';
  end if;
  if v_j.status not in ('requested','matching','broadcast') then
    raise exception 'This job is already % and cannot be re-assigned here.', v_j.status;
  end if;

  update public.transport_jobs
     set assigned_provider_id = p_provider_id,
         agreed_price = coalesce(p_agreed_price, agreed_price),
         status = 'booked',
         updated_at = now()
   where id = p_job_id;

  -- No two hauliers may believe they hold the same job.
  update public.transport_offers
     set status = case when provider_id = p_provider_id then 'selected' else 'declined' end
   where transport_job_id = p_job_id;

  insert into public.shipment_events (job_id, event_type, actor_id, previous_status, new_status, note)
  values (p_job_id, 'offer_selected', v_uid, v_j.status, 'booked', 'Provider selected');

  insert into public.notifications (user_id, title, body, type)
  values (p_provider_id, 'You have been assigned a delivery',
          'A shipment has been booked to you. Open Transport Jobs to see the details.', 'logistics');
end;
$$;

revoke all on function public.loamy_assign_transport(uuid,uuid,numeric) from public, anon;
grant execute on function public.loamy_assign_transport(uuid,uuid,numeric) to authenticated;

comment on function public.loamy_assign_transport(uuid,uuid,numeric) is
  'Books a transport job to one provider and declines every other offer on it, so two hauliers can never both believe they hold the job.';
