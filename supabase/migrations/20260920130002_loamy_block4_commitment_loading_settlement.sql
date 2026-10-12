-- ============================================================================
-- BLOCK 4 (b) — commitment, loading, and the settlement gate.
-- ----------------------------------------------------------------------------
-- Three things, each of which is a way the supplier-direct path can go wrong.
--
-- 1. DOUBLE FINANCING (directive 15). The same 100 MT must not back two
--    financing arrangements. Deliberately NOT a new table: the commitment is
--    already derivable from live financing applications and the transactions
--    they are tied to. A separate commitments table would be a second place
--    for the truth to live, and they would drift.
--
--    Partial sale is supported by design. 100 MT with 40 committed leaves 60
--    financeable -- the batch is not marked unavailable because one deal
--    exists.
--
-- 2. LOADING (directive 16). Delivery must not be reachable from approval.
--    The fulfilment machine gains explicit loading states, as DATA in the
--    transition-rules table rather than code, plus a place for the evidence a
--    loading actually produces: quantity, waybill, vehicle, photos, position.
--
-- 3. THE SETTLEMENT GATE (directive 13). "Approved" does not mean "pay the
--    seller". Every applicable condition is checked and REPORTED INDIVIDUALLY,
--    so a blocked settlement says which condition blocked it rather than
--    failing opaquely.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. How much of a batch is already spoken for.
-- ----------------------------------------------------------------------------
/**
 * Quantity committed to LIVE financing on this batch, derived rather than
 * stored. A rejected, cancelled or expired application commits nothing.
 */
create or replace function public.loamy_batch_financing_commitment(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_batch public.commodity_batches%rowtype;
  v_committed numeric := 0;
  v_apps  int := 0;
begin
  select * into v_batch from public.commodity_batches where id = p_batch_id;
  if v_batch.id is null then
    return jsonb_build_object('found', false, 'reason', 'no_such_batch');
  end if;

  select coalesce(sum(t.quantity), 0), count(*)
    into v_committed, v_apps
  from public.financing_applications f
  join public.transactions t on t.id = f.transaction_id
  where f.batch_id = p_batch_id
    and f.status in ('submitted','under_review','info_requested',
                     'additional_information_required','approved','partially_approved','disbursed');

  return jsonb_build_object(
    'found', true,
    'batch_quantity', v_batch.quantity,
    'unit', v_batch.unit,
    'committed_quantity', v_committed,
    'live_applications', v_apps,
    -- What is still financeable. Partial sale is normal, not an exception.
    'financeable_quantity', greatest(0, v_batch.quantity - v_committed));
end;
$$;

grant execute on function public.loamy_batch_financing_commitment(uuid) to authenticated;

comment on function public.loamy_batch_financing_commitment(uuid) is
  'BLOCK 4. Committed quantity DERIVED from live financing applications. Not stored: a second home for this number would drift from the first.';

-- ----------------------------------------------------------------------------
-- 2. Applying for financing now refuses to over-commit a batch.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_apply_financing_for_transaction(
  p_transaction_id uuid,
  p_bank_id        uuid,
  p_amount         numeric default null,
  p_purpose        text default null,
  p_product_type   text default 'commodity_purchase'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.transactions%rowtype;
  v_b   public.banks%rowtype;
  v_link uuid;
  v_amount numeric;
  v_id  uuid;
  v_commit jsonb;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if v_t.buyer_id <> v_uid then
    raise exception 'Only the buyer can seek financing for this purchase.';
  end if;
  if v_t.status in ('cancelled','rejected','expired') then
    raise exception 'That transaction is %.', v_t.status;
  end if;

  select * into v_b from public.banks where id = p_bank_id and active;
  if v_b.id is null then raise exception 'Bank not found or inactive.'; end if;
  if v_b.integration_mode = 'disabled' then
    raise exception 'That bank is not accepting applications through Loamy right now.';
  end if;

  select id into v_link from public.bank_account_links
  where user_id = v_uid and bank_id = p_bank_id;

  v_amount := coalesce(p_amount, v_t.subtotal);
  if v_amount <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  -- The point of transaction-linked financing is that the amount is DERIVED.
  -- A buyer may ask for less than the purchase, never more.
  if v_amount > v_t.subtotal then
    raise exception 'Financing cannot exceed this purchase (% %).', v_t.subtotal, v_t.currency;
  end if;

  if exists (select 1 from public.financing_applications
             where transaction_id = p_transaction_id and applicant_id = v_uid
               and status not in ('rejected','cancelled','expired','completed')) then
    raise exception 'You already have a live financing application for this purchase.';
  end if;

  -- Directive 15: the same stock cannot back two arrangements.
  if v_t.batch_id is not null then
    v_commit := public.loamy_batch_financing_commitment(v_t.batch_id);
    if (v_commit->>'found')::boolean
       and v_t.quantity > (v_commit->>'financeable_quantity')::numeric then
      raise exception
        'Only % % of this batch is still available to finance (% already committed to live applications).',
        v_commit->>'financeable_quantity', v_commit->>'unit', v_commit->>'committed_quantity';
    end if;
  end if;

  insert into public.financing_applications (
    applicant_id, bank_id, bank_link_id, transaction_id, batch_id, listing_id, seller_id,
    product_type, structure, amount_requested, purpose, status, disbursement_preference
  ) values (
    v_uid, p_bank_id, v_link, p_transaction_id, v_t.batch_id, v_t.listing_id, v_t.seller_id,
    p_product_type, 'murabaha', v_amount,
    coalesce(p_purpose, 'Purchase of ' || v_t.quantity || ' ' || v_t.unit || ' ' || v_t.commodity),
    'submitted',
    case when v_b.supports_supplier_direct then 'supplier_payment' else 'cash' end
  ) returning id into v_id;

  insert into public.financing_events (application_id, event_type, actor_id, actor_kind, new_status, amount, detail)
  values (v_id, 'submitted', v_uid, 'applicant', 'submitted', v_amount,
          jsonb_build_object('transaction', v_t.id, 'commodity', v_t.commodity,
                             'quantity', v_t.quantity, 'seller', v_t.seller_id,
                             'supplier_direct', v_b.supports_supplier_direct,
                             'commitment', v_commit));

  perform set_config('loamy.txn_system_authorized', 'true', true);
  update public.transactions set financing_application_id = v_id where id = p_transaction_id;
  perform set_config('loamy.txn_system_authorized', 'false', true);

  return v_id;
end;
$$;

revoke all on function public.loamy_apply_financing_for_transaction(uuid,uuid,numeric,text,text) from public, anon;
grant execute on function public.loamy_apply_financing_for_transaction(uuid,uuid,numeric,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Loading — explicit states, as data.
-- ----------------------------------------------------------------------------
alter table public.transactions drop constraint if exists transactions_fulfilment_state_check;
alter table public.transactions add constraint transactions_fulfilment_state_check
  check (fulfilment_state in (
    'not_started','awaiting_pickup',
    'loading_requested','loading_scheduled','loading_started',
    'loaded','in_transit','delivered','received','failed'
  ));

insert into public.transaction_transition_rules (machine, event_type, allowed_from, new_value, initiator) values
  ('fulfilment','loading_requested', array['not_started','awaiting_pickup'],          'loading_requested', 'buyer'),
  ('fulfilment','loading_scheduled', array['loading_requested','awaiting_pickup'],    'loading_scheduled', 'seller'),
  ('fulfilment','loading_started',   array['loading_scheduled','loading_requested'],  'loading_started',   'seller'),
  ('fulfilment','loading_failed',    array['loading_requested','loading_scheduled','loading_started'], 'failed', 'either')
on conflict (machine, event_type) do update
  set allowed_from = excluded.allowed_from,
      new_value    = excluded.new_value,
      initiator    = excluded.initiator;

-- `loaded` may now also be reached from the loading states. The original
-- paths are preserved so existing transactions are unaffected.
update public.transaction_transition_rules
   set allowed_from = array['not_started','awaiting_pickup','loading_scheduled','loading_started']
 where machine = 'fulfilment' and event_type = 'loaded';

/**
 * The evidence a loading actually produces. Append-only.
 *
 * Separate from shipment_events because loading happens at the seller's yard,
 * often before any transport job exists, and the party responsible is the
 * seller rather than a carrier.
 */
create table if not exists public.loading_confirmations (
  id              uuid primary key default gen_random_uuid(),
  ref             text unique,
  transaction_id  uuid not null references public.transactions (id) on delete cascade,
  batch_id        uuid references public.commodity_batches (id) on delete set null,
  stage           text not null check (stage in
                    ('requested','scheduled','started','completed','failed','cancelled')),
  quantity_confirmed numeric check (quantity_confirmed is null or quantity_confirmed >= 0),
  unit            text,
  waybill_ref     text,
  vehicle_registration text,
  carrier_note    text,
  photos          text[] not null default '{}',
  lat             numeric,
  lng             numeric,
  occurred_at     timestamptz not null default now(),
  recorded_by     uuid not null default auth.uid() references public.profiles (id) on delete set null,
  flags           text[] not null default '{}',
  note            text,
  created_at      timestamptz not null default now()
);

create index if not exists loading_confirmations_txn_idx
  on public.loading_confirmations (transaction_id, occurred_at desc);

alter table public.loading_confirmations enable row level security;

-- Parties to the deal, and admins. Nobody else.
drop policy if exists loading_confirmations_parties on public.loading_confirmations;
create policy loading_confirmations_parties on public.loading_confirmations
  for select to authenticated
  using (public.loamy_is_admin() or exists (
    select 1 from public.transactions t
    where t.id = transaction_id and (t.buyer_id = auth.uid() or t.seller_id = auth.uid())));

-- No insert/update/delete policy: writes go through loamy_record_loading.
create or replace function public.loamy_loading_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('loamy.loading_authorized', true), '') <> 'true' then
    raise exception 'Loading is recorded through loamy_record_loading.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists loamy_loading_confirmations_guard on public.loading_confirmations;
create trigger loamy_loading_confirmations_guard
  before insert or update or delete on public.loading_confirmations
  for each row execute function public.loamy_loading_guard();

drop trigger if exists loamy_loading_assign_ref on public.loading_confirmations;
create trigger loamy_loading_assign_ref
  before insert on public.loading_confirmations
  for each row execute function public.loamy_assign_ref('loading_confirmation', 'LOAD');

/**
 * Record a loading stage, with its evidence, and move the fulfilment machine.
 *
 * A quantity that disagrees with the transaction is FLAGGED, not silently
 * accepted and not rejected outright -- a two-bag shortfall on a 200-tonne
 * load is a real-world event that needs a human, not an exception.
 */
create or replace function public.loamy_record_loading(
  p_transaction_id uuid,
  p_stage          text,
  p_quantity       numeric default null,
  p_unit           text default null,
  p_waybill        text default null,
  p_vehicle        text default null,
  p_photos         text[] default '{}',
  p_lat            numeric default null,
  p_lng            numeric default null,
  p_note           text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_t     public.transactions%rowtype;
  v_flags text[] := '{}';
  v_id    uuid;
  v_event text;
  v_tol   numeric;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if not (v_t.buyer_id = v_uid or v_t.seller_id = v_uid or public.loamy_is_admin()) then
    raise exception 'Only a party to this purchase can record loading.';
  end if;
  if p_stage not in ('requested','scheduled','started','completed','failed','cancelled') then
    raise exception 'Unknown loading stage: %', p_stage;
  end if;

  -- A completed loading needs evidence. Otherwise "loaded" is just a click.
  if p_stage = 'completed' then
    if p_quantity is null then
      v_flags := array_append(v_flags, 'no_quantity_confirmed');
    else
      v_tol := greatest(v_t.quantity * 0.02, 0.001);
      if abs(p_quantity - v_t.quantity) > v_tol then
        v_flags := array_append(v_flags, 'quantity_mismatch');
      end if;
    end if;
    if coalesce(array_length(p_photos, 1), 0) = 0 then
      v_flags := array_append(v_flags, 'no_loading_photo');
    end if;
    if p_waybill is null then
      v_flags := array_append(v_flags, 'no_waybill');
    end if;
    if p_lat is null or p_lng is null then
      v_flags := array_append(v_flags, 'no_gps');
    end if;
  end if;

  perform set_config('loamy.loading_authorized', 'true', true);
  insert into public.loading_confirmations (
    transaction_id, batch_id, stage, quantity_confirmed, unit, waybill_ref,
    vehicle_registration, photos, lat, lng, recorded_by, flags, note)
  values (
    p_transaction_id, v_t.batch_id, p_stage, p_quantity, coalesce(p_unit, v_t.unit),
    p_waybill, p_vehicle, coalesce(p_photos, '{}'), p_lat, p_lng, v_uid, v_flags, p_note)
  returning id into v_id;
  perform set_config('loamy.loading_authorized', 'false', true);

  -- Mirror onto the fulfilment machine through its own guarded path.
  v_event := case p_stage
    when 'requested' then 'loading_requested'
    when 'scheduled' then 'loading_scheduled'
    when 'started'   then 'loading_started'
    when 'completed' then 'loaded'
    when 'failed'    then 'loading_failed'
    when 'cancelled' then 'loading_failed'
  end;

  if v_event is not null then
    begin
      perform public.loamy_transaction_transition(
        p_transaction_id, v_event, 'fulfilment', null,
        jsonb_build_object('loading_confirmation', v_id, 'flags', to_jsonb(v_flags)));
    exception when others then
      -- The evidence is recorded either way. A refused transition is
      -- reported, never swallowed into a false success.
      return jsonb_build_object('recorded', true, 'confirmation_id', v_id,
        'flags', to_jsonb(v_flags), 'state_moved', false, 'state_error', sqlerrm);
    end;
  end if;

  return jsonb_build_object('recorded', true, 'confirmation_id', v_id,
    'flags', to_jsonb(v_flags), 'state_moved', v_event is not null);
end;
$$;

revoke all on function public.loamy_record_loading(
  uuid,text,numeric,text,text,text,text[],numeric,numeric,text) from public, anon;
grant execute on function public.loamy_record_loading(
  uuid,text,numeric,text,text,text,text[],numeric,numeric,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The settlement gate — every condition, reported individually.
-- ----------------------------------------------------------------------------
/**
 * Can the seller be settled directly yet?
 *
 * Returns each condition with its own pass/fail, because "not ready" with no
 * reason is unactionable for everyone involved -- the buyer cannot tell what
 * to chase and the bank cannot tell what it is waiting on.
 */
create or replace function public.loamy_settlement_readiness(p_application_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_a       public.financing_applications%rowtype;
  v_t       public.transactions%rowtype;
  v_b       public.banks%rowtype;
  v_conds   jsonb := '[]'::jsonb;
  v_ready   boolean := true;
  v_ver     public.verification_tasks%rowtype;
  v_needs_ver boolean;
  v_commit  jsonb;

begin
  select * into v_a from public.financing_applications where id = p_application_id;
  if v_a.id is null then
    return jsonb_build_object('ready', false, 'reason', 'no_such_application');
  end if;

  -- Only the parties, the bank and admins may inspect the gate.
  if not (public.loamy_is_admin()
          or v_a.applicant_id = auth.uid()
          or v_a.seller_id = auth.uid()
          or (public.loamy_officer_bank() is not null and public.loamy_officer_bank() = v_a.bank_id)) then
    return jsonb_build_object('ready', false, 'reason', 'not_permitted');
  end if;

  select * into v_t from public.transactions where id = v_a.transaction_id;
  select * into v_b from public.banks where id = v_a.bank_id;

  -- Condition 1: the bank approved.
  v_conds := v_conds || jsonb_build_object(
    'code', 'bank_approved',
    'label', 'Bank approval',
    'passed', v_a.status in ('approved','partially_approved'),
    'detail', v_a.status);
  if v_a.status not in ('approved','partially_approved') then v_ready := false; end if;

  -- Condition 2: the approval has not expired.
  v_conds := v_conds || jsonb_build_object(
    'code', 'approval_current',
    'label', 'Approval still valid',
    'passed', v_a.expires_at is null or v_a.expires_at > now(),
    'detail', v_a.expires_at);
  if v_a.expires_at is not null and v_a.expires_at <= now() then v_ready := false; end if;

  -- Condition 3: this bank actually supports paying a seller directly.
  v_conds := v_conds || jsonb_build_object(
    'code', 'supplier_direct_supported',
    'label', 'Bank supports supplier-direct settlement',
    'passed', coalesce(v_b.supports_supplier_direct, false),
    'detail', coalesce(v_b.name, 'unknown'));
  if not coalesce(v_b.supports_supplier_direct, false) then v_ready := false; end if;

  -- Condition 4: there is a live transaction behind it.
  v_conds := v_conds || jsonb_build_object(
    'code', 'transaction_live',
    'label', 'Purchase is live',
    'passed', v_t.id is not null and v_t.status not in ('cancelled','rejected','expired'),
    'detail', coalesce(v_t.status, 'missing'));
  if v_t.id is null or v_t.status in ('cancelled','rejected','expired') then v_ready := false; end if;

  -- Condition 5: physical verification, where the goods are batch-backed.
  v_needs_ver := v_a.batch_id is not null;
  if v_needs_ver then
    select * into v_ver from public.verification_tasks
     where subject_id = v_a.batch_id and subject_type = 'commodity_batch'
     order by created_at desc limit 1;

    v_conds := v_conds || jsonb_build_object(
      'code', 'commodity_verified',
      'label', 'Commodity verified',
      'passed', v_ver.id is not null and v_ver.status = 'approved',
      'detail', coalesce(v_ver.status, 'not_requested'));
    if v_ver.id is null or v_ver.status <> 'approved' then v_ready := false; end if;

    -- Condition 6: and the verification is not stale.
    v_conds := v_conds || jsonb_build_object(
      'code', 'verification_current',
      'label', 'Verification still current',
      'passed', v_ver.completed_at is not null and v_ver.completed_at > now() - interval '30 days',
      'detail', v_ver.completed_at);
    if v_ver.completed_at is null or v_ver.completed_at <= now() - interval '30 days' then
      v_ready := false;
    end if;
  else
    v_conds := v_conds || jsonb_build_object(
      'code', 'commodity_verified', 'label', 'Commodity verified',
      'passed', false, 'detail', 'not_batch_backed',
      'note', 'Supplier-direct settlement requires batch-backed stock that can be inspected.');
    v_ready := false;
  end if;

  -- Condition 7: the seller can actually receive money.
  v_conds := v_conds || jsonb_build_object(
    'code', 'seller_payout_ready',
    'label', 'Seller settlement destination on file',
    'passed', exists (select 1 from public.seller_payout_accounts s
                      where s.user_id = v_a.seller_id),
    'detail', null);
  if not exists (select 1 from public.seller_payout_accounts s where s.user_id = v_a.seller_id) then
    v_ready := false;
  end if;

  -- Condition 8: no blocking fraud flag on the verification.
  v_conds := v_conds || jsonb_build_object(
    'code', 'no_blocking_flags',
    'label', 'No unresolved fraud flags',
    'passed', v_ver.id is null or coalesce(array_length(v_ver.flags, 1), 0) = 0
              or v_ver.status = 'approved',
    'detail', to_jsonb(coalesce(v_ver.flags, '{}')));

  -- Condition 9: the stock is not over-committed.
  if v_a.batch_id is not null then
    v_commit := public.loamy_batch_financing_commitment(v_a.batch_id);
    v_conds := v_conds || jsonb_build_object(
      'code', 'not_over_committed',
      'label', 'Stock not committed elsewhere',
      'passed', (v_commit->>'committed_quantity')::numeric
                <= (v_commit->>'batch_quantity')::numeric,
      'detail', v_commit);
    if (v_commit->>'committed_quantity')::numeric > (v_commit->>'batch_quantity')::numeric then
      v_ready := false;
    end if;
  end if;

  -- Condition 10: not already settled.
  v_conds := v_conds || jsonb_build_object(
    'code', 'not_already_settled',
    'label', 'Not already settled',
    'passed', coalesce(v_a.disbursed_amount, 0) = 0,
    'detail', v_a.disbursed_amount);
  if coalesce(v_a.disbursed_amount, 0) > 0 then v_ready := false; end if;

  return jsonb_build_object(
    'ready', v_ready,
    'application', v_a.ref,
    'is_sandbox', v_a.is_sandbox,
    'conditions', v_conds,
    'blocked_by', (select coalesce(jsonb_agg(c->>'code'), '[]'::jsonb)
                   from jsonb_array_elements(v_conds) c
                   where (c->>'passed')::boolean is not true),
    'checked_at', now());
end;
$$;

grant execute on function public.loamy_settlement_readiness(uuid) to authenticated;

comment on function public.loamy_settlement_readiness(uuid) is
  'BLOCK 4, directive 13. Every settlement condition reported individually. "Approved" alone never means "pay the seller".';
