-- ============================================================================
-- PHASE 12 (c) — a refused institutional query must leave a trace.
-- ----------------------------------------------------------------------------
-- The bug: the aggregate functions logged the refusal and then RAISED. In
-- Postgres the exception rolls the whole function back, audit row included --
-- so the denial was recorded nowhere. Every *allowed* query was audited and
-- every *refused* one vanished, which is precisely backwards: an institution
-- probing scopes it does not hold is the thing a reviewer most wants to see.
--
-- There are no autonomous transactions in Postgres, so a write cannot survive
-- a raise in the same call. The fix is to stop raising: DENIAL BECOMES DATA.
-- Each function now returns jsonb with an explicit `allowed` flag, the audit
-- row commits with the rest of the statement, and the caller still gets an
-- unambiguous answer.
--
-- Returning a shape instead of throwing is also a better API here: the caller
-- can tell "you may not ask that" apart from "that region has no activity",
-- which an exception and an empty set could not distinguish.
-- ============================================================================

drop function if exists public.loamy_institutional_production();
drop function if exists public.loamy_institutional_trade();
drop function if exists public.loamy_institutional_storage();

create or replace function public.loamy_institutional_production()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_min int; v_rows jsonb;
begin
  if not (public.loamy_has_institutional_scope('aggregate_production') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('aggregate_production', 'production', '{}'::jsonb, false, 0);
    return jsonb_build_object('allowed', false, 'reason', 'scope_not_held',
                              'scope', 'aggregate_production');
  end if;

  select coalesce((settings->>'institutional_min_group_size')::int, 5)
    into v_min from public.platform_config where id = 1;

  select coalesce(jsonb_agg(r order by r->>'state'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'state', f.state,
             'verified_farms', count(*) filter (where f.verification_status = 'verified'),
             'total_hectares_declared', round(sum(f.size_hectares), 1),
             'commodities', count(distinct c.crop),
             'batches', count(distinct b.id)) as r
    from public.farms f
    left join public.crop_records c on c.farm_id = f.id
    left join public.commodity_batches b on b.farm_id = f.id
    group by f.state
    having count(distinct f.id) >= v_min
  ) q;

  perform public.loamy_log_institutional_query('aggregate_production', 'production',
            '{}'::jsonb, true, jsonb_array_length(v_rows));
  return jsonb_build_object('allowed', true, 'min_group_size', v_min, 'rows', v_rows);
end;
$$;

create or replace function public.loamy_institutional_trade()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_min int; v_rows jsonb;
begin
  if not (public.loamy_has_institutional_scope('aggregate_trade') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('aggregate_trade', 'trade', '{}'::jsonb, false, 0);
    return jsonb_build_object('allowed', false, 'reason', 'scope_not_held', 'scope', 'aggregate_trade');
  end if;

  select coalesce((settings->>'institutional_min_group_size')::int, 5)
    into v_min from public.platform_config where id = 1;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'state', coalesce(b.origin_state, t.delivery_state),
             'commodity', t.commodity,
             'transactions', count(*),
             'total_quantity', round(sum(t.quantity), 2),
             'unit', min(t.unit)) as r
    from public.transactions t
    left join public.commodity_batches b on b.id = t.batch_id
    where t.status = 'completed'
    group by coalesce(b.origin_state, t.delivery_state), t.commodity
    -- Volume is policy-relevant; VALUE is commercial and is deliberately absent.
    having count(*) >= v_min
  ) q;

  perform public.loamy_log_institutional_query('aggregate_trade', 'trade',
            '{}'::jsonb, true, jsonb_array_length(v_rows));
  return jsonb_build_object('allowed', true, 'min_group_size', v_min, 'rows', v_rows);
end;
$$;

create or replace function public.loamy_institutional_storage()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_min int; v_rows jsonb;
begin
  if not (public.loamy_has_institutional_scope('aggregate_storage') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('aggregate_storage', 'storage', '{}'::jsonb, false, 0);
    return jsonb_build_object('allowed', false, 'reason', 'scope_not_held', 'scope', 'aggregate_storage');
  end if;

  select coalesce((settings->>'institutional_min_group_size')::int, 5)
    into v_min from public.platform_config where id = 1;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'state', d.state,
             'facilities', count(distinct d.id),
             'capacity_tonnes', round(coalesce(sum(d.capacity_tonnes), 0), 1),
             'receipts', count(r2.id)) as r
    from public.service_directory d
    left join public.warehouse_receipts r2 on r2.facility_id = d.id
    where d.service_type = 'warehouse'
    group by d.state
    having count(distinct d.id) >= v_min
  ) q;

  perform public.loamy_log_institutional_query('aggregate_storage', 'storage',
            '{}'::jsonb, true, jsonb_array_length(v_rows));
  return jsonb_build_object('allowed', true, 'min_group_size', v_min, 'rows', v_rows);
end;
$$;

-- Trace lookup: same treatment, same reason.
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
    return jsonb_build_object('allowed', false, 'reason', 'scope_not_held', 'scope', 'trace_lookup');
  end if;

  select entity_id into v_batch_id from public.loamy_entity_refs
  where ref = upper(trim(p_ref)) and entity_type = 'commodity_batch';

  if v_batch_id is null then
    perform public.loamy_log_institutional_query('trace_lookup', 'trace',
              jsonb_build_object('ref', p_ref), true, 0);
    return jsonb_build_object('allowed', true, 'found', false, 'reason', 'no_such_reference');
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
    'allowed', true, 'found', true, 'scope', 'institutional',
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

comment on function public.loamy_institutional_trace(text) is
  'Institutional trace. Returns {allowed,...} rather than raising, so the refusal audit row survives -- a raise would roll it back.';
