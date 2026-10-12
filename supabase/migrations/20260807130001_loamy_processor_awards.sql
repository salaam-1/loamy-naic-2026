-- ============================================================================
-- Processor Dashboard — PART 4: comparison, award, multi-supplier split
-- ============================================================================
-- A buyer can split one RFQ across several bids (e.g. 1,000 MT = 300 + 250 + 450).
-- Each award is tracked and fulfilled separately under the same RFQ. Supplier
-- contact stays hidden until the buyer awards them or explicitly proceeds.
--
-- SECURITY-REVIEW: contact disclosure gate. loamy_supplier_contact returns a
-- supplier's phone ONLY to a member of the RFQ's company AND only once an award
-- or an explicit disclosure exists for that (rfq, supplier). Verify no other
-- path exposes supplier contact, and that company isolation holds on awards.
-- ============================================================================

create table if not exists public.rfq_awards (
  id                uuid primary key default gen_random_uuid(),
  rfq_id            uuid not null references public.rfqs(id) on delete cascade,
  bid_id            uuid not null references public.rfq_bids(id) on delete cascade,
  supplier_id       uuid not null references auth.users(id) on delete cascade,
  awarded_quantity  numeric not null check (awarded_quantity > 0),
  awarded_price     numeric not null check (awarded_price > 0),
  status            text not null default 'awarded'
                      check (status in ('awarded','in_progress','inspected','delivered','completed','cancelled')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (rfq_id, bid_id)
);

create index if not exists rfq_awards_rfq_idx on public.rfq_awards(rfq_id);
create index if not exists rfq_awards_supplier_idx on public.rfq_awards(supplier_id);

create table if not exists public.rfq_contact_disclosures (
  id           uuid primary key default gen_random_uuid(),
  rfq_id       uuid not null references public.rfqs(id) on delete cascade,
  supplier_id  uuid not null references auth.users(id) on delete cascade,
  disclosed_by uuid not null default auth.uid() references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (rfq_id, supplier_id)
);

alter table public.rfq_awards enable row level security;
alter table public.rfq_contact_disclosures enable row level security;

-- Awards: the buyer company's members and the awarded supplier can read; writes
-- go through RPCs only.
drop policy if exists rfq_awards_select on public.rfq_awards;
create policy rfq_awards_select on public.rfq_awards
  for select to authenticated
  using (
    supplier_id = auth.uid()
    or rfq_id in (select id from public.rfqs where company_id in (select public.loamy_user_company_ids()))
    or public.loamy_is_admin()
  );

-- Disclosures: only the buyer company's members (or admin) read; writes via RPC.
drop policy if exists rfq_disclosures_select on public.rfq_contact_disclosures;
create policy rfq_disclosures_select on public.rfq_contact_disclosures
  for select to authenticated
  using (
    rfq_id in (select id from public.rfqs where company_id in (select public.loamy_user_company_ids()))
    or public.loamy_is_admin()
  );

-- Award one or more bids on an RFQ. p_awards = [{bid_id, quantity, price}, ...].
create or replace function public.loamy_award_bids(p_rfq_id uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rfqs;
  rec jsonb;
  v_bid public.rfq_bids;
  v_total numeric := 0;
  v_company text;
begin
  select * into r from public.rfqs where id = p_rfq_id;
  if not found then raise exception 'RFQ not found'; end if;
  if not public.loamy_company_can_procure(r.company_id) then
    raise exception 'Not authorised to award on this buy request';
  end if;
  if r.status not in ('open','closed','awarded') then
    raise exception 'This buy request cannot be awarded in its current state';
  end if;
  if p_awards is null or jsonb_typeof(p_awards) <> 'array' or jsonb_array_length(p_awards) = 0 then
    raise exception 'Select at least one bid to award';
  end if;

  -- Validate each award and total quantity.
  for rec in select * from jsonb_array_elements(p_awards) loop
    select * into v_bid from public.rfq_bids where id = (rec->>'bid_id')::uuid;
    if not found or v_bid.rfq_id <> p_rfq_id then
      raise exception 'A selected bid does not belong to this request';
    end if;
    if v_bid.status = 'withdrawn' then
      raise exception 'A selected bid has been withdrawn';
    end if;
    if coalesce((rec->>'quantity')::numeric, 0) <= 0 or coalesce((rec->>'price')::numeric, 0) <= 0 then
      raise exception 'Each award needs a quantity and price greater than zero';
    end if;
    v_total := v_total + (rec->>'quantity')::numeric;
  end loop;

  if v_total > r.quantity then
    raise exception 'Awarded quantity (%) exceeds the requested % %', v_total, r.quantity, r.unit;
  end if;

  select name into v_company from public.companies where id = r.company_id;

  for rec in select * from jsonb_array_elements(p_awards) loop
    select * into v_bid from public.rfq_bids where id = (rec->>'bid_id')::uuid;

    insert into public.rfq_awards (rfq_id, bid_id, supplier_id, awarded_quantity, awarded_price)
    values (p_rfq_id, v_bid.id, v_bid.supplier_id, (rec->>'quantity')::numeric, (rec->>'price')::numeric)
    on conflict (rfq_id, bid_id) do update set
      awarded_quantity = excluded.awarded_quantity,
      awarded_price = excluded.awarded_price,
      status = 'awarded',
      updated_at = now();

    update public.rfq_bids set status = 'awarded', updated_at = now() where id = v_bid.id;

    -- Awarding discloses contact to the buyer (see loamy_supplier_contact).
    insert into public.rfq_contact_disclosures (rfq_id, supplier_id)
    values (p_rfq_id, v_bid.supplier_id)
    on conflict (rfq_id, supplier_id) do nothing;

    insert into public.notifications (user_id, title, body, type)
    values (v_bid.supplier_id,
      'Your bid was awarded',
      coalesce(v_company, 'A processor') || ' awarded you ' || (rec->>'quantity')::numeric || ' ' || r.unit
        || ' of ' || r.commodity || ' (' || r.reference || ').',
      'award');
  end loop;

  update public.rfqs set status = 'awarded', updated_at = now() where id = p_rfq_id;
end;
$$;

grant execute on function public.loamy_award_bids(uuid, jsonb) to authenticated;

-- Explicitly disclose a supplier's contact without (yet) awarding — the
-- "Proceed with supplier" action. Buyer procurement role required.
create or replace function public.loamy_disclose_supplier_contact(p_rfq_id uuid, p_supplier_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid;
begin
  select company_id into v_company from public.rfqs where id = p_rfq_id;
  if v_company is null then raise exception 'RFQ not found'; end if;
  if not public.loamy_company_can_procure(v_company) then
    raise exception 'Not authorised';
  end if;
  -- Only a real bidder on this RFQ can be proceeded with.
  if not exists (select 1 from public.rfq_bids where rfq_id = p_rfq_id and supplier_id = p_supplier_id) then
    raise exception 'That supplier has not bid on this request';
  end if;
  insert into public.rfq_contact_disclosures (rfq_id, supplier_id)
  values (p_rfq_id, p_supplier_id)
  on conflict (rfq_id, supplier_id) do nothing;
end;
$$;

grant execute on function public.loamy_disclose_supplier_contact(uuid, uuid) to authenticated;

-- SECURITY-REVIEW: contact disclosure gate — the ONLY path to a supplier's
-- phone. Requires (1) caller is a member of the RFQ's company, (2) a disclosure
-- or award exists for that (rfq, supplier).
create or replace function public.loamy_supplier_contact(p_rfq_id uuid, p_supplier_id uuid)
returns table (full_name text, phone text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_company uuid;
begin
  select company_id into v_company from public.rfqs where id = p_rfq_id;
  if v_company is null then raise exception 'RFQ not found'; end if;
  if v_company not in (select public.loamy_user_company_ids()) and not public.loamy_is_admin() then
    raise exception 'Not authorised';
  end if;
  if not exists (
    select 1 from public.rfq_contact_disclosures d
    where d.rfq_id = p_rfq_id and d.supplier_id = p_supplier_id
  ) then
    raise exception 'Contact becomes available once you award or proceed with this supplier';
  end if;
  return query
    select p.full_name, p.phone from public.profiles p where p.id = p_supplier_id;
end;
$$;

grant execute on function public.loamy_supplier_contact(uuid, uuid) to authenticated;

-- Awards enriched with supplier name (name is not contact-sensitive; it already
-- shows on bids). Contact still only via loamy_supplier_contact.
create or replace view public.loamy_rfq_awards_v as
  select
    a.id, a.rfq_id, a.bid_id, a.supplier_id, a.awarded_quantity, a.awarded_price,
    a.status, a.created_at, a.updated_at,
    p.full_name as supplier_name,
    p.state as supplier_state,
    b.delivery_date,
    exists (
      select 1 from public.rfq_contact_disclosures d
      where d.rfq_id = a.rfq_id and d.supplier_id = a.supplier_id
    ) as contact_disclosed
  from public.rfq_awards a
  join public.profiles p on p.id = a.supplier_id
  join public.rfq_bids b on b.id = a.bid_id
  where a.rfq_id in (select id from public.rfqs where company_id in (select public.loamy_user_company_ids()))
     or a.supplier_id = auth.uid()
     or public.loamy_is_admin();

grant select on public.loamy_rfq_awards_v to authenticated;
