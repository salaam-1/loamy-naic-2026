-- ============================================================================
-- Trader + Buyer merged; exporters procure like processors.
-- ----------------------------------------------------------------------------
-- 1) Trader and Buyer are now ONE dashboard ("Trader & Buyer"). `trader` is the
--    canonical slug and the only one offered at signup; `buyer` stays a valid
--    platform_role so existing accounts are untouched, and anywhere the two
--    roles were treated differently they are now treated the same.
--
-- 2) Exporters run the full procurement suite. The suite is gated on COMPANY
--    MEMBERSHIP (loamy_company_can_procure), not on platform_role, so nothing
--    server-side has to change for exporters to post buy requests, rank bids,
--    award, contract, inspect and settle. What does change is the copy: a
--    buy request no longer necessarily comes from "a processor".
--
-- No data is rewritten and no role is deleted.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The merged desk supplies as well as buys, so `buyer` joins the roles that
--    may bid on an open buy request.
-- ----------------------------------------------------------------------------
-- (input_supplier still excluded: they sell inputs to farmers, not commodities
-- to off-takers.)
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
      and platform_role in ('farmer','trader','buyer','exporter','warehouse_owner')
  );
$$;

grant execute on function public.loamy_is_supplier_role() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Publish RPC: notify the merged Trader & Buyer role too, and stop calling
--    every procuring company "a processor" now that exporters procure as well.
-- ----------------------------------------------------------------------------
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
      coalesce(v_company, 'A verified buyer') || ' is buying ' || r.quantity || ' ' || r.unit
        || ' of ' || r.commodity
        || coalesce(' for delivery in ' || r.delivery_state, '') || '. Tap to view and place a bid.',
      'rfq'
    from public.profiles p
    join public.role_details rd on rd.user_id = p.id
    where p.platform_role in ('trader','buyer','exporter','warehouse_owner')
      and (r.delivery_state is null or p.state = r.delivery_state)
      and (rd.role_data -> 'commodities') ? r.commodity
      and p.id <> r.created_by
    limit 1000;
  end if;
end;
$$;

grant execute on function public.loamy_publish_rfq(uuid, timestamptz) to authenticated;
