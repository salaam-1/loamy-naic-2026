-- ============================================================================
-- BLOCK 7 (b) — demand, supply, funnel and seasonality.
-- ----------------------------------------------------------------------------
-- Every function here obeys four rules, and each exists because it is a way
-- an agricultural marketplace routinely misleads people.
--
-- 1. NO SIGNAL WITHOUT ITS POPULATION, PERIOD AND PLACE. "Hottest commodity"
--    is not a claim, it is a mood. "17 completed maize transactions in Lagos
--    in the last 30 days, from 86 searches" is a claim someone can check.
--
-- 2. A K-ANONYMITY FLOOR THAT WITHHOLDS. Below the threshold the answer is
--    "insufficient data", never a rounded band -- a range still narrows the
--    field when only two people are in it.
--
-- 3. LISTED, VERIFIED AND TRANSACTED SUPPLY ARE THREE DIFFERENT NUMBERS
--    (directive 9). Anyone can list 500 tonnes. A verified batch is stock an
--    agent physically saw. A completed transaction is stock that moved.
--    Collapsing them is how a platform reports supply that does not exist.
--
-- 4. VIEWS ARE NOT DEMAND. Every signal is weighted through the evidence
--    hierarchy and returns that arithmetic, so nobody has to trust the
--    number.
--
-- These are OBSERVATIONS, computed from records. Nothing here forecasts.
-- ============================================================================

create or replace function public.loamy_min_group_size()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((settings->>'institutional_min_group_size')::int, 5)
  from public.platform_config where id = 1;
$$;

grant execute on function public.loamy_min_group_size() to authenticated;

-- ----------------------------------------------------------------------------
-- 1. Demand.
-- ----------------------------------------------------------------------------
/**
 * Aggregate interest in a commodity, in a place, over a period.
 *
 * Reads discovery_events across ALL actors -- which is why it is aggregate
 * only and carries a participant floor. It never returns who did anything.
 */
create or replace function public.loamy_demand_signal(
  p_commodity text,
  p_state     text default null,
  p_days      int default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since  timestamptz;
  v_min    int := public.loamy_min_group_size();
  v_people int;
  v_rows   jsonb;
  v_score  numeric := 0;
  v_txn    int := 0;
  v_total  int := 0;
  v_band   text;
begin
  if auth.uid() is null then
    return jsonb_build_object('available', false, 'reason', 'not_signed_in');
  end if;
  if p_commodity is null then
    return jsonb_build_object('available', false, 'reason', 'no_commodity',
      'message', 'A demand signal needs a commodity. There is no "overall demand".');
  end if;

  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));

  -- The participant floor is DISTINCT PEOPLE, not events: one person
  -- searching ninety times is one person.
  select count(distinct actor_id) into v_people
  from public.discovery_events
  where commodity = p_commodity
    and (p_state is null or state = p_state)
    and occurred_at >= v_since;

  if coalesce(v_people, 0) < v_min then
    return jsonb_build_object(
      'available', false,
      'reason', 'insufficient_data',
      'classification', 'observed',
      'participants_required', v_min,
      'commodity', p_commodity, 'state', p_state,
      'period_days', p_days,
      -- Directive 20: withheld, not rounded into a band.
      'message', 'Too few participants in this period to report without identifying them.');
  end if;

  -- The breakdown, by signal type, with its weight visible.
  select coalesce(jsonb_agg(jsonb_build_object(
           'signal', d.event_type, 'events', d.n,
           'weight', public.loamy_evidence_weight(d.event_type),
           'contribution', round(d.n * public.loamy_evidence_weight(d.event_type), 1))
           order by public.loamy_evidence_weight(d.event_type) desc), '[]'::jsonb),
         coalesce(sum(d.n * public.loamy_evidence_weight(d.event_type)), 0),
         coalesce(sum(d.n) filter (where d.event_type = 'complete_transaction'), 0),
         coalesce(sum(d.n), 0)
    into v_rows, v_score, v_txn, v_total
  from (
    select event_type, count(*) as n
    from public.discovery_events
    where commodity = p_commodity
      and (p_state is null or state = p_state)
      and occurred_at >= v_since
    group by event_type
  ) d;

  -- A band, stated as a band and never as a forecast. The thresholds are
  -- arbitrary and said to be so; what is defensible is the evidence beneath.
  v_band := case
    when v_txn >= 10 or v_score >= 1500 then 'high'
    when v_txn >= 3  or v_score >= 400  then 'medium'
    else 'low' end;

  return jsonb_build_object(
    'available', true,
    'classification', 'observed',
    'commodity', p_commodity,
    'state', coalesce(p_state, 'all states'),
    'period_days', p_days,
    'period_start', v_since,
    'period_end', now(),

    'band', v_band,
    'weighted_score', round(v_score, 1),

    -- Directive 8: population, period, location, evidence -- all of it.
    'population', jsonb_build_object(
      'participants', v_people,
      'events', v_total,
      'completed_transactions', v_txn),
    'breakdown', v_rows,

    'evidence_note', format(
      'Based on %s events from %s participants in %s over %s days, of which %s were completed transactions.',
      v_total, v_people, coalesce(p_state, 'all states'), p_days, v_txn),
    'limitations', 'Counts platform activity only. A view is weighted far below a completed transaction, and neither proves future demand.');
end;
$$;

grant execute on function public.loamy_demand_signal(text,text,int) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Supply — three different numbers, kept apart.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_supply_signal(
  p_commodity text,
  p_state     text default null,
  p_days      int default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_min   int := public.loamy_min_group_size();
  v_sellers int;
  v_listed_qty numeric; v_listed_n int;
  v_verified_qty numeric; v_verified_n int;
  v_sold_qty numeric; v_sold_n int;
begin
  if auth.uid() is null then
    return jsonb_build_object('available', false, 'reason', 'not_signed_in');
  end if;
  if p_commodity is null then
    return jsonb_build_object('available', false, 'reason', 'no_commodity');
  end if;

  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));

  select count(distinct l.seller_id) into v_sellers
  from public.listings l
  where l.commodity = p_commodity and l.status = 'active'
    and (p_state is null or l.state = p_state);

  if coalesce(v_sellers, 0) < v_min then
    return jsonb_build_object(
      'available', false, 'reason', 'insufficient_data',
      'classification', 'observed',
      'participants_required', v_min,
      'commodity', p_commodity, 'state', p_state,
      'message', 'Too few sellers in this period to report without identifying them.');
  end if;

  -- CLAIMED supply. Anyone can type a number into a listing.
  select coalesce(sum(l.quantity_kg * coalesce(public.loamy_unit_kg(l.unit, l.commodity), 1)), 0),
         count(*)
    into v_listed_qty, v_listed_n
  from public.listings l
  where l.commodity = p_commodity and l.status = 'active'
    and (p_state is null or l.state = p_state);

  -- VERIFIED supply. A Loamy agent physically saw this stock.
  select coalesce(sum(b.available_quantity * coalesce(public.loamy_unit_kg(b.unit, b.commodity), 1)), 0),
         count(*)
    into v_verified_qty, v_verified_n
  from public.commodity_batches b
  where b.commodity = p_commodity
    and b.verification_status = 'verified'
    and b.available_quantity > 0
    and (p_state is null or coalesce(b.current_state, b.origin_state) = p_state);

  -- TRANSACTED supply. Stock that actually moved.
  select coalesce(sum(t.quantity * coalesce(public.loamy_unit_kg(t.unit, t.commodity), 1)), 0),
         count(*)
    into v_sold_qty, v_sold_n
  from public.transactions t
  where t.commodity = p_commodity
    and t.status = 'completed'
    and t.created_at >= v_since;

  return jsonb_build_object(
    'available', true,
    'classification', 'observed',
    'commodity', p_commodity,
    'state', coalesce(p_state, 'all states'),
    'period_days', p_days,
    'period_start', v_since,
    'period_end', now(),

    -- Directive 9: three numbers, never one. Each says what it is.
    'listed', jsonb_build_object(
      'listings', v_listed_n, 'quantity_kg', round(v_listed_qty, 2),
      'means', 'Claimed by sellers. Not inspected.'),
    'verified', jsonb_build_object(
      'batches', v_verified_n, 'quantity_kg', round(v_verified_qty, 2),
      'means', 'Physically inspected by a Loamy agent and still available.'),
    'transacted', jsonb_build_object(
      'transactions', v_sold_n, 'quantity_kg', round(v_sold_qty, 2),
      'means', 'Completed sales in the period. Stock that actually moved.'),

    'population', jsonb_build_object('sellers', v_sellers),
    'evidence_note', format(
      '%s active listings from %s sellers; %s verified batches; %s completed sales in %s days.',
      v_listed_n, v_sellers, v_verified_n, v_sold_n, p_days),
    'limitations', 'Listed quantity is a seller claim. Only the verified figure has been inspected.');
end;
$$;

grant execute on function public.loamy_supply_signal(text,text,int) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The funnel — where people stop (directive 6).
-- ----------------------------------------------------------------------------
/**
 * Administrative. The point is finding friction, not predicting anything, so
 * it reports counts and drop-off and explicitly declines to forecast.
 */
create or replace function public.loamy_conversion_funnel(
  p_commodity text default null,
  p_days      int default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_steps jsonb := '[]'::jsonb;
  v_prev  int := null;
  r       record;
begin
  if not public.loamy_is_admin() then
    raise exception 'Funnel analytics are administrative.';
  end if;

  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));

  for r in
    with counts as (
      select 'search' as step, 1 as ord,
             count(distinct actor_id) as people, count(*) as events
        from public.discovery_events
       where event_type = 'search' and occurred_at >= v_since
         and (p_commodity is null or commodity = p_commodity)
      union all
      select 'view_listing', 2, count(distinct actor_id), count(*)
        from public.discovery_events
       where event_type = 'view_listing' and occurred_at >= v_since
         and (p_commodity is null or commodity = p_commodity)
      union all
      select 'add_to_cart', 3, count(distinct actor_id), count(*)
        from public.discovery_events
       where event_type = 'add_to_cart' and occurred_at >= v_since
         and (p_commodity is null or commodity = p_commodity)
      union all
      select 'request_financing', 4, count(distinct actor_id), count(*)
        from public.discovery_events
       where event_type = 'request_financing' and occurred_at >= v_since
         and (p_commodity is null or commodity = p_commodity)
      union all
      select 'complete_transaction', 5, count(distinct actor_id), count(*)
        from public.discovery_events
       where event_type = 'complete_transaction' and occurred_at >= v_since
         and (p_commodity is null or commodity = p_commodity)
    )
    select * from counts order by ord
  loop
    v_steps := v_steps || jsonb_build_object(
      'step', r.step,
      'people', r.people,
      'events', r.events,
      'drop_off_from_previous',
        case when v_prev is null or v_prev = 0 then null
             else round(100.0 * (v_prev - r.people) / v_prev, 1) end);
    v_prev := r.people;
  end loop;

  return jsonb_build_object(
    'available', true,
    'classification', 'observed',
    'commodity', coalesce(p_commodity, 'all commodities'),
    'period_days', p_days,
    'period_start', v_since,
    'steps', v_steps,
    'limitations', 'Counts distinct people at each step in the period. People do not have to pass through every step in order, so this shows where activity thins out -- not a prediction and not a guaranteed path.');
end;
$$;

revoke all on function public.loamy_conversion_funnel(text,int) from public, anon;
grant execute on function public.loamy_conversion_funnel(text,int) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Price history and seasonality — observation, never forecast.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_price_history(
  p_commodity text,
  p_market    text,
  p_days      int default 180
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since date;
  v_rows  jsonb;
  v_n     int;
begin
  if p_commodity is null or p_market is null then
    return jsonb_build_object('available', false, 'reason', 'no_market_specified',
      'message', 'Price history needs a named market. There is no national series.');
  end if;

  v_since := current_date - greatest(1, least(coalesce(p_days, 180), 1095));

  select count(*) into v_n
  from public.market_price_updates
  where commodity = p_commodity and state = p_market and recorded_date >= v_since;

  if v_n = 0 then
    return jsonb_build_object('available', false, 'reason', 'no_observations',
      'commodity', p_commodity, 'market', p_market);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', m.recorded_date,
           'low_per_kg', round(m.price_min / nullif(public.loamy_unit_kg(m.unit, m.commodity), 0), 2),
           'high_per_kg', round(m.price_max / nullif(public.loamy_unit_kg(m.unit, m.commodity), 0), 2),
           -- Directive 2: each point says what KIND of data it is.
           'data_class', m.data_class,
           'market_name', m.market_name,
           'traders_sampled', m.traders_sampled)
           order by m.recorded_date), '[]'::jsonb)
    into v_rows
  from public.market_price_updates m
  where m.commodity = p_commodity and m.state = p_market and m.recorded_date >= v_since;

  return jsonb_build_object(
    'available', true,
    'classification', 'observed',
    'commodity', p_commodity,
    'market', p_market,
    'label', p_market || ' reference',
    'observations', v_n,
    'period_start', v_since,
    'period_end', current_date,
    'series', v_rows,
    'limitations', 'Recorded observations for this market only. Not a forecast, and not a national price.');
end;
$$;

grant execute on function public.loamy_price_history(text,text,int) to authenticated;

/**
 * A recurring historical pattern, reported as exactly that.
 *
 * Returns the observed range per month with its sample size, and refuses to
 * say anything at all about months with too few observations. It does not
 * predict; directive 12 is explicit that "observed historical pattern" and
 * "price will rise" are different statements, and only one of them is
 * supportable.
 */
create or replace function public.loamy_seasonal_pattern(
  p_commodity text,
  p_market    text,
  p_years     int default 3
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since date;
  v_rows  jsonb;
  v_total int;
  v_min_obs int := 3;
begin
  if p_commodity is null or p_market is null then
    return jsonb_build_object('available', false, 'reason', 'no_market_specified');
  end if;

  v_since := current_date - (greatest(1, least(coalesce(p_years, 3), 10)) * 365);

  select count(*) into v_total
  from public.market_price_updates
  where commodity = p_commodity and state = p_market and recorded_date >= v_since;

  if v_total < 12 then
    return jsonb_build_object(
      'available', false, 'reason', 'insufficient_history',
      'observations', v_total, 'minimum', 12,
      'commodity', p_commodity, 'market', p_market,
      'message', 'Not enough recorded observations to describe a seasonal pattern.');
  end if;

  select coalesce(jsonb_agg(x order by (x->>'month')::int), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'month', extract(month from recorded_date)::int,
      'month_name', to_char(recorded_date, 'Mon'),
      'observations', count(*),
      -- Below the per-month floor the month is reported as having too little
      -- data, rather than being given a spuriously precise average.
      'sufficient', count(*) >= v_min_obs,
      'avg_low_per_kg', case when count(*) >= v_min_obs
        then round(avg(price_min / nullif(public.loamy_unit_kg(unit, commodity), 0))::numeric, 2) end,
      'avg_high_per_kg', case when count(*) >= v_min_obs
        then round(avg(price_max / nullif(public.loamy_unit_kg(unit, commodity), 0))::numeric, 2) end
    ) as x
    from public.market_price_updates
    where commodity = p_commodity and state = p_market and recorded_date >= v_since
    group by extract(month from recorded_date), to_char(recorded_date, 'Mon')
  ) s;

  return jsonb_build_object(
    'available', true,
    -- This is a computation over observations, so it is labelled as such --
    -- NOT as an observation, and not as a forecast.
    'classification', 'model_inference',
    'model_key', 'monthly_mean_v1',
    'model_version', '1',
    'commodity', p_commodity,
    'market', p_market,
    'years', p_years,
    'observations', v_total,
    'period_start', v_since,
    'period_end', current_date,
    'months', v_rows,
    'headline', format('Observed historical pattern for %s in %s, from %s recorded observations.',
                       p_commodity, p_market, v_total),
    'limitations', 'A description of what WAS recorded, not a prediction of what prices will do. Months with fewer than 3 observations are reported as insufficient rather than averaged.');
end;
$$;

grant execute on function public.loamy_seasonal_pattern(text,text,int) to authenticated;
