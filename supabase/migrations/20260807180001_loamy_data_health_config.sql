-- ============================================================================
-- Per-dataset data-health thresholds + per-commodity price coverage
-- ============================================================================
-- Replaces the single global 60-day staleness rule with configurable per-dataset
-- thresholds (in days). `market_events` uses null = no threshold, because the
-- absence of events is normal (we show "no events since <date>", not a warning).
-- ============================================================================

alter table public.platform_config
  add column if not exists data_health jsonb not null default '{
    "ambassador_submissions": 3,
    "historical_prices": 120,
    "macro": 90,
    "market_events": null
  }'::jsonb;

-- Backfill the single existing row if the column was just added empty.
update public.platform_config
set data_health = '{
  "ambassador_submissions": 3,
  "historical_prices": 120,
  "macro": 90,
  "market_events": null
}'::jsonb
where id = 1 and (data_health is null or data_health = '{}'::jsonb);

-- Per-commodity / per-price-type coverage so we can see which series end early
-- (e.g. plain "Maize" retail stops 2023 while "Maize (flour)" runs to 2026).
-- Admin-only: the WHERE gate returns nothing to non-admins; the view is
-- SECURITY DEFINER (default) so it reads across the full history table.
create or replace view public.loamy_price_coverage as
  select
    commodity,
    price_type,
    min(date)   as earliest,
    max(date)   as latest,
    count(*)::int as rows
  from public.market_prices_history
  where public.loamy_is_admin()
  group by commodity, price_type;

grant select on public.loamy_price_coverage to authenticated;
