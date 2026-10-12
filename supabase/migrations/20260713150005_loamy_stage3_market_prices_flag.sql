-- ============================================================================
-- Loamy Platform · Stage 3 · Migration 5 of 5
-- `market_prices`: ADMIN-ENTERED reference prices (the honest pilot-period
-- Market Intelligence — if no prices are entered, the UI shows an empty
-- state; prices are never invented). Then flip the `marketplace` flag ON.
-- ============================================================================

create table if not exists public.market_prices (
  id            uuid primary key default gen_random_uuid(),
  commodity     text not null check (commodity in (
    'Maize','Rice','Sorghum','Millet','Soybeans','Cowpea','Groundnut',
    'Sesame','Cassava','Yam','Cocoa','Cashew','Ginger','Chili Pepper','Hibiscus'
  )),
  state         text, -- null = national reference
  price_per_kg  numeric not null check (price_per_kg > 0),
  recorded_date date not null default current_date,
  source_note   text,
  entered_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists market_prices_lookup_idx
  on public.market_prices (commodity, recorded_date desc);

alter table public.market_prices enable row level security;

-- Every signed-in user reads reference prices.
drop policy if exists "loamy_market_prices_select" on public.market_prices;
create policy "loamy_market_prices_select"
  on public.market_prices for select to authenticated
  using (true);

-- Admin-only writes (entry form lives in the admin shell).
drop policy if exists "loamy_market_prices_insert_admin" on public.market_prices;
create policy "loamy_market_prices_insert_admin"
  on public.market_prices for insert to authenticated
  with check (public.loamy_is_admin() and entered_by = auth.uid());

drop policy if exists "loamy_market_prices_delete_admin" on public.market_prices;
create policy "loamy_market_prices_delete_admin"
  on public.market_prices for delete to authenticated
  using (public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- Stage 3 ships the marketplace: flip the feature flag ON.
-- ----------------------------------------------------------------------------
update public.platform_config
set flags = flags || '{"marketplace": true}'::jsonb
where id = 1;
