-- ============================================================================
-- Processor Dashboard — PART 7: escrow via payment partner (Paystack)
-- ============================================================================
-- Funds are held BY THE PAYMENT PARTNER (Paystack), never by Loamy. The buyer
-- funds escrow through Paystack's hosted flow; after inspection is accepted, an
-- authorised buyer (Finance Officer / Procurement Director) triggers release and
-- Loamy sends the release instruction to Paystack, which disburses the supplier.
--
-- SECURITY-REVIEW: escrow rows are written ONLY by the Edge Functions
-- (service role) after: (1) verifying the Paystack webhook SIGNATURE over the
-- raw body, (2) re-verifying with Paystack and cross-checking the amount against
-- the server-computed award value, (3) idempotent status transitions so a
-- replayed webhook never double-funds or double-releases. No Paystack secret is
-- ever stored in these tables. Verify company isolation on reads.
-- ============================================================================

create table if not exists public.escrow_transactions (
  id                 uuid primary key default gen_random_uuid(),
  award_id           uuid not null unique references public.rfq_awards(id) on delete cascade,
  rfq_id             uuid not null references public.rfqs(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete cascade,
  supplier_id        uuid not null references auth.users(id) on delete cascade,
  provider           text not null default 'paystack',
  provider_reference text unique,
  authorization_url  text,
  amount             numeric not null check (amount >= 0),        -- server-computed award value
  released_amount    numeric not null default 0 check (released_amount >= 0),
  currency           text not null default 'NGN',
  status             text not null default 'initiated'
                       check (status in ('initiated','funded','released','partially_released','refunded','disputed')),
  funded_at          timestamptz,
  released_at        timestamptz,
  release_trigger    text,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists escrow_company_idx on public.escrow_transactions(company_id, status);
create index if not exists escrow_supplier_idx on public.escrow_transactions(supplier_id);

-- Immutable audit trail — one row per state change. No update/delete ever.
create table if not exists public.escrow_events (
  id                    uuid primary key default gen_random_uuid(),
  escrow_transaction_id uuid not null references public.escrow_transactions(id) on delete cascade,
  event_type            text not null,
  actor_id              uuid references auth.users(id) on delete set null,
  payload               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists escrow_events_txn_idx on public.escrow_events(escrow_transaction_id, created_at);

alter table public.escrow_transactions enable row level security;
alter table public.escrow_events enable row level security;

-- Read: the buyer company's members and the supplier (their money) and admin.
-- No client writes — the Edge Functions (service role) are the only writers.
drop policy if exists escrow_txn_select on public.escrow_transactions;
create policy escrow_txn_select on public.escrow_transactions
  for select to authenticated
  using (
    company_id in (select public.loamy_user_company_ids())
    or supplier_id = auth.uid()
    or public.loamy_is_admin()
  );

drop policy if exists escrow_events_select on public.escrow_events;
create policy escrow_events_select on public.escrow_events
  for select to authenticated
  using (
    escrow_transaction_id in (
      select id from public.escrow_transactions
      where company_id in (select public.loamy_user_company_ids()) or supplier_id = auth.uid()
    )
    or public.loamy_is_admin()
  );

-- Who may fund / release escrow: owner, Procurement Director, or Finance Officer.
-- Used by the Edge Functions (server-side authz) and for UI gating.
create or replace function public.loamy_company_can_settle(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target and user_id = auth.uid()
      and (is_owner or company_role in ('Procurement Director','Finance Officer'))
  );
$$;

grant execute on function public.loamy_company_can_settle(uuid) to authenticated;
