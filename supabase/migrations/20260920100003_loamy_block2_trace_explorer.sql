-- ============================================================================
-- BLOCK 2 — the Trace Explorer's backend.
-- ----------------------------------------------------------------------------
-- loamy_trace_batch already reconstructs a chain FORWARD from a batch, scoped
-- by loamy_trace_scope. Three things were missing for an explorer:
--
--   1. ENTRY FROM ANYTHING. A person holds a delivery note with TXN-000244 on
--      it, or a warehouse receipt, or a listing link. Making them find the
--      batch ref first defeats the purpose. loamy_entity_refs already maps
--      every ref to (entity_type, id), so resolution is a lookup, not a
--      parser.
--
--   2. FINANCING. The chain the business cares about is
--      farm -> ... -> transaction -> FINANCING -> logistics -> delivery, and
--      the financing node was simply absent from the trace payload.
--
--   3. THE REVERSE DIRECTION. "Open a farmer and follow them down to every
--      batch they produced" is a different query from "open a batch and walk
--      up". Both are needed, and the downward one has its own authorisation
--      question: you may not enumerate a stranger's production.
--
-- Redaction rule, unchanged and extended to the new nodes: a link that is
-- missing says WHY (`not_recorded`, `never_financed`), and a link you may not
-- see says `not_permitted`. The two are never conflated, because "no
-- financing was used" and "you may not see the financing" mean opposite
-- things to a buyer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Resolve any business ref to what it points at.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_trace_resolve(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ref  text := upper(trim(coalesce(p_ref, '')));
  v_type text;
  v_id   uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('found', false, 'reason', 'not_signed_in');
  end if;

  -- A bare uuid is accepted too, for links the app builds itself.
  if v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select entity_type, entity_id into v_type, v_id
    from public.loamy_entity_refs where entity_id = v_ref::uuid limit 1;
    if v_type is null then
      return jsonb_build_object('found', false, 'reason', 'no_such_reference');
    end if;
  else
    select entity_type, entity_id into v_type, v_id
    from public.loamy_entity_refs where ref = v_ref;
    if v_type is null then
      return jsonb_build_object('found', false, 'reason', 'no_such_reference');
    end if;
  end if;

  return jsonb_build_object('found', true, 'entity_type', v_type, 'entity_id', v_id,
                            'ref', v_ref);
end;
$$;

grant execute on function public.loamy_trace_resolve(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. From any ref to the batch whose chain answers the question.
-- ----------------------------------------------------------------------------
/**
 * Most refs a person holds are *attached* to a batch rather than being one.
 * Returns the batch id, plus how we got there so the UI can say
 * "TXN-000244 -> BATCH-000982".
 */
create or replace function public.loamy_trace_batch_for_ref(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_r     jsonb := public.loamy_trace_resolve(p_ref);
  v_type  text;
  v_id    uuid;
  v_batch uuid;
begin
  if not (v_r->>'found')::boolean then return v_r; end if;
  v_type := v_r->>'entity_type';
  v_id   := (v_r->>'entity_id')::uuid;

  if v_type = 'commodity_batch' then
    v_batch := v_id;
  elsif v_type = 'transaction' then
    select batch_id into v_batch from public.transactions where id = v_id;
  elsif v_type = 'listing' then
    select batch_id into v_batch from public.listings where id = v_id;
  elsif v_type = 'harvest' then
    select id into v_batch from public.commodity_batches where harvest_id = v_id limit 1;
  elsif v_type = 'warehouse_receipt' then
    select batch_id into v_batch from public.warehouse_receipts where id = v_id;
  elsif v_type = 'logistics_job' then
    select batch_id into v_batch from public.transport_jobs where id = v_id;
  elsif v_type = 'financing_application' then
    select batch_id into v_batch from public.financing_applications where id = v_id;
  elsif v_type = 'verification_case' then
    select subject_id into v_batch from public.verification_tasks
     where id = v_id and subject_type = 'commodity_batch';
  else
    return jsonb_build_object('found', false, 'reason', 'not_traceable',
      'entity_type', v_type,
      'message', format('%s references are not part of a commodity chain.', v_type));
  end if;

  if v_batch is null then
    return jsonb_build_object('found', false, 'reason', 'no_batch_attached',
      'entity_type', v_type,
      'message', 'That reference is real but is not attached to a commodity batch.');
  end if;

  return jsonb_build_object('found', true, 'batch_id', v_batch,
    'via_type', v_type, 'via_ref', v_r->>'ref');
end;
$$;

grant execute on function public.loamy_trace_batch_for_ref(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The missing financing node.
-- ----------------------------------------------------------------------------
/**
 * Financing is the most sensitive node in the chain: it says a named party
 * borrowed money. So it is 'party'-and-above only, and even then the AMOUNTS
 * are limited to the parties to the financed deal and admins. A warehouse
 * operator who stored the goods is a 'party' to the batch; they have no
 * business knowing the buyer's approved credit.
 */
create or replace function public.loamy_trace_financing(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope text := public.loamy_trace_scope(p_batch_id);
  v_uid   uuid := auth.uid();
  v_rows  jsonb;
begin
  if v_scope in ('none','public') then
    return jsonb_build_object('available', false, 'reason', 'not_permitted');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', f.ref,
           'status', f.status,
           'purpose', f.purpose,
           'bank', b.name,
           -- Money only for the applicant, the seller being paid, or admin.
           'amount_requested', case when v_can then to_jsonb(f.amount_requested) else 'null'::jsonb end,
           'approved_amount',  case when v_can then to_jsonb(f.approved_amount)  else 'null'::jsonb end,
           'disbursed_amount', case when v_can then to_jsonb(f.disbursed_amount) else 'null'::jsonb end,
           'disbursement_preference', f.disbursement_preference,
           'created_at', f.created_at,
           'decided_at', f.decided_at)
           order by f.created_at), '[]'::jsonb)
    into v_rows
  from (
    select fa.*,
           (public.loamy_is_admin()
            or fa.applicant_id = v_uid
            or fa.seller_id = v_uid) as v_can
    from public.financing_applications fa
    where fa.batch_id = p_batch_id
  ) f
  left join public.banks b on b.id = f.bank_id;

  if v_rows = '[]'::jsonb then
    return jsonb_build_object('available', false, 'reason', 'never_financed');
  end if;
  return jsonb_build_object('available', true, 'items', v_rows);
end;
$$;

grant execute on function public.loamy_trace_financing(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The full chain, from any ref, with financing folded in.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_trace(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lookup jsonb := public.loamy_trace_batch_for_ref(p_ref);
  v_batch  uuid;
  v_out    jsonb;
  v_bref   text;
begin
  if not (v_lookup->>'found')::boolean then return v_lookup; end if;
  v_batch := (v_lookup->>'batch_id')::uuid;

  select ref into v_bref from public.commodity_batches where id = v_batch;
  v_out := public.loamy_trace_batch(v_bref);
  if not (v_out->>'found')::boolean then return v_out; end if;

  v_out := v_out || jsonb_build_object(
    'financing', public.loamy_trace_financing(v_batch),
    'entered_via', jsonb_build_object(
      'ref', v_lookup->>'via_ref', 'entity_type', v_lookup->>'via_type'));

  return v_out;
end;
$$;

grant execute on function public.loamy_trace(text) to authenticated;

comment on function public.loamy_trace(text) is
  'BLOCK 2. Entry point for the Trace Explorer. Accepts ANY business ref, resolves it to a batch, and returns the scoped chain including financing.';

-- ----------------------------------------------------------------------------
-- 5. The reverse direction: an identity, downward.
-- ----------------------------------------------------------------------------
/**
 * Farmer -> farms -> cycles -> harvests -> batches.
 *
 * Authorisation is deliberately NARROW. Walking down from a person enumerates
 * their whole production, which is exactly the dataset a competitor would
 * want. Permitted for:
 *
 *   * yourself
 *   * an admin
 *   * a Growth Partner with an OPEN, ASSIGNED case on that person -- and only
 *     for as long as the case is open
 *
 * A buyer who bought one batch is NOT permitted. They can trace the batch
 * they bought, upward, which is the legitimate need.
 */
create or replace function public.loamy_trace_identity(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_subject uuid;
  v_name    text;
  v_allowed boolean := false;
  v_reason  text;
  v_farms   jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('found', false, 'reason', 'not_signed_in');
  end if;

  select id, full_name into v_subject, v_name
  from public.profiles where username = lower(trim(coalesce(p_username, '')));

  if v_subject is null then
    return jsonb_build_object('found', false, 'reason', 'no_such_reference');
  end if;

  if v_subject = v_uid then
    v_allowed := true; v_reason := 'self';
  elsif public.loamy_is_admin() then
    v_allowed := true; v_reason := 'admin';
  elsif exists (select 1 from public.verification_tasks t
                where t.assigned_to = v_uid
                  and t.subject_user_id = v_subject
                  and t.status in ('assigned','in_progress','resubmit_requested')) then
    v_allowed := true; v_reason := 'open_verification_case';
  end if;

  if not v_allowed then
    -- Same shape as "no such handle": a refusal must not confirm that this
    -- person is a producer.
    return jsonb_build_object('found', false, 'reason', 'no_such_reference');
  end if;

  select coalesce(jsonb_agg(f order by f->>'farm_name'), '[]'::jsonb)
    into v_farms
  from (
    select jsonb_build_object(
      'ref', fa.ref, 'farm_name', fa.farm_name,
      'state', fa.state, 'lga', fa.lga,
      'size_hectares', fa.size_hectares,
      'status', fa.status,
      'cycles', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'ref', c.ref, 'crop', c.crop, 'season', c.season_year, 'status', c.status,
          'harvests', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'ref', h.ref, 'commodity', h.commodity,
              'harvest_date', h.harvest_date,
              'quantity', h.quantity, 'unit', h.unit,
              'batches', (
                select coalesce(jsonb_agg(jsonb_build_object(
                  'ref', b.ref, 'status', b.status,
                  'quantity', b.quantity,
                  'available_quantity', b.available_quantity,
                  'unit', b.unit) order by b.created_at), '[]'::jsonb)
                from public.commodity_batches b where b.harvest_id = h.id)
              ) order by h.harvest_date), '[]'::jsonb)
            from public.harvests h where h.production_cycle_id = c.id)
          ) order by c.season_year desc), '[]'::jsonb)
        from public.crop_records c where c.farm_id = fa.id)
    ) as f
    from public.farms fa where fa.owner_id = v_subject
  ) s;

  return jsonb_build_object(
    'found', true,
    'subject', jsonb_build_object('username', lower(trim(p_username)), 'display_name', v_name),
    'access_reason', v_reason,
    'farms', v_farms);
end;
$$;

grant execute on function public.loamy_trace_identity(text) to authenticated;

comment on function public.loamy_trace_identity(text) is
  'BLOCK 2. Downward trace from a person. Narrow on purpose: self, admin, or a Growth Partner with an OPEN case. A buyer traces the batch they bought, not its producer.';
