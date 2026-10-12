-- ============================================================================
-- BLOCK 5 (d) — commission.
-- ----------------------------------------------------------------------------
-- The constraint that shaped this: no wallet, and no new money table.
--
-- So there are two things, kept apart, and neither duplicates the other:
--
--   partner_earnings    the ENTITLEMENT. What an agent has earned and where
--                       it is in its lifecycle. Already existed; it gains a
--                       real state machine rather than a replacement table.
--
--   ledger_entries      the MONEY. Recognising the liability and settling it
--                       are two double-entry postings against the existing
--                       accounts. Nothing new, nothing single-entry.
--
-- WHO PAYS IS NOT HARD-CODED (directive 22). The fee schedule decides. It may
-- be Loamy, an institution, a buyer, a seller, an enterprise client or a
-- programme partner, and the answer is frozen onto the earning at accrual so
-- a later schedule change cannot rewrite what someone was owed.
--
-- COMMISSION FOLLOWS COMPLETED, APPROVED WORK (directive 20). Not signup, not
-- invitation, not referral. An ordinary member who refers a friend earns
-- platform benefits, never cash -- and that is enforced here, not in the UI.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The entitlement, with a real lifecycle.
-- ----------------------------------------------------------------------------
alter table public.partner_earnings
  add column if not exists ref            text unique,
  add column if not exists task_id        uuid references public.verification_tasks (id) on delete set null,
  add column if not exists payer_kind     text,
  add column if not exists payer_id       uuid references public.profiles (id) on delete set null,
  add column if not exists fee_snapshot   jsonb,
  add column if not exists currency       text not null default 'NGN',
  add column if not exists approved_at    timestamptz,
  add column if not exists payable_at     timestamptz,
  add column if not exists paid_at        timestamptz,
  add column if not exists paid_reference text,
  add column if not exists liability_group uuid,
  add column if not exists settlement_group uuid,
  add column if not exists reversal_reason text,
  add column if not exists updated_at     timestamptz not null default now();

alter table public.partner_earnings drop constraint if exists partner_earnings_earning_type_check;
alter table public.partner_earnings add constraint partner_earnings_earning_type_check
  check (earning_type in (
    'onboarding','verification',
    'farm_verification','farmer_verification','commodity_verification',
    'batch_verification','quantity_verification','quality_verification',
    'transaction_verification','loading_verification',
    'warehouse_arrival_verification','logistics_verification',
    'document_verification','market_price_collection','field_support',
    -- Retained: values already in production. 'price_submission' predates
    -- this block's vocabulary; nothing is rewritten to make a list tidy.
    'price_submission'
  ));

alter table public.partner_earnings drop constraint if exists partner_earnings_status_check;
alter table public.partner_earnings add constraint partner_earnings_status_check
  check (status in (
    'estimated',  -- what the task advertised, before the work was approved
    'pending',    -- work approved, awaiting commission review
    'approved',   -- Loamy agrees it is owed
    'payable',    -- liability recognised in the ledger
    'paid',       -- settled, with a provider reference
    'reversed',
    'disputed',
    -- retained so existing rows stay valid
    'accrued','paid_externally'
  ));

alter table public.partner_earnings drop constraint if exists partner_earnings_payer_kind_check;
alter table public.partner_earnings add constraint partner_earnings_payer_kind_check
  check (payer_kind is null or payer_kind in (
    'loamy','financial_institution','buyer','seller','enterprise_client','programme_partner'
  ));

create index if not exists partner_earnings_status_idx
  on public.partner_earnings (partner_id, status, created_at desc);
create unique index if not exists partner_earnings_one_per_task
  on public.partner_earnings (task_id) where task_id is not null;

comment on table public.partner_earnings is
  'BLOCK 5. The commission ENTITLEMENT and its lifecycle. The MONEY lives in ledger_entries -- this table never holds a balance and is not a wallet.';

drop trigger if exists loamy_partner_earnings_ref on public.partner_earnings;
create trigger loamy_partner_earnings_ref
  before insert on public.partner_earnings
  for each row execute function public.loamy_assign_ref('partner_earning', 'COM');

-- No client write path at all.
create or replace function public.loamy_commission_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('loamy.commission_authorized', true), '') <> 'true' then
    raise exception 'Commission records are written by the commission workflow, not directly.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Commission history is never deleted.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists loamy_partner_earnings_guard on public.partner_earnings;
create trigger loamy_partner_earnings_guard
  before insert or update or delete on public.partner_earnings
  for each row execute function public.loamy_commission_guard();

-- ----------------------------------------------------------------------------
-- 2. The schedule decides the rate AND the payer.
-- ----------------------------------------------------------------------------
-- The commission scope is new; the existing list did not anticipate paying
-- a field agent, only charging a member.
alter table public.fee_schedules drop constraint if exists fee_schedules_scope_check;
alter table public.fee_schedules add constraint fee_schedules_scope_check
  check (scope in (
    'marketplace_transaction','verification','logistics','warehouse',
    'financing_facilitation','withdrawal','verification_commission'));

alter table public.fee_schedules drop constraint if exists fee_schedules_payer_check;
alter table public.fee_schedules add constraint fee_schedules_payer_check
  check (payer in (
    'buyer','seller','split','platform',
    'loamy','financial_institution','enterprise_client','programme_partner'
  ));

insert into public.fee_schedules (scope, transaction_type, basis, value, payer, note)
select 'verification_commission', t, 'flat', v, 'loamy',
       'Block 5 default. Replace with the commercial rate when it is agreed.'
from (values
  ('farm_verification', 2500),
  ('farmer_verification', 1500),
  ('commodity_verification', 4000),
  ('batch_verification', 4000),
  ('loading_verification', 3500),
  ('market_price_collection', 800)
) as d(t, v)
where not exists (
  select 1 from public.fee_schedules f
  where f.scope = 'verification_commission' and f.transaction_type = d.t);

-- ----------------------------------------------------------------------------
-- 3. Accrual — only from completed, approved work.
-- ----------------------------------------------------------------------------
/**
 * Called when a verification case is approved. Idempotent per task.
 *
 * Refuses outright for anyone who is not a Growth Partner, which is where
 * directive 23 is actually enforced: an ordinary member's referral can never
 * become a cash entitlement, because this is the only door to one.
 */
create or replace function public.loamy_accrue_commission(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t    public.verification_tasks%rowtype;
  v_fee  jsonb;
  v_amt  numeric;
  v_payer text;
  v_id   uuid;
begin
  select * into v_t from public.verification_tasks where id = p_task_id;
  if v_t.id is null then
    return jsonb_build_object('accrued', false, 'reason', 'no_such_task');
  end if;
  if v_t.status <> 'approved' then
    return jsonb_build_object('accrued', false, 'reason', 'work_not_approved',
      'status', v_t.status);
  end if;
  if v_t.assigned_to is null then
    return jsonb_build_object('accrued', false, 'reason', 'no_agent');
  end if;

  -- The gate that keeps referral out of the money path.
  if not public.loamy_can_verify(v_t.assigned_to) then
    return jsonb_build_object('accrued', false, 'reason', 'not_a_growth_partner',
      'message', 'Only a Growth Partner earns a cash commission. Ordinary referrals earn platform benefits.');
  end if;

  if exists (select 1 from public.partner_earnings where task_id = p_task_id) then
    select id into v_id from public.partner_earnings where task_id = p_task_id;
    return jsonb_build_object('accrued', false, 'reason', 'already_accrued', 'earning_id', v_id);
  end if;

  v_fee := public.loamy_resolve_fee('verification_commission', 0, v_t.task_type);
  if not (v_fee->>'resolved')::boolean then
    return jsonb_build_object('accrued', false, 'reason', 'no_commission_rule',
      'task_type', v_t.task_type,
      'message', 'No commission rate is set for this task type. Nothing is owed until one is.');
  end if;

  v_amt := (v_fee->>'fee')::numeric;
  -- The schedule names the payer. Nothing here assumes the farmer pays.
  v_payer := case v_fee->>'payer'
               when 'platform' then 'loamy'
               when 'buyer' then 'buyer'
               when 'seller' then 'seller'
               else coalesce(v_fee->>'payer', 'loamy') end;

  perform set_config('loamy.commission_authorized', 'true', true);
  insert into public.partner_earnings (
    partner_id, earning_type, reference_id, task_id, amount, status,
    payer_kind, fee_snapshot)
  values (v_t.assigned_to, v_t.task_type, p_task_id, p_task_id, v_amt, 'pending',
          v_payer, v_fee)
  returning id into v_id;
  perform set_config('loamy.commission_authorized', 'false', true);

  insert into public.notifications (user_id, title, body, type)
  values (v_t.assigned_to, 'Commission pending',
          'Your verification was approved. The commission is pending review.', 'finance');

  return jsonb_build_object('accrued', true, 'earning_id', v_id,
    'amount', v_amt, 'payer_kind', v_payer, 'status', 'pending');
end;
$$;

revoke all on function public.loamy_accrue_commission(uuid) from public, anon;
grant execute on function public.loamy_accrue_commission(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The lifecycle. Money only at 'payable' and 'paid'.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_commission_transition(
  p_earning_id uuid,
  p_event      text,
  p_reference  text default null,
  p_note       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_e     public.partner_earnings%rowtype;
  v_new   text;
  v_agent uuid;
  v_src   uuid;
  v_group uuid;
begin
  if not public.loamy_is_admin() then
    raise exception 'Commission decisions are administrative. An agent cannot move their own commission.';
  end if;

  select * into v_e from public.partner_earnings where id = p_earning_id for update;
  if v_e.id is null then raise exception 'Commission record not found.'; end if;

  v_new := case p_event
    when 'approve'      then 'approved'
    when 'make_payable' then 'payable'
    when 'pay'          then 'paid'
    when 'reverse'      then 'reversed'
    when 'dispute'      then 'disputed'
    when 'resolve'      then 'approved'
  end;
  if v_new is null then raise exception 'Unknown commission event: %', p_event; end if;

  -- The ordering that stops "task completed" being read as "paid".
  if p_event = 'approve' and v_e.status not in ('pending','disputed') then
    return jsonb_build_object('moved', false, 'reason', 'wrong_status', 'status', v_e.status);
  end if;
  if p_event = 'make_payable' and v_e.status <> 'approved' then
    return jsonb_build_object('moved', false, 'reason', 'must_be_approved_first',
      'status', v_e.status);
  end if;
  if p_event = 'pay' then
    if v_e.status <> 'payable' then
      return jsonb_build_object('moved', false, 'reason', 'must_be_payable_first',
        'status', v_e.status);
    end if;
    if coalesce(trim(p_reference), '') = '' then
      raise exception 'A payment must carry the provider''s own reference.';
    end if;
    if exists (select 1 from public.ledger_entries
               where external_reference = 'commission-pay:' || p_reference) then
      return jsonb_build_object('moved', false, 'reason', 'already_paid',
        'message', 'That payment reference has already been recorded.');
    end if;
  end if;
  if p_event in ('reverse','dispute') and coalesce(trim(p_note), '') = '' then
    raise exception 'A % needs a recorded reason.', p_event;
  end if;

  v_agent := public.loamy_member_account(v_e.partner_id, 'member_receivable');

  -- RECOGNISE THE LIABILITY. Loamy (or the named payer) now owes the agent.
  if p_event = 'make_payable' then
    if v_e.payer_kind = 'loamy' then
      select id into v_src from public.ledger_accounts
       where owner_id is null and account_type = 'platform_revenue' and currency = 'NGN';
    else
      -- Someone else's money. Memorandum, exactly as in Block 4 -- Loamy is
      -- not holding it.
      select id into v_src from public.ledger_accounts
       where owner_id is null and account_type = 'partner_funding' and currency = 'NGN';
    end if;

    v_group := public.loamy_post_ledger(
      'fee_charge',
      jsonb_build_array(
        jsonb_build_object('account_id', v_src,   'amount',  v_e.amount),
        jsonb_build_object('account_id', v_agent, 'amount', -v_e.amount)),
      'commission-liability:' || p_earning_id::text,
      null, 'partner_earning', p_earning_id,
      format('Commission %s recognised, payer: %s', v_e.ref, v_e.payer_kind));
  end if;

  -- SETTLE IT.
  if p_event = 'pay' then
    select id into v_src from public.ledger_accounts
     where owner_id is null and account_type = 'provider_clearing' and currency = 'NGN';

    v_group := public.loamy_post_ledger(
      'payout',
      jsonb_build_array(
        jsonb_build_object('account_id', v_agent, 'amount',  v_e.amount),
        jsonb_build_object('account_id', v_src,   'amount', -v_e.amount)),
      'commission-pay:' || p_reference,
      null, 'partner_earning', p_earning_id,
      format('Commission %s paid', v_e.ref));
  end if;

  -- REVERSE IT: a counter-entry, never a deletion.
  if p_event = 'reverse' and v_e.liability_group is not null then
    select id into v_src from public.ledger_accounts
     where owner_id is null and account_type = 'platform_revenue' and currency = 'NGN';
    v_group := public.loamy_post_ledger(
      'payout_reversal',
      jsonb_build_array(
        jsonb_build_object('account_id', v_agent, 'amount',  v_e.amount),
        jsonb_build_object('account_id', v_src,   'amount', -v_e.amount)),
      'commission-reverse:' || p_earning_id::text,
      null, 'partner_earning', p_earning_id,
      format('Commission %s reversed: %s', v_e.ref, p_note));
  end if;

  perform set_config('loamy.commission_authorized', 'true', true);
  update public.partner_earnings
     set status = v_new,
         approved_at = case when p_event = 'approve' then now() else approved_at end,
         payable_at  = case when p_event = 'make_payable' then now() else payable_at end,
         paid_at     = case when p_event = 'pay' then now() else paid_at end,
         paid_reference = case when p_event = 'pay' then p_reference else paid_reference end,
         liability_group = case when p_event = 'make_payable' then v_group else liability_group end,
         settlement_group = case when p_event = 'pay' then v_group else settlement_group end,
         reversal_reason = case when p_event in ('reverse','dispute') then p_note
                                else reversal_reason end,
         paid_note = coalesce(p_note, paid_note),
         updated_at = now()
   where id = p_earning_id;
  perform set_config('loamy.commission_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'admin', 'commission_' || p_event, 'partner_earning', p_earning_id,
          jsonb_build_object('from', v_e.status, 'to', v_new, 'amount', v_e.amount,
                             'reference', p_reference, 'ledger_group', v_group));

  insert into public.notifications (user_id, title, body, type)
  values (v_e.partner_id,
          case p_event when 'pay' then 'Commission paid'
                       when 'approve' then 'Commission approved'
                       when 'reverse' then 'Commission reversed'
                       else 'Commission updated' end,
          format('Commission %s is now %s.', v_e.ref, v_new), 'finance');

  return jsonb_build_object('moved', true, 'status', v_new, 'ledger_group', v_group);
end;
$$;

revoke all on function public.loamy_commission_transition(uuid,text,text,text) from public, anon;
grant execute on function public.loamy_commission_transition(uuid,text,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. An agent's own earnings summary.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_my_commission_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  return (
    select jsonb_build_object(
      'currency', 'NGN',
      'pending',  coalesce(sum(amount) filter (where status = 'pending'), 0),
      'approved', coalesce(sum(amount) filter (where status = 'approved'), 0),
      'payable',  coalesce(sum(amount) filter (where status = 'payable'), 0),
      'paid',     coalesce(sum(amount) filter (where status = 'paid'), 0),
      'reversed', coalesce(sum(amount) filter (where status = 'reversed'), 0),
      'disputed', coalesce(sum(amount) filter (where status = 'disputed'), 0),
      'count',    count(*),
      'note', 'Amounts owed to you. Loamy holds no balance on your behalf -- this is an entitlement record, not a wallet.')
    from public.partner_earnings where partner_id = v_uid);
end;
$$;

revoke all on function public.loamy_my_commission_summary() from public, anon;
grant execute on function public.loamy_my_commission_summary() to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Accrue automatically when a case is approved.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_commission_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and new.assigned_to is not null then
    -- Never let a commission failure roll back the verification itself.
    begin
      perform public.loamy_accrue_commission(new.id);
    exception when others then
      insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
      values (auth.uid(), 'system', 'commission_accrual_failed', 'verification_case', new.id,
              jsonb_build_object('error', sqlerrm));
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_verification_commission on public.verification_tasks;
create trigger loamy_verification_commission
  after update on public.verification_tasks
  for each row execute function public.loamy_commission_on_approval();
