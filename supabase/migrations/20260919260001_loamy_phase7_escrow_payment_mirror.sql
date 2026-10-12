-- ============================================================================
-- PHASE 7 (b) — escrow funding must open the transaction's payment machine.
-- ----------------------------------------------------------------------------
-- Found by tests/security/phase6and7-financing-money.test.ts.
--
-- The escrow workflow mirrored `held`, `released` and `refunded` onto the
-- transaction's payment machine, but not `funded`. So the sequence was:
--
--   escrow: created -> funded -> held
--   txn payment: not_started -> (nothing) -> payment_held  ->  REFUSED
--
-- because payment_held is only reachable from `pending` or `authorized`. The
-- two machines disagreed about whether money had started moving, and escrow
-- could not get past funding.
--
-- Mapping, stated so the two stay aligned:
--
--   escrow funded    -> payment_initiated   (not_started -> pending)
--                       the provider has taken the money
--   escrow held      -> payment_held        (pending     -> held)
--                       the provider confirms it is held against this deal
--   escrow released  -> payment_released
--   escrow refunded  -> payment_refunded
-- ============================================================================

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
    select coalesce(platform_fee_bps, 0) into v_bps from public.platform_config where id = 1;
    v_fee := round(v_w.amount * coalesce(v_bps, 0) / 10000.0, 2);

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
          v_w.state, v_rule.new_state, coalesce(p_amount, v_w.amount), coalesce(p_detail, '{}'::jsonb))
  returning id into v_event;

  -- Mirror onto the transaction's PAYMENT machine, through its own path. The
  -- transaction's agreement and fulfilment machines are untouched: escrow only
  -- ever speaks about money.
  if v_w.transaction_id is not null then
    select payment_state into v_pay_state from public.transactions where id = v_w.transaction_id;

    perform set_config('loamy.txn_system_authorized', 'true', true);

    if p_event_type = 'funded' then
      -- The provider has taken the money: payment has begun.
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
