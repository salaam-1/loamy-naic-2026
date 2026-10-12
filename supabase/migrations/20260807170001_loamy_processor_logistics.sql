-- ============================================================================
-- Processor Dashboard — PART 8: logistics (transport + warehouse reservation)
-- ============================================================================
-- Buyer arranges transport for an award: Loamy logistics (broadcast to providers
-- in the service directory who respond with price/availability; buyer selects)
-- or external logistics (record only). Milestone timeline: assigned → picked up
-- → in transit → delivered → POD. Buyer can also reserve warehouse space from a
-- directory warehouse (no in-platform payment).
--
-- Live GPS truck tracking is Phase 2 (needs a telematics integration that does
-- not exist) — only the milestone timeline is built. See HANDOFF.md.
--
-- SECURITY-REVIEW: company isolation on transport_jobs / warehouse_reservations;
-- only the assigned provider and the buyer company can act on a job.
-- ============================================================================

create table if not exists public.transport_jobs (
  id                    uuid primary key default gen_random_uuid(),
  award_id              uuid not null unique references public.rfq_awards(id) on delete cascade,
  rfq_id                uuid not null references public.rfqs(id) on delete cascade,
  company_id            uuid not null references public.companies(id) on delete cascade,
  supplier_id           uuid not null references auth.users(id) on delete cascade,
  mode                  text not null check (mode in ('loamy','external')),
  pickup_location       text,
  dropoff_location      text,
  pickup_state          text,
  dropoff_state         text,
  commodity             text,
  quantity              numeric,
  unit                  text,
  requested_date        date,
  assigned_provider_id  uuid references public.profiles(id) on delete set null,
  external_provider_name text,
  status                text not null default 'broadcast'
                          check (status in ('broadcast','assigned','picked_up','in_transit','delivered','completed','cancelled')),
  pickup_confirmed_at   timestamptz,
  delivered_at          timestamptz,
  pod_url               text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists transport_company_idx on public.transport_jobs(company_id, status);
create index if not exists transport_provider_idx on public.transport_jobs(assigned_provider_id, status);
create index if not exists transport_pool_idx on public.transport_jobs(status) where status = 'broadcast';

create table if not exists public.transport_offers (
  id               uuid primary key default gen_random_uuid(),
  transport_job_id uuid not null references public.transport_jobs(id) on delete cascade,
  provider_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  price            numeric not null check (price >= 0),
  available_date   date,
  note             text,
  status           text not null default 'offered' check (status in ('offered','selected','declined')),
  created_at       timestamptz not null default now(),
  unique (transport_job_id, provider_id)
);

create table if not exists public.warehouse_reservations (
  id                 uuid primary key default gen_random_uuid(),
  award_id           uuid not null references public.rfq_awards(id) on delete cascade,
  rfq_id             uuid not null references public.rfqs(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete cascade,
  warehouse_owner_id uuid not null references public.profiles(id) on delete cascade,
  space_quantity     numeric,
  unit               text,
  start_date         date,
  end_date           date,
  rate_note          text,
  status             text not null default 'requested' check (status in ('requested','confirmed','declined','cancelled')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists wh_res_company_idx on public.warehouse_reservations(company_id);
create index if not exists wh_res_owner_idx on public.warehouse_reservations(warehouse_owner_id, status);

alter table public.transport_jobs enable row level security;
alter table public.transport_offers enable row level security;
alter table public.warehouse_reservations enable row level security;

-- Transport jobs: buyer company + assigned provider + admin.
drop policy if exists transport_select on public.transport_jobs;
create policy transport_select on public.transport_jobs
  for select to authenticated
  using (
    company_id in (select public.loamy_user_company_ids())
    or assigned_provider_id = auth.uid()
    or public.loamy_is_admin()
  );

-- Offers: the buyer company (on their job) + the offering provider + admin.
drop policy if exists transport_offers_select on public.transport_offers;
create policy transport_offers_select on public.transport_offers
  for select to authenticated
  using (
    provider_id = auth.uid()
    or transport_job_id in (select id from public.transport_jobs where company_id in (select public.loamy_user_company_ids()))
    or public.loamy_is_admin()
  );

-- Reservations: buyer company + the warehouse owner + admin.
drop policy if exists wh_res_select on public.warehouse_reservations;
create policy wh_res_select on public.warehouse_reservations
  for select to authenticated
  using (
    company_id in (select public.loamy_user_company_ids())
    or warehouse_owner_id = auth.uid()
    or public.loamy_is_admin()
  );

-- Role helpers ---------------------------------------------------------------
create or replace function public.loamy_is_role(p_role text)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and platform_role = p_role); $$;

grant execute on function public.loamy_is_role(text) to authenticated;

-- Request transport for an award (buyer procurement role).
create or replace function public.loamy_request_transport(
  p_award_id uuid,
  p_mode text,
  p_pickup text default null,
  p_dropoff text default null,
  p_requested_date date default null,
  p_external_provider text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  a public.rfq_awards; r public.rfqs; v_id uuid; v_pickup_state text;
begin
  select * into a from public.rfq_awards where id = p_award_id;
  if not found then raise exception 'Award not found'; end if;
  select * into r from public.rfqs where id = a.rfq_id;
  if not public.loamy_company_can_procure(r.company_id) then
    raise exception 'Not authorised to arrange transport';
  end if;
  if p_mode not in ('loamy','external') then raise exception 'Invalid transport mode'; end if;
  if exists (select 1 from public.transport_jobs where award_id = p_award_id and status <> 'cancelled') then
    raise exception 'A transport job already exists for this award';
  end if;

  select state into v_pickup_state from public.profiles where id = a.supplier_id;

  insert into public.transport_jobs (
    award_id, rfq_id, company_id, supplier_id, mode, pickup_location, dropoff_location,
    pickup_state, dropoff_state, commodity, quantity, unit, requested_date,
    external_provider_name, status
  ) values (
    p_award_id, a.rfq_id, r.company_id, a.supplier_id, p_mode,
    p_pickup, coalesce(p_dropoff, r.delivery_address), v_pickup_state, r.delivery_state,
    r.commodity, a.awarded_quantity, r.unit, p_requested_date,
    case when p_mode = 'external' then nullif(trim(p_external_provider), '') else null end,
    case when p_mode = 'loamy' then 'broadcast' else 'assigned' end
  ) returning id into v_id;

  -- Broadcast to logistics providers in the directory (pickup/dropoff states).
  if p_mode = 'loamy' then
    insert into public.notifications (user_id, title, body, type)
    select distinct sd.owner_id,
      'New transport request',
      'A transport job for ' || r.commodity || ' is available. Submit your price and availability.',
      'logistics'
    from public.service_directory sd
    where sd.service_type = 'logistics'
      and (sd.state = v_pickup_state or sd.state = r.delivery_state or v_pickup_state is null);
  end if;

  return v_id;
end;
$$;

grant execute on function public.loamy_request_transport(uuid, text, text, text, date, text) to authenticated;

-- Provider submits an offer on a broadcast job.
create or replace function public.loamy_submit_transport_offer(
  p_job_id uuid, p_price numeric, p_available_date date default null, p_note text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare j public.transport_jobs; v_id uuid;
begin
  select * into j from public.transport_jobs where id = p_job_id;
  if not found then raise exception 'Transport job not found'; end if;
  if j.status <> 'broadcast' then raise exception 'This job is no longer accepting offers'; end if;
  if not public.loamy_is_role('logistics_provider') then raise exception 'Only logistics providers can offer'; end if;
  if j.company_id in (select public.loamy_user_company_ids()) then raise exception 'You cannot offer on your own job'; end if;
  if p_price is null or p_price < 0 then raise exception 'Enter a valid price'; end if;

  insert into public.transport_offers (transport_job_id, provider_id, price, available_date, note)
  values (p_job_id, auth.uid(), p_price, p_available_date, nullif(trim(p_note), ''))
  on conflict (transport_job_id, provider_id) do update set
    price = excluded.price, available_date = excluded.available_date, note = excluded.note, status = 'offered'
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.loamy_submit_transport_offer(uuid, numeric, date, text) to authenticated;

-- Buyer selects a provider's offer → assigns the job, declines the rest.
create or replace function public.loamy_select_transport_offer(p_offer_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare o public.transport_offers; j public.transport_jobs;
begin
  select * into o from public.transport_offers where id = p_offer_id;
  if not found then raise exception 'Offer not found'; end if;
  select * into j from public.transport_jobs where id = o.transport_job_id;
  if not public.loamy_company_can_procure(j.company_id) then raise exception 'Not authorised'; end if;
  if j.status <> 'broadcast' then raise exception 'This job is already assigned'; end if;

  update public.transport_jobs
    set assigned_provider_id = o.provider_id, status = 'assigned', updated_at = now()
  where id = j.id;
  update public.transport_offers set status = 'selected' where id = p_offer_id;
  update public.transport_offers set status = 'declined' where transport_job_id = j.id and id <> p_offer_id;

  insert into public.notifications (user_id, title, body, type)
  values (o.provider_id, 'Transport job assigned', 'You were selected for a transport job. Coordinate pickup with the buyer.', 'logistics');
end;
$$;

grant execute on function public.loamy_select_transport_offer(uuid) to authenticated;

-- Advance a milestone. Assigned provider: picked_up/in_transit/delivered.
-- Buyer procurement: any milestone (incl. external mode) + completed + POD.
create or replace function public.loamy_update_transport_status(
  p_job_id uuid, p_status text, p_pod_url text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare j public.transport_jobs; v_is_provider boolean; v_is_buyer boolean;
begin
  select * into j from public.transport_jobs where id = p_job_id;
  if not found then raise exception 'Transport job not found'; end if;
  v_is_provider := (j.assigned_provider_id = auth.uid());
  v_is_buyer := public.loamy_company_can_procure(j.company_id);
  if not (v_is_provider or v_is_buyer) then raise exception 'Not authorised'; end if;
  if p_status not in ('picked_up','in_transit','delivered','completed','cancelled') then
    raise exception 'Invalid status';
  end if;
  if p_status = 'completed' and not v_is_buyer then
    raise exception 'Only the buyer can complete the job';
  end if;

  update public.transport_jobs set
    status = p_status,
    pickup_confirmed_at = case when p_status = 'picked_up' then now() else pickup_confirmed_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    pod_url = coalesce(nullif(trim(p_pod_url), ''), pod_url),
    updated_at = now()
  where id = p_job_id;

  -- On delivery, mark the award delivered.
  if p_status = 'delivered' then
    update public.rfq_awards set status = 'delivered', updated_at = now()
    where id = j.award_id and status in ('inspected','in_progress','awarded');
  end if;
end;
$$;

grant execute on function public.loamy_update_transport_status(uuid, text, text) to authenticated;

-- Warehouse reservation (no in-platform payment).
create or replace function public.loamy_reserve_warehouse(
  p_award_id uuid, p_warehouse_owner_id uuid, p_space numeric default null,
  p_unit text default null, p_start date default null, p_end date default null, p_rate_note text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare a public.rfq_awards; r public.rfqs; v_id uuid; v_company text;
begin
  select * into a from public.rfq_awards where id = p_award_id;
  if not found then raise exception 'Award not found'; end if;
  select * into r from public.rfqs where id = a.rfq_id;
  if not public.loamy_company_can_procure(r.company_id) then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.service_directory where owner_id = p_warehouse_owner_id and service_type = 'warehouse') then
    raise exception 'That warehouse is not in the directory';
  end if;

  insert into public.warehouse_reservations (
    award_id, rfq_id, company_id, warehouse_owner_id, space_quantity, unit, start_date, end_date, rate_note
  ) values (
    p_award_id, a.rfq_id, r.company_id, p_warehouse_owner_id, p_space, coalesce(p_unit, r.unit), p_start, p_end, nullif(trim(p_rate_note), '')
  ) returning id into v_id;

  select name into v_company from public.companies where id = r.company_id;
  insert into public.notifications (user_id, title, body, type)
  values (p_warehouse_owner_id, 'New storage reservation request',
    coalesce(v_company, 'A processor') || ' requested storage for ' || r.commodity || '. Confirm or decline.', 'logistics');

  return v_id;
end;
$$;

grant execute on function public.loamy_reserve_warehouse(uuid, uuid, numeric, text, date, date, text) to authenticated;

-- Warehouse owner confirms / declines a reservation.
create or replace function public.loamy_respond_reservation(p_reservation_id uuid, p_confirm boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare w public.warehouse_reservations;
begin
  select * into w from public.warehouse_reservations where id = p_reservation_id;
  if not found then raise exception 'Reservation not found'; end if;
  if w.warehouse_owner_id <> auth.uid() then raise exception 'Not authorised'; end if;
  if w.status <> 'requested' then raise exception 'This reservation has already been answered'; end if;

  update public.warehouse_reservations
    set status = case when p_confirm then 'confirmed' else 'declined' end,
        rate_note = coalesce(nullif(trim(p_note), ''), rate_note), updated_at = now()
  where id = p_reservation_id;

  insert into public.notifications (user_id, title, body, type)
  select cm.user_id,
    case when p_confirm then 'Storage confirmed' else 'Storage declined' end,
    'Your storage reservation was ' || case when p_confirm then 'confirmed.' else 'declined.' end, 'logistics'
  from public.company_members cm
  where cm.company_id = w.company_id
    and (cm.is_owner or cm.company_role in ('Procurement Director','Procurement Manager','Logistics Coordinator'));
end;
$$;

grant execute on function public.loamy_respond_reservation(uuid, boolean, text) to authenticated;

-- Views ----------------------------------------------------------------------
create or replace view public.loamy_transport_jobs_v as
  select j.*, ap.full_name as provider_name, sp.full_name as supplier_name
  from public.transport_jobs j
  left join public.profiles ap on ap.id = j.assigned_provider_id
  join public.profiles sp on sp.id = j.supplier_id
  where j.company_id in (select public.loamy_user_company_ids())
     or j.assigned_provider_id = auth.uid()
     or public.loamy_is_admin();

grant select on public.loamy_transport_jobs_v to authenticated;

-- Provider pool: broadcast jobs the caller (a logistics provider) can offer on.
create or replace view public.loamy_open_transport_jobs as
  select j.id, j.rfq_id, j.commodity, j.quantity, j.unit, j.pickup_state, j.dropoff_state,
         j.pickup_location, j.dropoff_location, j.requested_date, j.created_at,
         exists (select 1 from public.transport_offers o where o.transport_job_id = j.id and o.provider_id = auth.uid() and o.status <> 'declined') as already_offered
  from public.transport_jobs j
  where j.status = 'broadcast'
    and public.loamy_is_role('logistics_provider')
    and j.company_id not in (select public.loamy_user_company_ids());

grant select on public.loamy_open_transport_jobs to authenticated;

create or replace view public.loamy_transport_offers_v as
  select o.*, p.full_name as provider_name, p.state as provider_state
  from public.transport_offers o
  join public.profiles p on p.id = o.provider_id
  where o.provider_id = auth.uid()
     or o.transport_job_id in (select id from public.transport_jobs where company_id in (select public.loamy_user_company_ids()))
     or public.loamy_is_admin();

grant select on public.loamy_transport_offers_v to authenticated;

create or replace view public.loamy_warehouse_reservations_v as
  select w.*, p.full_name as warehouse_name, r.commodity, co.name as buyer_company
  from public.warehouse_reservations w
  join public.profiles p on p.id = w.warehouse_owner_id
  join public.rfqs r on r.id = w.rfq_id
  join public.companies co on co.id = w.company_id
  where w.company_id in (select public.loamy_user_company_ids())
     or w.warehouse_owner_id = auth.uid()
     or public.loamy_is_admin();

grant select on public.loamy_warehouse_reservations_v to authenticated;
