-- ============================================================================
-- §16 (c) — the frozen fee rule must be the one that actually pays.
-- ----------------------------------------------------------------------------
-- 20260919270001 introduced the fee schedule and snapshot the resolved rule
-- onto transactions.fee_snapshot at acceptance. But loamy_escrow_transition
-- still computed the release fee from platform_config.platform_fee_bps.
--
-- So the snapshot was decorative: it recorded what SHOULD have been charged
-- while the ledger charged something else. Editing the schedule would still
-- have moved the economics of a deal that was already agreed -- the exact
-- thing the snapshot exists to prevent.
--
-- Two changes:
--
--   1. loamy_resolve_fee also returns min_fee and max_fee, so a snapshot
--      carries the WHOLE rule and never needs to read fee_schedules again.
--      (Reading it back would defeat the freeze: the row can be edited.)
--
--   2. Escrow release re-applies the snapshot's frozen basis/value/min/max
--      to the escrow amount. The frozen RULE is what is authoritative, not
--      the frozen naira figure -- that figure was computed against the
--      transaction subtotal, and a partial release moves a different amount.
--
-- When there is no snapshot (escrow with no transaction, or a deal accepted
-- before the schedule existed) it falls back to the global bps and SAYS SO in
-- the event detail, rather than pretending a schedule applied.
-- ============================================================================

create or replace function public.loamy_resolve_fee(
  p_scope  text,
  p_amount numeric,
  p_transaction_type text default null,
  p_user_role text default null,
  p_partner_id uuid default null,
  p_commodity_group text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r public.fee_schedules%rowtype; v_fee numeric;
begin
  select * into r from public.fee_schedules f
  where f.scope = p_scope
    and f.active
    and f.effective_from <= now()
    and (f.effective_to is null or f.effective_to > now())
    and (f.transaction_type is null or f.transaction_type = p_transaction_type)
    and (f.user_role      is null or f.user_role      = p_user_role)
    and (f.partner_id     is null or f.partner_id     = p_partner_id)
    and (f.commodity_group is null or f.commodity_group = p_commodity_group)
  order by
    (f.transaction_type is not null)::int
    + (f.user_role is not null)::int
    + (f.partner_id is not null)::int
    + (f.commodity_group is not null)::int desc,
    f.effective_from desc
  limit 1;

  if r.id is null then
    return jsonb_build_object('resolved', false, 'reason', 'no_rule', 'fee', 0);
  end if;

  v_fee := case when r.basis = 'bps'
                then round(coalesce(p_amount, 0) * r.value / 10000.0, 2)
                else r.value end;
  if r.min_fee is not null then v_fee := greatest(v_fee, r.min_fee); end if;
  if r.max_fee is not null then v_fee := least(v_fee, r.max_fee); end if;

  return jsonb_build_object(
    'resolved', true, 'fee', v_fee, 'basis', r.basis, 'value', r.value,
    'min_fee', r.min_fee, 'max_fee', r.max_fee,
    'payer', r.payer, 'schedule_ref', r.ref, 'schedule_id', r.id,
    'resolved_at', now());
end;
$$;

grant execute on function public.loamy_resolve_fee(text,numeric,text,text,uuid,text) to authenticated;

/**
 * Apply a SNAPSHOT rule to an amount. Reads nothing but the snapshot, on
 * purpose -- a frozen rule that consults a live table is not frozen.
 */
create or replace function public.loamy_fee_from_snapshot(
  p_snapshot jsonb,
  p_amount   numeric
) returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare v_fee numeric; v_min numeric; v_max numeric;
begin
  if p_snapshot is null or coalesce((p_snapshot->>'resolved')::boolean, false) is not true then
    return null;
  end if;

  v_fee := case when p_snapshot->>'basis' = 'bps'
                then round(coalesce(p_amount, 0) * (p_snapshot->>'value')::numeric / 10000.0, 2)
                else (p_snapshot->>'value')::numeric end;

  v_min := nullif(p_snapshot->>'min_fee', '')::numeric;
  v_max := nullif(p_snapshot->>'max_fee', '')::numeric;
  if v_min is not null then v_fee := greatest(v_fee, v_min); end if;
  if v_max is not null then v_fee := least(v_fee, v_max); end if;

  return v_fee;
end;
$$;

grant execute on function public.loamy_fee_from_snapshot(jsonb,numeric) to authenticated;

create or replace function public.loamy_escrow_transition(
  p_escrow_id  uuid,
  p_event_type text,
  p_amount     numeric default null,
  p_detail     jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_w         public.escrow_workflows%rowtype;
  v_rule      public.escrow_transition_rules%rowtype;
  v_is_admin  boolean := public.loamy_is_admin();
  v_is_system boolean := coalesce(current_setting('loamy.escrow_system_authorized', true), '') = 'true';
  v_event     uuid;
  v_seller_acc uuid; v_escrow_acc uuid; v_rev_acc uuid;
  v_fee       numeric := 0;
  v_bps       int;
  v_pay_state text;
  v_snapshot  jsonb;
  v_fee_src   jsonb := '{}'::jsonb;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_w from public.escrow_workflows where id = p_escrow_id for update;
  if v_w.id is null then raise exception 'Escrow not found.'; end if;

  select * into v_rule from public.escrow_transition_rules where event_type = p_event_type;
  if v_rule.event_type is null then raise exception 'Unknown escrow event: %', p_event_type; end if;

  if v_rule.initiator = 'buyer' and v_w.buyer_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'Only the buyer can record %.', p_event_type;
  elsif v_rule.initiator = 'seller' and v_w.seller_id <> v_uid and not (v_is_admin or v_is_system) then
    raise exception 'Only the seller can record %.', p_event_type;
  elsif v_rule.initiator in ('platform','provider','system') and not (v_is_admin or v_is_system) then
    raise exception '% is recorded by the platform or the payment provider, not directly.', p_event_type;
  end if;

  if not (v_w.state = any (v_rule.allowed_from)) then
    raise exception 'An escrow that is % cannot go to % (allowed from: %).',
      v_w.state, p_event_type, array_to_string(v_rule.allowed_from, ', ');
  end if;

  if p_event_type = 'released' then
    -- The rule frozen when this deal was accepted wins.
    if v_w.transaction_id is not null then
      select fee_snapshot into v_snapshot from public.transactions where id = v_w.transaction_id;
    end if;

    v_fee := public.loamy_fee_from_snapshot(v_snapshot, v_w.amount);

    if v_fee is not null then
      v_fee_src := jsonb_build_object(
        'fee', v_fee, 'source', 'fee_snapshot',
        'schedule_ref', v_snapshot->>'schedule_ref',
        'basis', v_snapshot->>'basis', 'value', v_snapshot->>'value');
    else
      -- No frozen rule to honour. Say which number was used and why.
      select coalesce(platform_fee_bps, 0) into v_bps from public.platform_config where id = 1;
      v_fee := round(v_w.amount * coalesce(v_bps, 0) / 10000.0, 2);
      v_fee_src := jsonb_build_object(
        'fee', v_fee, 'source', 'platform_config_fallback',
        'reason', case when v_w.transaction_id is null then 'escrow_has_no_transaction'
                       else 'transaction_has_no_fee_snapshot' end,
        'basis', 'bps', 'value', v_bps);
    end if;

    v_seller_acc := public.loamy_member_account(v_w.seller_id, 'member_receivable');
    select id into v_escrow_acc from public.ledger_accounts
      where owner_id is null and account_type = 'platform_escrow' and currency = 'NGN';
    select id into v_rev_acc from public.ledger_accounts
      where owner_id is null and account_type = 'platform_revenue' and currency = 'NGN';

    perform public.loamy_post_ledger(
      'escrow_release',
      jsonb_build_array(
        jsonb_build_object('account_id', v_escrow_acc, 'amount',  v_w.amount),
        jsonb_build_object('account_id', v_seller_acc, 'amount', -(v_w.amount - v_fee)),
        jsonb_build_object('account_id', v_rev_acc,    'amount', -v_fee)),
      'escrow-release:' || p_escrow_id::text,
      v_w.provider, 'escrow_workflow', p_escrow_id,
      'Escrow released to seller, net of platform fee');
  end if;

  update public.escrow_workflows
     set state = v_rule.new_state,
         released_amount = case when p_event_type = 'released' then amount else released_amount end,
         updated_at = now()
   where id = p_escrow_id;

  insert into public.escrow_workflow_events (
    escrow_id, event_type, actor_id, actor_kind, previous_state, new_state, amount, detail)
  values (p_escrow_id, p_event_type, v_uid,
          case when v_is_system then 'system' when v_is_admin then 'platform'
               when v_w.buyer_id = v_uid then 'buyer' else 'seller' end,
          v_w.state, v_rule.new_state, coalesce(p_amount, v_w.amount),
          coalesce(p_detail, '{}'::jsonb)
            || case when p_event_type = 'released'
                    then jsonb_build_object('fee_applied', v_fee_src)
                    else '{}'::jsonb end)
  returning id into v_event;

  -- Mirror onto the transaction's PAYMENT machine, through its own path. The
  -- transaction's agreement and fulfilment machines are untouched: escrow only
  -- ever speaks about money.
  if v_w.transaction_id is not null then
    select payment_state into v_pay_state from public.transactions where id = v_w.transaction_id;

    perform set_config('loamy.txn_system_authorized', 'true', true);

    if p_event_type = 'funded' then
      if v_pay_state in ('not_started','failed') then
        perform public.loamy_transaction_transition(
          v_w.transaction_id, 'payment_initiated', 'payment', null, '{}'::jsonb,
          v_w.provider, v_w.provider_reference);
      end if;
    elsif p_event_type = 'held' then
      perform public.loamy_transaction_transition(
        v_w.transaction_id, 'payment_held', 'payment', null, '{}'::jsonb,
        v_w.provider, v_w.provider_reference);
    elsif p_event_type = 'released' then
      perform public.loamy_transaction_transition(
        v_w.transaction_id, 'payment_released', 'payment', null, '{}'::jsonb,
        v_w.provider, v_w.provider_reference);
    elsif p_event_type = 'refunded' then
      perform public.loamy_transaction_transition(
        v_w.transaction_id, 'payment_refunded', 'payment', null, '{}'::jsonb,
        v_w.provider, v_w.provider_reference);
    end if;

    perform set_config('loamy.txn_system_authorized', 'false', true);
  end if;

  return v_event;
end;
$$;

revoke all on function public.loamy_escrow_transition(uuid,text,numeric,jsonb) from public, anon;
grant execute on function public.loamy_escrow_transition(uuid,text,numeric,jsonb) to authenticated;
