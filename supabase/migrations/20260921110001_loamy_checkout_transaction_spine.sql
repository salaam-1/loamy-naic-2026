-- ============================================================================
-- PHASE 4 / SLICE 1 — ordinary checkout creates the AUTHORITATIVE transaction.
-- ----------------------------------------------------------------------------
-- Before this migration the marketplace had two checkout endings:
--
--   "Place order"        -> loamy_place_orders_from_cart -> public.orders
--   "Apply for financing"-> loamy_propose_transaction    -> public.transactions
--
-- Neither order function references `transactions` at all, so the DEFAULT
-- purchase produced a record with no fee snapshot, no batch_id, no
-- transaction_events and no route to financing, verification, logistics,
-- warehouse or settlement. The whole Loamy spine hangs off `transactions`.
--
-- This migration changes three things and adds no new model.
--
-- 1. IDEMPOTENCY on loamy_propose_transaction. A double-click, a refresh or a
--    network retry must not buy the same thing twice. Re-proposing the SAME
--    (buyer, listing, quantity) while the first is still `proposed` now
--    returns the existing row instead of inserting a second one. A different
--    quantity is a different intention and is still allowed through.
--
--    A unique partial index makes it race-safe: two concurrent requests
--    cannot both pass the existence check and then both insert.
--
-- 2. loamy_checkout_cart — a thin ORCHESTRATOR over loamy_propose_transaction.
--    It is not a second checkout model and it re-implements none of the
--    business rules: it iterates the buyer's purchasable cart lines, calls the
--    authoritative function for each, and clears those lines. One statement,
--    so a failure on line three does not leave lines one and two bought with
--    the cart half-emptied.
--
--    Grouping is ONE TRANSACTION PER LISTING, which is the existing
--    authoritative semantics rather than a new choice: a transaction carries
--    listing_id, batch_id, commodity, quantity and price, so it cannot
--    represent several listings. `orders` grouped by seller; that grouping is
--    what could not carry traceability.
--
-- 3. loamy_place_orders_from_cart is DOCUMENTED as deprecated for new
--    checkout. It is deliberately left working: `orders` holds real history,
--    the model freeze already lists it as retained-but-not-authoritative, and
--    deleting it is a migration of its own.
--
-- No new table. No change to fees, financing, verification or settlement.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Race-safe idempotency for an open proposal.
-- ----------------------------------------------------------------------------
-- Partial, so it constrains only live proposals: once a transaction is
-- accepted, declined or cancelled the buyer may of course propose again.
create unique index if not exists transactions_open_proposal_idem
  on public.transactions (buyer_id, listing_id, quantity)
  where status = 'proposed';

comment on index public.transactions_open_proposal_idem is
  'Idempotency for checkout. One OPEN proposal per (buyer, listing, quantity), so a double-click or retry cannot create a second purchase. A different quantity is a different intention and is not blocked.';

-- ----------------------------------------------------------------------------
-- 2. loamy_propose_transaction — unchanged rules, now idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_propose_transaction(
  p_listing_id uuid,
  p_quantity   numeric,
  p_note       text default null,
  p_delivery_state text default null,
  p_delivery_lga   text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_l   public.listings%rowtype;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;

  select * into v_l from public.listings where id = p_listing_id;
  if v_l.id is null then raise exception 'Listing not found.'; end if;
  if v_l.status <> 'active' then raise exception 'That listing is not active.'; end if;
  if v_l.seller_id = v_uid then raise exception 'You cannot buy your own listing.'; end if;
  if p_quantity > v_l.quantity_kg then
    raise exception 'Only % % are listed.', v_l.quantity_kg, v_l.unit;
  end if;

  -- IDEMPOTENCY. The same intention, repeated, is the same purchase. Returning
  -- the existing row means a retried request is indistinguishable from the
  -- first one, which is what makes the client safe to retry at all.
  select id into v_id
  from public.transactions
  where buyer_id = v_uid
    and listing_id = p_listing_id
    and quantity = p_quantity
    and status = 'proposed'
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.transactions (
    buyer_id, seller_id, listing_id, batch_id, commodity, quantity, unit,
    price_per_unit, subtotal, status, buyer_note, delivery_state, delivery_lga
  ) values (
    v_uid, v_l.seller_id, p_listing_id, v_l.batch_id, v_l.commodity, p_quantity, v_l.unit,
    v_l.price_per_unit, round(p_quantity * v_l.price_per_unit, 2), 'proposed',
    p_note, p_delivery_state, p_delivery_lga
  )
  -- Loses the race? Then the other request already created exactly this
  -- purchase, and the select below returns it. Still one transaction.
  on conflict (buyer_id, listing_id, quantity) where status = 'proposed'
  do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.transactions
    where buyer_id = v_uid and listing_id = p_listing_id
      and quantity = p_quantity and status = 'proposed'
    limit 1;
    return v_id;
  end if;

  insert into public.transaction_events (transaction_id, event_type, machine, actor_id, new_value, note)
  values (v_id, 'proposed', 'status', v_uid, 'proposed', p_note);

  insert into public.notifications (user_id, title, body, type)
  values (v_l.seller_id, 'New purchase proposal',
          'A buyer proposed a purchase against one of your listings.', 'marketplace');

  return v_id;
end;
$$;

revoke all on function public.loamy_propose_transaction(uuid,numeric,text,text,text) from public, anon;
grant execute on function public.loamy_propose_transaction(uuid,numeric,text,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. loamy_checkout_cart — the authoritative cart checkout.
-- ----------------------------------------------------------------------------
/**
 * Turn the caller's cart into authoritative transactions.
 *
 * Every business rule -- ownership, active listing, self-purchase, quantity,
 * batch linkage, the event, the seller notification, idempotency -- belongs to
 * loamy_propose_transaction and is reused rather than restated. This function
 * only decides WHICH lines to buy and clears them afterwards.
 *
 * Returns the transaction ids in cart order.
 */
create or replace function public.loamy_checkout_cart(
  p_delivery_state text default null,
  p_delivery_lga   text default null,
  p_note           text default null
) returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid := auth.uid();
  v_row   record;
  v_txn   uuid;
  v_ids   uuid[] := '{}';
begin
  if v_buyer is null then
    raise exception 'You need to be signed in to check out.';
  end if;

  for v_row in
    select ci.id as cart_id, ci.listing_id, ci.quantity
    from public.cart_items ci
    join public.listings l on l.id = ci.listing_id
    where ci.user_id = v_buyer
      and l.status = 'active'
      -- Same exclusion the order path used: a member cannot buy their own
      -- stock, and such a line should be skipped rather than fail the cart.
      and l.seller_id <> v_buyer
    order by ci.created_at
  loop
    -- Any refusal inside here (inactive listing, quantity beyond the listing)
    -- aborts the whole statement. That is deliberate: a partially bought cart
    -- with a partially emptied cart is worse than a clear failure.
    v_txn := public.loamy_propose_transaction(
      v_row.listing_id, v_row.quantity, p_note, p_delivery_state, p_delivery_lga);

    v_ids := array_append(v_ids, v_txn);
    delete from public.cart_items where id = v_row.cart_id;
  end loop;

  if array_length(v_ids, 1) is null then
    raise exception 'Nothing to check out — your cart has no purchasable items.';
  end if;

  return query select unnest(v_ids);
end;
$$;

revoke all on function public.loamy_checkout_cart(text,text,text) from public, anon;
grant execute on function public.loamy_checkout_cart(text,text,text) to authenticated;

comment on function public.loamy_checkout_cart(text,text,text) is
  'Authoritative cart checkout. Orchestrates loamy_propose_transaction per cart line and clears those lines atomically. One transaction per listing.';

-- ----------------------------------------------------------------------------
-- 4. The old path, marked.
-- ----------------------------------------------------------------------------
comment on function public.loamy_place_orders_from_cart(text,text) is
  'DEPRECATED for new checkout (Phase 4 slice 1, 2026-09-21). Creates public.orders, which the model freeze lists as retained-but-not-authoritative: no fee snapshot, no batch_id, no transaction_events and no route to financing, verification, logistics, warehouse or settlement. New checkout uses loamy_checkout_cart. Left working because `orders` holds real history and removing it is a separate migration.';

comment on table public.orders is
  'RETAINED, NOT AUTHORITATIVE. Historical marketplace orders placed before Phase 4 slice 1. The authoritative purchase record is public.transactions. Do not create new rows here from product code.';
