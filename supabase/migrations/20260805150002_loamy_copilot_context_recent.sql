-- ============================================================================
-- Refine loamy_copilot_price_context: the current-month "normal range" must use
-- the LAST 5 YEARS, not all history. Nominal price levels are dominated by naira
-- devaluation (see HANDOFF backtest note), so a range across 12 years is
-- meaninglessly wide. The seasonal SHAPE (cheapest/dearest month) stays over all
-- history (that's a within-year relative pattern, unaffected by the level).
-- ============================================================================
create or replace function public.loamy_copilot_price_context(
  p_commodity text,
  p_state text default null,
  p_price_type text default 'retail'
) returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select h.date, h.price_ngn_per_kg::numeric as p,
           extract(month from h.date)::int as m, extract(year from h.date)::int as y
    from public.loamy_copilot_prices h
    where lower(h.commodity) = lower(p_commodity)
      and h.price_type = p_price_type
      and (p_state is null or lower(h.state) = lower(p_state))
  ),
  bounds  as (select min(y) miny, max(y) maxy, count(*) c from base),
  monthly as (select m, avg(p) avg_p, count(*) n from base group by m),
  latest  as (select date, p from base order by date desc limit 1),
  curmonth as (
    select min(p) lo, max(p) hi, avg(p) av, count(distinct y) yrs
    from base
    where m = extract(month from now())::int
      and y >= (select maxy from bounds) - 4        -- last 5 years only
  )
  select case when (select c from bounds) = 0 then null else jsonb_build_object(
    'row_count',      (select c from bounds),
    'latest_date',    (select date from latest),
    'latest_per_kg',  (select round(p,2) from latest),
    'years_from',     (select miny from bounds),
    'years_to',       (select maxy from bounds),
    'cur_month',      extract(month from now())::int,
    'cur_month_low',  (select round(lo,2) from curmonth),
    'cur_month_high', (select round(hi,2) from curmonth),
    'cur_month_avg',  (select round(av,2) from curmonth),
    'cur_month_years',(select yrs from curmonth),
    'cheapest_month', (select m from monthly order by avg_p asc limit 1),
    'dearest_month',  (select m from monthly order by avg_p desc limit 1),
    'monthly',        (select jsonb_agg(jsonb_build_object('month',m,'avg',round(avg_p,2),'n',n) order by m) from monthly)
  ) end;
$$;
