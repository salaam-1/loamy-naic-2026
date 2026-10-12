-- ============================================================================
-- BLOCK 4 (c) — supplier-direct settlement.
-- ----------------------------------------------------------------------------
-- The most consequential workflow in Loamy, and the one most easily built
-- wrong.
--
-- WHAT ACTUALLY HAPPENS: the partner institution pays the seller. The money
-- does not pass through Loamy, and the buyer never receives it as cash.
-- Loamy's job is to (a) prove the conditions were met before anyone paid,
-- and (b) keep a faithful record of what the institution reported.
--
-- SO THE LEDGER ENTRY IS A MEMORANDUM. Two new account types are added, both
-- named so they cannot be misread as custody:
--
--   partner_funding       funding provided by an institution into a deal
--   external_settlement   funds settled OUTSIDE Loamy, to a named party
--
-- Neither is a member balance. Nothing here implies Loamy holds money or owes
-- anyone, which is precisely the representation the directive forbids. The
-- entry still balances, so reconciliation continues to work over it.
--
-- IDEMPOTENCY is the bank's reference. loamy_post_ledger already refuses a
-- duplicate external_reference, so a replayed settlement callback cannot pay
-- twice; this function turns that refusal into an honest "already settled"
-- rather than an error the caller might retry.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Memorandum account types.
-- ----------------------------------------------------------------------------
alter table public.ledger_accounts drop constraint if exists ledger_accounts_account_type_check;
alter table public.ledger_accounts add constraint ledger_accounts_account_type_check
  check (account_type in (
    'member_receivable',
    'member_payable',
    'provider_clearing',
    'platform_revenue',
    'platform_escrow',
    'suspense',
    -- MEMORANDUM ONLY. Money Loamy never touches.
    'partner_funding',
    'external_settlement'
  ));

insert into public.ledger_accounts (owner_id, account_type, currency, label)
select null, 'partner_funding', 'NGN', 'Partner institution funding (memorandum)'
where not exists (select 1 from public.ledger_accounts
                  where owner_id is null and account_type = 'partner_funding' and currency = 'NGN');

insert into public.ledger_accounts (owner_id, account_type, currency, label)
select null, 'external_settlement', 'NGN', 'Settled outside Loamy (memorandum)'
where not exists (select 1 from public.ledger_accounts
                  where owner_id is null and account_type = 'external_settlement' and currency = 'NGN');

comment on table public.ledger_accounts is
  'Double-entry accounts. partner_funding and external_settlement are MEMORANDUM: they record money that moved between an institution and a member without passing through Loamy. They are never a member balance.';

-- ----------------------------------------------------------------------------
-- 2. Verification, requested for a financing application.
-- ----------------------------------------------------------------------------
/**
 * The bank, the buyer or an admin can ask for the commodity behind a
 * financing application to be physically inspected.
 *
 * Reuses verification_tasks and the anonymity model already built -- the
 * inspected party sees "Loamy Verification Agent", never the agent. Adding a
 * parallel inspection concept here would have been a second place for the
 * same truth.
 */
create or replace function public.loamy_request_financing_verification(
  p_application_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_a    public.financing_applications%rowtype;
  v_t    public.transactions%rowtype;
  v_b    public.commodity_batches%rowtype;
  v_case uuid;
  v_bank uuid := public.loamy_officer_bank();
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_a from public.financing_applications where id = p_application_id;
  if v_a.id is null then raise exception 'Application not found.'; end if;

  if not (public.loamy_is_admin()
          or v_a.applicant_id = v_uid
          or (v_bank is not null and v_bank = v_a.bank_id)) then
    raise exception 'Only the applicant, the assigned bank or an administrator can order verification.';
  end if;

  if v_a.batch_id is null then
    return jsonb_build_object('requested', false, 'reason', 'not_batch_backed',
      'message', 'This purchase is not backed by a traceable batch, so there is nothing to inspect.');
  end if;

  select * into v_t from public.transactions where id = v_a.transaction_id;
  select * into v_b from public.commodity_batches where id = v_a.batch_id;

  -- Idempotent: reuse any case already open on this batch. A second agent
  -- despatched to the same yard is cost and confusion, not extra assurance.
  select id into v_case from public.verification_tasks
   where subject_type = 'commodity_batch' and subject_id = v_a.batch_id
     and status not in ('approved','rejected')
   order by created_at desc limit 1;

  if v_case is not null then
    return jsonb_build_object('requested', true, 'case_id', v_case, 'reused', true);
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  insert into public.verification_tasks (
    task_type, subject_type, subject_id, subject_user_id, requested_by,
    status, priority, expected_state, expected_lga
  ) values (
    'commodity_verification', 'commodity_batch', v_a.batch_id, v_b.owner_id, v_uid,
    'pending', 'high',
    coalesce(v_b.current_state, v_b.origin_state), v_b.origin_lga)
  returning id into v_case;
  perform set_config('loamy.status_change_authorized', 'false', true);

  insert into public.financing_events (
    application_id, event_type, actor_id, actor_kind, new_status, note, detail)
  values (p_application_id, 'verification_requested', v_uid,
          case when v_bank is not null then 'bank'
               when public.loamy_is_admin() then 'platform' else 'applicant' end,
          v_a.status, p_note, jsonb_build_object('case_id', v_case, 'batch_id', v_a.batch_id));

  return jsonb_build_object('requested', true, 'case_id', v_case, 'reused', false);
end;
$$;

revoke all on function public.loamy_request_financing_verification(uuid,text) from public, anon;
grant execute on function public.loamy_request_financing_verification(uuid,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Settlement.
-- ----------------------------------------------------------------------------
/**
 * Record that the institution has settled the seller directly.
 *
 * This function does NOT move money. It records that money moved, having
 * first proved every condition was met. Callable only by an officer of the
 * assigned bank or an admin -- never by a member, and never by the seller who
 * benefits from it.
 */
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
  if p_amount > coalesce(v_a.approved_amount, 0) then
    raise exception 'A settlement cannot exceed the approved amount (%).', v_a.approved_amount;
  end if;

  -- Replay protection, reported honestly rather than as an error a caller
  -- would retry.
  if exists (select 1 from public.ledger_entries
             where external_reference = 'settle:' || p_provider_reference) then
    return jsonb_build_object('settled', false, 'reason', 'already_settled',
      'provider_reference', p_provider_reference,
      'message', 'That settlement reference has already been recorded.');
  end if;

  -- EVERY condition, before any record of payment.
  v_ready := public.loamy_settlement_readiness(p_application_id);
  if not (v_ready->>'ready')::boolean then
    return jsonb_build_object('settled', false, 'reason', 'conditions_not_met',
      'blocked_by', v_ready->'blocked_by', 'conditions', v_ready->'conditions');
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

comment on function public.loamy_record_supplier_settlement(uuid,numeric,text,text,text) is
  'BLOCK 4, directive 8/13/22. Records that the INSTITUTION settled the seller. Proves every condition first, is idempotent on the institution''s reference, and posts a memorandum entry that never implies Loamy custody.';
