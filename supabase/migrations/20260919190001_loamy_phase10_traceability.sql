-- ============================================================================
-- PHASE 10 — traceability.
-- ----------------------------------------------------------------------------
-- Directive Part 25. Given a batch ID, an authorised user reconstructs:
--
--   ORIGIN FARM -> PRODUCTION CYCLE -> HARVEST -> BATCH -> VERIFICATION ->
--   SELLER -> LISTING -> BUYER -> TRANSACTION -> PAYMENT EVENT -> LOADING ->
--   LOGISTICS -> WAREHOUSE -> DELIVERY -> FINAL STATUS
--
-- The hard rule, and the reason this is mostly assembly rather than new data:
--
--   "The system must never fabricate missing history. If an event does not
--    exist: display that it is unavailable. Do not infer it."
--
-- So every link returns one of three shapes: the real record, an explicit
-- `"available": false` with a reason, or -- where the caller is not entitled to
-- see that link -- `"available": false, "reason": "not_permitted"`. A gap is
-- never rendered as an empty success.
--
-- SECURITY-REVIEW ** THIS FUNCTION CROSSES EVERY RLS BOUNDARY **
-- It is SECURITY DEFINER, so it can read tables the caller cannot. That is the
-- point (a buyer should see that a batch came from a verified farm in Benue)
-- and also the danger (they must not learn the farmer's identity or the farm's
-- coordinates). Entitlement is computed ONCE at the top into a scope, and every
-- section below redacts against that scope. Any new field added to this
-- function is a disclosure decision -- check it against the scope table in
-- docs/traceability.md before adding it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Who may see how much of a chain.
-- ----------------------------------------------------------------------------
/**
 * Returns one of:
 *   'none'        no entitlement at all
 *   'public'      commodity, origin STATE, verification status. No identities.
 *   'party'       + counterparties, quantities, transaction and logistics detail
 *   'origin'      + the origin farm's identity (the farmer, or admin)
 *   'admin'       everything
 *
 * A buyer who transacted on a batch gets 'party'. A member merely browsing a
 * listing gets 'public'. Institutional access (Phase 12) maps onto 'public'
 * plus aggregate rights, never 'party'.
 */
create or replace function public.loamy_trace_scope(p_batch_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_b   public.commodity_batches%rowtype;
begin
  if v_uid is null then return 'none'; end if;
  if public.loamy_is_admin() then return 'admin'; end if;

  select * into v_b from public.commodity_batches where id = p_batch_id;
  if v_b.id is null then return 'none'; end if;

  -- The farmer who grew it, or whoever holds it now.
  if v_b.origin_owner_id = v_uid or v_b.owner_id = v_uid then return 'origin'; end if;

  -- A counterparty on a transaction for this batch.
  if exists (select 1 from public.transactions t
             where t.batch_id = p_batch_id
               and (t.buyer_id = v_uid or t.seller_id = v_uid)) then
    return 'party';
  end if;

  -- Someone carrying or storing it.
  if exists (select 1 from public.transport_jobs j
             where j.batch_id = p_batch_id
               and (j.assigned_provider_id = v_uid or j.requested_by = v_uid)) then
    return 'party';
  end if;
  if exists (select 1 from public.warehouse_receipts r
             join public.service_directory d on d.id = r.facility_id
             where r.batch_id = p_batch_id and d.owner_id = v_uid) then
    return 'party';
  end if;

  -- Anyone else signed in sees the public chain only if it is on sale.
  if exists (select 1 from public.listings l
             where l.batch_id = p_batch_id and l.status = 'active') then
    return 'public';
  end if;

  return 'none';
end;
$$;

grant execute on function public.loamy_trace_scope(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. The trace.
-- ----------------------------------------------------------------------------
/**
 * Accepts a batch UUID or a business ref ('BATCH-000982'), so the thing a
 * person actually holds is the thing they can type.
 */
create or replace function public.loamy_trace_batch(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_scope    text;
  v_b        public.commodity_batches%rowtype;
  v_out      jsonb := '{}'::jsonb;
  v_node     jsonb;
  v_rows     jsonb;
begin
  -- Resolve ref -> id, or accept an id directly.
  select entity_id into v_batch_id
  from public.loamy_entity_refs
  where ref = upper(trim(p_ref)) and entity_type = 'commodity_batch';

  if v_batch_id is null then
    begin
      v_batch_id := p_ref::uuid;
    exception when others then
      return jsonb_build_object('found', false, 'reason', 'no_such_reference');
    end;
  end if;

  v_scope := public.loamy_trace_scope(v_batch_id);
  if v_scope = 'none' then
    -- Deliberately indistinguishable from "does not exist": otherwise this is
    -- an oracle for guessing which batch refs are real.
    return jsonb_build_object('found', false, 'reason', 'no_such_reference');
  end if;

  select * into v_b from public.commodity_batches where id = v_batch_id;

  v_out := jsonb_build_object(
    'found', true,
    'scope', v_scope,
    'batch', jsonb_build_object(
      'ref', v_b.ref,
      'commodity', v_b.commodity,
      'unit', v_b.unit,
      'status', v_b.status,
      'verification_status', v_b.verification_status,
      'origin_traced', v_b.origin_traced,
      'origin_state', v_b.origin_state,
      'created_at', v_b.created_at,
      -- Quantities are commercial. Public viewers do not get them.
      'quantity', case when v_scope in ('party','origin','admin') then to_jsonb(v_b.quantity) else 'null'::jsonb end,
      'available_quantity', case when v_scope in ('party','origin','admin') then to_jsonb(v_b.available_quantity) else 'null'::jsonb end
    ));

  -- ---- ORIGIN: farm, cycle, harvest ---------------------------------------
  if v_b.farm_id is null then
    v_node := jsonb_build_object('available', false, 'reason',
      case when v_b.origin_traced then 'record_missing' else 'origin_not_traced' end);
  else
    select jsonb_build_object(
             'available', true,
             'ref', f.ref,
             'state', f.state,
             -- Identity and precise location only for the farmer / admin.
             'lga',        case when v_scope in ('origin','admin') then to_jsonb(f.lga) else 'null'::jsonb end,
             'farm_name',  case when v_scope in ('origin','admin') then to_jsonb(f.farm_name) else 'null'::jsonb end,
             'owner_name', case when v_scope = 'admin' then to_jsonb(p.full_name) else 'null'::jsonb end,
             'verification_status', f.verification_status,
             'declared_hectares', case when v_scope in ('origin','admin') then to_jsonb(f.size_hectares) else 'null'::jsonb end,
             'mapped_hectares',   case when v_scope in ('origin','admin') then to_jsonb(f.mapped_area_hectares) else 'null'::jsonb end)
      into v_node
    from public.farms f
    join public.profiles p on p.id = f.owner_id
    where f.id = v_b.farm_id;
    v_node := coalesce(v_node, jsonb_build_object('available', false, 'reason', 'record_missing'));
  end if;
  v_out := v_out || jsonb_build_object('farm', v_node);

  if v_b.production_cycle_id is null then
    v_node := jsonb_build_object('available', false, 'reason', 'not_recorded');
  else
    select jsonb_build_object('available', true, 'ref', c.ref, 'season', c.season_year,
                              'commodity', c.crop, 'status', c.status,
                              'planting_date', c.planting_date)
      into v_node from public.crop_records c where c.id = v_b.production_cycle_id;
    v_node := coalesce(v_node, jsonb_build_object('available', false, 'reason', 'record_missing'));
  end if;
  v_out := v_out || jsonb_build_object('production_cycle', v_node);

  if v_b.harvest_id is null then
    v_node := jsonb_build_object('available', false, 'reason', 'not_recorded');
  else
    select jsonb_build_object('available', true, 'ref', h.ref, 'harvest_date', h.harvest_date,
                              'quantity', case when v_scope in ('party','origin','admin') then to_jsonb(h.quantity) else 'null'::jsonb end,
                              'unit', h.unit, 'grade', h.quality_grade, 'status', h.status)
      into v_node from public.harvests h where h.id = v_b.harvest_id;
    v_node := coalesce(v_node, jsonb_build_object('available', false, 'reason', 'record_missing'));
  end if;
  v_out := v_out || jsonb_build_object('harvest', v_node);

  -- ---- VERIFICATION --------------------------------------------------------
  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', t.ref, 'type', t.task_type, 'status', t.status,
           'flagged', array_length(t.flags, 1) is not null,
           'decided_at', t.completed_at) order by t.created_at), '[]'::jsonb)
    into v_rows
  from public.verification_tasks t
  where (t.subject_type = 'commodity_batch' and t.subject_id = v_batch_id)
     or (t.subject_farm_id = v_b.farm_id and t.task_type = 'farm_verification');
  v_out := v_out || jsonb_build_object('verifications',
    case when v_rows = '[]'::jsonb
         then jsonb_build_object('available', false, 'reason', 'never_verified')
         else jsonb_build_object('available', true, 'items', v_rows) end);

  -- ---- LISTINGS ------------------------------------------------------------
  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', l.ref, 'status', l.status, 'claim_basis', l.claim_basis,
           'quantity', case when v_scope in ('party','origin','admin') then to_jsonb(l.quantity_kg) else 'null'::jsonb end,
           'price_per_unit', case when v_scope in ('party','origin','admin') then to_jsonb(l.price_per_unit) else 'null'::jsonb end,
           'listed_at', l.created_at) order by l.created_at), '[]'::jsonb)
    into v_rows
  from public.listings l where l.batch_id = v_batch_id;
  v_out := v_out || jsonb_build_object('listings',
    case when v_rows = '[]'::jsonb
         then jsonb_build_object('available', false, 'reason', 'never_listed')
         else jsonb_build_object('available', true, 'items', v_rows) end);

  -- ---- TRANSACTIONS (+ payment state) --------------------------------------
  if v_scope in ('party','origin','admin') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'ref', t.ref, 'status', t.status,
             'payment_state', t.payment_state,
             'fulfilment_state', t.fulfilment_state,
             'quantity', t.quantity, 'unit', t.unit,
             'subtotal', case when v_scope in ('origin','admin') then to_jsonb(t.subtotal) else 'null'::jsonb end,
             'buyer', case when v_scope = 'admin' then to_jsonb(pb.full_name) else 'null'::jsonb end,
             'seller', case when v_scope = 'admin' then to_jsonb(ps.full_name) else 'null'::jsonb end,
             'created_at', t.created_at, 'completed_at', t.completed_at)
             order by t.created_at), '[]'::jsonb)
      into v_rows
    from public.transactions t
    join public.profiles pb on pb.id = t.buyer_id
    join public.profiles ps on ps.id = t.seller_id
    where t.batch_id = v_batch_id;
    v_out := v_out || jsonb_build_object('transactions',
      case when v_rows = '[]'::jsonb
           then jsonb_build_object('available', false, 'reason', 'never_sold')
           else jsonb_build_object('available', true, 'items', v_rows) end);
  else
    v_out := v_out || jsonb_build_object('transactions',
      jsonb_build_object('available', false, 'reason', 'not_permitted'));
  end if;

  -- ---- LOGISTICS -----------------------------------------------------------
  if v_scope in ('party','origin','admin') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'ref', j.ref, 'mode', j.mode, 'status', j.status,
             'pickup_state', j.pickup_state, 'dropoff_state', j.dropoff_state,
             'delivered_at', j.delivered_at) order by j.created_at), '[]'::jsonb)
      into v_rows
    from public.transport_jobs j where j.batch_id = v_batch_id;
    v_out := v_out || jsonb_build_object('logistics',
      case when v_rows = '[]'::jsonb
           then jsonb_build_object('available', false, 'reason', 'no_transport_recorded')
           else jsonb_build_object('available', true, 'items', v_rows) end);
  else
    v_out := v_out || jsonb_build_object('logistics',
      jsonb_build_object('available', false, 'reason', 'not_permitted'));
  end if;

  -- ---- WAREHOUSE -----------------------------------------------------------
  if v_scope in ('party','origin','admin') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'ref', r.ref, 'movement', r.movement, 'quantity', r.quantity,
             'unit', r.unit, 'condition', r.condition,
             'facility', d.business_name, 'facility_ref', d.ref,
             'state', d.state, 'occurred_at', r.occurred_at)
             order by r.occurred_at), '[]'::jsonb)
      into v_rows
    from public.warehouse_receipts r
    join public.service_directory d on d.id = r.facility_id
    where r.batch_id = v_batch_id;
    v_out := v_out || jsonb_build_object('warehouse',
      case when v_rows = '[]'::jsonb
           then jsonb_build_object('available', false, 'reason', 'never_warehoused')
           else jsonb_build_object('available', true, 'items', v_rows) end);
  else
    v_out := v_out || jsonb_build_object('warehouse',
      jsonb_build_object('available', false, 'reason', 'not_permitted'));
  end if;

  -- ---- THE EVENT SPINE -----------------------------------------------------
  select coalesce(jsonb_agg(jsonb_build_object(
           'event', e.event_type, 'from', e.previous_status, 'to', e.new_status,
           'quantity_after', case when v_scope in ('party','origin','admin') then to_jsonb(e.quantity_after) else 'null'::jsonb end,
           'at', e.occurred_at) order by e.occurred_at), '[]'::jsonb)
    into v_rows
  from public.batch_events e where e.batch_id = v_batch_id;
  v_out := v_out || jsonb_build_object('events', v_rows);

  return v_out;
end;
$$;

revoke all on function public.loamy_trace_batch(text) from public, anon;
grant execute on function public.loamy_trace_batch(text) to authenticated;

comment on function public.loamy_trace_batch(text) is
  'TRACEABILITY (directive Part 25). Reconstructs a batch chain, redacted by loamy_trace_scope. Missing links return available=false with a reason -- history is never fabricated.';
