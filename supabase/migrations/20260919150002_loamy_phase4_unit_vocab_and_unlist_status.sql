-- ============================================================================
-- PHASE 4 (b) — two bugs found by the Phase 4 tests.
-- ----------------------------------------------------------------------------
-- 1. UNIT VOCABULARY MISMATCH. `listings.unit` allowed ('kg','bags','litres',
--    'units') while `commodity_batches.unit` allows ('kg','tonne','bag',
--    'crate','unit'). Listing a batch measured in tonnes therefore failed the
--    listings CHECK constraint outright — the two halves of the marketplace
--    could not actually talk to each other.
--
-- 2. UNLISTING SILENTLY MARKED STOCK VERIFIED.  ** the serious one **
--    The 'unlisted' transition rule set new_status = 'verified'
--    unconditionally. So a batch that was never inspected went
--    created -> listed -> unlisted -> VERIFIED, and would then display as
--    verified stock to buyers. A status that lies is worse than no status.
--    Unlisting now returns the batch to whatever it actually was: 'verified'
--    only if its verification_status really is verified, otherwise 'created'.
--
-- Both were caught by tests/security/phase4-marketplace-batches.test.ts before
-- anything reached a buyer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Widen the listing unit vocabulary to cover the batch vocabulary.
-- ----------------------------------------------------------------------------
-- NOTE for a later cleanup: 'bag'/'bags' and 'unit'/'units' are the same thing
-- spelled twice, inherited from two features written months apart. Unifying
-- them means rewriting existing listing rows and every UI select, so it is a
-- data migration in its own right rather than a side effect of Phase 4. The
-- union is accepted here so the two halves can interoperate today.
alter table public.listings drop constraint if exists listings_unit_check;
alter table public.listings add constraint listings_unit_check
  check (unit in ('kg','bags','bag','litres','units','unit','tonne','crate'));

comment on column public.listings.unit is
  'Accepts both the listing vocabulary (bags/units) and the batch vocabulary (bag/unit/tonne/crate). The duplicate spellings are technical debt -- see 20260919150002.';

-- ----------------------------------------------------------------------------
-- 2. Unlisting must not invent a verification.
-- ----------------------------------------------------------------------------
-- new_status null means "decide it in code", which is what the transition
-- function already does for quantity_adjusted and split.
update public.batch_transition_rules
   set new_status = null
 where event_type = 'unlisted';

create or replace function public.loamy_batch_transition(
  p_batch_id       uuid,
  p_event_type     text,
  p_quantity_delta numeric default null,
  p_subject_type   text default null,
  p_subject_id     uuid default null,
  p_location_state text default null,
  p_location_lga   text default null,
  p_latitude       numeric default null,
  p_longitude      numeric default null,
  p_metadata       jsonb default '{}'::jsonb,
  p_evidence       jsonb default '{}'::jsonb,
  p_note           text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_b        public.commodity_batches%rowtype;
  v_rule     public.batch_transition_rules%rowtype;
  v_is_admin boolean := public.loamy_is_admin();
  v_new_qty  numeric;
  v_status   text;
  v_event    uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_b from public.commodity_batches where id = p_batch_id for update;
  if v_b.id is null then raise exception 'Batch not found.'; end if;

  select * into v_rule from public.batch_transition_rules where event_type = p_event_type;
  if v_rule.event_type is null then
    raise exception 'Unknown batch event: %', p_event_type;
  end if;

  if v_rule.initiator = 'platform' and not v_is_admin then
    raise exception 'Only the platform can record a % event.', p_event_type;
  elsif v_rule.initiator = 'holder' and v_b.owner_id <> v_uid and not v_is_admin then
    raise exception 'Only the current holder can record a % event.', p_event_type;
  elsif v_rule.initiator = 'system' and not v_is_admin then
    raise exception 'A % event is recorded by the platform workflow, not directly.', p_event_type;
  end if;

  if not (v_b.status = any (v_rule.allowed_from)) then
    raise exception 'A batch that is % cannot go to % (allowed from: %).',
      v_b.status, p_event_type, array_to_string(v_rule.allowed_from, ', ');
  end if;

  v_new_qty := v_b.available_quantity;
  if p_quantity_delta is not null and p_quantity_delta <> 0 then
    v_new_qty := v_b.available_quantity + p_quantity_delta;
    if v_new_qty < 0 then
      raise exception 'Only % % remain available in this batch.', v_b.available_quantity, v_b.unit;
    end if;
    if v_new_qty > v_b.quantity then
      raise exception 'A batch cannot hold more than its original quantity.';
    end if;
  end if;

  -- Unlisting returns the batch to what it ACTUALLY was, never to a state that
  -- claims an inspection that did not happen.
  if p_event_type = 'unlisted' then
    v_status := case when v_b.verification_status = 'verified' then 'verified' else 'created' end;
  else
    v_status := coalesce(v_rule.new_status, v_b.status);
  end if;

  update public.commodity_batches
     set status             = v_status,
         available_quantity = v_new_qty,
         verification_status = case
           when p_event_type = 'verified' then 'verified'
           when p_event_type = 'verification_rejected' then 'rejected'
           else verification_status end,
         current_state      = coalesce(p_location_state, current_state),
         current_location   = coalesce(p_note, current_location),
         updated_at         = now()
   where id = p_batch_id;

  insert into public.batch_events (
    batch_id, event_type, actor_id, previous_status, new_status,
    quantity_delta, quantity_after, location_state, location_lga,
    latitude, longitude, subject_type, subject_id, metadata, evidence, note
  ) values (
    p_batch_id, p_event_type, v_uid, v_b.status, v_status,
    p_quantity_delta, v_new_qty, p_location_state, p_location_lga,
    p_latitude, p_longitude, p_subject_type, p_subject_id,
    coalesce(p_metadata, '{}'::jsonb), coalesce(p_evidence, '{}'::jsonb), p_note
  ) returning id into v_event;

  return v_event;
end;
$$;

revoke all on function public.loamy_batch_transition(uuid,text,numeric,text,uuid,text,text,numeric,numeric,jsonb,jsonb,text) from public, anon;
grant execute on function public.loamy_batch_transition(uuid,text,numeric,text,uuid,text,text,numeric,numeric,jsonb,jsonb,text) to authenticated;

-- 'listed' must also be reachable from 'created' for an unverified batch that
-- was unlisted and is being re-listed; it already is. Re-assert for clarity.
update public.batch_transition_rules
   set allowed_from = array['created','verified','partially_sold']
 where event_type = 'listed';
