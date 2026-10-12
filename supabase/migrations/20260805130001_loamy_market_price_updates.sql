-- ============================================================================
-- Loamy · daily market price updates (RANGES, flexible unit).
-- Real-world workflow: growth partners (field agents) and admins post daily
-- price ranges — e.g. "Soybeans ₦72,000–₦75,000 per 100kg" — not single per-kg
-- values. Feeds the marketplace price panel AND the Co-pilot's current-price
-- answer. The uploaded WFP/FAOSTAT `market_prices_history` stays the source for
-- long-run history & seasonal patterns; this table is the LIVE current price.
-- ============================================================================

-- Who may report prices: admins + growth partners (the field-agent network).
create or replace function public.loamy_can_report_prices()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.loamy_is_admin()
    or exists (select 1 from public.profiles where id = auth.uid() and platform_role = 'growth_partner');
$$;

revoke all on function public.loamy_can_report_prices() from public, anon;
grant execute on function public.loamy_can_report_prices() to authenticated;

create table if not exists public.market_price_updates (
  id           uuid primary key default gen_random_uuid(),
  commodity    text not null,
  state        text,
  unit         text not null default '100kg',
  price_min    numeric not null check (price_min >= 0),
  price_max    numeric not null check (price_max >= price_min),
  recorded_date date not null default current_date,
  source_note  text,
  recorded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists mpu_commodity_date_idx on public.market_price_updates (commodity, recorded_date desc);
create index if not exists mpu_state_commodity_idx on public.market_price_updates (state, commodity, recorded_date desc);
create index if not exists mpu_reporter_idx on public.market_price_updates (recorded_by, created_at desc);

-- SECURITY-REVIEW: everyone signed in reads current prices; only admins and
-- growth partners may post/edit (loamy_can_report_prices), and only their own
-- rows (recorded_by = auth.uid()) unless admin. No PII columns here.
alter table public.market_price_updates enable row level security;

drop policy if exists "loamy_mpu_select" on public.market_price_updates;
create policy "loamy_mpu_select"
  on public.market_price_updates for select to authenticated using (true);

drop policy if exists "loamy_mpu_insert" on public.market_price_updates;
create policy "loamy_mpu_insert"
  on public.market_price_updates for insert to authenticated
  with check (recorded_by = auth.uid() and public.loamy_can_report_prices());

drop policy if exists "loamy_mpu_update" on public.market_price_updates;
create policy "loamy_mpu_update"
  on public.market_price_updates for update to authenticated
  using (public.loamy_is_admin() or recorded_by = auth.uid())
  with check (public.loamy_is_admin() or (recorded_by = auth.uid() and public.loamy_can_report_prices()));

drop policy if exists "loamy_mpu_delete" on public.market_price_updates;
create policy "loamy_mpu_delete"
  on public.market_price_updates for delete to authenticated
  using (public.loamy_is_admin() or recorded_by = auth.uid());

-- Anon-safe view for the public marketplace panel — recent updates, safe cols.
create or replace view public.loamy_public_price_updates
with (security_invoker = false) as
select id, commodity, state, unit, price_min, price_max, recorded_date, source_note
from public.market_price_updates
where recorded_date >= current_date - interval '150 days';

revoke all on public.loamy_public_price_updates from public;
grant select on public.loamy_public_price_updates to anon, authenticated;
