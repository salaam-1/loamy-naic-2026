-- ============================================================================
-- Loamy Marketplace · payments + escrow (Stage 4 · Paystack).
-- Loamy collects a confirmed order's payment through Paystack and holds it in
-- escrow until the buyer confirms receipt, then releases it to the seller.
--
-- MONEY CUSTODY: the browser only ever holds the anon key. Every Paystack
-- secret-key operation (charge init, webhook verification) runs in a Supabase
-- Edge Function using the SERVICE ROLE key, which bypasses RLS. This table
-- therefore has ONLY a party-scoped SELECT policy — clients never write to it.
-- ============================================================================

create table if not exists public.order_payments (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  provider          text not null default 'paystack',
  reference         text not null unique,
  amount            numeric not null check (amount >= 0),
  currency          text not null default 'NGN',
  status            text not null default 'initialized'
    check (status in ('initialized','paid','failed','refunded','released')),
  authorization_url text,
  paid_at           timestamptz,
  meta              jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists order_payments_order_idx on public.order_payments (order_id, created_at desc);

-- SECURITY-REVIEW: a payment row is visible only to the buyer, the seller, or an
-- admin (via the parent order). There is NO client insert/update/delete policy —
-- the Edge Functions write with the service role. Verify a third account cannot
-- read a payment reference, and that no Paystack secret is ever stored here.
alter table public.order_payments enable row level security;

drop policy if exists "loamy_order_payments_select_parties" on public.order_payments;
create policy "loamy_order_payments_select_parties"
  on public.order_payments for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.buyer_id = auth.uid() or o.seller_id = auth.uid() or public.loamy_is_admin())
  ));

-- ----------------------------------------------------------------------------
-- Release escrow. Buyer (or admin) confirms receipt of an in-escrow order; the
-- order moves to 'released'. Automated payout/transfer to the seller's bank is
-- a follow-up increment — this records the buyer's authorisation to settle.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_release_order(p_order uuid)
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
  if auth.uid() <> v_order.buyer_id and not public.loamy_is_admin() then
    raise exception 'Only the buyer can release this order.';
  end if;
  if v_order.status <> 'in_escrow' then
    raise exception 'Only a paid (in-escrow) order can be released.';
  end if;

  update public.orders set status = 'released', updated_at = now() where id = p_order;

  insert into public.notifications (user_id, title, body, type)
  values (v_order.seller_id, 'Payment released',
          'The buyer confirmed receipt and released payment for an order. Loamy will settle it to you.',
          'marketplace');
end;
$$;

revoke all on function public.loamy_release_order(uuid) from public;
revoke all on function public.loamy_release_order(uuid) from anon;
grant execute on function public.loamy_release_order(uuid) to authenticated;
