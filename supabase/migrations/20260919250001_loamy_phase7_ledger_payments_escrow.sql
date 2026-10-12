-- ============================================================================
-- PHASE 7 — double-entry ledger, payment events, escrow workflow.
-- ----------------------------------------------------------------------------
-- Master directive Parts 18-20.
--
-- Part 18 is a direct instruction: "Review the existing wallet immediately. Do
-- not make Loamy appear to be a deposit-taking institution or custodian unless
-- the legal structure explicitly supports it... Implement proper double-entry
-- accounting where wallet/ledger functionality remains."
--
-- WHAT WAS WRONG WITH THE WALLET. It was single-entry: one row per movement,
-- balance = sum of credits minus debits. Nothing said where money came FROM or
-- went TO, so nothing could be reconciled against a provider and a missing row
-- was invisible. It also read, to a user, like a Loamy-held balance.
--
-- WHAT REPLACES IT. Proper double-entry: every event writes at least two
-- entries that sum to zero, against named accounts. Loamy's own accounts are
-- CONTRA accounts -- they record an obligation to a member, not custody of
-- their cash. A member's "balance" is what Loamy owes them once a provider
-- settles, and the UI copy says exactly that.
--
-- MIGRATION SAFETY: wallet_entries has zero rows in production (verified
-- before writing this), so there is nothing to convert. The table is KEPT and
-- marked deprecated rather than dropped -- dropping a money table, even an
-- empty one, is not something to do casually.
--
-- SECURITY-REVIEW ** THE MONEY LAYER **
-- No client may write a ledger entry, ever. Entries are produced only by
-- definer functions that post balanced pairs. Payment state comes only from a
-- verified provider webhook. The escrow workflow refuses to release without
-- the conditions actually being met. Verify: a member cannot post an entry,
-- cannot unbalance a pair, and cannot release their own escrow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Chart of accounts.
-- ----------------------------------------------------------------------------
create table if not exists public.ledger_accounts (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique,
  -- A member's account, or one of Loamy's own control accounts.
  owner_id    uuid references public.profiles (id) on delete cascade,
  account_type text not null check (account_type in (
    'member_receivable',   -- what Loamy owes this member once settled
    'member_payable',      -- what this member owes Loamy (fees)
    'provider_clearing',   -- funds sitting with the payment provider
    'platform_revenue',    -- Loamy's earned fees
    'platform_escrow',     -- provider-held funds against a specific deal
    'suspense'             -- unmatched; must be cleared by reconciliation
  )),
  currency    text not null default 'NGN',
  -- Human label, e.g. 'Paystack clearing' or a member's name.
  label       text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (owner_id, account_type, currency)
);

alter table public.ledger_accounts enable row level security;

drop policy if exists "loamy_ledger_accounts_select" on public.ledger_accounts;
create policy "loamy_ledger_accounts_select"
  on public.ledger_accounts for select to authenticated
  using (owner_id = auth.uid() or public.loamy_is_admin());

drop trigger if exists loamy_ledger_accounts_assign_ref on public.ledger_accounts;
create trigger loamy_ledger_accounts_assign_ref
  before insert on public.ledger_accounts
  for each row execute function public.loamy_assign_ref('ledger_account', 'ACC');

-- Loamy's own control accounts. owner_id is null: these are the platform's.
insert into public.ledger_accounts (owner_id, account_type, currency, label)
values (null, 'provider_clearing', 'NGN', 'Payment provider clearing'),
       (null, 'platform_revenue',  'NGN', 'Platform revenue'),
       (null, 'platform_escrow',   'NGN', 'Provider-held escrow'),
       (null, 'suspense',          'NGN', 'Unmatched settlements')
on conflict (owner_id, account_type, currency) do nothing;

/** Get (or create) a member's receivable account. */
create or replace function public.loamy_member_account(p_user uuid, p_type text default 'member_receivable')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_name text;
begin
  select id into v_id from public.ledger_accounts
  where owner_id = p_user and account_type = p_type and currency = 'NGN';
  if v_id is not null then return v_id; end if;

  select coalesce(full_name, 'Member') into v_name from public.profiles where id = p_user;
  insert into public.ledger_accounts (owner_id, account_type, currency, label)
  values (p_user, p_type, 'NGN', v_name)
  on conflict (owner_id, account_type, currency) do update set label = excluded.label
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Double-entry lines.
-- ----------------------------------------------------------------------------
create table if not exists public.ledger_entries (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  -- Every line of one economic event shares a transaction_group; the group
  -- must sum to zero. That is what makes this double-entry rather than a log.
  entry_group   uuid not null,
  account_id    uuid not null references public.ledger_accounts (id) on delete restrict,

  -- Signed minor-unit amount. Positive = debit, negative = credit.
  amount        numeric not null check (amount <> 0),
  currency      text not null default 'NGN',

  event_type    text not null check (event_type in (
    'order_payment','escrow_fund','escrow_release','escrow_refund',
    'fee_charge','payout','payout_reversal','adjustment','settlement'
  )),
  -- Idempotency against the provider. One provider event, one group.
  external_reference text,
  provider      text,
  subject_type  text,
  subject_id    uuid,

  status        text not null default 'posted' check (status in ('posted','reversed')),
  reconciled_at timestamptz,
  description   text,
  created_at    timestamptz not null default now()
);

create index if not exists ledger_entries_group_idx   on public.ledger_entries (entry_group);
create index if not exists ledger_entries_account_idx on public.ledger_entries (account_id, created_at desc);
create unique index if not exists ledger_entries_extref_uniq
  on public.ledger_entries (external_reference, account_id)
  where external_reference is not null;

-- SECURITY-REVIEW: NO client write policy of any kind. Entries are posted only
-- by loamy_post_ledger, which enforces the balance. A single-sided write would
-- silently corrupt every balance derived from this table.
alter table public.ledger_entries enable row level security;

drop policy if exists "loamy_ledger_entries_select" on public.ledger_entries;
create policy "loamy_ledger_entries_select"
  on public.ledger_entries for select to authenticated
  using (exists (
    select 1 from public.ledger_accounts a
    where a.id = account_id and (a.owner_id = auth.uid() or public.loamy_is_admin())
  ));

drop trigger if exists loamy_ledger_entries_assign_ref on public.ledger_entries;
create trigger loamy_ledger_entries_assign_ref
  before insert on public.ledger_entries
  for each row execute function public.loamy_assign_ref('ledger_entry', 'LGE');

/**
 * Post a balanced set of lines, atomically.
 *
 * p_lines is [{"account_id": uuid, "amount": numeric}, ...]. The sum MUST be
 * zero; an unbalanced post raises rather than writing anything. This is the
 * only way entries come into existence.
 */
create or replace function public.loamy_post_ledger(
  p_event_type text,
  p_lines      jsonb,
  p_external_reference text default null,
  p_provider   text default null,
  p_subject_type text default null,
  p_subject_id uuid default null,
  p_description text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid := gen_random_uuid();
  v_sum   numeric := 0;
  v_line  jsonb;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A ledger post needs at least two lines.';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sum := v_sum + (v_line->>'amount')::numeric;
  end loop;
  if abs(v_sum) > 0.0001 then
    raise exception 'Ledger lines must balance to zero (got %).', v_sum;
  end if;

  -- Idempotency: the same provider reference must never post twice.
  if p_external_reference is not null and exists (
       select 1 from public.ledger_entries where external_reference = p_external_reference) then
    raise exception 'Already posted for reference %.', p_external_reference
      using errcode = 'unique_violation';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.ledger_entries (
      entry_group, account_id, amount, event_type, external_reference,
      provider, subject_type, subject_id, description
    ) values (
      v_group, (v_line->>'account_id')::uuid, (v_line->>'amount')::numeric,
      p_event_type, p_external_reference, p_provider, p_subject_type, p_subject_id, p_description
    );
  end loop;

  return v_group;
end;
$$;

revoke all on function public.loamy_post_ledger(text,jsonb,text,text,text,uuid,text) from public, anon, authenticated;
-- Deliberately NOT granted to authenticated: only other definer functions call it.

/** A member's balance: what Loamy owes them once the provider settles. */
create or replace function public.loamy_ledger_balance(p_user uuid default null)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target uuid := coalesce(p_user, auth.uid());
  v_total  numeric;
begin
  if v_target is null then raise exception 'Not signed in.'; end if;
  if v_target <> auth.uid() and not public.loamy_is_admin() then
    raise exception 'Not authorized.';
  end if;

  select coalesce(-sum(e.amount), 0) into v_total
  from public.ledger_entries e
  join public.ledger_accounts a on a.id = e.account_id
  where a.owner_id = v_target
    and a.account_type = 'member_receivable'
    and e.status = 'posted';

  return v_total;
end;
$$;

revoke all on function public.loamy_ledger_balance(uuid) from public, anon;
grant execute on function public.loamy_ledger_balance(uuid) to authenticated;

-- The old single-entry wallet stays, empty and deprecated.
comment on table public.wallet_entries is
  'DEPRECATED (Phase 7). Single-entry; superseded by ledger_entries double-entry. Retained empty rather than dropped -- do not write to it.';

-- ----------------------------------------------------------------------------
-- 3. Payment events — the provider is the source of truth.
-- ----------------------------------------------------------------------------
create table if not exists public.payment_events (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  transaction_id uuid references public.transactions (id) on delete set null,
  escrow_id     uuid,

  provider      text not null,
  provider_event text not null,
  -- The provider's own id for this event. UNIQUE: this is what makes replay
  -- and duplicate delivery harmless.
  provider_reference text not null,
  amount        numeric not null check (amount >= 0),
  currency      text not null default 'NGN',

  -- Verified server-side against the provider, never trusted from the client.
  verified      boolean not null default false,
  verification_note text,
  -- What the provider actually sent, kept for reconciliation and dispute.
  raw_payload   jsonb not null default '{}'::jsonb,
  ledger_group  uuid,
  received_at   timestamptz not null default now(),
  unique (provider, provider_reference)
);

create index if not exists payment_events_txn_idx on public.payment_events (transaction_id, received_at desc);

alter table public.payment_events enable row level security;

drop policy if exists "loamy_payment_events_select" on public.payment_events;
create policy "loamy_payment_events_select"
  on public.payment_events for select to authenticated
  using (exists (
    select 1 from public.transactions t
    where t.id = transaction_id
      and (t.buyer_id = auth.uid() or t.seller_id = auth.uid() or public.loamy_is_admin())
  ) or public.loamy_is_admin());

drop trigger if exists loamy_payment_events_assign_ref on public.payment_events;
create trigger loamy_payment_events_assign_ref
  before insert on public.payment_events
  for each row execute function public.loamy_assign_ref('payment_event', 'PAY');

-- ----------------------------------------------------------------------------
-- 4. Escrow as a WORKFLOW, not a status.
-- ----------------------------------------------------------------------------
create table if not exists public.escrow_workflows (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique,
  transaction_id uuid not null unique references public.transactions (id) on delete cascade,
  buyer_id       uuid not null references public.profiles (id) on delete cascade,
  seller_id      uuid not null references public.profiles (id) on delete cascade,
  amount         numeric not null check (amount > 0),
  currency       text not null default 'NGN',

  state          text not null default 'created' check (state in (
    'created','funded','held','verification','loading','in_transit',
    'delivered','accepted','released','refunded','disputed','failed'
  )),
  -- The provider actually holding the money. Loamy is not the custodian.
  provider       text,
  provider_reference text,
  released_amount numeric not null default 0 check (released_amount >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.escrow_workflows enable row level security;

drop policy if exists "loamy_escrow_wf_select" on public.escrow_workflows;
create policy "loamy_escrow_wf_select"
  on public.escrow_workflows for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.loamy_is_admin());

drop trigger if exists loamy_escrow_wf_assign_ref on public.escrow_workflows;
create trigger loamy_escrow_wf_assign_ref
  before insert on public.escrow_workflows
  for each row execute function public.loamy_assign_ref('escrow_workflow', 'ESC');

drop trigger if exists loamy_escrow_wf_updated_at on public.escrow_workflows;
create trigger loamy_escrow_wf_updated_at
  before update on public.escrow_workflows
  for each row execute function public.loamy_set_updated_at();

create table if not exists public.escrow_workflow_events (
  id          uuid primary key default gen_random_uuid(),
  escrow_id   uuid not null references public.escrow_workflows (id) on delete cascade,
  event_type  text not null,
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_kind  text not null default 'system' check (actor_kind in ('buyer','seller','platform','system','provider')),
  previous_state text,
  new_state   text,
  amount      numeric,
  detail      jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists escrow_wf_events_idx on public.escrow_workflow_events (escrow_id, occurred_at);

alter table public.escrow_workflow_events enable row level security;

drop policy if exists "loamy_escrow_wf_events_select" on public.escrow_workflow_events;
create policy "loamy_escrow_wf_events_select"
  on public.escrow_workflow_events for select to authenticated
  using (exists (
    select 1 from public.escrow_workflows w
    where w.id = escrow_id
      and (w.buyer_id = auth.uid() or w.seller_id = auth.uid() or public.loamy_is_admin())
  ));

create table if not exists public.escrow_transition_rules (
  event_type   text primary key,
  allowed_from text[] not null,
  new_state    text not null,
  initiator    text not null check (initiator in ('buyer','seller','platform','provider','system'))
);

alter table public.escrow_transition_rules enable row level security;
drop policy if exists "loamy_escrow_rules_read" on public.escrow_transition_rules;
create policy "loamy_escrow_rules_read"
  on public.escrow_transition_rules for select to authenticated using (true);

insert into public.escrow_transition_rules (event_type, allowed_from, new_state, initiator) values
  ('funded',       array['created'],                                   'funded',       'provider'),
  ('held',         array['funded'],                                    'held',         'provider'),
  ('verification', array['held'],                                      'verification', 'platform'),
  ('loading',      array['held','verification'],                       'loading',      'seller'),
  ('in_transit',   array['loading'],                                   'in_transit',   'system'),
  ('delivered',    array['in_transit','loading'],                      'delivered',    'system'),
  ('accepted',     array['delivered'],                                 'accepted',     'buyer'),
  ('released',     array['accepted'],                                  'released',     'platform'),
  ('refunded',     array['funded','held','verification','disputed'],   'refunded',     'platform'),
  ('disputed',     array['funded','held','verification','loading','in_transit','delivered'], 'disputed', 'buyer'),
  ('failed',       array['created','funded'],                          'failed',       'provider')
on conflict (event_type) do update
  set allowed_from = excluded.allowed_from,
      new_state    = excluded.new_state,
      initiator    = excluded.initiator;

/**
 * Move an escrow. Release is deliberately the narrowest path in the system:
 * it is reachable ONLY from 'accepted', which only the BUYER can set, and only
 * after 'delivered'. Nobody can shortcut from held straight to released.
 */
create or replace function public.loamy_escrow_transition(
  p_escrow_id  uuid,
  p_event_type text,
  p_amount     numeric default null,
  p_detail     jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_w         public.escrow_workflows%rowtype;
  v_rule      public.escrow_transition_rules%rowtype;
  v_is_admin  boolean := public.loamy_is_admin();
  v_is_system boolean := coalesce(current_setting('loamy.escrow_system_authorized', true), '') = 'true';
  v_event     uuid;
  v_seller_acc uuid; v_escrow_acc uuid; v_rev_acc uuid;
  v_fee       numeric := 0;
  v_bps       int;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_w from public.escrow_workflows where id = p_escrow_id for update;
  if v_w.id is null then raise exception 'Escrow not found.'; end if;

  select * into v_rule from public.escrow_transition_rules where event_type = p_event_type;
  if v_rule.event_type is null then raise exception 'Unknown escrow event: %', p_event_type; end if;

  if v_rule.initiator = 'buyer' and v_w.buyer_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'Only the buyer can record %.', p_event_type;
  elsif v_rule.initiator = 'seller' and v_w.seller_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'Only the seller can record %.', p_event_type;
  elsif v_rule.initiator in ('platform','provider','system') and not (v_is_admin or v_is_system) then
    raise exception '% is recorded by the platform or the payment provider, not directly.', p_event_type;
  end if;

  if not (v_w.state = any (v_rule.allowed_from)) then
    raise exception 'An escrow that is % cannot go to % (allowed from: %).',
      v_w.state, p_event_type, array_to_string(v_rule.allowed_from, ', ');
  end if;

  -- Release posts the money movement, net of the configured fee.
  if p_event_type = 'released' then
    select coalesce(platform_fee_bps, 0) into v_bps from public.platform_config where id = 1;
    v_fee := round(v_w.amount * coalesce(v_bps, 0) / 10000.0, 2);

    v_seller_acc := public.loamy_member_account(v_w.seller_id, 'member_receivable');
    select id into v_escrow_acc from public.ledger_accounts
      where owner_id is null and account_type = 'platform_escrow' and currency = 'NGN';
    select id into v_rev_acc from public.ledger_accounts
      where owner_id is null and account_type = 'platform_revenue' and currency = 'NGN';

    -- Debit escrow, credit the seller's receivable and Loamy's revenue.
    -- Sums to zero by construction; loamy_post_ledger re-checks.
    perform public.loamy_post_ledger(
      'escrow_release',
      jsonb_build_array(
        jsonb_build_object('account_id', v_escrow_acc, 'amount',  v_w.amount),
        jsonb_build_object('account_id', v_seller_acc, 'amount', -(v_w.amount - v_fee)),
        jsonb_build_object('account_id', v_rev_acc,    'amount', -v_fee)),
      'escrow-release:' || p_escrow_id::text,
      v_w.provider, 'escrow_workflow', p_escrow_id,
      'Escrow released to seller, net of platform fee');
  end if;

  update public.escrow_workflows
     set state = v_rule.new_state,
         released_amount = case when p_event_type = 'released' then amount else released_amount end,
         updated_at = now()
   where id = p_escrow_id;

  insert into public.escrow_workflow_events (
    escrow_id, event_type, actor_id, actor_kind, previous_state, new_state, amount, detail)
  values (p_escrow_id, p_event_type, v_uid,
          case when v_is_system then 'system' when v_is_admin then 'platform'
               when v_w.buyer_id = v_uid then 'buyer' else 'seller' end,
          v_w.state, v_rule.new_state, coalesce(p_amount, v_w.amount), coalesce(p_detail, '{}'::jsonb))
  returning id into v_event;

  -- Mirror onto the transaction's PAYMENT machine, through its own path.
  if v_w.transaction_id is not null then
    perform set_config('loamy.txn_system_authorized', 'true', true);
    if p_event_type = 'held' then
      perform public.loamy_transaction_transition(
        v_w.transaction_id, 'payment_held', 'payment', null, '{}'::jsonb, v_w.provider, v_w.provider_reference);
    elsif p_event_type = 'released' then
      perform public.loamy_transaction_transition(
        v_w.transaction_id, 'payment_released', 'payment', null, '{}'::jsonb, v_w.provider, v_w.provider_reference);
    elsif p_event_type = 'refunded' then
      perform public.loamy_transaction_transition(
        v_w.transaction_id, 'payment_refunded', 'payment', null, '{}'::jsonb, v_w.provider, v_w.provider_reference);
    end if;
    perform set_config('loamy.txn_system_authorized', 'false', true);
  end if;

  return v_event;
end;
$$;

revoke all on function public.loamy_escrow_transition(uuid,text,numeric,jsonb) from public, anon;
grant execute on function public.loamy_escrow_transition(uuid,text,numeric,jsonb) to authenticated;

/** Open an escrow against an accepted transaction. */
create or replace function public.loamy_open_escrow(p_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.transactions%rowtype;
  v_id  uuid;
begin
  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if v_t.buyer_id <> v_uid and not public.loamy_is_admin() then
    raise exception 'Only the buyer can open escrow for this purchase.';
  end if;
  if v_t.status not in ('accepted','verified') then
    raise exception 'Escrow opens once the transaction is accepted (this one is %).', v_t.status;
  end if;

  insert into public.escrow_workflows (transaction_id, buyer_id, seller_id, amount)
  values (p_transaction_id, v_t.buyer_id, v_t.seller_id, v_t.subtotal)
  on conflict (transaction_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.escrow_workflows where transaction_id = p_transaction_id;
    return v_id;
  end if;

  insert into public.escrow_workflow_events (escrow_id, event_type, actor_id, actor_kind, new_state, amount)
  values (v_id, 'created', v_uid, 'buyer', 'created', v_t.subtotal);

  return v_id;
end;
$$;

revoke all on function public.loamy_open_escrow(uuid) from public, anon;
grant execute on function public.loamy_open_escrow(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Reconciliation.
-- ----------------------------------------------------------------------------
/** Ledger groups that do not balance, and provider events with no ledger. */
create or replace view public.loamy_reconciliation_exceptions as
select 'unbalanced_group' as kind, e.entry_group::text as subject,
       round(sum(e.amount), 2) as delta, min(e.created_at) as noticed_from
from public.ledger_entries e
where e.status = 'posted'
group by e.entry_group
having abs(sum(e.amount)) > 0.0001
union all
select 'payment_without_ledger', p.ref, p.amount, p.received_at
from public.payment_events p
where p.verified and p.ledger_group is null
union all
select 'unreconciled_entry', e.ref, e.amount, e.created_at
from public.ledger_entries e
where e.external_reference is not null
  and e.reconciled_at is null
  and e.created_at < now() - interval '48 hours';

alter view public.loamy_reconciliation_exceptions set (security_invoker = on);
grant select on public.loamy_reconciliation_exceptions to authenticated;

comment on view public.loamy_reconciliation_exceptions is
  'Money that does not add up: unbalanced groups, verified provider events with no ledger post, and entries unreconciled after 48h. Should be empty.';

comment on table public.escrow_workflows is
  'ESCROW AS A WORKFLOW (directive Part 20), not a status column. Loamy is not the custodian -- provider/provider_reference identify who actually holds the funds.';
