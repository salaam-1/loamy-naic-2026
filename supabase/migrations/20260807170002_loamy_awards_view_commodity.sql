-- Add commodity / unit / rfq_reference to the awards view so the logistics and
-- overview screens can label consignments without an extra query. Additive.
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
    ) as contact_disclosed,
    r.commodity, r.unit, r.reference as rfq_reference
  from public.rfq_awards a
  join public.profiles p on p.id = a.supplier_id
  join public.rfq_bids b on b.id = a.bid_id
  join public.rfqs r on r.id = a.rfq_id
  where a.rfq_id in (select id from public.rfqs where company_id in (select public.loamy_user_company_ids()))
     or a.supplier_id = auth.uid()
     or public.loamy_is_admin();

grant select on public.loamy_rfq_awards_v to authenticated;
