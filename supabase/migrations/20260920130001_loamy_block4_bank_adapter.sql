-- ============================================================================
-- BLOCK 4 (a) — the partner-bank boundary.
-- ----------------------------------------------------------------------------
-- Loamy is not the lender and does not own credit policy. What Loamy owns is
-- the SHAPE of the conversation: a structured application in, a structured
-- decision back, and a record of which side said what.
--
-- Three things this migration establishes.
--
-- 1. CAPABILITIES ARE DATA, NOT CODE. No bank is named anywhere in the core
--    model. A bank declares what it supports, every flag defaults to NO, and
--    a workflow that needs a capability checks for it rather than assuming.
--    supports_supplier_direct stays the authoritative gate for the
--    supplier-direct path.
--
-- 2. A DECISION CARRIES ITS PROVENANCE. decision_source records whether an
--    approval came from a bank officer, a bank API, or the SANDBOX adapter.
--    A sandbox decision is marked as such on the row and in every payload
--    that carries it, so a simulated approval can never be mistaken for a
--    real one. That is the whole of rule 30 in one column.
--
-- 3. REPAYMENT IS REFERENCED, NEVER COMPUTED. Loamy stores the minimum
--    status a bank reports and the moment it was reported. It does not
--    derive credit performance from partial data, because a wrong "overdue"
--    on a farmer's record is a real harm and Loamy would have no standing to
--    assert it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Decision data the bank owns.
-- ----------------------------------------------------------------------------
alter table public.financing_applications
  add column if not exists bank_reference   text,
  add column if not exists tenor_days       int check (tenor_days is null or tenor_days > 0),
  add column if not exists pricing_note     text,
  add column if not exists decision_source  text
    check (decision_source is null or decision_source in
           ('bank_officer','bank_api','sandbox_adapter')),
  add column if not exists is_sandbox       boolean not null default false,
  -- Repayment, as REPORTED by the institution.
  add column if not exists repayment_status text
    check (repayment_status is null or repayment_status in
           ('active','partially_repaid','repaid','overdue','restructured','unknown')),
  add column if not exists repayment_reported_at timestamptz,
  add column if not exists repayment_source text;

comment on column public.financing_applications.is_sandbox is
  'TRUE when the decision came from the sandbox adapter. A sandbox approval is a simulation and must never be presented as a real credit decision.';
comment on column public.financing_applications.repayment_status is
  'As REPORTED by the institution. Loamy never derives this -- a wrong "overdue" on a member''s record is a real harm Loamy has no standing to assert.';

-- ----------------------------------------------------------------------------
-- 2. The adapter surface: what can this bank actually do?
-- ----------------------------------------------------------------------------
/**
 * The capability map a UI must consult before offering anything.
 *
 * Named capabilities rather than a bank name, so adding a second partner is a
 * row, not a branch. Every capability defaults to false: a workflow that is
 * not explicitly supported is not offered.
 */
create or replace function public.loamy_bank_capabilities(p_bank_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare b public.banks%rowtype;
begin
  select * into b from public.banks where id = p_bank_id;
  if b.id is null then
    return jsonb_build_object('available', false, 'reason', 'no_such_bank');
  end if;
  if not b.active then
    return jsonb_build_object('available', false, 'reason', 'inactive', 'bank', b.name);
  end if;

  return jsonb_build_object(
    'available', b.integration_mode <> 'disabled',
    'bank', b.name,
    'bank_id', b.id,
    'ref', b.ref,
    'integration_mode', b.integration_mode,
    -- Loud, because everything downstream depends on reading it.
    'is_sandbox', b.integration_mode = 'sandbox',
    'capabilities', jsonb_build_object(
      'check_eligibility', true,
      'submit_application', b.integration_mode <> 'disabled',
      'get_application_status', true,
      'receive_decision', true,
      'account_opening', b.supports_account_opening,
      'account_opening_url', case when b.supports_account_opening then b.account_opening_url end,
      'status_callback', b.supports_status_callback,
      -- The authoritative gate for the supplier-direct path.
      'supplier_direct', b.supports_supplier_direct),
    'contact_note', b.contact_note);
end;
$$;

grant execute on function public.loamy_bank_capabilities(uuid) to authenticated;

/**
 * Banks a buyer may actually apply to right now, with their capabilities.
 * Used by checkout, so the UI never offers a path the bank cannot honour.
 */
create or replace function public.loamy_financing_partners()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.loamy_bank_capabilities(b.id) order by b.name), '[]'::jsonb)
  from public.banks b
  where b.active and b.integration_mode <> 'disabled';
$$;

grant execute on function public.loamy_financing_partners() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The decision, extended — still owned entirely by the bank.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_financing_decision(
  p_application_id uuid,
  p_decision       text,
  p_approved_amount numeric default null,
  p_conditions     text default null,
  p_note           text default null,
  p_tenor_days     int default null,
  p_pricing_note   text default null,
  p_bank_reference text default null,
  p_expires_at     timestamptz default null,
  p_source         text default 'bank_officer'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_a    public.financing_applications%rowtype;
  v_bank uuid := public.loamy_officer_bank();
  v_b    public.banks%rowtype;
  v_sandbox boolean := false;
begin
  select * into v_a from public.financing_applications where id = p_application_id for update;
  if v_a.id is null then raise exception 'Application not found.'; end if;

  -- Only an officer of the ASSIGNED bank, or an admin acting for them.
  if not (public.loamy_is_admin() or (v_bank is not null and v_a.bank_id = v_bank)) then
    raise exception 'Only the assigned bank can decide this application.';
  end if;
  if p_decision not in ('approved','partially_approved','rejected',
                        'additional_information_required','under_review') then
    raise exception 'Unknown decision: %', p_decision;
  end if;
  if v_a.status in ('disbursed','completed','cancelled','expired') then
    raise exception 'This application is % and cannot be re-decided.', v_a.status;
  end if;
  if p_source not in ('bank_officer','bank_api','sandbox_adapter') then
    raise exception 'Unknown decision source: %', p_source;
  end if;

  select * into v_b from public.banks where id = v_a.bank_id;
  v_sandbox := coalesce(v_b.integration_mode, 'sandbox') = 'sandbox'
               or p_source = 'sandbox_adapter';

  -- A sandbox adapter may not write a decision for a bank that is LIVE. The
  -- simulator must never be able to produce a real-looking approval.
  if p_source = 'sandbox_adapter' and coalesce(v_b.integration_mode, '') = 'live' then
    raise exception 'The sandbox adapter cannot decide for a live bank integration.';
  end if;

  if p_decision in ('approved','partially_approved') then
    if p_approved_amount is null or p_approved_amount <= 0 then
      raise exception 'An approval needs an approved amount.';
    end if;
    if p_approved_amount > v_a.amount_requested then
      raise exception 'Approved amount cannot exceed the amount requested.';
    end if;
  end if;

  perform set_config('loamy.financing_decision_authorized', 'true', true);
  update public.financing_applications
     set status = p_decision,
         approved_amount = case when p_decision in ('approved','partially_approved')
                                then p_approved_amount else approved_amount end,
         conditions    = coalesce(p_conditions, conditions),
         decision_note = coalesce(p_note, decision_note),
         tenor_days    = coalesce(p_tenor_days, tenor_days),
         pricing_note  = coalesce(p_pricing_note, pricing_note),
         bank_reference = coalesce(p_bank_reference, bank_reference),
         expires_at    = coalesce(p_expires_at, expires_at),
         decision_source = p_source,
         is_sandbox    = v_sandbox,
         reviewed_by   = v_uid,
         decided_at    = case when p_decision in ('approved','partially_approved','rejected')
                              then now() else decided_at end,
         updated_at    = now()
   where id = p_application_id;
  perform set_config('loamy.financing_decision_authorized', 'false', true);

  insert into public.financing_events (
    application_id, event_type, actor_id, actor_kind, previous_status, new_status, amount, note, detail)
  values (p_application_id, p_decision, v_uid, 'bank', v_a.status, p_decision,
          p_approved_amount, p_note,
          jsonb_build_object('source', p_source, 'is_sandbox', v_sandbox,
                             'tenor_days', p_tenor_days, 'bank_reference', p_bank_reference));

  insert into public.notifications (user_id, title, body, type)
  values (v_a.applicant_id, 'Financing update',
          case when v_sandbox
               then 'Your financing application has been updated (sandbox simulation).'
               else 'Your financing application has been updated by the bank.' end,
          'finance');

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'bank', 'financing_decision', 'financing_application', p_application_id,
          jsonb_build_object('decision', p_decision, 'approved_amount', p_approved_amount,
                             'source', p_source, 'is_sandbox', v_sandbox));
end;
$$;

revoke all on function public.loamy_financing_decision(
  uuid,text,numeric,text,text,int,text,text,timestamptz,text) from public, anon;
grant execute on function public.loamy_financing_decision(
  uuid,text,numeric,text,text,int,text,text,timestamptz,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Repayment status, as reported.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_record_repayment_status(
  p_application_id uuid,
  p_status         text,
  p_source         text default 'bank_report'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_a    public.financing_applications%rowtype;
  v_bank uuid := public.loamy_officer_bank();
begin
  select * into v_a from public.financing_applications where id = p_application_id;
  if v_a.id is null then raise exception 'Application not found.'; end if;

  if not (public.loamy_is_admin() or (v_bank is not null and v_a.bank_id = v_bank)) then
    raise exception 'Only the lending institution reports repayment status.';
  end if;
  if p_status not in ('active','partially_repaid','repaid','overdue','restructured','unknown') then
    raise exception 'Unknown repayment status: %', p_status;
  end if;

  perform set_config('loamy.financing_decision_authorized', 'true', true);
  update public.financing_applications
     set repayment_status = p_status,
         repayment_reported_at = now(),
         repayment_source = p_source,
         updated_at = now()
   where id = p_application_id;
  perform set_config('loamy.financing_decision_authorized', 'false', true);

  insert into public.financing_events (
    application_id, event_type, actor_id, actor_kind, new_status, note, detail)
  values (p_application_id, 'repayment_status', v_uid, 'bank', v_a.status,
          'Reported by the institution',
          jsonb_build_object('repayment_status', p_status, 'source', p_source));

  return jsonb_build_object('recorded', true, 'repayment_status', p_status);
end;
$$;

revoke all on function public.loamy_record_repayment_status(uuid,text,text) from public, anon;
grant execute on function public.loamy_record_repayment_status(uuid,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. The sandbox adapter — a SIMULATOR, and it says so.
-- ----------------------------------------------------------------------------
/**
 * Stands in for a bank's decisioning while no integration is signed off.
 *
 * It applies NO credit policy, because inventing one is the thing Loamy must
 * not do. It returns whatever the caller asked it to simulate, marks the
 * result as a sandbox decision, and refuses to run against a bank whose
 * integration_mode is 'live'.
 *
 * Admin-only. A member cannot simulate their own approval.
 */
create or replace function public.loamy_sandbox_bank_decision(
  p_application_id uuid,
  p_decision       text,
  p_approved_amount numeric default null,
  p_note           text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.financing_applications%rowtype;
  v_b public.banks%rowtype;
begin
  if not public.loamy_is_admin() then
    raise exception 'The sandbox adapter is administrative. A member cannot simulate a bank decision.';
  end if;

  select * into v_a from public.financing_applications where id = p_application_id;
  if v_a.id is null then raise exception 'Application not found.'; end if;

  select * into v_b from public.banks where id = v_a.bank_id;
  if coalesce(v_b.integration_mode, 'sandbox') <> 'sandbox' then
    return jsonb_build_object('simulated', false, 'reason', 'bank_not_in_sandbox',
      'integration_mode', v_b.integration_mode,
      'message', 'This bank is not in sandbox mode. A real decision must come from the institution.');
  end if;

  perform public.loamy_financing_decision(
    p_application_id, p_decision,
    case when p_decision in ('approved','partially_approved')
         then coalesce(p_approved_amount, v_a.amount_requested) end,
    null,
    coalesce(p_note, 'Sandbox simulation — not a credit decision.'),
    null, null,
    'SANDBOX-' || left(replace(p_application_id::text, '-', ''), 10),
    now() + interval '30 days',
    'sandbox_adapter');

  return jsonb_build_object(
    'simulated', true,
    'is_sandbox', true,
    'decision', p_decision,
    'disclaimer', 'Simulated by the Loamy sandbox adapter. This is not a credit decision, not an offer, and not a guarantee.');
end;
$$;

revoke all on function public.loamy_sandbox_bank_decision(uuid,text,numeric,text) from public, anon;
grant execute on function public.loamy_sandbox_bank_decision(uuid,text,numeric,text) to authenticated;

comment on function public.loamy_sandbox_bank_decision(uuid,text,numeric,text) is
  'BLOCK 4. A SIMULATOR for use while no bank integration is signed off. Applies no credit policy, marks every result is_sandbox, refuses a live bank, and is admin-only.';
