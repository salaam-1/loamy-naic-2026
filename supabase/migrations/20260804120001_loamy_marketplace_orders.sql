-- ============================================================================
-- Loamy Marketplace · orders + order_items (Stage 3 of the redesign).
-- A cart that spans several sellers splits into ONE order per seller. Orders are
-- created only through a security-definer RPC that snapshots prices from the
-- listings table server-side — a buyer can never set their own price. Payment
-- and escrow are Stage 4; here an order is placed → the seller confirms/rejects
-- → (Stage 4) it proceeds to Paystack escrow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- orders — one buyer, one seller, a status, a snapshotted subtotal.
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  buyer_id       uuid not null references public.profiles (id) on delete cascade,
  seller_id      uuid not null references public.profiles (id) on delete cascade,
  status         text not null default 'pending_seller'
    check (status in (
      'pending_seller','confirmed','rejected','cancelled',
      -- reserved for Stage 4 (Paystack escrow) so no later ALTER is needed:
      'awaiting_payment','in_escrow','released','completed','refunded'
    )),
  currency       text not null default 'NGN',
  subtotal       numeric not null default 0 check (subtotal >= 0),
  delivery_state text,
  buyer_note     text,
  seller_note    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (buyer_id <> seller_id)
);

create index if not exists orders_buyer_idx  on public.orders (buyer_id, created_at desc);
create index if not exists orders_seller_idx on public.orders (seller_id, created_at desc);

-- order line items — price/commodity/unit are SNAPSHOTTED at order time so the
-- order is stable even if the listing later changes or is deleted.
create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  commodity  text not null,
  unit       text not null,
  unit_price numeric not null check (unit_price >= 0),
  quantity   numeric not null check (quantity > 0),
  line_total numeric not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- ----------------------------------------------------------------------------
-- RLS. Orders are two-party private data. There are NO direct insert/update/
-- delete policies — every mutation goes through the security-definer RPCs below
-- (which validate the caller and run as owner). Third accounts see nothing.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: verify only the buyer, the seller, or an admin can read an
-- order or its items; verify a buyer cannot forge an order for another buyer or
-- set an arbitrary price (only loamy_place_orders_from_cart writes rows, and it
-- reads prices from listings). Verify status transitions are gated by role.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "loamy_orders_select_parties" on public.orders;
create policy "loamy_orders_select_parties"
  on public.orders for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.loamy_is_admin());

drop policy if exists "loamy_order_items_select_parties" on public.order_items;
create policy "loamy_order_items_select_parties"
  on public.order_items for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.buyer_id = auth.uid() or o.seller_id = auth.uid() or public.loamy_is_admin())
  ));

-- ----------------------------------------------------------------------------
-- Place orders from the caller's cart. Groups the cart by seller, snapshots
-- prices from listings, creates orders + items, clears the ordered cart rows,
-- and notifies each seller. Returns the created order ids.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_place_orders_from_cart(
  p_delivery_state text default null,
  p_note text default null
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer  uuid := auth.uid();
  v_seller uuid;
  v_order  uuid;
  v_ids    uuid[] := '{}';
begin
  if v_buyer is null then
    raise exception 'You need to be signed in to place an order.';
  end if;

  for v_seller in
    select distinct l.seller_id
    from public.cart_items ci
    join public.listings l on l.id = ci.listing_id
    where ci.user_id = v_buyer
      and l.status = 'active'
      and l.seller_id <> v_buyer
  loop
    insert into public.orders (buyer_id, seller_id, status, currency, delivery_state, buyer_note, subtotal)
    values (v_buyer, v_seller, 'pending_seller', 'NGN', p_delivery_state, p_note, 0)
    returning id into v_order;

    insert into public.order_items (order_id, listing_id, commodity, unit, unit_price, quantity, line_total)
    select v_order, l.id, l.commodity, l.unit, l.price_per_unit, ci.quantity, l.price_per_unit * ci.quantity
    from public.cart_items ci
    join public.listings l on l.id = ci.listing_id
    where ci.user_id = v_buyer
      and l.seller_id = v_seller
      and l.status = 'active';

    update public.orders
    set subtotal = (select coalesce(sum(line_total), 0) from public.order_items where order_id = v_order)
    where id = v_order;

    insert into public.notifications (user_id, title, body, type)
    values (v_seller, 'New order received',
            'You have a new order awaiting your confirmation. Review it in your sales.',
            'marketplace');

    v_ids := array_append(v_ids, v_order);
  end loop;

  -- Remove the ordered items from the cart (purchasable rows only).
  delete from public.cart_items ci
  using public.listings l
  where ci.user_id = v_buyer
    and l.id = ci.listing_id
    and l.status = 'active'
    and l.seller_id <> v_buyer;

  if array_length(v_ids, 1) is null then
    raise exception 'Nothing to order — your cart has no purchasable items.';
  end if;

  return query select unnest(v_ids);
end;
$$;

revoke all on function public.loamy_place_orders_from_cart(text, text) from public;
revoke all on function public.loamy_place_orders_from_cart(text, text) from anon;
grant execute on function public.loamy_place_orders_from_cart(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Seller confirms or rejects a pending order.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_respond_to_order(
  p_order uuid,
  p_accept boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;
  if auth.uid() <> v_order.seller_id then
    raise exception 'Only the seller can respond to this order.';
  end if;
  if v_order.status <> 'pending_seller' then
    raise exception 'This order has already been actioned.';
  end if;

  update public.orders
  set status = case when p_accept then 'confirmed' else 'rejected' end,
      seller_note = p_note,
      updated_at = now()
  where id = p_order;

  insert into public.notifications (user_id, title, body, type)
  values (v_order.buyer_id,
          case when p_accept then 'Order confirmed' else 'Order declined' end,
          case when p_accept
               then 'The seller confirmed your order. Secure payment is the next step.'
               else 'The seller declined your order.' end,
          'marketplace');
end;
$$;

revoke all on function public.loamy_respond_to_order(uuid, boolean, text) from public;
revoke all on function public.loamy_respond_to_order(uuid, boolean, text) from anon;
grant execute on function public.loamy_respond_to_order(uuid, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Buyer cancels a still-pending order.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_cancel_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;
  if auth.uid() <> v_order.buyer_id then
    raise exception 'Only the buyer can cancel this order.';
  end if;
  if v_order.status <> 'pending_seller' then
    raise exception 'Only a pending order can be cancelled.';
  end if;

  update public.orders set status = 'cancelled', updated_at = now() where id = p_order;

  insert into public.notifications (user_id, title, body, type)
  values (v_order.seller_id, 'Order cancelled',
          'A pending order was cancelled by the buyer.', 'marketplace');
end;
$$;

revoke all on function public.loamy_cancel_order(uuid) from public;
revoke all on function public.loamy_cancel_order(uuid) from anon;
grant execute on function public.loamy_cancel_order(uuid) to authenticated;
