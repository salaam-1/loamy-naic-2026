-- ============================================================================
-- Loamy Platform · Stage 3 · Migration 2 of 5
-- `listings`: commodity listings (farmers/traders) and input listings
-- (input suppliers). NO payments, NO checkout, NO carts — buyers express
-- interest and deals conclude off-platform on bank rails.
-- ============================================================================

create table if not exists public.listings (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references public.profiles (id) on delete cascade,
  listing_type   text not null check (listing_type in ('commodity','input')),
  -- Commodity listings come from the fixed taxonomy (NO livestock, enforced
  -- here); input listings use a free-text category (e.g. "NPK Fertilizer 50kg").
  commodity      text not null,
  constraint listings_commodity_taxonomy check (
    listing_type <> 'commodity' or commodity in (
      'Maize','Rice','Sorghum','Millet','Soybeans','Cowpea','Groundnut',
      'Sesame','Cassava','Yam','Cocoa','Cashew','Ginger','Chili Pepper','Hibiscus'
    )
  ),
  quantity_kg    numeric not null check (quantity_kg > 0),
  unit           text not null default 'kg' check (unit in ('kg','bags','litres','units')),
  price_per_unit numeric not null check (price_per_unit > 0),
  currency       text not null default 'NGN',
  state          text not null,
  lga            text,
  description    text,
  photos         text[] not null default '{}',
  status         text not null default 'active'
    check (status in ('active','paused','sold','expired')),
  available_from date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists listings_browse_idx on public.listings (status, created_at desc);
create index if not exists listings_seller_idx on public.listings (seller_id);
create index if not exists listings_commodity_idx on public.listings (commodity);

-- SECURITY-REVIEW: listings are the platform's most public data. Reads expose
-- the listing itself; seller identity on cards comes ONLY from
-- loamy_public_profiles (name/category/state/badge) — never phone or email.
-- Verify no future join pulls contact fields onto a listing surface.
alter table public.listings enable row level security;

-- Everyone signed in browses ACTIVE listings; sellers see all their own.
drop policy if exists "loamy_listings_select" on public.listings;
create policy "loamy_listings_select"
  on public.listings for select to authenticated
  using (status = 'active' or seller_id = auth.uid() or public.loamy_is_admin());

drop policy if exists "loamy_listings_insert_own" on public.listings;
create policy "loamy_listings_insert_own"
  on public.listings for insert to authenticated
  with check (seller_id = auth.uid());

drop policy if exists "loamy_listings_update_own" on public.listings;
create policy "loamy_listings_update_own"
  on public.listings for update to authenticated
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid());

drop policy if exists "loamy_listings_delete_own" on public.listings;
create policy "loamy_listings_delete_own"
  on public.listings for delete to authenticated
  using (seller_id = auth.uid());

drop policy if exists "loamy_listings_admin_update" on public.listings;
create policy "loamy_listings_admin_update"
  on public.listings for update to authenticated
  using (public.loamy_is_admin())
  with check (public.loamy_is_admin());

drop trigger if exists loamy_listings_updated_at on public.listings;
create trigger loamy_listings_updated_at
  before update on public.listings
  for each row execute function public.loamy_set_updated_at();

-- ----------------------------------------------------------------------------
-- Listing photo storage: public-read (photos are the marketplace), writes
-- scoped to the seller's own folder.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

-- SECURITY-REVIEW: public-read bucket for LISTING PHOTOS ONLY — nothing
-- identity-related may ever be uploaded here (verification evidence uses a
-- PRIVATE bucket in Stage 4). Writes are path-scoped to auth.uid()'s folder.
drop policy if exists "loamy_listing_photos_insert_own" on storage.objects;
create policy "loamy_listing_photos_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "loamy_listing_photos_update_own" on storage.objects;
create policy "loamy_listing_photos_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "loamy_listing_photos_delete_own" on storage.objects;
create policy "loamy_listing_photos_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
