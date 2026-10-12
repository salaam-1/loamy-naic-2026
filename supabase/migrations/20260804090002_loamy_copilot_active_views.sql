-- ============================================================================
-- Loamy Platform · Co-pilot v1 · active-batch retrieval views
-- The Co-pilot must answer only from ACTIVE upload batches so that deactivating
-- a batch (the rollback mechanism) immediately changes what it can say. Regular
-- users cannot read upload_batches (admin-only), so these views expose ONLY the
-- rows belonging to active batches, joined at the database. security_invoker so
-- the caller's RLS still applies (defence in depth) — the view only adds the
-- active-batch filter, it never widens visibility.
-- ============================================================================

create or replace view public.loamy_copilot_prices
  with (security_invoker = true) as
  select h.*
  from public.market_prices_history h
  join public.upload_batches b
    on b.id = h.upload_batch_id and b.active and b.data_type = 'prices';

create or replace view public.loamy_copilot_macro
  with (security_invoker = true) as
  select m.*
  from public.macro_context m
  join public.upload_batches b
    on b.id = m.upload_batch_id and b.active and b.data_type = 'macro';

create or replace view public.loamy_copilot_events
  with (security_invoker = true) as
  select e.*
  from public.market_events e
  join public.upload_batches b
    on b.id = e.upload_batch_id and b.active and b.data_type = 'events';

grant select on public.loamy_copilot_prices to authenticated;
grant select on public.loamy_copilot_macro to authenticated;
grant select on public.loamy_copilot_events to authenticated;
