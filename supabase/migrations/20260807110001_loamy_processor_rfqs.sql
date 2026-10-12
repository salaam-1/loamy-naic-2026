-- ============================================================================
-- Processor Dashboard — PART 2: RFQ (buy request) creation
-- ============================================================================
-- Company-scoped buy requests built through a six-step wizard, saved as a draft
-- between steps and published to matching suppliers. Reusable templates too.
--
-- SECURITY-REVIEW: multi-tenant company isolation — every rfqs / rfq_templates
-- read is scoped to the caller's own companies (loamy_user_company_ids());
-- writes require procurement authority in that company (loamy_company_can_procure).
-- Verify no cross-company leakage.
-- ============================================================================

create sequence if not exists public.rfq_reference_seq;

-- Procurement authority: founder, Procurement Director, or Procurement Manager.
create or replace function public.loamy_company_can_procure(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target and user_id = auth.uid()
      and (is_owner or company_role in ('Procurement Director','Procurement Manager'))
  );
$$;

grant execute on function public.loamy_company_can_procure(uuid) to authenticated;

create table if not exists public.rfqs (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  created_by            uuid not null default auth.uid() references auth.users(id),
  reference             text not null unique
                          default 'RFQ-' || to_char(now(), 'YYYY') || '-'
                            || lpad(nextval('public.rfq_reference_seq')::text, 6, '0'),
  -- Step 1 — commodity
  commodity             text not null,
  variety_id            uuid references public.commodity_varieties(id),
  grade                 text,
  moisture_content      numeric,
  quantity              numeric not null check (quantity > 0),
  unit                  text not null,
  packaging_type        text,
  -- Step 2 — delivery
  delivery_state        text,
  delivery_address      text,
  delivery_warehouse_id uuid,               -- FK added in Part 8 (no warehouses table yet)
  delivery_deadline     date,
  delivery_schedule     text,
  -- Step 3 — pricing
  pricing_mode          text not null default 'open_bidding'
                          check (pricing_mode in ('fixed','open_bidding')),
  max_price             numeric,
  -- Step 4 — visibility
  visibility            text not null default 'open'
                          check (visibility in ('open','invited','verified_only','founding_members')),
  -- Step 5 — inspection
  inspection_mode       text not null default 'loamy_partner'
                          check (inspection_mode in ('loamy_partner','company_inspector','third_party')),
  -- Step 6 — payment
  payment_mode          text not null default 'escrow'
                          check (payment_mode in ('escrow','bank_transfer')),
  status                text not null default 'draft'
                          check (status in ('draft','open','closed','awarded','completed','cancelled')),
  published_at          timestamptz,
  closes_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists rfqs_company_idx on public.rfqs(company_id, status);
create index if not exists rfqs_open_idx on public.rfqs(status, commodity, delivery_state) where status = 'open';

create table if not exists public.rfq_templates (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  name       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rfq_templates_company_idx on public.rfq_templates(company_id);

-- RLS ------------------------------------------------------------------------
alter table public.rfqs enable row level security;
alter table public.rfq_templates enable row level security;

-- Owner side (this part). Supplier read access to open RFQs arrives in Part 3.
drop policy if exists rfqs_select on public.rfqs;
create policy rfqs_select on public.rfqs
  for select to authenticated
  using (company_id in (select public.loamy_user_company_ids()) or public.loamy_is_admin());

drop policy if exists rfqs_insert on public.rfqs;
create policy rfqs_insert on public.rfqs
  for insert to authenticated
  with check (public.loamy_company_can_procure(company_id));

-- Only DRAFTS are editable directly; publishing and later transitions go through
-- SECURITY DEFINER RPCs (with check pins status to 'draft' so a client update
-- can never publish or otherwise advance the lifecycle on its own).
drop policy if exists rfqs_update on public.rfqs;
create policy rfqs_update on public.rfqs
  for update to authenticated
  using (public.loamy_company_can_procure(company_id) and status = 'draft')
  with check (public.loamy_company_can_procure(company_id) and status = 'draft');

drop policy if exists rfqs_delete on public.rfqs;
create policy rfqs_delete on public.rfqs
  for delete to authenticated
  using (public.loamy_company_can_procure(company_id) and status = 'draft');

drop policy if exists rfq_templates_select on public.rfq_templates;
create policy rfq_templates_select on public.rfq_templates
  for select to authenticated
  using (company_id in (select public.loamy_user_company_ids()) or public.loamy_is_admin());

drop policy if exists rfq_templates_write on public.rfq_templates;
create policy rfq_templates_write on public.rfq_templates
  for all to authenticated
  using (public.loamy_company_can_procure(company_id))
  with check (public.loamy_company_can_procure(company_id));

-- Publish RPC ----------------------------------------------------------------
-- Validates the draft, opens it, and notifies matching suppliers (by role,
-- delivery state and commodity). Notification is best-effort broadcast for any
-- non-'invited' visibility; suppliers also discover open RFQs on the board.
create or replace function public.loamy_publish_rfq(
  p_rfq_id uuid,
  p_closes_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rfqs;
  v_company text;
begin
  select * into r from public.rfqs where id = p_rfq_id;
  if not found then
    raise exception 'RFQ not found';
  end if;
  if not public.loamy_company_can_procure(r.company_id) then
    raise exception 'Not authorised to publish this buy request';
  end if;
  if r.status <> 'draft' then
    raise exception 'Only a draft can be published';
  end if;
  if coalesce(trim(r.commodity), '') = '' or r.quantity is null or r.quantity <= 0
     or coalesce(trim(r.unit), '') = '' then
    raise exception 'Commodity, quantity and unit are required before publishing';
  end if;
  if r.pricing_mode = 'fixed' and r.max_price is null then
    raise exception 'A fixed-price buy request needs a maximum price';
  end if;

  update public.rfqs
    set status = 'open',
        published_at = now(),
        closes_at = coalesce(p_closes_at, now() + interval '14 days'),
        updated_at = now()
  where id = p_rfq_id;

  if r.visibility <> 'invited' then
    select name into v_company from public.companies where id = r.company_id;
    insert into public.notifications (user_id, title, body, type)
    select distinct p.id,
      'New buy request: ' || r.commodity,
      coalesce(v_company, 'A processor') || ' is buying ' || r.quantity || ' ' || r.unit
        || ' of ' || r.commodity
        || coalesce(' for delivery in ' || r.delivery_state, '') || '. Tap to view and place a bid.',
      'rfq'
    from public.profiles p
    join public.role_details rd on rd.user_id = p.id
    where p.platform_role in ('trader','exporter','warehouse_owner')
      and (r.delivery_state is null or p.state = r.delivery_state)
      and (rd.role_data -> 'commodities') ? r.commodity
      and p.id <> r.created_by
    limit 1000;
  end if;
end;
$$;

grant execute on function public.loamy_publish_rfq(uuid, timestamptz) to authenticated;

-- Lifecycle helpers used by the board later; safe to add now.
create or replace function public.loamy_close_rfq(p_rfq_id uuid)
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
  update public.rfqs set status = 'closed', updated_at = now()
  where id = p_rfq_id and status = 'open';
end;
$$;

create or replace function public.loamy_cancel_rfq(p_rfq_id uuid)
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
  update public.rfqs set status = 'cancelled', updated_at = now()
  where id = p_rfq_id and status in ('draft','open','closed');
end;
$$;

grant execute on function public.loamy_close_rfq(uuid) to authenticated;
grant execute on function public.loamy_cancel_rfq(uuid) to authenticated;
