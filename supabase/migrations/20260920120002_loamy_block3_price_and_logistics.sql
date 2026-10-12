-- ============================================================================
-- BLOCK 3 (b) — honest price comparison, and honest logistics estimates.
-- ----------------------------------------------------------------------------
-- Two numbers on a listing card can mislead a buyer more effectively than any
-- amount of bad copy:
--
--   "5% cheaper"            -- cheaper than WHAT? Measured WHEN?
--   "Logistics: N42/kg"     -- from where? Or invented?
--
-- So both are built to refuse rather than to guess.
--
-- PRICE. There is no national benchmark, because there is no national market.
-- A reference is always a NAMED market on a DATED observation, and the label
-- carries both. A comparison across incompatible units is refused outright --
-- comparing N/kg against a N/100kg reference is a 100x error that looks
-- entirely plausible on a card.
--
-- LOGISTICS. An estimate comes from observed selected offers on the SAME
-- CORRIDOR, or it does not come at all. Below a minimum number of
-- observations the answer is available=false with a reason, never a plausible
-- number with no evidence behind it. A landed cost built on a fabricated
-- freight rate is worse than no landed cost, because the buyer will act on it.
-- ============================================================================

-- Units the marketplace actually uses, so conversion never silently fails.
insert into public.commodity_units (commodity, unit_name, kg_equivalent) values
  (null,'tonne',1000), (null,'tonnes',1000), (null,'mt',1000),
  (null,'bags',100), (null,'ton',1000)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 1. Unit conversion, or an explicit refusal.
-- ----------------------------------------------------------------------------
/**
 * kg per unit, or NULL when the unit is not a mass at all.
 *
 * 'litres' and 'units' are deliberately unconvertible: a price per litre
 * cannot be compared with a grain reference, and pretending otherwise is the
 * kind of error that only shows up after someone has bought.
 */
create or replace function public.loamy_unit_kg(p_unit text, p_commodity text default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select kg_equivalent
  from public.commodity_units
  where active
    and lower(unit_name) = lower(trim(coalesce(p_unit, '')))
    and (commodity is null or commodity = p_commodity)
  order by (commodity is not null) desc
  limit 1;
$$;

grant execute on function public.loamy_unit_kg(text,text) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 2. The reference price — always a named market, always dated.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_reference_price(
  p_commodity text,
  p_market_state text,
  p_max_age_days int default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r        public.market_price_updates%rowtype;
  v_kg     numeric;
  v_age    int;
  v_n      int;
begin
  if p_commodity is null or p_market_state is null then
    -- Refusing here is the point. A reference with no market is a national
    -- benchmark, and Loamy does not have one.
    return jsonb_build_object('available', false, 'reason', 'no_market_specified',
      'message', 'A price reference needs a named market.');
  end if;

  select * into r
  from public.market_price_updates
  where commodity = p_commodity and state = p_market_state
  order by recorded_date desc, created_at desc
  limit 1;

  if r.id is null then
    return jsonb_build_object('available', false, 'reason', 'no_reference_data',
      'market', p_market_state, 'commodity', p_commodity,
      'message', format('No %s price has been recorded for %s.', p_commodity, p_market_state));
  end if;

  v_kg := public.loamy_unit_kg(r.unit, p_commodity);
  if v_kg is null then
    return jsonb_build_object('available', false, 'reason', 'unit_not_convertible',
      'market', p_market_state, 'unit', r.unit);
  end if;

  v_age := (current_date - r.recorded_date);

  select count(*) into v_n
  from public.market_price_updates
  where commodity = p_commodity and state = p_market_state
    and recorded_date = r.recorded_date;

  return jsonb_build_object(
    'available', true,
    'commodity', p_commodity,
    'market', p_market_state,
    -- The label a UI may print. It NAMES the market, always.
    'label', p_market_state || ' reference',
    'price_min_per_kg', round(r.price_min / v_kg, 4),
    'price_max_per_kg', round(r.price_max / v_kg, 4),
    'midpoint_per_kg', round(((r.price_min + r.price_max) / 2.0) / v_kg, 4),
    'source_unit', r.unit,
    'recorded_date', r.recorded_date,
    'age_days', v_age,
    -- Stale is reported, not hidden. A 60-day-old price may still be the best
    -- available, but the buyer decides that, not the query.
    'stale', v_age > greatest(1, coalesce(p_max_age_days, 30)),
    'observations_that_day', v_n);
end;
$$;

grant execute on function public.loamy_reference_price(text,text,int) to authenticated, anon;

comment on function public.loamy_reference_price(text,text,int) is
  'BLOCK 3. A reference price is a NAMED market on a DATED observation. Refuses when no market is given -- there is no national benchmark.';

-- ----------------------------------------------------------------------------
-- 3. The comparison — transparent, or absent.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_price_comparison(
  p_price_per_unit numeric,
  p_unit           text,
  p_commodity      text,
  p_market_state   text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ref  jsonb := public.loamy_reference_price(p_commodity, p_market_state);
  v_kg   numeric;
  v_per_kg numeric;
  v_mid  numeric;
  v_diff numeric;
begin
  if not (v_ref->>'available')::boolean then
    return jsonb_build_object('comparable', false,
      'reason', v_ref->>'reason', 'message', v_ref->>'message');
  end if;

  v_kg := public.loamy_unit_kg(p_unit, p_commodity);
  if v_kg is null then
    -- e.g. a price per litre against a grain reference.
    return jsonb_build_object('comparable', false, 'reason', 'unit_not_convertible',
      'message', format('A price per %s cannot be compared with a %s reference.',
                        p_unit, v_ref->>'source_unit'));
  end if;
  if coalesce(p_price_per_unit, 0) <= 0 then
    return jsonb_build_object('comparable', false, 'reason', 'no_price');
  end if;

  v_per_kg := p_price_per_unit / v_kg;
  v_mid    := (v_ref->>'midpoint_per_kg')::numeric;
  if v_mid is null or v_mid = 0 then
    return jsonb_build_object('comparable', false, 'reason', 'no_reference_data');
  end if;

  v_diff := round(((v_per_kg - v_mid) / v_mid) * 100, 2);

  return jsonb_build_object(
    'comparable', true,
    'price_per_kg', round(v_per_kg, 4),
    'reference_per_kg', v_mid,
    'market', v_ref->>'market',
    'recorded_date', v_ref->>'recorded_date',
    'stale', (v_ref->>'stale')::boolean,
    'difference_percent', v_diff,
    'direction', case when v_diff < 0 then 'below' when v_diff > 0 then 'above' else 'level' end,
    -- The label a UI prints. The market is IN it, so a Kano reference can
    -- never be rendered as a national one by a careless template.
    'label', case
               when v_diff = 0 then format('level with %s reference', v_ref->>'market')
               else format('%s%% %s %s reference',
                           to_char(abs(v_diff), 'FM990.0'),
                           case when v_diff < 0 then 'below' else 'above' end,
                           v_ref->>'market')
             end);
end;
$$;

grant execute on function public.loamy_price_comparison(numeric,text,text,text) to authenticated, anon;

comment on function public.loamy_price_comparison(numeric,text,text,text) is
  'BLOCK 3. Every comparison carries its market and its date in the label itself, so a Kano reference cannot be rendered as a national benchmark.';

-- ----------------------------------------------------------------------------
-- 4. Logistics — observed, or unavailable.
-- ----------------------------------------------------------------------------
/**
 * The per-kg freight rate actually paid on this corridor, from SELECTED
 * offers on DELIVERED jobs. Below the minimum sample it refuses.
 *
 * The minimum lives in platform_config so it can be raised once there is more
 * data, rather than being a number buried in a function.
 */
create or replace function public.loamy_logistics_estimate(
  p_from_state text,
  p_to_state   text,
  p_quantity   numeric default null,
  p_unit       text default null,
  p_commodity  text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min_n  int;
  v_n      int;
  v_median numeric;
  v_low    numeric;
  v_high   numeric;
  v_kg     numeric;
  v_total  numeric;
begin
  if p_from_state is null or p_to_state is null then
    return jsonb_build_object('available', false, 'reason', 'no_corridor');
  end if;

  select coalesce((settings->>'logistics_min_observations')::int, 3)
    into v_min_n from public.platform_config where id = 1;
  v_min_n := coalesce(v_min_n, 3);

  -- Rate per kg on each comparable completed job.
  with observed as (
    select o.price / nullif(j.quantity * public.loamy_unit_kg(j.unit, j.commodity), 0) as rate_per_kg
    from public.transport_offers o
    join public.transport_jobs j on j.id = o.transport_job_id
    where o.status = 'selected'
      and j.delivered_at is not null
      and j.pickup_state = p_from_state
      and j.dropoff_state = p_to_state
      and j.quantity is not null and j.quantity > 0
  )
  select count(*),
         percentile_cont(0.5) within group (order by rate_per_kg),
         percentile_cont(0.25) within group (order by rate_per_kg),
         percentile_cont(0.75) within group (order by rate_per_kg)
    into v_n, v_median, v_low, v_high
  from observed where rate_per_kg is not null and rate_per_kg > 0;

  if coalesce(v_n, 0) < v_min_n then
    -- No number at all. A plausible-looking guess here becomes a landed cost
    -- the buyer plans around.
    return jsonb_build_object(
      'available', false,
      'reason', 'insufficient_corridor_data',
      'observations', coalesce(v_n, 0),
      'minimum_required', v_min_n,
      'from_state', p_from_state, 'to_state', p_to_state,
      'message', format('Loamy has not carried enough %s to %s loads to estimate freight.',
                        p_from_state, p_to_state));
  end if;

  v_kg := public.loamy_unit_kg(p_unit, p_commodity);
  if p_quantity is not null and v_kg is not null then
    v_total := round(v_median * p_quantity * v_kg, 2);
  end if;

  return jsonb_build_object(
    'available', true,
    'basis', 'observed_selected_offers_on_delivered_jobs',
    'from_state', p_from_state, 'to_state', p_to_state,
    'observations', v_n,
    'rate_per_kg', round(v_median, 4),
    'rate_per_kg_low', round(v_low, 4),
    'rate_per_kg_high', round(v_high, 4),
    'estimated_total', v_total,
    'label', format('Estimated from %s past %s→%s load(s)', v_n, p_from_state, p_to_state));
end;
$$;

grant execute on function public.loamy_logistics_estimate(text,text,numeric,text,text) to authenticated, anon;

comment on function public.loamy_logistics_estimate(text,text,numeric,text,text) is
  'BLOCK 3. Freight from OBSERVED selected offers on delivered jobs for the same corridor. Refuses below the minimum sample rather than guessing.';
