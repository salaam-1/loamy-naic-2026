-- ============================================================================
-- PARTIAL SALE — a batch is only `sold` when there is nothing left of it.
-- ----------------------------------------------------------------------------
-- THE DEFECT
--   `loamy_transaction_transition` fires the batch event 'sold' on every
--   completed transaction, unconditionally:
--
--     elsif v_rule.new_value = 'completed' then
--       perform public.loamy_batch_transition(v_t.batch_id, 'sold', ...)
--
--   So completing a 12-tonne purchase against a 100-tonne batch marked the
--   WHOLE batch sold, with 88 tonnes still available. The seller's remaining
--   stock silently became unsellable, and the trace said the batch was gone
--   when it was not.
--
--   The `partially_sold` state has existed since Phase 2 and the transition
--   rules were widened for it in 20260919220001 -- reserved, partially_sold
--   and sold all accept from ['listed','reserved','partially_sold'], and
--   'listed' accepts from 'partially_sold' so the remainder can go back on
--   the market. Every piece was in place. Nothing ever fired the event.
--
-- THE AUTHORITATIVE REPRESENTATION, which this does not change
--   quantity            the batch as harvested. NEVER mutates.
--   available_quantity  what is left to sell. Moved only by
--                       loamy_batch_transition with a signed delta.
--   committed           quantity - available_quantity (derived, not stored)
--   status              where the batch is in its life
--
--   Acceptance already commits stock (`reserved`, delta -quantity) and
--   cancellation already releases it. Only the COMPLETION branch was wrong.
--
-- THE FIX
--   One decision, on the quantity that is actually left. Nothing else moves:
--   no new column, no new state, no rule change, no quantity written here.
-- ============================================================================

create or replace function public.loamy_transaction_transition(
  p_transaction_id uuid,
  p_event_type     text,
  p_machine        text default 'status',
  p_note           text default null,
  p_metadata       jsonb default '{}'::jsonb,
  p_payment_provider  text default null,
  p_payment_reference text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_t         public.transactions%rowtype;
  v_rule      public.transaction_transition_rules%rowtype;
  v_is_admin  boolean := public.loamy_is_admin();
  v_is_system boolean := coalesce(current_setting('loamy.txn_system_authorized', true), '') = 'true';
  v_current   text;
  v_event     uuid;
  v_avail     numeric;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_t from public.transactions where id = p_transaction_id for update;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if v_t.buyer_id <> v_uid and v_t.seller_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'That is not your transaction.';
  end if;

  select * into v_rule from public.transaction_transition_rules
   where machine = p_machine and event_type = p_event_type;
  if v_rule.event_type is null then
    raise exception 'Unknown % event: %', p_machine, p_event_type;
  end if;

  -- Who may initiate.
  if v_rule.initiator = 'buyer' and v_t.buyer_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'Only the buyer can record %.', p_event_type;
  elsif v_rule.initiator = 'seller' and v_t.seller_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'Only the seller can record %.', p_event_type;
  elsif v_rule.initiator = 'platform' and not (v_is_admin or v_is_system) then
    raise exception 'Only the platform can record %.', p_event_type;
  elsif v_rule.initiator = 'system' and not (v_is_admin or v_is_system) then
    -- Payment events in particular: a member must never be able to assert that
    -- money moved. Phase 7 drives these from the provider webhook.
    raise exception '% is recorded by the platform workflow, not directly.', p_event_type;
  end if;

  v_current := case p_machine
                 when 'status'     then v_t.status
                 when 'payment'    then v_t.payment_state
                 else                   v_t.fulfilment_state end;

  if not (v_current = any (v_rule.allowed_from)) then
    raise exception 'A transaction whose % is % cannot go to % (allowed from: %).',
      p_machine, v_current, p_event_type, array_to_string(v_rule.allowed_from, ', ');
  end if;

  if p_machine = 'status' then
    update public.transactions
       set status = v_rule.new_value,
           completed_at = case when v_rule.new_value = 'completed' then now() else completed_at end
     where id = p_transaction_id;
  elsif p_machine = 'payment' then
    update public.transactions
       set payment_state = v_rule.new_value,
           payment_provider  = coalesce(p_payment_provider, payment_provider),
           payment_reference = coalesce(p_payment_reference, payment_reference)
     where id = p_transaction_id;
  else
    update public.transactions
       set fulfilment_state = v_rule.new_value
     where id = p_transaction_id;
  end if;

  insert into public.transaction_events (
    transaction_id, event_type, machine, actor_id, previous_value, new_value, metadata, note
  ) values (
    p_transaction_id, p_event_type, p_machine, v_uid, v_current, v_rule.new_value,
    coalesce(p_metadata, '{}'::jsonb), p_note
  ) returning id into v_event;

  -- Agreement side effects on the batch, driven through its own controlled path.
  if p_machine = 'status' and v_t.batch_id is not null then
    perform set_config('loamy.batch_system_authorized', 'true', true);

    if v_rule.new_value = 'accepted' then
      -- Accepting commits stock. Proposing does not, so a buyer cannot grief a
      -- seller by locking their inventory for free.
      perform public.loamy_batch_transition(
        v_t.batch_id, 'reserved', -v_t.quantity, 'transaction', p_transaction_id,
        null, null, null, null, '{}'::jsonb, '{}'::jsonb, null);

    elsif v_rule.new_value in ('cancelled','rejected','expired')
          and v_t.status = 'accepted' then
      -- Release the commitment we took on acceptance.
      perform public.loamy_batch_transition(
        v_t.batch_id, 'quantity_adjusted', v_t.quantity, 'transaction', p_transaction_id,
        null, null, null, null, '{}'::jsonb, '{}'::jsonb, 'Reservation released');

    elsif v_rule.new_value = 'completed' then
      -- THE FIX. `sold` means there is none left; anything else is a PARTIAL
      -- sale and the remainder is still the seller's to sell. This fired
      -- 'sold' unconditionally, so completing a 12-tonne purchase against a
      -- 100-tonne batch marked the whole batch sold with 88 tonnes still
      -- available -- the seller's stock silently became unsellable and the
      -- trace said the batch was gone when it was not.
      --
      -- The stock was already decremented at acceptance, so this reads the
      -- balance rather than recomputing it. Nothing else moves: no new
      -- column, no new state, no rule change, no quantity written here.
      select available_quantity into v_avail
        from public.commodity_batches where id = v_t.batch_id;

      perform public.loamy_batch_transition(
        v_t.batch_id,
        case when coalesce(v_avail, 0) <= 0.0001 then 'sold' else 'partially_sold' end,
        null, 'transaction', p_transaction_id,
        null, null, null, null, '{}'::jsonb,
        jsonb_build_object('remaining', v_avail, 'sold_quantity', v_t.quantity),
        case when coalesce(v_avail, 0) > 0.0001
             then 'Part of this batch was sold; the remainder is still available.'
             else null end);
    end if;

    perform set_config('loamy.batch_system_authorized', 'false', true);
  end if;

  return v_event;
end;
$$;

revoke all on function public.loamy_transaction_transition(
  uuid,text,text,text,jsonb,text,text) from public, anon;
grant execute on function public.loamy_transaction_transition(
  uuid,text,text,text,jsonb,text,text) to authenticated;

comment on function public.loamy_transaction_transition(uuid,text,text,text,jsonb,text,text) is
  'Transaction state machine. On completion the batch becomes `sold` only when available_quantity has reached zero, and `partially_sold` otherwise -- it previously fired `sold` unconditionally, marking a 100t batch sold on a 12t sale.';
