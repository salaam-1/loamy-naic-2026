-- ============================================================================
-- Loamy Wallet -- every member gets one.
-- ----------------------------------------------------------------------------
-- Money released from escrow (a marketplace order, or a procurement award) now
-- lands in the seller's Loamy wallet instead of being pushed straight to their
-- bank. They withdraw from the wallet when they choose, to a bank account they
-- have saved and the payment partner has verified.
--
-- MODEL: the wallet is a LEDGER, not a mutable balance column. Every movement
-- is an immutable wallet_entries row and the balance is the sum of them. There
-- is no UPDATE path on entries at all, so a balance can never silently drift
-- from its history, and a double-credit is impossible because each entry
-- carries a UNIQUE external reference.
--
-- SECURITY-REVIEW ** MONEY SURFACE **
--   * clients may READ their own entries and withdrawals; they may never write
--     either. Credits are written only by the Edge Functions (service role) at
--     the moment a release is confirmed; debits only by loamy_request_withdrawal.
--   * loamy_request_withdrawal takes a per-user advisory lock and re-computes
--     the balance INSIDE the transaction, so two concurrent requests cannot
--     both pass the balance check and overdraw.
--   * a withdrawal is refused unless the account has a payout account whose
--     recipient_code the payment partner issued -- i.e. a real, name-verified
--     bank account. The account number itself is never re-entered here.
--   * Loamy still holds no funds of its own: the balance mirrors money the
--     payment partner is holding, and a withdrawal instructs a transfer to the
--     member's own bank.
-- Verify before launch: a second account cannot read another member's entries,
-- balance or withdrawals; withdrawing more than the balance fails; a failed
-- transfer restores the balance exactly once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. wallet_entries -- the ledger.
-- ----------------------------------------------------------------------------
create table if not exists public.wallet_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  direction    text not null check (direction in ('credit','debit')),
  amount       numeric not null check (amount > 0),
  currency     text not null default 'NGN',
  kind         text not null check (kind in (
                 'order_settlement',      -- marketplace order released by the buyer
                 'escrow_release',        -- procurement award escrow released
                 'withdrawal',            -- debit: member cashed out
                 'withdrawal_reversal',   -- credit: a withdrawal transfer failed
                 'adjustment'             -- admin correction, always explained
               )),
  -- Idempotency key from the source event (order id, transfer reference, ...).
  -- A repeated webhook or a retried Edge Function can never credit twice.
  reference    text not null unique,
  subject_type text,
  subject_id   uuid,
  description  text,
  created_at   timestamptz not null default now()
);

create index if not exists wallet_entries_user_idx
  on public.wallet_entries (user_id, created_at desc);

alter table public.wallet_entries enable row level security;

-- Read own rows only. NO insert/update/delete policy exists, deliberately.
drop policy if exists "loamy_wallet_entries_select_own" on public.wallet_entries;
create policy "loamy_wallet_entries_select_own"
  on public.wallet_entries for select to authenticated
  using (user_id = auth.uid() or public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 2. wallet_withdrawals -- cash-out requests and their outcome.
-- ----------------------------------------------------------------------------
create table if not exists public.wallet_withdrawals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  amount         numeric not null check (amount > 0),
  currency       text not null default 'NGN',
  status         text not null default 'pending'
                   check (status in ('pending','processing','paid','failed')),
  -- Snapshot of where it was sent, so history stays readable after the member
  -- changes their payout account. Only the last 4 digits are ever stored here.
  bank_name      text,
  account_last4  text,
  recipient_code text,
  transfer_code  text,
  reference      text unique,
  failure_reason text,
  -- The debit entry this withdrawal created, so a reversal can find it.
  entry_id       uuid references public.wallet_entries (id) on delete set null,
  requested_at   timestamptz not null default now(),
  completed_at   timestamptz
);

create index if not exists wallet_withdrawals_user_idx
  on public.wallet_withdrawals (user_id, requested_at desc);

alter table public.wallet_withdrawals enable row level security;

-- Read own rows only; all writes go through the RPC / Edge Function.
drop policy if exists "loamy_wallet_withdrawals_select_own" on public.wallet_withdrawals;
create policy "loamy_wallet_withdrawals_select_own"
  on public.wallet_withdrawals for select to authenticated
  using (user_id = auth.uid() or public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 3. Balance.
-- ----------------------------------------------------------------------------
-- Sum of the ledger. Definer so it can also serve the Edge Functions and the
-- admin view, but it only ever answers for the caller unless they are an admin.
create or replace function public.loamy_wallet_balance(p_user uuid default null)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target uuid := coalesce(p_user, auth.uid());
  v_total numeric;
begin
  if v_target is null then raise exception 'Not signed in.'; end if;
  if v_target <> auth.uid() and not public.loamy_is_admin() then
    raise exception 'Not authorized.';
  end if;

  select coalesce(sum(case when direction = 'credit' then amount else -amount end), 0)
    into v_total
  from public.wallet_entries
  where user_id = v_target;

  return v_total;
end;
$$;

revoke all on function public.loamy_wallet_balance(uuid) from public, anon;
grant execute on function public.loamy_wallet_balance(uuid) to authenticated;

-- Minimum withdrawal, admin-tunable rather than hardcoded.
update public.platform_config
set settings = jsonb_build_object('wallet_min_withdrawal_ngn', 1000) || coalesce(settings, '{}'::jsonb)
where id = 1;

-- ----------------------------------------------------------------------------
-- 4. Requesting a withdrawal.
-- ----------------------------------------------------------------------------
-- Creates the debit and the pending withdrawal in ONE transaction, under a
-- per-user advisory lock so concurrent requests serialise and cannot overdraw.
-- The transfer itself is executed afterwards by the wallet-withdraw Edge
-- Function, which holds the payment partner's secret key.
create or replace function public.loamy_request_withdrawal(p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_balance  numeric;
  v_min      numeric;
  v_acct     record;
  v_entry    uuid;
  v_wid      uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if not coalesce((select active from public.profiles where id = v_uid), true) then
    raise exception 'This account is suspended.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;

  -- Serialise this user's withdrawals for the rest of the transaction.
  perform pg_advisory_xact_lock(hashtext('loamy_wallet:' || v_uid::text));

  select coalesce((settings->>'wallet_min_withdrawal_ngn')::numeric, 1000)
    into v_min from public.platform_config where id = 1;
  if p_amount < coalesce(v_min, 1000) then
    raise exception 'The minimum withdrawal is %.', coalesce(v_min, 1000);
  end if;

  -- A verified destination is required: recipient_code only exists once the
  -- payment partner has resolved the account name for a real bank account.
  select bank_name, account_number, recipient_code into v_acct
  from public.seller_payout_accounts where user_id = v_uid;
  if v_acct is null or coalesce(v_acct.recipient_code, '') = '' then
    raise exception 'Add and verify your bank account number before withdrawing.';
  end if;

  select coalesce(sum(case when direction = 'credit' then amount else -amount end), 0)
    into v_balance
  from public.wallet_entries
  where user_id = v_uid;

  if p_amount > v_balance then
    raise exception 'You cannot withdraw more than your balance.';
  end if;

  v_wid := gen_random_uuid();

  insert into public.wallet_entries
    (user_id, direction, amount, kind, reference, subject_type, subject_id, description)
  values
    (v_uid, 'debit', p_amount, 'withdrawal', 'withdrawal:' || v_wid::text,
     'wallet_withdrawal', v_wid, 'Withdrawal to your bank account')
  returning id into v_entry;

  insert into public.wallet_withdrawals
    (id, user_id, amount, status, bank_name, account_last4, recipient_code, entry_id)
  values
    (v_wid, v_uid, p_amount, 'pending', v_acct.bank_name,
     right(v_acct.account_number, 4), v_acct.recipient_code, v_entry);

  return v_wid;
end;
$$;

revoke all on function public.loamy_request_withdrawal(numeric) from public, anon;
grant execute on function public.loamy_request_withdrawal(numeric) to authenticated;

comment on table public.wallet_entries is
  'Immutable wallet ledger. Balance = sum(credits) - sum(debits). Written only by the payment Edge Functions (service role) and loamy_request_withdrawal.';
comment on table public.wallet_withdrawals is
  'Member cash-out requests. Executed by the wallet-withdraw Edge Function against the payment partner.';
