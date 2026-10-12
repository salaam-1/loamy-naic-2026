-- ============================================================================
-- Loamy Platform · Stage 2 · Migration 2 of 4
-- `crop_records`: season-by-season history per farm. This is the data that
-- later powers the Credit Intelligence Report (Stage 5) — access through farm
-- ownership only.
-- ============================================================================

create table if not exists public.crop_records (
  id                    uuid primary key default gen_random_uuid(),
  farm_id               uuid not null references public.farms (id) on delete cascade,
  crop                  text not null check (crop in (
    'Maize','Rice','Sorghum','Millet','Soybeans','Cowpea','Groundnut',
    'Sesame','Cassava','Yam','Cocoa','Cashew','Ginger','Chili Pepper','Hibiscus'
  )),
  season_year           int not null check (season_year between 1980 and 2100),
  planting_date         date,
  expected_harvest_date date,
  actual_harvest_date   date,
  expected_yield_kg     numeric check (expected_yield_kg is null or expected_yield_kg >= 0),
  actual_yield_kg       numeric check (actual_yield_kg   is null or actual_yield_kg   >= 0),
  notes                 text,
  created_at            timestamptz not null default now()
);

create index if not exists crop_records_farm_idx on public.crop_records (farm_id, season_year desc);

-- SECURITY-REVIEW: yield history feeds credit intelligence later — it must
-- only ever be readable by the farm owner and admin. All four policies below
-- resolve access THROUGH farm ownership; verify no future policy grants
-- broader read (e.g. marketplace must never expose yields).
alter table public.crop_records enable row level security;

drop policy if exists "loamy_crop_records_select_own" on public.crop_records;
create policy "loamy_crop_records_select_own"
  on public.crop_records for select to authenticated
  using (exists (
    select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()
  ));

drop policy if exists "loamy_crop_records_select_admin" on public.crop_records;
create policy "loamy_crop_records_select_admin"
  on public.crop_records for select to authenticated
  using (public.loamy_is_admin());

drop policy if exists "loamy_crop_records_insert_own" on public.crop_records;
create policy "loamy_crop_records_insert_own"
  on public.crop_records for insert to authenticated
  with check (exists (
    select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()
  ));

drop policy if exists "loamy_crop_records_update_own" on public.crop_records;
create policy "loamy_crop_records_update_own"
  on public.crop_records for update to authenticated
  using (exists (
    select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()
  ));

drop policy if exists "loamy_crop_records_delete_own" on public.crop_records;
create policy "loamy_crop_records_delete_own"
  on public.crop_records for delete to authenticated
  using (exists (
    select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()
  ));
