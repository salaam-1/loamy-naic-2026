-- ============================================================================
-- Co-pilot v2.1 fix — the "normal range" must be RECENT (last 24 months), and
-- the seasonal pattern must be devaluation-proof.
--
-- Why: comparing today's price against a range spanning 2014–2023 is comparing
-- across a currency collapse (₦58/kg 2014 vs ₦338/kg 2023) — meaningless. So:
--   • normal range = min/max of MONTHLY averages over the last 24 months only.
--   • seasonal SHAPE = each month's average as a RATIO to that year's average,
--     then averaged across years. A ratio is level-independent, so devaluation
--     cancels out — no CPI deflation needed (the uploaded food_cpi is several
--     mixed series and not a clean index; see HANDOFF).
-- The engine applies the sanity guard (range >2.5x or <6 recent months → refuse).
-- SECURITY-REVIEW: never aggregates across price_type (p_price_type mandatory).
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
  bounds   as (select min(y) miny, max(y) maxy, count(*) c from base),
  latest   as (select date, p from base order by date desc limit 1),
  recent_m as (select date_trunc('month', date) ym, avg(p) ap
               from base where date >= (current_date - interval '24 months') group by 1),
  recent   as (select min(ap) lo, max(ap) hi, avg(ap) av, count(*) n from recent_m),
  ym_avg   as (select y, m, avg(p) ap from base group by y, m),
  yr_avg   as (select y, avg(ap) ya from ym_avg group by y),
  ratios   as (select a.m, a.ap / b.ya as r from ym_avg a join yr_avg b on b.y = a.y where b.ya > 0),
  seasonal as (select m, avg(r) idx, count(*) n from ratios group by m)
  select case when (select c from bounds) = 0 then null else jsonb_build_object(
    'row_count',      (select c from bounds),
    'years_from',     (select miny from bounds),
    'years_to',       (select maxy from bounds),
    'latest_date',    (select date from latest),
    'latest_per_kg',  (select round(p,2) from latest),
    'recent_low',     (select round(lo,2) from recent),
    'recent_high',    (select round(hi,2) from recent),
    'recent_avg',     (select round(av,2) from recent),
    'recent_months',  coalesce((select n from recent), 0),
    'cheapest_month', (select m from seasonal order by idx asc limit 1),
    'dearest_month',  (select m from seasonal order by idx desc limit 1),
    'seasonal',       (select jsonb_agg(jsonb_build_object('month', m, 'index', round(idx, 3)) order by m) from seasonal)
  ) end;
$$;
