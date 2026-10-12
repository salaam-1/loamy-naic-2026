-- ============================================================================
-- PHASE 9 — warehouse.
-- ----------------------------------------------------------------------------
-- Directive Part 22. A warehouse is independently identifiable, and:
--
--   "A warehouse receiving a batch must create a traceable event.
--    Do not merely change batch location."
--
-- That sentence is the whole design. A receipt is a record with an actor, a
-- quantity, a condition and evidence -- not an UPDATE to a location column.
--
-- DELIBERATE REUSE: `service_directory` already holds warehouse profiles
-- (owner, state, LGA, capacity note, and the address added earlier today), and
-- `warehouse_reservations` already exists but is AWARD-SCOPED like transport
-- was. Both are generalised rather than duplicated.
--
-- SECURITY-REVIEW: a receipt states that N tonnes of a commodity are sitting
-- at a named facility. Read is the warehouse owner, the batch's holder and
-- origin farmer, the transaction parties, and admin. It is not public, and the
-- directory's public surface gains nothing from this migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Allow two-letter reference prefixes.
-- ----------------------------------------------------------------------------
-- loamy_next_ref demanded 3-6 uppercase letters, which rejects 'WH' -- the
-- prefix the directive itself uses in its example (WH-000032). The guard
-- exists to stop typos and lowercase slugs becoming permanent business IDs,
-- and 2 letters serves that just as well.
create or replace function public.loamy_next_ref(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v bigint;
begin
  if p_prefix !~ '^[A-Z]{2,6}$' then
    raise exception 'Reference prefix must be 2-6 uppercase letters, got %', p_prefix;
  end if;
  insert into public.loamy_ref_counters (prefix, next_value)
  values (p_prefix, 1)
  on conflict (prefix) do update set next_value = public.loamy_ref_counters.next_value + 1
  returning next_value into v;
  return p_prefix || '-' || lpad(v::text, 6, '0');
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. The warehouse as an identifiable entity.
-- ----------------------------------------------------------------------------
alter table public.service_directory
  add column if not exists ref                 text unique,
  add column if not exists capacity_tonnes     numeric check (capacity_tonnes is null or capacity_tonnes >= 0),
  add column if not exists storage_types       text[] not null default '{}',
  add column if not exists commodities_supported text[] not null default '{}',
  add column if not exists verification_status text not null default 'unverified'
    check (verification_status in ('unverified','pending','verified','rejected'));

drop trigger if exists loamy_directory_assign_ref on public.service_directory;
create trigger loamy_directory_assign_ref
  before insert on public.service_directory
  for each row execute function public.loamy_assign_ref('service_facility', 'WH');

do $$
declare r record;
begin
  for r in select id from public.service_directory where ref is null loop
    update public.service_directory
       set ref = public.loamy_register_ref('service_facility', r.id, 'WH') where id = r.id;
  end loop;
end;
$$;

comment on column public.service_directory.verification_status is
  'Set by the verification workflow (warehouse_verification), never by the owner.';

-- The owner must not be able to self-verify their own facility -- same rule as
-- everywhere else in this schema.
create or replace function public.loamy_protect_facility_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status is distinct from old.verification_status
     and coalesce(current_setting('loamy.status_change_authorized', true), '') <> 'true'
     and not public.loamy_is_admin() then
    raise exception 'A facility is verified through the verification workflow, not by its owner.';
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_directory_protect_verification on public.service_directory;
create trigger loamy_directory_protect_verification
  before update on public.service_directory
  for each row execute function public.loamy_protect_facility_verification();

-- ----------------------------------------------------------------------------
-- 2. Generalise reservations beyond RFQ awards.
-- ----------------------------------------------------------------------------
alter table public.warehouse_reservations
  alter column award_id drop not null,
  alter column rfq_id   drop not null,
  alter column company_id drop not null;

alter table public.warehouse_reservations
  add column if not exists ref            text unique,
  add column if not exists transaction_id uuid references public.transactions (id) on delete cascade,
  add column if not exists batch_id       uuid references public.commodity_batches (id) on delete set null,
  add column if not exists facility_id    uuid references public.service_directory (id) on delete set null,
  add column if not exists requested_by   uuid references public.profiles (id) on delete set null;

alter table public.warehouse_reservations drop constraint if exists wh_res_one_origin;
alter table public.warehouse_reservations add constraint wh_res_one_origin
  check (num_nonnulls(award_id, transaction_id) = 1);

alter table public.warehouse_reservations drop constraint if exists warehouse_reservations_status_check;
alter table public.warehouse_reservations add constraint warehouse_reservations_status_check
  check (status in ('requested','confirmed','declined','occupied','released','completed','cancelled'));

drop trigger if exists loamy_wh_res_assign_ref on public.warehouse_reservations;
create trigger loamy_wh_res_assign_ref
  before insert on public.warehouse_reservations
  for each row execute function public.loamy_assign_ref('warehouse_reservation', 'WHR');

do $$
declare r record;
begin
  for r in select id from public.warehouse_reservations where ref is null loop
    update public.warehouse_reservations
       set ref = public.loamy_register_ref('warehouse_reservation', r.id, 'WHR') where id = r.id;
  end loop;
end;
$$;

drop policy if exists "loamy_wh_res_select_txn" on public.warehouse_reservations;
create policy "loamy_wh_res_select_txn"
  on public.warehouse_reservations for select to authenticated
  using (
    requested_by = auth.uid()
    or warehouse_owner_id = auth.uid()
    or exists (select 1 from public.transactions t
               where t.id = transaction_id
                 and (t.buyer_id = auth.uid() or t.seller_id = auth.uid()))
  );

-- ----------------------------------------------------------------------------
-- 3. warehouse_receipts — the traceable event Part 22 demands.
-- ----------------------------------------------------------------------------
create table if not exists public.warehouse_receipts (
  id                uuid primary key default gen_random_uuid(),
  ref               text unique,
  facility_id       uuid not null references public.service_directory (id) on delete cascade,
  reservation_id    uuid references public.warehouse_reservations (id) on delete set null,
  batch_id          uuid references public.commodity_batches (id) on delete set null,
  transaction_id    uuid references public.transactions (id) on delete set null,

  movement          text not null check (movement in ('arrival','release','adjustment')),
  -- ARRIVAL, QUANTITY RECEIVED, DATE/TIME, WAREHOUSE, ACTOR, CONDITION, EVIDENCE
  quantity          numeric not null check (quantity > 0),
  unit              text not null,
  condition         text,
  -- Who signed for it, on behalf of the facility.
  received_by       uuid not null references public.profiles (id) on delete cascade,
  evidence          jsonb not null default '{}'::jsonb,
  note              text,
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists wh_receipts_facility_idx on public.warehouse_receipts (facility_id, occurred_at desc);
create index if not exists wh_receipts_batch_idx    on public.warehouse_receipts (batch_id, occurred_at);

-- SECURITY-REVIEW: append-only. No client insert/update/delete -- receipts are
-- written by loamy_record_warehouse_receipt, which stamps the actor and
-- records a matching batch event. A warehouse receipt is a custody record.
alter table public.warehouse_receipts enable row level security;

drop policy if exists "loamy_wh_receipts_select" on public.warehouse_receipts;
create policy "loamy_wh_receipts_select"
  on public.warehouse_receipts for select to authenticated
  using (
    received_by = auth.uid()
    or exists (select 1 from public.service_directory d
               where d.id = facility_id and d.owner_id = auth.uid())
    or exists (select 1 from public.commodity_batches b
               where b.id = batch_id
                 and (b.owner_id = auth.uid() or b.origin_owner_id = auth.uid()))
    or exists (select 1 from public.transactions t
               where t.id = transaction_id
                 and (t.buyer_id = auth.uid() or t.seller_id = auth.uid()))
    or public.loamy_is_admin()
  );

drop trigger if exists loamy_wh_receipts_assign_ref on public.warehouse_receipts;
create trigger loamy_wh_receipts_assign_ref
  before insert on public.warehouse_receipts
  for each row execute function public.loamy_assign_ref('warehouse_receipt', 'WRC');

-- ----------------------------------------------------------------------------
-- 4. Request storage.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_request_storage(
  p_transaction_id uuid,
  p_facility_id    uuid,
  p_quantity       numeric,
  p_start_date     date default null,
  p_end_date       date default null,
  p_note           text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.transactions%rowtype;
  v_f   public.service_directory%rowtype;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero.'; end if;

  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if v_t.buyer_id <> v_uid and v_t.seller_id <> v_uid then
    raise exception 'That is not your transaction.';
  end if;

  select * into v_f from public.service_directory where id = p_facility_id;
  if v_f.id is null then raise exception 'Facility not found.'; end if;
  if v_f.service_type <> 'warehouse' then raise exception 'That facility is not a warehouse.'; end if;

  insert into public.warehouse_reservations (
    transaction_id, batch_id, facility_id, warehouse_owner_id, requested_by,
    space_quantity, unit, start_date, end_date, rate_note, status
  ) values (
    p_transaction_id, v_t.batch_id, p_facility_id, v_f.owner_id, v_uid,
    p_quantity, v_t.unit, p_start_date, p_end_date, p_note, 'requested'
  ) returning id into v_id;

  insert into public.notifications (user_id, title, body, type)
  values (v_f.owner_id, 'New storage request',
          'A member has requested storage space. Confirm or decline it from your Reservations.',
          'logistics');

  return v_id;
end;
$$;

revoke all on function public.loamy_request_storage(uuid,uuid,numeric,date,date,text) from public, anon;
grant execute on function public.loamy_request_storage(uuid,uuid,numeric,date,date,text) to authenticated;

/** The warehouse owner confirms or declines. Never silently auto-booked. */
create or replace function public.loamy_respond_storage(
  p_reservation_id uuid,
  p_accept         boolean,
  p_note           text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_r   public.warehouse_reservations%rowtype;
begin
  select * into v_r from public.warehouse_reservations where id = p_reservation_id for update;
  if v_r.id is null then raise exception 'Reservation not found.'; end if;
  if v_r.warehouse_owner_id <> v_uid and not public.loamy_is_admin() then
    raise exception 'Only the facility owner can answer this request.';
  end if;
  if v_r.status <> 'requested' then
    raise exception 'This request is already %.', v_r.status;
  end if;

  update public.warehouse_reservations
     set status = case when p_accept then 'confirmed' else 'declined' end,
         rate_note = coalesce(p_note, rate_note),
         updated_at = now()
   where id = p_reservation_id;

  if v_r.requested_by is not null then
    insert into public.notifications (user_id, title, body, type)
    values (v_r.requested_by,
            case when p_accept then 'Storage confirmed' else 'Storage declined' end,
            case when p_accept then 'The facility confirmed your storage request.'
                 else 'The facility declined your storage request.' end,
            'logistics');
  end if;
end;
$$;

revoke all on function public.loamy_respond_storage(uuid,boolean,text) from public, anon;
grant execute on function public.loamy_respond_storage(uuid,boolean,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Record a receipt. THE point of this phase.
-- ----------------------------------------------------------------------------
/**
 * Receiving stock creates a RECORD, and the batch event that goes with it.
 * It never just moves a location string.
 *
 * Only someone acting for the facility may sign for goods -- a seller cannot
 * declare that a warehouse received their stock.
 */
create or replace function public.loamy_record_warehouse_receipt(
  p_facility_id uuid,
  p_batch_id    uuid,
  p_movement    text,
  p_quantity    numeric,
  p_condition   text default null,
  p_reservation_id uuid default null,
  p_transaction_id uuid default null,
  p_evidence    jsonb default '{}'::jsonb,
  p_note        text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_f   public.service_directory%rowtype;
  v_b   public.commodity_batches%rowtype;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_movement not in ('arrival','release','adjustment') then
    raise exception 'Unknown movement: %', p_movement;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;

  select * into v_f from public.service_directory where id = p_facility_id;
  if v_f.id is null then raise exception 'Facility not found.'; end if;
  if v_f.owner_id <> v_uid and not public.loamy_is_admin() then
    raise exception 'Only the facility can sign for goods at this warehouse.';
  end if;

  select * into v_b from public.commodity_batches where id = p_batch_id;
  if v_b.id is null then raise exception 'Batch not found.'; end if;

  insert into public.warehouse_receipts (
    facility_id, reservation_id, batch_id, transaction_id, movement,
    quantity, unit, condition, received_by, evidence, note
  ) values (
    p_facility_id, p_reservation_id, p_batch_id, p_transaction_id, p_movement,
    p_quantity, v_b.unit, p_condition, v_uid, coalesce(p_evidence, '{}'::jsonb), p_note
  ) returning id into v_id;

  -- The matching batch event, through the batch's own controlled path.
  if p_movement = 'arrival' then
    perform set_config('loamy.batch_system_authorized', 'true', true);
    perform public.loamy_batch_transition(
      p_batch_id, 'warehouse_received', null, 'warehouse_receipt', v_id,
      v_f.state, v_f.lga, null, null,
      jsonb_build_object('facility_ref', v_f.ref, 'quantity', p_quantity),
      coalesce(p_evidence, '{}'::jsonb),
      coalesce(v_f.business_name, 'Warehouse'));
    perform set_config('loamy.batch_system_authorized', 'false', true);

    if p_reservation_id is not null then
      update public.warehouse_reservations
         set status = 'occupied', updated_at = now()
       where id = p_reservation_id and status = 'confirmed';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.loamy_record_warehouse_receipt(uuid,uuid,text,numeric,text,uuid,uuid,jsonb,text) from public, anon;
grant execute on function public.loamy_record_warehouse_receipt(uuid,uuid,text,numeric,text,uuid,uuid,jsonb,text) to authenticated;

comment on table public.warehouse_receipts is
  'WAREHOUSE RECEIPT (directive Part 22). Receiving a batch creates a record with actor, quantity, condition and evidence -- and a matching batch event. It never merely changes a location.';
