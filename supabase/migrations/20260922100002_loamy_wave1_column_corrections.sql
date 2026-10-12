-- ============================================================================
-- WAVE 1 (b) — the remaining column errors in the warehouse/logistics reads.
-- ----------------------------------------------------------------------------
-- loamy_suggest_warehouses did not have one bug. It had three, and 100001
-- fixed only the first because the other two are downstream of it and plpgsql
-- never reached them:
--
--   1. v_t.origin_state   -- transactions has no such column     (fixed in 100001)
--   2. d.verified         -- service_directory has verification_status
--   3. d.active           -- service_directory has no active column at all
--
-- Which means this function has never executed successfully since it was
-- written, and the "warehouse suggestions" feature has never once run. Worth
-- stating plainly rather than fixing quietly: a function nobody calls is not
-- only unreachable, it is unverified, and the compiler cannot help because
-- plpgsql resolves column references at run time.
--
-- Also corrects shipment_events.created_at -> occurred_at in the fulfilment
-- read added by 100001.
-- ============================================================================

create or replace function public.loamy_suggest_warehouses(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_t     public.transactions%rowtype;
  v_state text;
  v_origin text;
  v_rows  jsonb;
begin
  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null or not (public.loamy_is_admin()
                            or v_t.buyer_id = v_uid or v_t.seller_id = v_uid) then
    -- Same answer for "no such transaction" and "not yours": distinguishing
    -- them would confirm a stranger's transaction exists.
    return jsonb_build_object('available', false, 'reason', 'no_such_transaction');
  end if;

  v_origin := public.loamy_transaction_origin_state(p_transaction_id);
  -- Destination first, origin as a fallback: storage is usually wanted near
  -- where the goods are going.
  v_state := coalesce(v_t.delivery_state, v_origin);

  if v_state is null then
    return jsonb_build_object('available', false, 'reason', 'no_destination',
      'message', 'Set a delivery state to see storage options.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'facility_id', d.id, 'ref', d.ref,
           'business_name', d.business_name,
           'state', d.state, 'lga', d.lga,
           -- The real column. A facility is 'verified' only when Loamy has
           -- actually inspected it; anything else must not read as verified.
           'verification_status', coalesce(d.verification_status, 'unverified'),
           'verified', coalesce(d.verification_status, '') = 'verified',
           -- What a member needs to choose between facilities.
           'capacity_tonnes', d.capacity_tonnes,
           'capacity_note', d.capacity_note,
           'storage_types', d.storage_types,
           'same_state', d.state = v_state)
           order by (coalesce(d.verification_status,'') = 'verified') desc, d.business_name), '[]'::jsonb)
    into v_rows
  from public.service_directory d
  where d.service_type = 'warehouse'
    and d.state = v_state;

  return jsonb_build_object(
    'available', true,
    'delivery_state', v_t.delivery_state,
    'origin_state', v_origin,
    'searched_state', v_state,
    'items', v_rows,
    'note', 'Suggestions only. Nothing is reserved until you request storage and the facility accepts.');
end;
$$;

revoke all on function public.loamy_suggest_warehouses(uuid) from public, anon;
grant execute on function public.loamy_suggest_warehouses(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- shipment_events timestamps are `occurred_at`.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_transaction_fulfilment(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.transactions%rowtype;
  v_job public.transport_jobs%rowtype;
begin
  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null or not (public.loamy_is_admin()
                            or v_t.buyer_id = v_uid or v_t.seller_id = v_uid) then
    return jsonb_build_object('available', false, 'reason', 'not_a_party');
  end if;

  select * into v_job from public.transport_jobs
   where transaction_id = p_transaction_id and status not in ('cancelled','failed')
   order by created_at desc limit 1;

  return jsonb_build_object(
    'available', true,
    'transaction', jsonb_build_object(
      'ref', v_t.ref, 'commodity', v_t.commodity,
      'quantity', v_t.quantity, 'unit', v_t.unit,
      'status', v_t.status,
      'payment_state', v_t.payment_state,
      'fulfilment_state', v_t.fulfilment_state,
      'delivery_state', v_t.delivery_state,
      'delivery_lga', v_t.delivery_lga,
      'viewer_role', case
        when v_t.buyer_id = v_uid then 'buyer'
        when v_t.seller_id = v_uid then 'seller'
        else 'admin' end),

    'loading', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'stage', c.stage,
        'quantity_confirmed', c.quantity_confirmed, 'unit', c.unit,
        'waybill_ref', c.waybill_ref, 'vehicle_registration', c.vehicle_registration,
        'photo_count', coalesce(array_length(c.photos, 1), 0),
        'flags', to_jsonb(c.flags), 'note', c.note,
        'recorded_at', c.occurred_at) order by c.occurred_at desc), '[]'::jsonb)
      from public.loading_confirmations c where c.transaction_id = p_transaction_id),

    'transport', case when v_job.id is null then null else jsonb_build_object(
      'job_id', v_job.id, 'status', v_job.status, 'mode', v_job.mode,
      'pickup_location', v_job.pickup_location, 'dropoff_location', v_job.dropoff_location,
      'agreed_price', v_job.agreed_price,
      'external_provider_name', v_job.external_provider_name,
      'assigned_provider', (
        select p.full_name from public.profiles p where p.id = v_job.assigned_provider_id),
      'offers', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'offer_id', o.id, 'price', o.price, 'status', o.status,
          'available_date', o.available_date, 'note', o.note,
          'provider_name', p.full_name, 'provider_state', p.state)
          order by o.price), '[]'::jsonb)
        from public.transport_offers o
        join public.profiles p on p.id = o.provider_id
        where o.transport_job_id = v_job.id and o.status <> 'declined'),
      'events', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'event_type', e.event_type, 'new_status', e.new_status,
          'note', e.note, 'occurred_at', e.occurred_at)
          order by e.occurred_at desc), '[]'::jsonb)
        from public.shipment_events e where e.job_id = v_job.id)
    ) end,

    'storage', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reservation_id', w.id, 'status', w.status,
        'space_quantity', w.space_quantity, 'unit', w.unit,
        'start_date', w.start_date, 'end_date', w.end_date,
        'facility', d.business_name, 'facility_state', d.state, 'facility_lga', d.lga,
        'requested_at', w.created_at) order by w.created_at desc), '[]'::jsonb)
      from public.warehouse_reservations w
      left join public.service_directory d on d.id = w.facility_id
      where w.transaction_id = p_transaction_id),

    'receipts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ref', wr.ref, 'movement', wr.movement, 'quantity', wr.quantity,
        'condition', wr.condition, 'recorded_at', wr.occurred_at)
        order by wr.occurred_at desc), '[]'::jsonb)
      from public.warehouse_receipts wr where wr.transaction_id = p_transaction_id),

    'financing', (
      select case when a.id is null then null else jsonb_build_object(
        'application_id', a.id, 'ref', a.ref, 'status', a.status,
        'approved_amount', a.approved_amount, 'disbursed_amount', a.disbursed_amount,
        'is_sandbox', a.is_sandbox) end
      from public.financing_applications a where a.id = v_t.financing_application_id));
end;
$$;

revoke all on function public.loamy_transaction_fulfilment(uuid) from public, anon;
grant execute on function public.loamy_transaction_fulfilment(uuid) to authenticated;
