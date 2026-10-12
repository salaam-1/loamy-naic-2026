-- ============================================================================
-- PHASE 8 — logistics.
-- ----------------------------------------------------------------------------
-- Directive Part 21. Users request transport, see providers, receive bids,
-- select one, track the shipment and confirm delivery. External logistics must
-- stay possible: "Do not force users to use Loamy logistics."
--
-- DELIBERATE REUSE: transport_jobs / transport_offers already exist, but they
-- are AWARD-SCOPED -- award_id is NOT NULL UNIQUE against rfq_awards, so they
-- only ever served the processor procurement suite. A second, parallel
-- logistics system for marketplace transactions would mean two inboxes for the
-- same haulier and two places to look for one truck.
--
-- So the existing tables are GENERALISED: award_id becomes optional, and a job
-- may instead hang off a transaction and a batch. Exactly one origin is
-- required, enforced by a CHECK.
--
-- SECURITY-REVIEW ** LOCATION OF REAL GOODS IN TRANSIT **
-- A shipment event carries the live position of a loaded truck. That is a
-- theft risk. Read is scoped to the parties to the job (requester, supplier,
-- assigned provider, owning company) and admin. It must never reach the open
-- board, which shows only pickup/dropoff STATE for bidding purposes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Generalise transport_jobs beyond RFQ awards.
-- ----------------------------------------------------------------------------
alter table public.transport_jobs
  alter column award_id drop not null,
  alter column rfq_id   drop not null,
  alter column company_id drop not null,
  alter column supplier_id drop not null;

-- award_id was UNIQUE NOT NULL; it must stay unique WHEN PRESENT so one award
-- still cannot spawn two jobs, but many jobs may have no award at all.
alter table public.transport_jobs drop constraint if exists transport_jobs_award_id_key;
create unique index if not exists transport_jobs_award_uniq
  on public.transport_jobs (award_id) where award_id is not null;

alter table public.transport_jobs
  add column if not exists ref            text unique,
  add column if not exists transaction_id uuid references public.transactions (id) on delete cascade,
  add column if not exists batch_id       uuid references public.commodity_batches (id) on delete set null,
  -- Who asked for the transport. For award jobs this stays null (the company owns it).
  add column if not exists requested_by   uuid references public.profiles (id) on delete set null,
  add column if not exists pickup_lga     text,
  add column if not exists dropoff_lga    text,
  add column if not exists agreed_price   numeric check (agreed_price is null or agreed_price >= 0),
  add column if not exists updated_at     timestamptz not null default now();

-- A job belongs to exactly one thing.
alter table public.transport_jobs drop constraint if exists transport_jobs_one_origin;
alter table public.transport_jobs add constraint transport_jobs_one_origin
  check (num_nonnulls(award_id, transaction_id) = 1);

-- Part 21's status vocabulary, unioned with the words already in the table so
-- existing rows stay valid.
alter table public.transport_jobs drop constraint if exists transport_jobs_status_check;
alter table public.transport_jobs add constraint transport_jobs_status_check
  check (status in (
    'requested','matching','broadcast','booked','assigned','loading','loaded',
    'picked_up','in_transit','arrived','delivered','completed','failed',
    'cancelled','disputed'
  ));

create index if not exists transport_jobs_txn_idx on public.transport_jobs (transaction_id);

drop trigger if exists loamy_transport_jobs_assign_ref on public.transport_jobs;
create trigger loamy_transport_jobs_assign_ref
  before insert on public.transport_jobs
  for each row execute function public.loamy_assign_ref('logistics_job', 'LOG');

drop trigger if exists loamy_transport_jobs_updated_at on public.transport_jobs;
create trigger loamy_transport_jobs_updated_at
  before update on public.transport_jobs
  for each row execute function public.loamy_set_updated_at();

do $$
declare r record;
begin
  for r in select id from public.transport_jobs where ref is null loop
    update public.transport_jobs
       set ref = public.loamy_register_ref('logistics_job', r.id, 'LOG') where id = r.id;
  end loop;
end;
$$;

comment on table public.transport_jobs is
  'LOGISTICS JOB (directive Part 21). Serves both RFQ awards and marketplace transactions -- exactly one of award_id / transaction_id. mode=external records haulage Loamy did not arrange.';

-- ----------------------------------------------------------------------------
-- 2. Read access for the transaction side.
-- ----------------------------------------------------------------------------
-- The existing policies cover award/company jobs. Add the parties to a
-- transaction-backed job without touching those.
drop policy if exists "loamy_transport_jobs_select_txn" on public.transport_jobs;
create policy "loamy_transport_jobs_select_txn"
  on public.transport_jobs for select to authenticated
  using (
    requested_by = auth.uid()
    or assigned_provider_id = auth.uid()
    or exists (
      select 1 from public.transactions t
      where t.id = transaction_id
        and (t.buyer_id = auth.uid() or t.seller_id = auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- 3. shipment_events — the tracking trail.
-- ----------------------------------------------------------------------------
create table if not exists public.shipment_events (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  job_id        uuid not null references public.transport_jobs (id) on delete cascade,
  event_type    text not null check (event_type in (
    'requested','matching','offer_selected','booked','loading','loaded',
    'departed','position','arrived','delivered','failed','cancelled','disputed','note'
  )),
  actor_id      uuid references public.profiles (id) on delete set null,
  previous_status text,
  new_status    text,
  latitude      numeric check (latitude  is null or (latitude  between -90 and 90)),
  longitude     numeric check (longitude is null or (longitude between -180 and 180)),
  location_note text,
  evidence      jsonb not null default '{}'::jsonb,
  note          text,
  occurred_at   timestamptz not null default now()
);

create index if not exists shipment_events_job_idx on public.shipment_events (job_id, occurred_at);

-- SECURITY-REVIEW: append-only, and scoped to the job's parties. Live truck
-- position is the most sensitive thing in this phase.
alter table public.shipment_events enable row level security;

drop policy if exists "loamy_shipment_events_select" on public.shipment_events;
create policy "loamy_shipment_events_select"
  on public.shipment_events for select to authenticated
  using (exists (
    select 1 from public.transport_jobs j
    where j.id = job_id
      and (
        j.requested_by = auth.uid()
        or j.assigned_provider_id = auth.uid()
        or j.supplier_id = auth.uid()
        or public.loamy_is_admin()
        or exists (select 1 from public.transactions t
                   where t.id = j.transaction_id
                     and (t.buyer_id = auth.uid() or t.seller_id = auth.uid()))
        or (j.company_id is not null
            and j.company_id in (select public.loamy_user_company_ids()))
      )
  ));

drop trigger if exists loamy_shipment_events_assign_ref on public.shipment_events;
create trigger loamy_shipment_events_assign_ref
  before insert on public.shipment_events
  for each row execute function public.loamy_assign_ref('shipment_event', 'SHP');

-- ----------------------------------------------------------------------------
-- 4. Transition rules.
-- ----------------------------------------------------------------------------
create table if not exists public.logistics_transition_rules (
  event_type   text primary key,
  allowed_from text[] not null,
  new_status   text,
  -- 'requester' | 'provider' | 'either' | 'platform'
  initiator    text not null check (initiator in ('requester','provider','either','platform'))
);

alter table public.logistics_transition_rules enable row level security;
drop policy if exists "loamy_logi_rules_read" on public.logistics_transition_rules;
create policy "loamy_logi_rules_read"
  on public.logistics_transition_rules for select to authenticated using (true);

insert into public.logistics_transition_rules (event_type, allowed_from, new_status, initiator) values
  ('matching',       array['requested'],                              'matching',  'requester'),
  ('offer_selected', array['requested','matching','broadcast'],       'booked',    'requester'),
  ('loading',        array['booked','assigned'],                      'loading',   'provider'),
  ('loaded',         array['booked','assigned','loading'],            'loaded',    'provider'),
  ('departed',       array['loaded','picked_up'],                     'in_transit','provider'),
  ('position',       array['in_transit'],                             null,        'provider'),
  ('arrived',        array['in_transit'],                             'arrived',   'provider'),
  ('delivered',      array['arrived','in_transit'],                   'delivered', 'provider'),
  ('failed',         array['booked','assigned','loading','loaded','in_transit','arrived'], 'failed', 'either'),
  ('cancelled',      array['requested','matching','broadcast','booked','assigned'], 'cancelled', 'requester'),
  ('disputed',       array['loaded','in_transit','arrived','delivered'], 'disputed','either'),
  ('note',           array['requested','matching','broadcast','booked','assigned','loading','loaded','in_transit','arrived','delivered'], null, 'either')
on conflict (event_type) do update
  set allowed_from = excluded.allowed_from,
      new_status   = excluded.new_status,
      initiator    = excluded.initiator;

-- ----------------------------------------------------------------------------
-- 5. Request transport for a transaction.
-- ----------------------------------------------------------------------------
/**
 * Either party to a transaction may arrange haulage.
 *
 * mode='external' records transport the user arranged themselves. The
 * directive is explicit that Loamy logistics must not be forced, so an
 * external job is a first-class record with the same tracking trail, not a
 * second-class placeholder.
 */
create or replace function public.loamy_request_transport(
  p_transaction_id uuid,
  p_mode           text default 'loamy',
  p_pickup_state   text default null,
  p_pickup_lga     text default null,
  p_dropoff_state  text default null,
  p_dropoff_lga    text default null,
  p_requested_date date default null,
  p_external_provider_name text default null
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
  if p_mode not in ('loamy','external') then raise exception 'Unknown transport mode.'; end if;

  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if v_t.buyer_id <> v_uid and v_t.seller_id <> v_uid then
    raise exception 'That is not your transaction.';
  end if;
  if v_t.status not in ('accepted','verified','completed') then
    raise exception 'Arrange transport once the transaction is accepted (this one is %).', v_t.status;
  end if;
  if exists (select 1 from public.transport_jobs
             where transaction_id = p_transaction_id
               and status not in ('cancelled','failed')) then
    raise exception 'Transport is already arranged for this transaction.';
  end if;

  insert into public.transport_jobs (
    transaction_id, batch_id, requested_by, mode, commodity, quantity, unit,
    pickup_state, pickup_lga, dropoff_state, dropoff_lga,
    requested_date, external_provider_name, status
  ) values (
    p_transaction_id, v_t.batch_id, v_uid, p_mode, v_t.commodity, v_t.quantity, v_t.unit,
    p_pickup_state, p_pickup_lga,
    coalesce(p_dropoff_state, v_t.delivery_state), coalesce(p_dropoff_lga, v_t.delivery_lga),
    p_requested_date, p_external_provider_name,
    case when p_mode = 'external' then 'booked' else 'requested' end
  ) returning id into v_id;

  insert into public.shipment_events (job_id, event_type, actor_id, new_status, note)
  values (v_id, 'requested', v_uid,
          case when p_mode = 'external' then 'booked' else 'requested' end,
          case when p_mode = 'external'
               then 'External haulage: ' || coalesce(p_external_provider_name, 'provider not named')
               else null end);

  return v_id;
end;
$$;

revoke all on function public.loamy_request_transport(uuid,text,text,text,text,text,date,text) from public, anon;
grant execute on function public.loamy_request_transport(uuid,text,text,text,text,text,date,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. The controlled transition path.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_logistics_transition(
  p_job_id     uuid,
  p_event_type text,
  p_latitude   numeric default null,
  p_longitude  numeric default null,
  p_location_note text default null,
  p_evidence   jsonb default '{}'::jsonb,
  p_note       text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_j        public.transport_jobs%rowtype;
  v_rule     public.logistics_transition_rules%rowtype;
  v_is_admin boolean := public.loamy_is_admin();
  v_is_req   boolean;
  v_is_prov  boolean;
  v_status   text;
  v_event    uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_j from public.transport_jobs where id = p_job_id for update;
  if v_j.id is null then raise exception 'Transport job not found.'; end if;

  select * into v_rule from public.logistics_transition_rules where event_type = p_event_type;
  if v_rule.event_type is null then raise exception 'Unknown logistics event: %', p_event_type; end if;

  v_is_req := v_j.requested_by = v_uid
              or exists (select 1 from public.transactions t
                         where t.id = v_j.transaction_id
                           and (t.buyer_id = v_uid or t.seller_id = v_uid));
  -- On an external job the requester is also the one reporting progress,
  -- because there is no Loamy provider to report it.
  v_is_prov := v_j.assigned_provider_id = v_uid
               or (v_j.mode = 'external' and v_is_req);

  if not (v_is_req or v_is_prov or v_is_admin) then
    raise exception 'That is not your transport job.';
  end if;
  if v_rule.initiator = 'requester' and not (v_is_req or v_is_admin) then
    raise exception 'Only the party who requested this transport can record %.', p_event_type;
  elsif v_rule.initiator = 'provider' and not (v_is_prov or v_is_admin) then
    raise exception 'Only the assigned provider can record %.', p_event_type;
  elsif v_rule.initiator = 'platform' and not v_is_admin then
    raise exception 'Only the platform can record %.', p_event_type;
  end if;

  if not (v_j.status = any (v_rule.allowed_from)) then
    raise exception 'A job that is % cannot go to % (allowed from: %).',
      v_j.status, p_event_type, array_to_string(v_rule.allowed_from, ', ');
  end if;

  v_status := coalesce(v_rule.new_status, v_j.status);

  update public.transport_jobs
     set status = v_status,
         pickup_confirmed_at = case when p_event_type = 'loaded' then now() else pickup_confirmed_at end,
         delivered_at        = case when p_event_type = 'delivered' then now() else delivered_at end,
         updated_at = now()
   where id = p_job_id;

  insert into public.shipment_events (
    job_id, event_type, actor_id, previous_status, new_status,
    latitude, longitude, location_note, evidence, note
  ) values (
    p_job_id, p_event_type, v_uid, v_j.status, v_status,
    p_latitude, p_longitude, p_location_note,
    coalesce(p_evidence, '{}'::jsonb), p_note
  ) returning id into v_event;

  -- Carry the movement onto the batch and the transaction, through THEIR
  -- controlled paths -- logistics does not write their columns directly.
  if v_j.transaction_id is not null and p_event_type in ('loaded','departed','delivered') then
    perform set_config('loamy.txn_system_authorized', 'true', true);
    perform set_config('loamy.batch_system_authorized', 'true', true);

    if p_event_type = 'loaded' then
      perform public.loamy_transaction_transition(
        v_j.transaction_id, 'loaded', 'fulfilment', null, '{}'::jsonb, null, null);
    elsif p_event_type = 'departed' then
      perform public.loamy_transaction_transition(
        v_j.transaction_id, 'in_transit', 'fulfilment', null, '{}'::jsonb, null, null);
      if v_j.batch_id is not null then
        perform public.loamy_batch_transition(
          v_j.batch_id, 'in_transit', null, 'logistics_job', p_job_id,
          p_location_note, null, p_latitude, p_longitude, '{}'::jsonb, '{}'::jsonb, null);
      end if;
    elsif p_event_type = 'delivered' then
      perform public.loamy_transaction_transition(
        v_j.transaction_id, 'delivered', 'fulfilment', null, '{}'::jsonb, null, null);
      if v_j.batch_id is not null then
        perform public.loamy_batch_transition(
          v_j.batch_id, 'delivered', null, 'logistics_job', p_job_id,
          p_location_note, null, p_latitude, p_longitude, '{}'::jsonb, '{}'::jsonb, null);
      end if;
    end if;

    perform set_config('loamy.txn_system_authorized', 'false', true);
    perform set_config('loamy.batch_system_authorized', 'false', true);
  end if;

  return v_event;
end;
$$;

revoke all on function public.loamy_logistics_transition(uuid,text,numeric,numeric,text,jsonb,text) from public, anon;
grant execute on function public.loamy_logistics_transition(uuid,text,numeric,numeric,text,jsonb,text) to authenticated;

comment on table public.shipment_events is
  'Append-only shipment trail (directive Part 21). Carries live truck position, so read is scoped to the job parties only.';
