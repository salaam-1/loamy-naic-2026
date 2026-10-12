-- ============================================================================
-- PHASE 2 — CommodityBatch and batch events.
-- ----------------------------------------------------------------------------
-- Directive Parts 9 and 10. The audit named this the single most important
-- missing entity: without it, Parts 25 (traceability), 26 (institutional
-- trace) and 28 (verified transaction) are unimplementable, because there is
-- nothing that persists across a listing, a sale, a warehouse and a shipment.
--
-- A batch is a specific quantity of a specific commodity that can be followed
-- through the ecosystem. It is created FROM a harvest and outlives the listing
-- that sells it.
--
-- TWO NON-NEGOTIABLES, both enforced in the database rather than the UI:
--
--   1. Quantity NEVER mutates silently. available_quantity changes only
--      through a recorded batch_event carrying a signed delta, an actor and a
--      resulting balance. There is no client UPDATE policy on the table.
--
--   2. Status NEVER moves arbitrarily. Transitions go through
--      loamy_batch_transition, which checks an explicit allowed-from matrix and
--      who may initiate. A seller cannot mark their own batch verified.
--
-- SECURITY-REVIEW ** COMMERCIALLY SENSITIVE + THEFT RISK **
-- A batch states how much of a commodity exists, who holds it, and where. Read
-- access at this phase is the owner, the origin farmer, and admin. Phase 4
-- will publish a DERIVED marketplace summary (commodity, quantity, state,
-- verification status) and must never expose current_location, coordinates, or
-- the origin farm's identity to a buyer who has not transacted.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. commodity_batches
-- ----------------------------------------------------------------------------
create table if not exists public.commodity_batches (
  id                  uuid primary key default gen_random_uuid(),
  ref                 text unique,

  commodity           text not null check (commodity in (
    'Maize','Rice','Sorghum','Millet','Soybeans','Cowpea','Groundnut',
    'Sesame','Cassava','Yam','Cocoa','Cashew','Ginger','Chili Pepper','Hibiscus'
  )),

  -- Origin chain. Nullable because a trader may aggregate stock that did not
  -- come through a Loamy farm — in that case origin is declared, not traced,
  -- and `origin_traced` says so rather than the data quietly implying it did.
  farm_id             uuid references public.farms (id) on delete set null,
  production_cycle_id uuid references public.crop_records (id) on delete set null,
  harvest_id          uuid references public.harvests (id) on delete set null,
  origin_traced       boolean not null default false,

  -- Who created it (the farmer/aggregator) vs who controls it now. Ownership
  -- moves on sale; origin never changes.
  origin_owner_id     uuid not null references public.profiles (id) on delete cascade,
  owner_id            uuid not null references public.profiles (id) on delete cascade,

  quantity            numeric not null check (quantity > 0),
  -- Uncommitted remainder. Only batch events may change this.
  available_quantity  numeric not null check (available_quantity >= 0),
  unit                text not null default 'kg'
    check (unit in ('kg','tonne','bag','crate','unit')),

  quality_grade       text,
  moisture_content    numeric check (moisture_content is null or (moisture_content >= 0 and moisture_content <= 100)),
  packaging           text,
  condition           text,

  origin_state        text,
  origin_lga          text,
  current_location    text,
  current_state       text,

  status              text not null default 'created' check (status in (
    'created','verified','listed','reserved','partially_sold','sold',
    'loaded','in_transit','warehouse_received','delivered','released',
    'disputed','cancelled'
  )),
  -- Set only by the verification workflow, never by the holder.
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','pending','verified','rejected')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint batch_available_within_total check (available_quantity <= quantity)
);

create index if not exists batches_owner_idx     on public.commodity_batches (owner_id, created_at desc);
create index if not exists batches_origin_idx    on public.commodity_batches (origin_owner_id, created_at desc);
create index if not exists batches_harvest_idx   on public.commodity_batches (harvest_id);
create index if not exists batches_commodity_idx on public.commodity_batches (commodity, status);

alter table public.commodity_batches enable row level security;

-- Read: current holder, origin farmer, admin. Nothing else at this phase.
drop policy if exists "loamy_batches_select" on public.commodity_batches;
create policy "loamy_batches_select"
  on public.commodity_batches for select to authenticated
  using (owner_id = auth.uid() or origin_owner_id = auth.uid() or public.loamy_is_admin());

-- NO client insert/update/delete policy, deliberately. Every write is an RPC
-- below, so quantity and status can never move without an event beside them.

drop trigger if exists loamy_batches_assign_ref on public.commodity_batches;
create trigger loamy_batches_assign_ref
  before insert on public.commodity_batches
  for each row execute function public.loamy_assign_ref('commodity_batch', 'BATCH');

drop trigger if exists loamy_batches_updated_at on public.commodity_batches;
create trigger loamy_batches_updated_at
  before update on public.commodity_batches
  for each row execute function public.loamy_set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. batch_events — the audit trail that makes traceability possible.
-- ----------------------------------------------------------------------------
create table if not exists public.batch_events (
  id              uuid primary key default gen_random_uuid(),
  ref             text unique,
  batch_id        uuid not null references public.commodity_batches (id) on delete cascade,

  event_type      text not null check (event_type in (
    'created','verified','verification_rejected','listed','unlisted','reserved',
    'partially_sold','sold','ownership_transferred','loaded','in_transit',
    'warehouse_received','delivered','released','disputed','cancelled',
    'quantity_adjusted','split'
  )),

  actor_id        uuid references public.profiles (id) on delete set null,
  previous_status text,
  new_status      text,

  -- Signed change to available_quantity, plus the balance it produced. Storing
  -- both means the ledger can be replayed and cross-checked.
  quantity_delta  numeric,
  quantity_after  numeric,

  location_state  text,
  location_lga    text,
  latitude        numeric check (latitude  is null or (latitude  between -90 and 90)),
  longitude       numeric check (longitude is null or (longitude between -180 and 180)),

  -- What the event relates to: a listing, an order, a shipment, a warehouse.
  subject_type    text,
  subject_id      uuid,

  metadata        jsonb not null default '{}'::jsonb,
  evidence        jsonb not null default '{}'::jsonb,
  note            text,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists batch_events_batch_idx on public.batch_events (batch_id, occurred_at);
create index if not exists batch_events_type_idx  on public.batch_events (event_type, occurred_at desc);

-- SECURITY-REVIEW: append-only. No client insert/update/delete policy exists
-- and none may be added — the event log is the evidence, and an editable
-- evidence log is worth nothing.
alter table public.batch_events enable row level security;

drop policy if exists "loamy_batch_events_select" on public.batch_events;
create policy "loamy_batch_events_select"
  on public.batch_events for select to authenticated
  using (exists (
    select 1 from public.commodity_batches b
    where b.id = batch_id
      and (b.owner_id = auth.uid() or b.origin_owner_id = auth.uid() or public.loamy_is_admin())
  ));

drop trigger if exists loamy_batch_events_assign_ref on public.batch_events;
create trigger loamy_batch_events_assign_ref
  before insert on public.batch_events
  for each row execute function public.loamy_assign_ref('batch_event', 'BEV');

-- ----------------------------------------------------------------------------
-- 3. Transition rules.
-- ----------------------------------------------------------------------------
-- Explicit matrix rather than scattered ifs: allowed_from, resulting status,
-- and who may initiate. Adding an event type without adding a row here means
-- the transition is refused, which is the safe default.
create table if not exists public.batch_transition_rules (
  event_type   text primary key,
  allowed_from text[] not null,
  new_status   text,
  -- 'holder'   — the member who currently controls the batch
  -- 'platform' — admin only (verification outcomes)
  -- 'system'   — other server-side flows (Phases 4-9 wire these)
  initiator    text not null check (initiator in ('holder','platform','system'))
);

alter table public.batch_transition_rules enable row level security;
drop policy if exists "loamy_batch_rules_read" on public.batch_transition_rules;
create policy "loamy_batch_rules_read"
  on public.batch_transition_rules for select to authenticated using (true);

insert into public.batch_transition_rules (event_type, allowed_from, new_status, initiator) values
  ('verified',              array['created','listed','pending'],                 'verified',           'platform'),
  ('verification_rejected', array['created','listed'],                            'created',            'platform'),
  ('listed',                array['created','verified','partially_sold'],         'listed',             'holder'),
  ('unlisted',              array['listed'],                                      'verified',           'holder'),
  ('reserved',              array['listed'],                                      'reserved',           'system'),
  ('partially_sold',        array['listed','reserved'],                           'partially_sold',     'system'),
  ('sold',                  array['listed','reserved','partially_sold'],          'sold',               'system'),
  ('ownership_transferred', array['sold'],                                        'sold',               'system'),
  ('loaded',                array['sold','partially_sold'],                       'loaded',             'holder'),
  ('in_transit',            array['loaded'],                                      'in_transit',         'system'),
  ('warehouse_received',    array['in_transit','loaded'],                         'warehouse_received', 'system'),
  ('delivered',             array['in_transit','warehouse_received'],             'delivered',          'system'),
  ('released',              array['delivered','warehouse_received'],              'released',           'system'),
  ('disputed',              array['created','verified','listed','reserved','partially_sold','sold','loaded','in_transit','warehouse_received','delivered'], 'disputed', 'holder'),
  ('cancelled',             array['created','verified','listed'],                 'cancelled',          'holder'),
  ('quantity_adjusted',     array['created','verified','listed'],                 null,                 'holder'),
  ('split',                 array['created','verified','listed'],                 null,                 'holder')
on conflict (event_type) do update
  set allowed_from = excluded.allowed_from,
      new_status   = excluded.new_status,
      initiator    = excluded.initiator;

-- ----------------------------------------------------------------------------
-- 4. Create a batch from a harvest.
-- ----------------------------------------------------------------------------
/**
 * The ONLY way a traced batch comes into existence.
 *
 * Refuses to over-issue: the sum of batches created from a harvest can never
 * exceed the harvest quantity, so a farmer cannot mint 200 tonnes of
 * traceable maize from a 100 tonne harvest.
 */
create or replace function public.loamy_create_batch_from_harvest(
  p_harvest_id uuid,
  p_quantity   numeric default null,
  p_grade      text default null,
  p_packaging  text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_h         public.harvests%rowtype;
  v_farm      public.farms%rowtype;
  v_allocated numeric;
  v_qty       numeric;
  v_id        uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_h from public.harvests where id = p_harvest_id;
  if v_h.id is null then raise exception 'Harvest not found.'; end if;

  select * into v_farm from public.farms where id = v_h.farm_id;
  if v_farm.owner_id <> v_uid then
    raise exception 'Only the farm owner can create a batch from this harvest.';
  end if;
  if v_h.status in ('cancelled','disputed') then
    raise exception 'This harvest is %, so no batch can be created from it.', v_h.status;
  end if;

  select coalesce(sum(quantity), 0) into v_allocated
  from public.commodity_batches
  where harvest_id = p_harvest_id and status <> 'cancelled';

  v_qty := coalesce(p_quantity, v_h.quantity - v_allocated);
  if v_qty <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;
  if v_allocated + v_qty > v_h.quantity + 0.000001 then
    raise exception 'Only % % of this harvest remains unbatched.',
      v_h.quantity - v_allocated, v_h.unit;
  end if;

  insert into public.commodity_batches (
    commodity, farm_id, production_cycle_id, harvest_id, origin_traced,
    origin_owner_id, owner_id, quantity, available_quantity, unit,
    quality_grade, packaging, condition,
    origin_state, origin_lga, current_state, current_location, status
  ) values (
    v_h.commodity, v_h.farm_id, v_h.production_cycle_id, p_harvest_id, true,
    v_uid, v_uid, v_qty, v_qty, v_h.unit,
    coalesce(p_grade, v_h.quality_grade), p_packaging, v_h.condition,
    coalesce(v_h.location_state, v_farm.state), coalesce(v_h.location_lga, v_farm.lga),
    coalesce(v_h.location_state, v_farm.state), v_h.location_note, 'created'
  ) returning id into v_id;

  insert into public.batch_events (
    batch_id, event_type, actor_id, previous_status, new_status,
    quantity_delta, quantity_after, location_state, location_lga,
    subject_type, subject_id, note
  ) values (
    v_id, 'created', v_uid, null, 'created',
    v_qty, v_qty, coalesce(v_h.location_state, v_farm.state), coalesce(v_h.location_lga, v_farm.lga),
    'harvest', p_harvest_id, 'Batch created from harvest'
  );

  -- The harvest is now represented by batches; quantity stops being freely
  -- editable from here (the harvests UPDATE policy pins status).
  update public.harvests set status = 'batched' where id = p_harvest_id;

  return v_id;
end;
$$;

revoke all on function public.loamy_create_batch_from_harvest(uuid,numeric,text,text) from public, anon;
grant execute on function public.loamy_create_batch_from_harvest(uuid,numeric,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. The single controlled transition path.
-- ----------------------------------------------------------------------------
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
  v_uid      uuid := auth.uid();
  v_b        public.commodity_batches%rowtype;
  v_rule     public.batch_transition_rules%rowtype;
  v_is_admin boolean := public.loamy_is_admin();
  v_new_qty  numeric;
  v_status   text;
  v_event    uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  -- Lock the row: two concurrent sales must not both pass the balance check.
  select * into v_b from public.commodity_batches where id = p_batch_id for update;
  if v_b.id is null then raise exception 'Batch not found.'; end if;

  select * into v_rule from public.batch_transition_rules where event_type = p_event_type;
  if v_rule.event_type is null then
    raise exception 'Unknown batch event: %', p_event_type;
  end if;

  -- Who may initiate.
  if v_rule.initiator = 'platform' and not v_is_admin then
    raise exception 'Only the platform can record a % event.', p_event_type;
  elsif v_rule.initiator = 'holder' and v_b.owner_id <> v_uid and not v_is_admin then
    raise exception 'Only the current holder can record a % event.', p_event_type;
  elsif v_rule.initiator = 'system' and not v_is_admin then
    -- Phases 4-9 will call these from their own definer functions, which run
    -- with elevated rights. A member may never drive them directly.
    raise exception 'A % event is recorded by the platform workflow, not directly.', p_event_type;
  end if;

  -- Where it may come from.
  if not (v_b.status = any (v_rule.allowed_from)) then
    raise exception 'A batch that is % cannot go to % (allowed from: %).',
      v_b.status, p_event_type, array_to_string(v_rule.allowed_from, ', ');
  end if;

  -- Quantity, if the event moves any.
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

  v_status := coalesce(v_rule.new_status, v_b.status);

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

comment on table public.commodity_batches is
  'COMMODITY BATCH (directive Part 9). The traceability spine. Quantity and status move only through loamy_batch_transition.';
comment on table public.batch_events is
  'Append-only batch history (directive Part 10). Every state change records actor, previous/new status, quantity delta and resulting balance.';
