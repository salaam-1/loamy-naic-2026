-- ============================================================================
-- WAVE 1 — the fulfilment spine, made visible to the people who must act on it.
-- ----------------------------------------------------------------------------
-- Everything downstream of checkout already exists in the database: loading,
-- transport offers, exclusive award, logistics transitions, storage requests,
-- warehouse receipts, supplier-direct settlement. None of it was reachable,
-- and the audit blamed the UI. The UI was only half the problem.
--
-- THE REAL BLOCKER: THREE VIEWS THAT FILTER ON company_id
--
--   transport_jobs and warehouse_reservations were generalised in Phase 9 to
--   belong to EITHER an RFQ award OR a transaction. The VIEWS were not. Each
--   still reads `... company_id in (select loamy_user_company_ids())`, and a
--   transaction-linked row has company_id = NULL.
--
--   In SQL `NULL in (...)` is NULL, not false, so those rows are filtered out
--   silently. The consequences, none of which look like a bug from the
--   outside:
--
--     * loamy_open_transport_jobs  -> a carrier NEVER sees a marketplace
--       purchase needing haulage. A buyer could request transport and no
--       offer could ever arrive.
--     * loamy_transport_offers_v   -> a buyer cannot see offers on their own
--       job, so loamy_select_transport_offer had no caller and no way to get
--       one.
--     * loamy_warehouse_reservations_v -> a warehouse owner never sees a
--       storage request from a transaction, so loamy_request_storage was
--       writing into a table nobody read.
--
--   Fixing the views is what actually unlocks WS2, WS3 and WS4. No new table,
--   no second logistics or storage model: same tables, same statuses, same
--   transition rules, one more authorisation branch each -- exactly as
--   20260920130005 did for the functions.
--
-- AND ONE FUNCTION THAT HAS NEVER WORKED
--   loamy_suggest_warehouses reads v_t.origin_state. transactions has no such
--   column, so every call has raised 42703 since it was written. Per the
--   directive the column is NOT added; origin is resolved through the
--   relationship that already exists.
--
-- SECURITY-REVIEW ** WIDENING A VIEW IS WIDENING ACCESS **
--   Each view below gains exactly one branch, and each branch names a party
--   to the row: the carrier who is being asked to quote, the buyer or seller
--   on the transaction, the facility owner being asked for space. A carrier
--   still cannot see another carrier's offer price. Nobody gains a row they
--   are not a party to.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Where did this stock come from?
-- ----------------------------------------------------------------------------
/**
 * The origin state of a purchase, resolved through the traceability chain.
 *
 * transaction -> batch (current, then origin) -> listing -> farm
 *
 * Walked in that order because it answers "where is the stock NOW" before
 * "where was it grown": a batch that has already moved to a warehouse should
 * suggest storage near where it actually is. A denormalised
 * transactions.origin_state would have been quicker and would have been wrong
 * the moment stock moved.
 */
create or replace function public.loamy_transaction_origin_state(p_transaction_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    b.current_state,
    b.origin_state,
    l.state,
    f.state
  )
  from public.transactions t
  left join public.commodity_batches b on b.id = t.batch_id
  left join public.listings         l on l.id = t.listing_id
  left join public.farms            f on f.id = b.farm_id
  where t.id = p_transaction_id;
$$;

grant execute on function public.loamy_transaction_origin_state(uuid) to authenticated;

comment on function public.loamy_transaction_origin_state(uuid) is
  'Origin state resolved through transaction -> batch -> listing -> farm. Replaces a read of transactions.origin_state, which never existed and raised 42703 on every call to loamy_suggest_warehouses.';

-- ----------------------------------------------------------------------------
-- 2. The suggestion function, working for the first time.
-- ----------------------------------------------------------------------------
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
    -- Deliberately the same answer for "no such transaction" and "not yours":
    -- distinguishing them would confirm a stranger's transaction exists.
    return jsonb_build_object('available', false, 'reason', 'no_such_transaction');
  end if;

  v_origin := public.loamy_transaction_origin_state(p_transaction_id);
  -- Delivery destination first; origin only as a fallback, because storage is
  -- usually wanted near where the goods are going.
  v_state := coalesce(v_t.delivery_state, v_origin);

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
-- 3. Carriers can see marketplace freight.
-- ----------------------------------------------------------------------------
-- Dropped rather than replaced: the column list changes, and CREATE OR
-- REPLACE VIEW can only append.
drop view if exists public.loamy_open_transport_jobs;
create view public.loamy_open_transport_jobs as
  select j.id, j.rfq_id, j.transaction_id, j.commodity, j.quantity, j.unit,
         j.pickup_state, j.dropoff_state, j.pickup_location, j.dropoff_location,
         j.requested_date, j.created_at,
         -- So a board can say what kind of work this is.
         case when j.transaction_id is not null then 'purchase' else 'contract' end as job_kind,
         exists (select 1 from public.transport_offers o
                  where o.transport_job_id = j.id
                    and o.provider_id = auth.uid()
                    and o.status <> 'declined') as already_offered
  from public.transport_jobs j
  where j.status = 'broadcast'
    -- You cannot quote on your own freight, whichever origin the job has.
    -- Written as NOT EXISTS rather than `company_id not in (...)`: the old
    -- form evaluated to NULL for a transaction job and silently hid every one.
    and not exists (
      select 1 from public.transactions t
       where t.id = j.transaction_id
         and auth.uid() in (t.buyer_id, t.seller_id))
    and (j.company_id is null
         or j.company_id not in (select public.loamy_user_company_ids()));

grant select on public.loamy_open_transport_jobs to authenticated;

comment on view public.loamy_open_transport_jobs is
  'Broadcast transport jobs a carrier may quote on, from EITHER an RFQ award or a marketplace purchase. The previous definition filtered on company_id, which is NULL for a purchase, so carriers never saw marketplace freight at all.';

-- ----------------------------------------------------------------------------
-- 4. A buyer can see the offers on their own job.
-- ----------------------------------------------------------------------------
-- Dropped rather than replaced: the column list changes, and CREATE OR
-- REPLACE VIEW can only append.
drop view if exists public.loamy_transport_offers_v;
create view public.loamy_transport_offers_v as
  select o.*, p.full_name as provider_name, p.state as provider_state
  from public.transport_offers o
  join public.profiles p on p.id = o.provider_id
  where
    -- Your own offer.
    o.provider_id = auth.uid()
    -- A procuring company's job, as before.
    or o.transport_job_id in (
      select id from public.transport_jobs
       where company_id in (select public.loamy_user_company_ids()))
    -- NEW: the buyer or seller on the transaction this job serves. Without
    -- this branch loamy_select_transport_offer could never be called by the
    -- person the function itself authorises.
    or o.transport_job_id in (
      select j.id from public.transport_jobs j
       join public.transactions t on t.id = j.transaction_id
       where auth.uid() in (t.buyer_id, t.seller_id))
    or public.loamy_is_admin();

grant select on public.loamy_transport_offers_v to authenticated;

-- ----------------------------------------------------------------------------
-- 5. A warehouse owner can see a storage request from a purchase.
-- ----------------------------------------------------------------------------
-- Dropped rather than replaced: the column list changes, and CREATE OR
-- REPLACE VIEW can only append.
drop view if exists public.loamy_warehouse_reservations_v;
create view public.loamy_warehouse_reservations_v as
  select w.*,
         p.full_name as warehouse_name,
         coalesce(r.commodity, t.commodity) as commodity,
         co.name as buyer_company,
         t.ref as transaction_ref,
         case when w.transaction_id is not null then 'purchase' else 'contract' end as reservation_kind
  from public.warehouse_reservations w
  left join public.profiles     p  on p.id = w.warehouse_owner_id
  left join public.rfqs         r  on r.id = w.rfq_id
  left join public.companies    co on co.id = w.company_id
  left join public.transactions t  on t.id = w.transaction_id
  where
    -- The procuring company, as before.
    w.company_id in (select public.loamy_user_company_ids())
    -- NEW: the facility being asked. Without this a warehouse owner never
    -- saw a purchase-linked request, so loamy_request_storage wrote into a
    -- table nobody read.
    or w.warehouse_owner_id = auth.uid()
    -- NEW: whoever asked, and the counterparty on the purchase.
    or w.requested_by = auth.uid()
    or (t.id is not null and auth.uid() in (t.buyer_id, t.seller_id))
    or public.loamy_is_admin();

grant select on public.loamy_warehouse_reservations_v to authenticated;

comment on view public.loamy_warehouse_reservations_v is
  'Storage reservations from EITHER an RFQ or a marketplace purchase, visible to the facility owner, the requester, the transaction parties and the procuring company. The previous definition filtered on company_id only, which is NULL for a purchase.';

-- ----------------------------------------------------------------------------
-- 6. What a party can see of their own transaction's fulfilment.
-- ----------------------------------------------------------------------------
/**
 * One read for the whole downstream spine of a purchase.
 *
 * The purchase page needs loading, transport, offers, storage and settlement
 * state together, and issuing five round trips for it invites exactly the
 * partial-render bugs this lifecycle cannot afford. Returns only what the
 * caller is a party to; a stranger gets `available: false` with no detail.
 *
 * It ASSERTS NOTHING. Every field is read from an authoritative table, and a
 * stage that has not happened is absent rather than reported as pending-with-
 * a-guess.
 */
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
      -- Which side the caller is on, so the UI never has to guess.
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
        'recorded_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
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
          'note', e.note, 'occurred_at', e.created_at)
          order by e.created_at desc), '[]'::jsonb)
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
        'condition', wr.condition, 'recorded_at', wr.created_at)
        order by wr.created_at desc), '[]'::jsonb)
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
