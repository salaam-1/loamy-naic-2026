-- ============================================================================
-- BLOCK 4 (i) — report the refusal that helps.
-- ----------------------------------------------------------------------------
-- Found by the end-to-end test: settling a DECLINED application raised
--
--   "A settlement cannot exceed the approved amount (<null>)"
--
-- which is true, and useless. The caller's actual problem is that the bank
-- said no. Two changes:
--
--   * the readiness gate runs BEFORE the amount comparison, so a declined
--     application answers with blocked_by: ["bank_approved"]
--   * an over-large amount is a structured refusal rather than an exception,
--     matching how every other refusal in this function behaves
--
-- Same shape as the Block 3 fix: when several refusals are true at once,
-- report the one the caller can act on.
-- ============================================================================

create or replace function public.loamy_record_supplier_settlement(
  p_application_id    uuid,
  p_amount            numeric,
  p_provider          text,
  p_provider_reference text,
  p_note              text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_a     public.financing_applications%rowtype;
  v_bank  uuid := public.loamy_officer_bank();
  v_ready jsonb;
  v_fund  uuid;
  v_ext   uuid;
  v_group uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_a from public.financing_applications where id = p_application_id for update;
  if v_a.id is null then raise exception 'Application not found.'; end if;

  -- The institution settles. A member never can, including the seller.
  if not (public.loamy_is_admin() or (v_bank is not null and v_bank = v_a.bank_id)) then
    raise exception 'Only the settling institution can record a supplier settlement.';
  end if;

  if p_provider_reference is null or length(trim(p_provider_reference)) = 0 then
    raise exception 'A settlement must carry the institution''s own reference.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'A settlement amount must be greater than zero.';
  end if;
  -- Replay protection, reported honestly rather than as an error a caller
  -- would retry.
  if exists (select 1 from public.ledger_entries
             where external_reference = 'settle:' || p_provider_reference) then
    return jsonb_build_object('settled', false, 'reason', 'already_settled',
      'provider_reference', p_provider_reference,
      'message', 'That settlement reference has already been recorded.');
  end if;

  -- EVERY condition, before any record of payment. This comes BEFORE the
  -- amount check on purpose: on a declined application approved_amount is
  -- null, and "cannot exceed the approved amount (null)" is a true statement
  -- that tells the caller nothing. "blocked_by: bank_approved" does.
  v_ready := public.loamy_settlement_readiness(p_application_id);
  if not (v_ready->>'ready')::boolean then
    return jsonb_build_object('settled', false, 'reason', 'conditions_not_met',
      'blocked_by', v_ready->'blocked_by', 'conditions', v_ready->'conditions');
  end if;

  if p_amount > coalesce(v_a.approved_amount, 0) then
    return jsonb_build_object('settled', false, 'reason', 'exceeds_approved_amount',
      'approved_amount', v_a.approved_amount, 'attempted', p_amount);
  end if;

  select id into v_fund from public.ledger_accounts
   where owner_id is null and account_type = 'partner_funding' and currency = 'NGN';
  select id into v_ext from public.ledger_accounts
   where owner_id is null and account_type = 'external_settlement' and currency = 'NGN';

  -- MEMORANDUM. Neither leg is a member balance; nothing here says Loamy
  -- holds or owes the money.
  v_group := public.loamy_post_ledger(
    'settlement',
    jsonb_build_array(
      jsonb_build_object('account_id', v_fund, 'amount',  p_amount),
      jsonb_build_object('account_id', v_ext,  'amount', -p_amount)),
    'settle:' || p_provider_reference,
    p_provider, 'financing_application', p_application_id,
    format('Institution settled seller directly for %s (memorandum)', v_a.ref));

  perform set_config('loamy.financing_decision_authorized', 'true', true);
  update public.financing_applications
     set disbursed_amount = coalesce(disbursed_amount, 0) + p_amount,
         status = 'disbursed',
         updated_at = now()
   where id = p_application_id;
  perform set_config('loamy.financing_decision_authorized', 'false', true);

  insert into public.financing_events (
    application_id, event_type, actor_id, actor_kind, previous_status, new_status, amount, note, detail)
  values (p_application_id, 'supplier_settled', v_uid, 'bank', v_a.status, 'disbursed',
          p_amount, p_note,
          jsonb_build_object('provider', p_provider, 'provider_reference', p_provider_reference,
                             'ledger_group', v_group, 'seller_id', v_a.seller_id,
                             'is_sandbox', v_a.is_sandbox));

  -- The transaction's PAYMENT machine, through its own guarded path. The
  -- agreement and fulfilment machines are untouched.
  if v_a.transaction_id is not null then
    perform set_config('loamy.txn_system_authorized', 'true', true);
    begin
      perform public.loamy_transaction_transition(
        v_a.transaction_id, 'payment_initiated', 'payment', null, '{}'::jsonb,
        p_provider, p_provider_reference);
    exception when others then null;
    end;
    begin
      perform public.loamy_transaction_transition(
        v_a.transaction_id, 'payment_released', 'payment', null, '{}'::jsonb,
        p_provider, p_provider_reference);
    exception when others then null;
    end;
    perform set_config('loamy.txn_system_authorized', 'false', true);
  end if;

  insert into public.notifications (user_id, title, body, type)
  values (v_a.seller_id, 'Settlement recorded',
          'The financing institution has recorded a direct settlement for your sale.', 'finance'),
         (v_a.applicant_id, 'Supplier settled',
          'Your financing institution has settled the seller directly for this purchase.', 'finance');

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'bank', 'supplier_settlement', 'financing_application', p_application_id,
          jsonb_build_object('amount', p_amount, 'provider', p_provider,
                             'provider_reference', p_provider_reference,
                             'is_sandbox', v_a.is_sandbox));

  return jsonb_build_object('settled', true, 'amount', p_amount,
    'ledger_group', v_group, 'is_sandbox', v_a.is_sandbox,
    'note', 'Recorded as a memorandum. The institution moved the funds; Loamy did not hold them.');
end;
$$;

revoke all on function public.loamy_record_supplier_settlement(uuid,numeric,text,text,text)
  from public, anon;
grant execute on function public.loamy_record_supplier_settlement(uuid,numeric,text,text,text)
  to authenticated;
