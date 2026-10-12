-- ============================================================================
-- Activate facility: accept the decision states the product actually produces.
--
-- THE BUG
--   `loamy_activate_facility` was written in Stage 7, when the only way an
--   application could be decided was outside Loamy:
--
--       if v_app.status <> 'decided_external' then
--         raise exception 'Only a decided application can be activated ...';
--
--   Phase 4 slice 3 then introduced the in-Loamy decision lifecycle, so a bank
--   officer deciding inside the portal leaves the application `approved` or
--   `partially_approved`. The RPC was never taught about either.
--
--   BankLoans.tsx offers "Activate facility" for all three states, and its own
--   comment says a facility may be opened against any approved application.
--   So the button was correct and the function refused it: every activation of
--   an application decided INSIDE Loamy failed with "Only a decided
--   application can be activated as a facility". On staging that is 6 of the
--   18 applications.
--
-- WHAT CHANGES
--   1. The status test becomes the set of decided-AND-fundable statuses, which
--      is what src/lib/financingLifecycle.ts already calls decided: `rejected`,
--      `expired` and `cancelled` are decided but not fundable, and `disbursed`
--      and `completed` are already past activation.
--   2. Activation becomes idempotent. facilities.application_id is UNIQUE, so a
--      double submit previously surfaced as a raw 23505. It now returns the
--      facility that already exists, so a retry after a dropped response is
--      safe and a double click cannot create a second facility.
--
-- WHAT DOES NOT CHANGE
--   The bank is still derived server-side from loamy_officer_bank(); the
--   application must still belong to that bank; the principal is still
--   validated; the audit row and the applicant notification are unchanged.
--   No client-supplied bank, actor or decision provenance is accepted.
-- ============================================================================

create or replace function public.loamy_activate_facility(
  p_application uuid, p_principal numeric, p_sector text default 'Agriculture Production',
  p_instalments int default 0, p_first_due date default null, p_instalment_amount numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank uuid := public.loamy_officer_bank();
  v_app  public.financing_applications%rowtype;
  v_fac  uuid;
  i      int;
begin
  if v_bank is null then
    raise exception 'Bank officers only';
  end if;
  select * into v_app from public.financing_applications where id = p_application;
  if v_app.id is null or v_app.bank_id is distinct from v_bank then
    raise exception 'Application not found for your bank';
  end if;

  -- Decided AND fundable. A declined, expired or withdrawn application is
  -- decided but must never open a facility, and one already disbursed or
  -- completed is past this point.
  if v_app.status not in ('approved', 'partially_approved', 'decided_external') then
    raise exception 'Only an approved application can be activated as a facility (this one is %)', v_app.status;
  end if;
  if p_principal < 0 then
    raise exception 'Principal must be non-negative';
  end if;

  -- Idempotent: one facility per application, enforced by the unique index.
  -- Returning the existing row makes a retry harmless instead of a 23505.
  select id into v_fac from public.facilities where application_id = p_application;
  if v_fac is not null then
    return v_fac;
  end if;

  insert into public.facilities (application_id, bank_id, borrower_id, principal, structure, sector, created_by)
  values (p_application, v_bank, v_app.applicant_id, p_principal, coalesce(v_app.structure, 'murabaha'), p_sector, auth.uid())
  on conflict (application_id) do nothing
  returning id into v_fac;

  -- Lost the race with a concurrent activation: take the winner's facility.
  if v_fac is null then
    select id into v_fac from public.facilities where application_id = p_application;
    return v_fac;
  end if;

  if p_instalments > 0 and p_first_due is not null and p_instalment_amount > 0 then
    for i in 0 .. p_instalments - 1 loop
      insert into public.repayment_schedule (facility_id, due_date, amount_due, recorded_by)
      values (v_fac, (p_first_due + (i || ' months')::interval)::date, p_instalment_amount, auth.uid());
    end loop;
  end if;

  perform public.loamy_audit_internal('facility_activated', 'facility', v_fac,
    jsonb_build_object('application_id', p_application, 'principal', p_principal, 'sector', p_sector));
  perform public.loamy_create_notification_internal(
    v_app.applicant_id, 'Facility opened',
    'Your financing facility has been opened with the partner bank. Track disbursements and repayments under Financing.',
    'financing');
  return v_fac;
end;
$$;

revoke all on function public.loamy_activate_facility(uuid, numeric, text, int, date, numeric) from public, anon;
grant execute on function public.loamy_activate_facility(uuid, numeric, text, int, date, numeric) to authenticated;
