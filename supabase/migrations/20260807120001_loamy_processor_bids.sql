-- ============================================================================
-- Processor Dashboard — PART 3: Supplier bids
-- ============================================================================
-- Suppliers (farmers, traders, exporters, warehouse owners) see the open RFQs
-- they qualify for and submit bids. Buyers see all bids on their own RFQs,
-- enriched with REAL supplier track record only (verification, completed Loamy
-- transactions) — never a fabricated score. Ranking is done client-side from
-- these transparent facts (see src/lib/bids.ts), never labelled "AI".
--
-- SECURITY-REVIEW: contact details (phone/email) are deliberately NOT exposed in
-- the buyer-facing bids view — supplier contact stays hidden until award/proceed
-- (Part 4). Company isolation: buyers only ever see bids on their own company's
-- RFQs. Verify no cross-company leakage and no contact leakage.
-- ============================================================================

create table if not exists public.rfq_bids (
  id                 uuid primary key default gen_random_uuid(),
  rfq_id             uuid not null references public.rfqs(id) on delete cascade,
  supplier_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  price_per_unit     numeric not null check (price_per_unit > 0),
  unit               text not null,
  available_quantity numeric not null check (available_quantity > 0),
  delivery_date      date,
  warehouse_id       uuid,                 -- FK added in Part 8
  farm_origin        text,
  photos             text[] not null default '{}',
  documents          text[] not null default '{}',
  note               text,
  status             text not null default 'submitted'
                       check (status in ('submitted','shortlisted','awarded','declined','withdrawn')),
  submitted_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (rfq_id, supplier_id)
);

create index if not exists rfq_bids_rfq_idx on public.rfq_bids(rfq_id, status);
create index if not exists rfq_bids_supplier_idx on public.rfq_bids(supplier_id);

alter table public.rfq_bids enable row level security;

-- Read: the bidding supplier sees their own bids; the buyer company's members
-- see every bid on their own RFQs; admin sees all. Writes go through RPCs only.
drop policy if exists rfq_bids_select on public.rfq_bids;
create policy rfq_bids_select on public.rfq_bids
  for select to authenticated
  using (
    supplier_id = auth.uid()
    or rfq_id in (select id from public.rfqs where company_id in (select public.loamy_user_company_ids()))
    or public.loamy_is_admin()
  );

-- Which platform roles may supply a processor. (input_supplier sells inputs to
-- farmers, not commodities to processors — excluded.)
create or replace function public.loamy_is_supplier_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and platform_role in ('farmer','trader','exporter','warehouse_owner')
  );
$$;

grant execute on function public.loamy_is_supplier_role() to authenticated;

-- Does the caller qualify to bid on a given RFQ (open + visibility rule)?
-- 'founding_members' and 'invited' are intentionally NOT surfaced yet — there is
-- no reliable founding/invited-supplier signal to target honestly. They become
-- visible once that membership source lands. Until then those RFQs get no bids.
create or replace function public.loamy_can_bid_on(p_rfq_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare r public.rfqs;
begin
  select * into r from public.rfqs where id = p_rfq_id;
  if not found then return false; end if;
  if r.status <> 'open' then return false; end if;
  if r.closes_at is not null and r.closes_at <= now() then return false; end if;
  if not public.loamy_is_supplier_role() then return false; end if;
  -- Can't bid on your own company's request.
  if r.company_id in (select public.loamy_user_company_ids()) then return false; end if;
  if r.visibility = 'open' then
    return true;
  elsif r.visibility = 'verified_only' then
    return exists (select 1 from public.farms where owner_id = auth.uid() and verification_status = 'verified');
  else
    return false;  -- founding_members / invited: not targetable yet
  end if;
end;
$$;

grant execute on function public.loamy_can_bid_on(uuid) to authenticated;

-- Submit (or update) a bid. One active bid per supplier per RFQ.
create or replace function public.loamy_submit_bid(
  p_rfq_id uuid,
  p_price_per_unit numeric,
  p_unit text,
  p_available_quantity numeric,
  p_delivery_date date default null,
  p_farm_origin text default null,
  p_photos text[] default '{}',
  p_documents text[] default '{}',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.loamy_can_bid_on(p_rfq_id) then
    raise exception 'You are not eligible to bid on this request (it may be closed or restricted).';
  end if;
  if p_price_per_unit is null or p_price_per_unit <= 0 then
    raise exception 'Enter a price greater than zero.';
  end if;
  if p_available_quantity is null or p_available_quantity <= 0 then
    raise exception 'Enter the quantity you can supply.';
  end if;

  insert into public.rfq_bids (
    rfq_id, supplier_id, price_per_unit, unit, available_quantity, delivery_date,
    farm_origin, photos, documents, note, status, updated_at
  ) values (
    p_rfq_id, auth.uid(), p_price_per_unit, p_unit, p_available_quantity, p_delivery_date,
    nullif(trim(p_farm_origin), ''), coalesce(p_photos, '{}'), coalesce(p_documents, '{}'),
    nullif(trim(p_note), ''), 'submitted', now()
  )
  on conflict (rfq_id, supplier_id) do update set
    price_per_unit = excluded.price_per_unit,
    unit = excluded.unit,
    available_quantity = excluded.available_quantity,
    delivery_date = excluded.delivery_date,
    farm_origin = excluded.farm_origin,
    photos = excluded.photos,
    documents = excluded.documents,
    note = excluded.note,
    status = case when public.rfq_bids.status = 'awarded' then public.rfq_bids.status else 'submitted' end,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.loamy_submit_bid(uuid, numeric, text, numeric, date, text, text[], text[], text) to authenticated;

create or replace function public.loamy_withdraw_bid(p_bid_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rfq_bids
    set status = 'withdrawn', updated_at = now()
  where id = p_bid_id and supplier_id = auth.uid() and status in ('submitted','shortlisted');
  if not found then
    raise exception 'Bid not found, not yours, or can no longer be withdrawn.';
  end if;
end;
$$;

grant execute on function public.loamy_withdraw_bid(uuid) to authenticated;

-- Supplier board: open RFQs the caller qualifies for. No buyer contact details.
create or replace view public.loamy_open_rfqs as
  select
    r.id, r.reference, r.commodity, r.variety_id, r.grade, r.moisture_content,
    r.quantity, r.unit, r.packaging_type, r.delivery_state, r.delivery_address,
    r.delivery_deadline, r.delivery_schedule, r.pricing_mode, r.max_price,
    r.visibility, r.inspection_mode, r.payment_mode, r.published_at, r.closes_at,
    c.name as company_name,
    exists (
      select 1 from public.rfq_bids b
      where b.rfq_id = r.id and b.supplier_id = auth.uid() and b.status <> 'withdrawn'
    ) as already_bid
  from public.rfqs r
  join public.companies c on c.id = r.company_id
  where r.status = 'open'
    and (r.closes_at is null or r.closes_at > now())
    and r.company_id not in (select public.loamy_user_company_ids())
    and public.loamy_is_supplier_role()
    and (
      r.visibility = 'open'
      or (r.visibility = 'verified_only'
          and exists (select 1 from public.farms f where f.owner_id = auth.uid() and f.verification_status = 'verified'))
    );

grant select on public.loamy_open_rfqs to authenticated;

-- Buyer-facing bids, enriched with REAL supplier track record only. No contact
-- fields. Scoped to the buyer's own company RFQs (or the supplier's own bids).
create or replace view public.loamy_rfq_bids_v as
  select
    b.id, b.rfq_id, b.supplier_id, b.price_per_unit, b.unit, b.available_quantity,
    b.delivery_date, b.farm_origin, b.photos, b.documents, b.note, b.status,
    b.submitted_at, b.updated_at,
    p.full_name as supplier_name,
    p.state as supplier_state,
    exists (
      select 1 from public.farms f where f.owner_id = b.supplier_id and f.verification_status = 'verified'
    ) as supplier_verified,
    (select count(*)::int from public.orders o where o.seller_id = b.supplier_id and o.status = 'completed')
      as completed_transactions,
    null::numeric as on_time_rate   -- no reliable delivery-timing records in v1
  from public.rfq_bids b
  join public.profiles p on p.id = b.supplier_id
  where b.rfq_id in (select id from public.rfqs where company_id in (select public.loamy_user_company_ids()))
     or b.supplier_id = auth.uid()
     or public.loamy_is_admin();

grant select on public.loamy_rfq_bids_v to authenticated;
