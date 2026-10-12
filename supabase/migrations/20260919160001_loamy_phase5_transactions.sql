-- ============================================================================
-- PHASE 5 — transaction state machine (orchestration only).
-- ----------------------------------------------------------------------------
-- Directive Part 19: "Payment state must be represented separately from
-- transaction state... These are different state machines. Never use one
-- status field to represent the entire economic workflow."
--
-- So a transaction carries THREE independent states:
--
--   status           the commercial agreement    proposed -> accepted -> completed
--   payment_state    what the money is doing     not_started -> held -> released
--   fulfilment_state where the goods are         not_started -> loaded -> delivered
--
-- A transaction can legitimately be `accepted` + `payment_state=pending` +
-- `fulfilment_state=not_started`, and each moves on its own rules.
--
-- CUSTODY (Part 2): Loamy is NOT modelled here as holding anyone's funds.
-- payment_state records what a PROVIDER reported, against a provider
-- reference. There is no balance, no debit and no credit in this migration.
-- Phase 7 plugs a licensed provider in behind that seam. If the legal position
-- later supports custody, that is an additive change to Phase 7, not a rewrite
-- of the transaction model.
--
-- SECURITY-REVIEW ** COMMERCIAL + COUNTERPARTY DATA **
-- A transaction row names both parties, the quantity and the price. Read is
-- the two parties and admin. Contact details are NOT here and must not be
-- added; the existing disclosure gate governs those.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Let definer workflow functions drive `system` batch transitions.
-- ----------------------------------------------------------------------------
-- Phase 2 left `system` events rejecting every non-admin caller, and said
-- "Phases 4-9 will call them from their own definer functions". This is that
-- seam: a session flag only a definer function can set, exactly like the
-- guards used elsewhere in this schema.
create or replace function public.loamy_batch_transition(
  p_batch_id       uuid,
  p_event_type     text,
  p_quantity_delta numeric default null,
  p_subject_type   text default null,
  p_subject_id     uuid default null,
  p_location_state text default null,
  p_location_lga   text default null,
  p_latitude       numeric default null,
  p_longitude      numeric default null,
  p_metadata       jsonb default '{}'::jsonb,
  p_evidence       jsonb default '{}'::jsonb,
  p_note           text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_b         public.commodity_batches%rowtype;
  v_rule      public.batch_transition_rules%rowtype;
  v_is_admin  boolean := public.loamy_is_admin();
  v_is_system boolean := coalesce(current_setting('loamy.batch_system_authorized', true), '') = 'true';
  v_new_qty   numeric;
  v_status    text;
  v_event     uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_b from public.commodity_batches where id = p_batch_id for update;
  if v_b.id is null then raise exception 'Batch not found.'; end if;

  select * into v_rule from public.batch_transition_rules where event_type = p_event_type;
  if v_rule.event_type is null then
    raise exception 'Unknown batch event: %', p_event_type;
  end if;

  if v_rule.initiator = 'platform' and not (v_is_admin or v_is_system) then
    raise exception 'Only the platform can record a % event.', p_event_type;
  elsif v_rule.initiator = 'holder' and v_b.owner_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'Only the current holder can record a % event.', p_event_type;
  elsif v_rule.initiator = 'system' and not (v_is_admin or v_is_system) then
    raise exception 'A % event is recorded by the platform workflow, not directly.', p_event_type;
  end if;

  if not (v_b.status = any (v_rule.allowed_from)) then
    raise exception 'A batch that is % cannot go to % (allowed from: %).',
      v_b.status, p_event_type, array_to_string(v_rule.allowed_from, ', ');
  end if;

  v_new_qty := v_b.available_quantity;
  if p_quantity_delta is not null and p_quantity_delta <> 0 then
    v_new_qty := v_b.available_quantity + p_quantity_delta;
    if v_new_qty < 0 then
      raise exception 'Only % % remain available in this batch.', v_b.available_quantity, v_b.unit;
    end if;
    if v_new_qty > v_b.quantity then
      raise exception 'A batch cannot hold more than its original quantity.';
    end if;
  end if;

  if p_event_type = 'unlisted' then
    v_status := case when v_b.verification_status = 'verified' then 'verified' else 'created' end;
  else
    v_status := coalesce(v_rule.new_status, v_b.status);
  end if;

  update public.commodity_batches
     set status             = v_status,
         available_quantity = v_new_qty,
         verification_status = case
           when p_event_type = 'verified' then 'verified'
           when p_event_type = 'verification_rejected' then 'rejected'
           else verification_status end,
         current_state      = coalesce(p_location_state, current_state),
         current_location   = coalesce(p_note, current_location),
         updated_at         = now()
   where id = p_batch_id;

  insert into public.batch_events (
    batch_id, event_type, actor_id, previous_status, new_status,
    quantity_delta, quantity_after, location_state, location_lga,
    latitude, longitude, subject_type, subject_id, metadata, evidence, note
  ) values (
    p_batch_id, p_event_type, v_uid, v_b.status, v_status,
    p_quantity_delta, v_new_qty, p_location_state, p_location_lga,
    p_latitude, p_longitude, p_subject_type, p_subject_id,
    coalesce(p_metadata, '{}'::jsonb), coalesce(p_evidence, '{}'::jsonb), p_note
  ) returning id into v_event;

  return v_event;
end;
$$;

revoke all on function public.loamy_batch_transition(uuid,text,numeric,text,uuid,text,text,numeric,numeric,jsonb,jsonb,text) from public, anon;
grant execute on function public.loamy_batch_transition(uuid,text,numeric,text,uuid,text,text,numeric,numeric,jsonb,jsonb,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. transactions
-- ----------------------------------------------------------------------------
create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,

  buyer_id      uuid not null references public.profiles (id) on delete cascade,
  seller_id     uuid not null references public.profiles (id) on delete cascade,
  listing_id    uuid references public.listings (id) on delete set null,
  batch_id      uuid references public.commodity_batches (id) on delete set null,

  commodity     text not null,
  quantity      numeric not null check (quantity > 0),
  unit          text not null,
  price_per_unit numeric not null check (price_per_unit > 0),
  currency      text not null default 'NGN',
  -- Server-computed, never client-supplied.
  subtotal      numeric not null check (subtotal >= 0),

  -- MACHINE 1: the commercial agreement.
  status        text not null default 'proposed' check (status in (
    'proposed','accepted','rejected','verification_required','verified',
    'completed','cancelled','disputed','expired'
  )),

  -- MACHINE 2: what the money is doing. Provider-reported only.
  payment_state text not null default 'not_started' check (payment_state in (
    'not_started','pending','authorized','held','released','refunded','failed'
  )),
  -- Reference AT the provider. Loamy holds no funds; this identifies theirs.
  payment_provider   text,
  payment_reference  text,

  -- MACHINE 3: where the goods are.
  fulfilment_state text not null default 'not_started' check (fulfilment_state in (
    'not_started','awaiting_pickup','loaded','in_transit','delivered','received','failed'
  )),

  -- Cross-links. Financing is Phase 6; logistics Phase 8.
  verification_case_id     uuid references public.verification_tasks (id) on delete set null,
  financing_application_id uuid references public.financing_applications (id) on delete set null,

  buyer_note    text,
  seller_note   text,
  delivery_state text,
  delivery_lga   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,

  constraint transactions_parties_differ check (buyer_id <> seller_id)
);

create index if not exists transactions_buyer_idx  on public.transactions (buyer_id, created_at desc);
create index if not exists transactions_seller_idx on public.transactions (seller_id, created_at desc);
create index if not exists transactions_batch_idx  on public.transactions (batch_id);

alter table public.transactions enable row level security;

drop policy if exists "loamy_transactions_select" on public.transactions;
create policy "loamy_transactions_select"
  on public.transactions for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.loamy_is_admin());

-- No client insert/update/delete: every move is an RPC below.

drop trigger if exists loamy_transactions_assign_ref on public.transactions;
create trigger loamy_transactions_assign_ref
  before insert on public.transactions
  for each row execute function public.loamy_assign_ref('transaction', 'TXN');

drop trigger if exists loamy_transactions_updated_at on public.transactions;
create trigger loamy_transactions_updated_at
  before update on public.transactions
  for each row execute function public.loamy_set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. transaction_events — append-only, mirrors batch_events.
-- ----------------------------------------------------------------------------
create table if not exists public.transaction_events (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  event_type     text not null,
  machine        text not null check (machine in ('status','payment','fulfilment')),
  actor_id       uuid references public.profiles (id) on delete set null,
  previous_value text,
  new_value      text,
  metadata       jsonb not null default '{}'::jsonb,
  note           text,
  occurred_at    timestamptz not null default now()
);

create index if not exists txn_events_idx on public.transaction_events (transaction_id, occurred_at);

alter table public.transaction_events enable row level security;

drop policy if exists "loamy_txn_events_select" on public.transaction_events;
create policy "loamy_txn_events_select"
  on public.transaction_events for select to authenticated
  using (exists (
    select 1 from public.transactions t
    where t.id = transaction_id
      and (t.buyer_id = auth.uid() or t.seller_id = auth.uid() or public.loamy_is_admin())
  ));

drop trigger if exists loamy_txn_events_assign_ref on public.transaction_events;
create trigger loamy_txn_events_assign_ref
  before insert on public.transaction_events
  for each row execute function public.loamy_assign_ref('transaction_event', 'TEV');

-- ----------------------------------------------------------------------------
-- 4. Transition rules, one row per machine transition.
-- ----------------------------------------------------------------------------
create table if not exists public.transaction_transition_rules (
  machine      text not null check (machine in ('status','payment','fulfilment')),
  event_type   text not null,
  allowed_from text[] not null,
  new_value    text not null,
  -- 'buyer' | 'seller' | 'either' | 'platform' | 'system'
  initiator    text not null check (initiator in ('buyer','seller','either','platform','system')),
  primary key (machine, event_type)
);

alter table public.transaction_transition_rules enable row level security;
drop policy if exists "loamy_txn_rules_read" on public.transaction_transition_rules;
create policy "loamy_txn_rules_read"
  on public.transaction_transition_rules for select to authenticated using (true);

insert into public.transaction_transition_rules (machine, event_type, allowed_from, new_value, initiator) values
  -- Agreement
  ('status','accept',                array['proposed'],                              'accepted',              'seller'),
  ('status','reject',                array['proposed'],                              'rejected',              'seller'),
  ('status','withdraw',              array['proposed'],                              'cancelled',             'buyer'),
  ('status','require_verification',  array['proposed','accepted'],                   'verification_required', 'either'),
  ('status','verification_passed',   array['verification_required'],                 'verified',              'platform'),
  ('status','verification_failed',   array['verification_required'],                 'cancelled',             'platform'),
  ('status','complete',              array['accepted','verified'],                   'completed',             'system'),
  ('status','cancel',                array['proposed','accepted','verification_required','verified'], 'cancelled', 'either'),
  ('status','dispute',               array['accepted','verified','completed'],       'disputed',              'either'),
  ('status','resolve_dispute',       array['disputed'],                              'completed',             'platform'),
  ('status','expire',                array['proposed'],                              'expired',               'system'),
  -- Payment. Provider-reported; no member may assert these.
  ('payment','payment_initiated',    array['not_started','failed'],                  'pending',               'system'),
  ('payment','payment_authorized',   array['pending'],                               'authorized',            'system'),
  ('payment','payment_held',         array['authorized','pending'],                  'held',                  'system'),
  ('payment','payment_released',     array['held','authorized'],                     'released',              'system'),
  ('payment','payment_refunded',     array['held','authorized','released'],          'refunded',              'system'),
  ('payment','payment_failed',       array['pending','authorized'],                  'failed',                'system'),
  -- Fulfilment
  ('fulfilment','ready_for_pickup',  array['not_started'],                           'awaiting_pickup',       'seller'),
  ('fulfilment','loaded',            array['not_started','awaiting_pickup'],         'loaded',                'seller'),
  ('fulfilment','in_transit',        array['loaded'],                                'in_transit',            'system'),
  ('fulfilment','delivered',         array['in_transit','loaded'],                   'delivered',             'system'),
  ('fulfilment','received',          array['delivered'],                             'received',              'buyer'),
  ('fulfilment','fulfilment_failed', array['awaiting_pickup','loaded','in_transit'], 'failed',                'either')
on conflict (machine, event_type) do update
  set allowed_from = excluded.allowed_from,
      new_value    = excluded.new_value,
      initiator    = excluded.initiator;

-- ----------------------------------------------------------------------------
-- 5. Propose a transaction.
-- ----------------------------------------------------------------------------
/**
 * The buyer proposes against a listing. Nothing is reserved yet — reserving on
 * proposal would let anyone lock a seller's stock for free.
 *
 * subtotal is computed here from the LISTING's price, never accepted from the
 * client. A client-supplied total is a price the buyer chose.
 */
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

  insert into public.transactions (
    buyer_id, seller_id, listing_id, batch_id, commodity, quantity, unit,
    price_per_unit, subtotal, status, buyer_note, delivery_state, delivery_lga
  ) values (
    v_uid, v_l.seller_id, p_listing_id, v_l.batch_id, v_l.commodity, p_quantity, v_l.unit,
    v_l.price_per_unit, round(p_quantity * v_l.price_per_unit, 2), 'proposed',
    p_note, p_delivery_state, p_delivery_lga
  ) returning id into v_id;

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
-- 6. The single controlled transition path, across all three machines.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_transaction_transition(
  p_transaction_id uuid,
  p_event_type     text,
  p_machine        text default 'status',
  p_note           text default null,
  p_metadata       jsonb default '{}'::jsonb,
  p_payment_provider  text default null,
  p_payment_reference text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_t         public.transactions%rowtype;
  v_rule      public.transaction_transition_rules%rowtype;
  v_is_admin  boolean := public.loamy_is_admin();
  v_is_system boolean := coalesce(current_setting('loamy.txn_system_authorized', true), '') = 'true';
  v_current   text;
  v_event     uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_t from public.transactions where id = p_transaction_id for update;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if v_t.buyer_id <> v_uid and v_t.seller_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'That is not your transaction.';
  end if;

  select * into v_rule from public.transaction_transition_rules
   where machine = p_machine and event_type = p_event_type;
  if v_rule.event_type is null then
    raise exception 'Unknown % event: %', p_machine, p_event_type;
  end if;

  -- Who may initiate.
  if v_rule.initiator = 'buyer' and v_t.buyer_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'Only the buyer can record %.', p_event_type;
  elsif v_rule.initiator = 'seller' and v_t.seller_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'Only the seller can record %.', p_event_type;
  elsif v_rule.initiator = 'platform' and not (v_is_admin or v_is_system) then
    raise exception 'Only the platform can record %.', p_event_type;
  elsif v_rule.initiator = 'system' and not (v_is_admin or v_is_system) then
    -- Payment events in particular: a member must never be able to assert that
    -- money moved. Phase 7 drives these from the provider webhook.
    raise exception '% is recorded by the platform workflow, not directly.', p_event_type;
  end if;

  v_current := case p_machine
                 when 'status'     then v_t.status
                 when 'payment'    then v_t.payment_state
                 else                   v_t.fulfilment_state end;

  if not (v_current = any (v_rule.allowed_from)) then
    raise exception 'A transaction whose % is % cannot go to % (allowed from: %).',
      p_machine, v_current, p_event_type, array_to_string(v_rule.allowed_from, ', ');
  end if;

  if p_machine = 'status' then
    update public.transactions
       set status = v_rule.new_value,
           completed_at = case when v_rule.new_value = 'completed' then now() else completed_at end
     where id = p_transaction_id;
  elsif p_machine = 'payment' then
    update public.transactions
       set payment_state = v_rule.new_value,
           payment_provider  = coalesce(p_payment_provider, payment_provider),
           payment_reference = coalesce(p_payment_reference, payment_reference)
     where id = p_transaction_id;
  else
    update public.transactions
       set fulfilment_state = v_rule.new_value
     where id = p_transaction_id;
  end if;

  insert into public.transaction_events (
    transaction_id, event_type, machine, actor_id, previous_value, new_value, metadata, note
  ) values (
    p_transaction_id, p_event_type, p_machine, v_uid, v_current, v_rule.new_value,
    coalesce(p_metadata, '{}'::jsonb), p_note
  ) returning id into v_event;

  -- Agreement side effects on the batch, driven through its own controlled path.
  if p_machine = 'status' and v_t.batch_id is not null then
    perform set_config('loamy.batch_system_authorized', 'true', true);

    if v_rule.new_value = 'accepted' then
      -- Accepting commits stock. Proposing does not, so a buyer cannot grief a
      -- seller by locking their inventory for free.
      perform public.loamy_batch_transition(
        v_t.batch_id, 'reserved', -v_t.quantity, 'transaction', p_transaction_id,
        null, null, null, null, '{}'::jsonb, '{}'::jsonb, null);

    elsif v_rule.new_value in ('cancelled','rejected','expired')
          and v_t.status = 'accepted' then
      -- Release the commitment we took on acceptance.
      perform public.loamy_batch_transition(
        v_t.batch_id, 'quantity_adjusted', v_t.quantity, 'transaction', p_transaction_id,
        null, null, null, null, '{}'::jsonb, '{}'::jsonb, 'Reservation released');

    elsif v_rule.new_value = 'completed' then
      perform public.loamy_batch_transition(
        v_t.batch_id, 'sold', null, 'transaction', p_transaction_id,
        null, null, null, null, '{}'::jsonb, '{}'::jsonb, null);
    end if;

    perform set_config('loamy.batch_system_authorized', 'false', true);
  end if;

  return v_event;
end;
$$;

revoke all on function public.loamy_transaction_transition(uuid,text,text,text,jsonb,text,text) from public, anon;
grant execute on function public.loamy_transaction_transition(uuid,text,text,text,jsonb,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Disputes.
-- ----------------------------------------------------------------------------
create table if not exists public.disputes (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  raised_by      uuid not null references public.profiles (id) on delete cascade,
  against_id     uuid not null references public.profiles (id) on delete cascade,
  category       text not null check (category in
                   ('quantity','quality','delivery','payment','verification','logistics','other')),
  detail         text not null,
  evidence       jsonb not null default '{}'::jsonb,
  status         text not null default 'open' check (status in
                   ('open','evidence_requested','under_review','decided','resolved','escalated','withdrawn')),
  decision       text,
  decision_note  text,
  decided_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  decided_at     timestamptz
);

create index if not exists disputes_txn_idx on public.disputes (transaction_id, created_at desc);

alter table public.disputes enable row level security;

drop policy if exists "loamy_disputes_select" on public.disputes;
create policy "loamy_disputes_select"
  on public.disputes for select to authenticated
  using (raised_by = auth.uid() or against_id = auth.uid() or public.loamy_is_admin());

drop trigger if exists loamy_disputes_assign_ref on public.disputes;
create trigger loamy_disputes_assign_ref
  before insert on public.disputes
  for each row execute function public.loamy_assign_ref('dispute', 'DSP');

drop trigger if exists loamy_disputes_updated_at on public.disputes;
create trigger loamy_disputes_updated_at
  before update on public.disputes
  for each row execute function public.loamy_set_updated_at();

/** Either party may raise a dispute; it also moves the transaction. */
create or replace function public.loamy_open_dispute(
  p_transaction_id uuid,
  p_category       text,
  p_detail         text,
  p_evidence       jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.transactions%rowtype;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if coalesce(trim(p_detail), '') = '' then
    raise exception 'Describe the problem so it can be reviewed.';
  end if;

  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if v_t.buyer_id <> v_uid and v_t.seller_id <> v_uid then
    raise exception 'That is not your transaction.';
  end if;
  if exists (select 1 from public.disputes
             where transaction_id = p_transaction_id
               and status not in ('resolved','withdrawn')) then
    raise exception 'There is already an open dispute on this transaction.';
  end if;

  insert into public.disputes (transaction_id, raised_by, against_id, category, detail, evidence)
  values (p_transaction_id, v_uid,
          case when v_t.buyer_id = v_uid then v_t.seller_id else v_t.buyer_id end,
          p_category, p_detail, coalesce(p_evidence, '{}'::jsonb))
  returning id into v_id;

  -- Moving the transaction to disputed goes through the normal rules.
  if v_t.status in ('accepted','verified','completed') then
    perform public.loamy_transaction_transition(
      p_transaction_id, 'dispute', 'status', 'Dispute ' || p_category, '{}'::jsonb, null, null);
  end if;

  insert into public.notifications (user_id, title, body, type)
  values (case when v_t.buyer_id = v_uid then v_t.seller_id else v_t.buyer_id end,
          'A dispute was raised',
          'The other party raised a dispute on one of your transactions. Loamy will review it.',
          'marketplace');

  insert into public.audit_events (actor_id, event_type, subject_type, subject_id, detail)
  values (v_uid, 'dispute_opened', 'transaction', p_transaction_id,
          jsonb_build_object('category', p_category, 'dispute_id', v_id));

  return v_id;
end;
$$;

revoke all on function public.loamy_open_dispute(uuid,text,text,jsonb) from public, anon;
grant execute on function public.loamy_open_dispute(uuid,text,text,jsonb) to authenticated;

comment on table public.transactions is
  'TRANSACTION (directive Part 19). THREE independent state machines: status (agreement), payment_state (provider-reported), fulfilment_state (goods). Loamy holds no funds -- payment_state records what a provider said.';
comment on column public.transactions.payment_state is
  'What the PAYMENT PROVIDER reported. Loamy is not a custodian; this is a mirror of their state, against payment_reference.';
