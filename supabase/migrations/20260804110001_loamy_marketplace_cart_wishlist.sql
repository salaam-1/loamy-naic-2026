-- ============================================================================
-- Loamy Marketplace · cart + wishlist (Stage 2 of the marketplace redesign).
-- The mockup's heart (save) and add-to-cart actions, backed by REAL per-user
-- tables. Both are strictly private: a member only ever sees their own rows.
-- Checkout / orders / escrow are later stages — these tables just hold intent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- wishlists — a member's saved listings (the heart icon). One row per pair.
-- ----------------------------------------------------------------------------
create table if not exists public.wishlists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

create index if not exists wishlists_user_idx on public.wishlists (user_id, created_at desc);

-- SECURITY-REVIEW: wishlists are private to their owner. Only rows where
-- user_id = auth.uid() are ever selectable/insertable/deletable. No admin read,
-- no cross-user visibility. Verify a second account sees nothing.
alter table public.wishlists enable row level security;

drop policy if exists "loamy_wishlists_select_own" on public.wishlists;
create policy "loamy_wishlists_select_own"
  on public.wishlists for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "loamy_wishlists_insert_own" on public.wishlists;
create policy "loamy_wishlists_insert_own"
  on public.wishlists for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "loamy_wishlists_delete_own" on public.wishlists;
create policy "loamy_wishlists_delete_own"
  on public.wishlists for delete to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- cart_items — a buyer's cart. One row per (buyer, listing) with a desired qty.
-- ----------------------------------------------------------------------------
create table if not exists public.cart_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  quantity   numeric not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

create index if not exists cart_items_user_idx on public.cart_items (user_id, updated_at desc);

-- SECURITY-REVIEW: a cart is private to its owner (user_id = auth.uid() on every
-- verb). Insert additionally requires the target listing to be ACTIVE and NOT
-- the buyer's own listing — you cannot cart your own goods, mirroring the
-- interest-insert guard. Verify a second account cannot read or mutate the cart.
alter table public.cart_items enable row level security;

drop policy if exists "loamy_cart_select_own" on public.cart_items;
create policy "loamy_cart_select_own"
  on public.cart_items for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "loamy_cart_insert_own" on public.cart_items;
create policy "loamy_cart_insert_own"
  on public.cart_items for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.status = 'active'
        and l.seller_id <> auth.uid()
    )
  );

drop policy if exists "loamy_cart_update_own" on public.cart_items;
create policy "loamy_cart_update_own"
  on public.cart_items for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "loamy_cart_delete_own" on public.cart_items;
create policy "loamy_cart_delete_own"
  on public.cart_items for delete to authenticated
  using (user_id = auth.uid());

-- Keep updated_at fresh on quantity changes (cart sorts by most-recent).
create or replace function public.loamy_cart_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists loamy_cart_touch on public.cart_items;
create trigger loamy_cart_touch
  before update on public.cart_items
  for each row execute function public.loamy_cart_touch();
