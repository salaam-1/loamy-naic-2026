-- ============================================================================
-- Loamy Marketplace · seller payouts (Paystack Transfers).
-- Completes the escrow loop: when a buyer releases an in-escrow order, Loamy
-- transfers the funds to the seller's bank via Paystack. This needs the seller
-- to have a saved bank account (registered as a Paystack transfer recipient).
--
-- The recipient_code comes from Paystack and is written ONLY by the Edge
-- Functions (service role). Clients read their own row; they never write the
-- recipient_code themselves.
-- ============================================================================

create table if not exists public.seller_payout_accounts (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  bank_code      text not null,
  bank_name      text,
  account_number text not null,
  account_name   text,
  recipient_code text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- SECURITY-REVIEW: a payout account is private to its owner. Read is own-row
-- only; the row is created/updated by the paystack-create-recipient Edge
-- Function (service role) after Paystack validates the account — the client
-- never sets recipient_code. Verify a second account cannot read another
-- seller's bank details.
alter table public.seller_payout_accounts enable row level security;

drop policy if exists "loamy_payout_accounts_select_own" on public.seller_payout_accounts;
create policy "loamy_payout_accounts_select_own"
  on public.seller_payout_accounts for select to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- order_payouts — a record of each Paystack transfer for a released order.
-- ----------------------------------------------------------------------------
create table if not exists public.order_payouts (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  amount        numeric not null check (amount >= 0),
  transfer_code text,
  reference     text,
  status        text not null default 'pending'
    check (status in ('pending','success','failed','reversed')),
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists order_payouts_order_idx on public.order_payouts (order_id, created_at desc);

-- SECURITY-REVIEW: a payout record is visible only to the order's buyer, seller,
-- or an admin. Written only by the Edge Functions (service role).
alter table public.order_payouts enable row level security;

drop policy if exists "loamy_order_payouts_select_parties" on public.order_payouts;
create policy "loamy_order_payouts_select_parties"
  on public.order_payouts for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.buyer_id = auth.uid() or o.seller_id = auth.uid() or public.loamy_is_admin())
  ));
