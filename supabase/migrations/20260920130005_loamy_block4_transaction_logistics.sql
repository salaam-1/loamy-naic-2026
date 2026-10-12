-- ============================================================================
-- BLOCK 4 (e) — logistics and storage for a marketplace purchase.
-- ----------------------------------------------------------------------------
-- transport_jobs was generalised in Phase 9 to belong to EITHER an RFQ award
-- OR a transaction, but the entry points were never generalised with it:
-- loamy_request_transport still takes an award, and the offer/selection
-- functions authorise through company procurement rights that a marketplace
-- buyer does not have.
--
-- So a buyer could not arrange transport for their own purchase. This closes
-- that, WITHOUT creating a second logistics system -- the directive is
-- explicit about that and it is the right call. Same table, same status
-- vocabulary, same transition rules; only the authorisation branch is new.
--
-- Loamy never forces Loamy logistics. mode='external' records haulage the
-- buyer arranged themselves, and it is a first-class outcome rather than an
-- escape hatch.
-- ============================================================================

alter table public.transport_jobs alter column company_id drop not null;
alter table public.transport_jobs alter column supplier_id drop not null;
alter table public.transport_jobs alter column rfq_id drop not null;

/**
 * Who may act on a transport job, whichever kind it is.
 *
 * One function so the two origins can never drift apart in what they permit.
 */
create or replace function public.loamy_can_manage_transport(p_job_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare j public.transport_jobs%rowtype; t public.transactions%rowtype;
begin
  select * into j from public.transport_jobs where id = p_job_id;
  if j.id is null then return false; end if;
  if public.loamy_is_admin() then return true; end if;

  if j.transaction_id is not null then
    select * into t from public.transactions where id = j.transaction_id;
    -- The buyer arranges delivery; the seller can see it moving.
    return t.buyer_id = auth.uid() or t.seller_id = auth.uid();
  end if;

  if j.company_id is not null then
    return public.loamy_company_can_procure(j.company_id);
  end if;

  return j.requested_by = auth.uid();
end;
$$;

grant execute on function public.loamy_can_manage_transport(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 1. Requesting transport for a purchase.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_request_transport_for_transaction(
  p_transaction_id uuid,
  p_mode           text default 'loamy',
  p_pickup         text default null,
  p_dropoff        text default null,
  p_requested_date date default null,
  p_external_provider text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.transactions%rowtype;
  v_b   public.commodity_batches%rowtype;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if v_t.buyer_id <> v_uid and not public.loamy_is_admin() then
    raise exception 'Only the buyer arranges delivery for this purchase.';
  end if;
  if p_mode not in ('loamy','external') then
    raise exception 'Transport mode must be loamy or external.';
  end if;
  if v_t.status in ('cancelled','rejected','expired') then
    raise exception 'That purchase is %.', v_t.status;
  end if;

  -- Goods must at least be loading before a carrier is meaningful.
  if v_t.fulfilment_state = 'not_started' then
    return jsonb_build_object('created', false, 'reason', 'too_early',
      'message', 'Arrange transport once the seller has scheduled loading.');
  end if;

  if exists (select 1 from public.transport_jobs
             where transaction_id = p_transaction_id
               and status not in ('cancelled','failed')) then
    select id into v_id from public.transport_jobs
     where transaction_id = p_transaction_id and status not in ('cancelled','failed')
     order by created_at desc limit 1;
    return jsonb_build_object('created', false, 'reason', 'already_arranged', 'job_id', v_id);
  end if;

  if v_t.batch_id is not null then
    select * into v_b from public.commodity_batches where id = v_t.batch_id;
  end if;

  insert into public.transport_jobs (
    transaction_id, batch_id, requested_by, mode,
    pickup_location, dropoff_location,
    pickup_state, dropoff_state,
    commodity, quantity, unit,
    external_provider_name,
    status)
  values (
    p_transaction_id, v_t.batch_id, v_uid, p_mode,
    coalesce(p_pickup, v_b.current_lga, v_b.origin_lga),
    p_dropoff,
    coalesce(v_b.current_state, v_b.origin_state),
    coalesce(v_t.delivery_state, p_dropoff),
    v_t.commodity, v_t.quantity, v_t.unit,
    case when p_mode = 'external' then p_external_provider end,
    -- External haulage is already arranged; Loamy jobs go out for offers.
    case when p_mode = 'external' then 'booked' else 'broadcast' end)
  returning id into v_id;

  return jsonb_build_object('created', true, 'job_id', v_id, 'mode', p_mode);
end;
$$;

revoke all on function public.loamy_request_transport_for_transaction(
  uuid,text,text,text,date,text) from public, anon;
grant execute on function public.loamy_request_transport_for_transaction(
  uuid,text,text,text,date,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Offers, and an EXCLUSIVE award.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_submit_transport_offer(
  p_job_id uuid,
  p_price  numeric,
  p_available_date date default null,
  p_note   text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare j public.transport_jobs%rowtype; t public.transactions%rowtype; v_id uuid;
begin
  select * into j from public.transport_jobs where id = p_job_id;
  if j.id is null then raise exception 'Transport job not found'; end if;
  if j.status <> 'broadcast' then raise exception 'This job is no longer accepting offers'; end if;
  if not public.loamy_is_role('logistics_provider') then
    raise exception 'Only logistics providers can offer';
  end if;
  if p_price is null or p_price < 0 then raise exception 'Enter a valid price'; end if;

  -- You cannot bid on your own freight, whichever origin the job has.
  if j.company_id is not null
     and j.company_id in (select public.loamy_user_company_ids()) then
    raise exception 'You cannot offer on your own job';
  end if;
  if j.transaction_id is not null then
    select * into t from public.transactions where id = j.transaction_id;
    if auth.uid() in (t.buyer_id, t.seller_id) then
      raise exception 'You cannot offer on your own job';
    end if;
  end if;

  insert into public.transport_offers (transport_job_id, provider_id, price, available_date, note)
  values (p_job_id, auth.uid(), p_price, p_available_date, nullif(trim(p_note), ''))
  on conflict (transport_job_id, provider_id) do update set
    price = excluded.price, available_date = excluded.available_date,
    note = excluded.note, status = 'offered'
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.loamy_submit_transport_offer(uuid, numeric, date, text) to authenticated;

/**
 * Award to one provider and decline the rest, in one statement each, so the
 * assignment is exclusive by construction rather than by convention.
 */
create or replace function public.loamy_select_transport_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare o public.transport_offers%rowtype; j public.transport_jobs%rowtype;
begin
  select * into o from public.transport_offers where id = p_offer_id;
  if o.id is null then raise exception 'Offer not found'; end if;
  select * into j from public.transport_jobs where id = o.transport_job_id;

  if not public.loamy_can_manage_transport(j.id) then
    raise exception 'Not authorised';
  end if;
  if j.status <> 'broadcast' then raise exception 'This job is already assigned'; end if;

  update public.transport_jobs
     set assigned_provider_id = o.provider_id, status = 'assigned',
         agreed_price = o.price, updated_at = now()
   where id = j.id;

  update public.transport_offers set status = 'selected' where id = p_offer_id;
  update public.transport_offers set status = 'declined'
   where transport_job_id = j.id and id <> p_offer_id;

  insert into public.notifications (user_id, title, body, type)
  values (o.provider_id, 'Transport job assigned',
          'You were selected for a transport job. Coordinate pickup with the buyer.', 'logistics');
end;
$$;

grant execute on function public.loamy_select_transport_offer(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Warehouses, SUGGESTED after checkout. Never auto-booked.
-- ----------------------------------------------------------------------------
/**
 * Relevant facilities near the delivery point. A suggestion and nothing more:
 * this function creates no reservation and no obligation. Booking happens
 * only when the member calls loamy_request_storage themselves.
 */
create or replace function public.loamy_suggest_warehouses(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.transactions%rowtype;
  v_state text;
  v_rows jsonb;
begin
  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null or not (public.loamy_is_admin()
                            or v_t.buyer_id = v_uid or v_t.seller_id = v_uid) then
    return jsonb_build_object('available', false, 'reason', 'no_such_transaction');
  end if;

  v_state := coalesce(v_t.delivery_state, v_t.origin_state);
  if v_state is null then
    return jsonb_build_object('available', false, 'reason', 'no_destination',
      'message', 'Set a delivery state to see storage options.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'facility_id', d.id, 'ref', d.ref,
           'business_name', d.business_name,
           'state', d.state, 'lga', d.lga,
           'verified', coalesce(d.verified, false),
           'same_state', d.state = v_state) order by (d.state = v_state) desc, d.business_name), '[]'::jsonb)
    into v_rows
  from public.service_directory d
  where d.service_type = 'warehouse'
    and coalesce(d.active, true)
    and d.state = v_state
  limit 10;

  return jsonb_build_object(
    'available', true,
    'delivery_state', v_state,
    'items', v_rows,
    'note', 'Suggestions only. Nothing is reserved until you request storage and the facility accepts.');
end;
$$;

revoke all on function public.loamy_suggest_warehouses(uuid) from public, anon;
grant execute on function public.loamy_suggest_warehouses(uuid) to authenticated;
