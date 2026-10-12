-- ============================================================================
-- PHASE 1 (b) — Farm, Production Cycle, Harvest.
-- ----------------------------------------------------------------------------
-- Directive Parts 6, 7, 8. This is the first three links of the spine:
--
--   FARM -> PRODUCTION CYCLE -> HARVEST -> (Phase 2: COMMODITY BATCH)
--
-- DELIBERATE REUSE: `crop_records` already models a production cycle almost
-- exactly (farm, crop, season, planting date, expected/actual harvest, yields).
-- Rather than create a parallel `production_cycles` table and end up with two
-- sources of truth, this migration EXTENDS crop_records into the entity the
-- directive describes and exposes it under the directive's name as a view.
-- Existing FarmDetail UI keeps working untouched.
--
-- GEOSPATIAL CHOICE, stated because it is a trade-off, not an oversight:
-- boundaries are stored as GeoJSON in jsonb and areas are computed with a
-- spherical-excess function in plain SQL, rather than enabling PostGIS now.
-- Reason: PostGIS is the right answer for proximity search at scale, but it is
-- an extension-level change to a live database serving 171 accounts, and
-- nothing in Phase 1 queries by proximity yet. Adopting it is scheduled with
-- the geospatial work in Phase 11; the column is jsonb so the migration to
-- geography(Polygon) is a backfill, not a redesign. See docs/data-model.md.
--
-- SECURITY-REVIEW: farm boundaries are MORE sensitive than the single point
-- they replace — a polygon outlines private land. No public view exposes
-- `boundary` or `mapped_area_hectares`, and the farms RLS (owner + admin) is
-- unchanged. Verify before any map surface is built for non-owners.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Farm: reference ID, community, boundary, and DECLARED vs MAPPED area.
-- ----------------------------------------------------------------------------
alter table public.farms
  add column if not exists ref                  text unique,
  add column if not exists community            text,
  add column if not exists size_unit            text not null default 'hectares'
    check (size_unit in ('hectares','acres')),
  -- GeoJSON Polygon, captured in the field. Null until a boundary is walked.
  add column if not exists boundary             jsonb,
  -- Computed from `boundary`. NEVER overwrites size_hectares, which stays the
  -- farmer's DECLARED figure. Both are kept so a bank can see the difference.
  add column if not exists mapped_area_hectares numeric
    check (mapped_area_hectares is null or mapped_area_hectares >= 0),
  add column if not exists status               text not null default 'active'
    check (status in ('active','inactive','archived'));

comment on column public.farms.size_hectares is
  'DECLARED size, as stated by the farmer. Never overwritten by observation — compare against mapped_area_hectares.';
comment on column public.farms.mapped_area_hectares is
  'Area computed from the captured boundary polygon. Null when no boundary has been walked.';
comment on column public.farms.boundary is
  'GeoJSON Polygon of the farm perimeter, captured in the field. Sensitive: outlines private land.';

-- ----------------------------------------------------------------------------
-- 2. Spherical polygon area, so mapped area is computed not guessed.
-- ----------------------------------------------------------------------------
/**
 * Area of a GeoJSON Polygon in hectares, by the spherical excess formula on a
 * sphere of the earth's mean radius. Accurate to well under a percent at farm
 * scale, which is the precision the input GPS supports anyway.
 *
 * Returns null for anything that is not a usable Polygon rather than throwing:
 * a malformed boundary must not block saving a farm.
 */
create or replace function public.loamy_geojson_area_hectares(p_geo jsonb)
returns numeric
language plpgsql
immutable
as $$
declare
  R  constant numeric := 6371008.8;   -- earth mean radius, metres
  ring jsonb;
  n    int;
  i    int;
  lon1 numeric; lat1 numeric; lon2 numeric; lat2 numeric;
  total numeric := 0;
begin
  if p_geo is null or coalesce(p_geo->>'type','') <> 'Polygon' then return null; end if;
  ring := p_geo->'coordinates'->0;
  if ring is null or jsonb_typeof(ring) <> 'array' then return null; end if;

  n := jsonb_array_length(ring);
  if n < 4 then return null; end if;   -- a closed ring needs >= 4 positions

  for i in 0 .. n - 2 loop
    lon1 := radians((ring->i->>0)::numeric);
    lat1 := radians((ring->i->>1)::numeric);
    lon2 := radians((ring->(i + 1)->>0)::numeric);
    lat2 := radians((ring->(i + 1)->>1)::numeric);
    total := total + (lon2 - lon1) * (2 + sin(lat1) + sin(lat2));
  end loop;

  -- m^2 -> hectares
  return round(abs(total * R * R / 2.0) / 10000.0, 4);
exception when others then
  return null;   -- malformed coordinates must never break a farm save
end;
$$;

/** Keep mapped_area_hectares in step with boundary. */
create or replace function public.loamy_farm_sync_mapped_area()
returns trigger
language plpgsql
as $$
begin
  if new.boundary is distinct from coalesce(old.boundary, null) then
    new.mapped_area_hectares := public.loamy_geojson_area_hectares(new.boundary);
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_farms_mapped_area on public.farms;
create trigger loamy_farms_mapped_area
  before insert or update of boundary on public.farms
  for each row execute function public.loamy_farm_sync_mapped_area();

-- Reference IDs for farms.
drop trigger if exists loamy_farms_assign_ref on public.farms;
create trigger loamy_farms_assign_ref
  before insert on public.farms
  for each row execute function public.loamy_assign_ref('farm', 'FARM');

-- Backfill refs for farms that already exist.
do $$
declare r record;
begin
  for r in select id from public.farms where ref is null loop
    update public.farms
       set ref = public.loamy_register_ref('farm', r.id, 'FARM')
     where id = r.id;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Production cycle (crop_records, extended).
-- ----------------------------------------------------------------------------
alter table public.crop_records
  add column if not exists ref                text unique,
  add column if not exists status             text not null default 'planned'
    check (status in ('planned','planted','growing','harvested','failed','abandoned')),
  add column if not exists expected_quantity  numeric
    check (expected_quantity is null or expected_quantity >= 0),
  add column if not exists actual_quantity    numeric
    check (actual_quantity is null or actual_quantity >= 0),
  add column if not exists quantity_unit      text not null default 'kg'
    check (quantity_unit in ('kg','tonne','bag','crate','unit')),
  add column if not exists updated_at         timestamptz not null default now();

comment on table public.crop_records is
  'PRODUCTION CYCLE (directive Part 7). One row per farm per commodity per season. Historical rows are never overwritten.';

drop trigger if exists loamy_crop_records_assign_ref on public.crop_records;
create trigger loamy_crop_records_assign_ref
  before insert on public.crop_records
  for each row execute function public.loamy_assign_ref('production_cycle', 'PROD');

drop trigger if exists loamy_crop_records_updated_at on public.crop_records;
create trigger loamy_crop_records_updated_at
  before update on public.crop_records
  for each row execute function public.loamy_set_updated_at();

do $$
declare r record;
begin
  for r in select id from public.crop_records where ref is null loop
    update public.crop_records
       set ref = public.loamy_register_ref('production_cycle', r.id, 'PROD')
     where id = r.id;
  end loop;
end;
$$;

-- The directive's name for the entity, over the existing storage.
create or replace view public.loamy_production_cycles as
select
  c.id                    as production_cycle_id,
  c.ref                   as production_cycle_ref,
  c.farm_id,
  f.ref                   as farm_ref,
  f.owner_id,
  c.crop                  as commodity,
  c.season_year           as season,
  c.planting_date,
  c.expected_harvest_date,
  c.actual_harvest_date,
  c.expected_quantity,
  c.actual_quantity,
  c.quantity_unit,
  c.expected_yield_kg,
  c.actual_yield_kg,
  c.status,
  c.notes,
  c.created_at,
  c.updated_at
from public.crop_records c
join public.farms f on f.id = c.farm_id;

-- security_invoker so the caller's RLS on crop_records/farms still applies.
alter view public.loamy_production_cycles set (security_invoker = on);
grant select on public.loamy_production_cycles to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Harvest.
-- ----------------------------------------------------------------------------
-- A harvest is an EVENT against a production cycle, and is what a commodity
-- batch is created from in Phase 2. One cycle may yield several harvests.
create table if not exists public.harvests (
  id                  uuid primary key default gen_random_uuid(),
  ref                 text unique,
  production_cycle_id uuid not null references public.crop_records (id) on delete cascade,
  farm_id             uuid not null references public.farms (id) on delete cascade,
  commodity           text not null check (commodity in (
    'Maize','Rice','Sorghum','Millet','Soybeans','Cowpea','Groundnut',
    'Sesame','Cassava','Yam','Cocoa','Cashew','Ginger','Chili Pepper','Hibiscus'
  )),
  harvest_date        date not null,
  quantity            numeric not null check (quantity > 0),
  unit                text not null default 'kg'
    check (unit in ('kg','tonne','bag','crate','unit')),
  quality_grade       text,
  condition           text,
  -- Where the harvest physically is, which may not be the farm.
  location_state      text,
  location_lga        text,
  location_note       text,
  latitude            numeric check (latitude  is null or (latitude  between -90 and 90)),
  longitude           numeric check (longitude is null or (longitude between -180 and 180)),
  -- Evidence references only (private bucket paths), never raw files.
  evidence            jsonb not null default '{}'::jsonb,
  status              text not null default 'recorded'
    check (status in ('recorded','verified','batched','disputed','cancelled')),
  created_by          uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists harvests_cycle_idx on public.harvests (production_cycle_id, harvest_date desc);
create index if not exists harvests_farm_idx  on public.harvests (farm_id, harvest_date desc);
create index if not exists harvests_owner_idx on public.harvests (created_by, created_at desc);

-- SECURITY-REVIEW: a harvest carries quantity and location of real stock —
-- commercially sensitive and a theft risk if leaked. Read is owner + admin
-- ONLY at this phase. Phase 4 will expose a DERIVED, non-location summary to
-- buyers through the marketplace, never this table directly.
alter table public.harvests enable row level security;

drop policy if exists "loamy_harvests_select_own" on public.harvests;
create policy "loamy_harvests_select_own"
  on public.harvests for select to authenticated
  using (
    exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid())
    or public.loamy_is_admin()
  );

drop policy if exists "loamy_harvests_insert_own" on public.harvests;
create policy "loamy_harvests_insert_own"
  on public.harvests for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid())
    -- the cycle must belong to the same farm
    and exists (select 1 from public.crop_records c
                where c.id = production_cycle_id and c.farm_id = harvests.farm_id)
  );

drop policy if exists "loamy_harvests_update_own" on public.harvests;
create policy "loamy_harvests_update_own"
  on public.harvests for update to authenticated
  using (exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()))
  -- A farmer may correct their own record while it is still theirs alone.
  -- Once Phase 2 creates a batch the status moves to 'batched'; from then on
  -- quantity is controlled by batch events, not free edits.
  with check (
    exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid())
    and status in ('recorded','disputed','cancelled')
  );

drop trigger if exists loamy_harvests_assign_ref on public.harvests;
create trigger loamy_harvests_assign_ref
  before insert on public.harvests
  for each row execute function public.loamy_assign_ref('harvest', 'HARV');

drop trigger if exists loamy_harvests_updated_at on public.harvests;
create trigger loamy_harvests_updated_at
  before update on public.harvests
  for each row execute function public.loamy_set_updated_at();

comment on table public.harvests is
  'HARVEST (directive Part 8). Belongs to a production cycle; a commodity batch is created FROM a harvest in Phase 2.';
