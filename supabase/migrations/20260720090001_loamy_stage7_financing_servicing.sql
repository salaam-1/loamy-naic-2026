-- ============================================================================
-- Loamy Platform · Stage 7 (PHASE 2) · Financing servicing
-- Turns a decided application into a serviced FACILITY the partner bank
-- monitors on Loamy. ARCHITECTURE: Loamy RECORDS and reconciles against the
-- bank's licensed rails — it does NOT execute transfers, hold balances, or
-- store account/card credentials. Principals, disbursements, and repayments
-- are BANK-CONFIRMED references entered by a bank officer; the money moves at
-- the bank of record. This keeps Loamy an origination + monitoring layer, not
-- a money transmitter.
--
-- SECURITY-REVIEW (Phase 2): before real go-live the engineer must wire the
-- payment-provider seam (src/lib/providers/payments.ts) for reconciliation and
-- confirm no fund custody occurs in-app. No amount here is a balance Loamy
-- holds. See HANDOFF.md "Phase 2".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) facilities — a decided application activated as a serviced loan.
-- ----------------------------------------------------------------------------
create table if not exists public.facilities (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.financing_applications (id) on delete cascade,
  bank_id        uuid not null references public.banks (id),
  borrower_id    uuid not null references public.profiles (id) on delete cascade,
  principal      numeric not null check (principal >= 0),   -- bank-confirmed
  structure      text not null default 'murabaha',
  sector         text not null default 'Agriculture Production',
  status         text not null default 'active' check (status in ('active','closed','written_off')),
  opened_on      date not null default current_date,
  closed_on      date,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists facilities_bank_idx on public.facilities (bank_id, status);
create index if not exists facilities_borrower_idx on public.facilities (borrower_id);

alter table public.facilities enable row level security;

-- Bank officers of the facility's bank + admin; the borrower sees their own.
drop policy if exists "loamy_facilities_select" on public.facilities;
create policy "loamy_facilities_select"
  on public.facilities for select to authenticated
  using (bank_id = public.loamy_officer_bank() or borrower_id = auth.uid() or public.loamy_is_admin());

-- No client insert/update/delete: facilities are created and serviced only via
-- the security-definer officer functions below.

drop trigger if exists loamy_facilities_updated_at on public.facilities;
create trigger loamy_facilities_updated_at
  before update on public.facilities
  for each row execute function public.loamy_set_updated_at();

-- ----------------------------------------------------------------------------
-- 2) disbursement_records — bank-confirmed disbursements (references, not
--    executions). Loamy records what the bank disbursed off-platform.
-- ----------------------------------------------------------------------------
create table if not exists public.disbursement_records (
  id                 uuid primary key default gen_random_uuid(),
  facility_id        uuid not null references public.facilities (id) on delete cascade,
  amount             numeric not null check (amount > 0),   -- bank-confirmed
  disbursed_on       date not null default current_date,
  external_reference text,                                   -- bank/PSP ref
  recorded_by        uuid references public.profiles (id),
  created_at         timestamptz not null default now()
);

create index if not exists disbursements_facility_idx on public.disbursement_records (facility_id);

alter table public.disbursement_records enable row level security;

drop policy if exists "loamy_disbursements_select" on public.disbursement_records;
create policy "loamy_disbursements_select"
  on public.disbursement_records for select to authenticated
  using (
    public.loamy_is_admin()
    or exists (select 1 from public.facilities f where f.id = facility_id
               and (f.bank_id = public.loamy_officer_bank() or f.borrower_id = auth.uid()))
  );

-- ----------------------------------------------------------------------------
-- 3) repayment_schedule — instalments (amounts bank-confirmed). Status is
--    computed for PAR; no payment is executed by Loamy.
-- ----------------------------------------------------------------------------
create table if not exists public.repayment_schedule (
  id                 uuid primary key default gen_random_uuid(),
  facility_id        uuid not null references public.facilities (id) on delete cascade,
  due_date           date not null,
  amount_due         numeric not null check (amount_due >= 0),
  amount_paid        numeric check (amount_paid is null or amount_paid >= 0),
  status             text not null default 'upcoming'
    check (status in ('upcoming','paid','partial','overdue')),
  paid_on            date,
  external_reference text,
  recorded_by        uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists repayment_schedule_facility_idx on public.repayment_schedule (facility_id, due_date);

alter table public.repayment_schedule enable row level security;

drop policy if exists "loamy_repayment_schedule_select" on public.repayment_schedule;
create policy "loamy_repayment_schedule_select"
  on public.repayment_schedule for select to authenticated
  using (
    public.loamy_is_admin()
    or exists (select 1 from public.facilities f where f.id = facility_id
               and (f.bank_id = public.loamy_officer_bank() or f.borrower_id = auth.uid()))
  );

drop trigger if exists loamy_repayment_schedule_updated_at on public.repayment_schedule;
create trigger loamy_repayment_schedule_updated_at
  before update on public.repayment_schedule
  for each row execute function public.loamy_set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) collateral — recorded description + estimated value (no custody).
-- ----------------------------------------------------------------------------
create table if not exists public.collateral (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities (id) on delete cascade,
  kind            text not null,
  description     text,
  estimated_value numeric check (estimated_value is null or estimated_value >= 0),
  recorded_by     uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);

create index if not exists collateral_facility_idx on public.collateral (facility_id);

alter table public.collateral enable row level security;

drop policy if exists "loamy_collateral_select" on public.collateral;
create policy "loamy_collateral_select"
  on public.collateral for select to authenticated
  using (
    public.loamy_is_admin()
    or exists (select 1 from public.facilities f where f.id = facility_id
               and (f.bank_id = public.loamy_officer_bank() or f.borrower_id = auth.uid()))
  );

-- ----------------------------------------------------------------------------
-- 5) Officer functions (record, don't execute). All bank-officer-scoped.
-- ----------------------------------------------------------------------------

-- Activate a facility from a bank's own decided application. Optionally seed an
-- equal-instalment schedule (amounts are bank-confirmed inputs).
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
  if v_app.status <> 'decided_external' then
    raise exception 'Only a decided application can be activated as a facility';
  end if;
  if p_principal < 0 then
    raise exception 'Principal must be non-negative';
  end if;

  insert into public.facilities (application_id, bank_id, borrower_id, principal, structure, sector, created_by)
  values (p_application, v_bank, v_app.applicant_id, p_principal, coalesce(v_app.structure, 'murabaha'), p_sector, auth.uid())
  returning id into v_fac;

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

-- Record a bank-confirmed disbursement (reference only; nothing is executed).
create or replace function public.loamy_record_disbursement(
  p_facility uuid, p_amount numeric, p_disbursed_on date, p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank uuid := public.loamy_officer_bank();
  v_fac  public.facilities%rowtype;
  v_id   uuid;
begin
  if v_bank is null then raise exception 'Bank officers only'; end if;
  select * into v_fac from public.facilities where id = p_facility;
  if v_fac.id is null or v_fac.bank_id is distinct from v_bank then
    raise exception 'Facility not found for your bank';
  end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  insert into public.disbursement_records (facility_id, amount, disbursed_on, external_reference, recorded_by)
  values (p_facility, p_amount, coalesce(p_disbursed_on, current_date), p_reference, auth.uid())
  returning id into v_id;

  perform public.loamy_audit_internal('disbursement_recorded', 'facility', p_facility,
    jsonb_build_object('amount', p_amount, 'reference', p_reference));
  perform public.loamy_create_notification_internal(
    v_fac.borrower_id, 'Disbursement recorded',
    'The bank recorded a disbursement on your facility. Payment is made on bank rails; Loamy records it for your history.',
    'financing');
  return v_id;
end;
$$;

-- Record a bank-confirmed repayment against a scheduled instalment.
create or replace function public.loamy_record_repayment(
  p_schedule uuid, p_amount_paid numeric, p_paid_on date, p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank uuid := public.loamy_officer_bank();
  v_row  public.repayment_schedule%rowtype;
  v_fac  public.facilities%rowtype;
  v_status text;
begin
  if v_bank is null then raise exception 'Bank officers only'; end if;
  select * into v_row from public.repayment_schedule where id = p_schedule;
  if v_row.id is null then raise exception 'Instalment not found'; end if;
  select * into v_fac from public.facilities where id = v_row.facility_id;
  if v_fac.bank_id is distinct from v_bank then raise exception 'Not your bank''s facility'; end if;

  v_status := case when p_amount_paid >= v_row.amount_due then 'paid' else 'partial' end;
  update public.repayment_schedule
  set amount_paid = p_amount_paid, paid_on = coalesce(p_paid_on, current_date),
      external_reference = p_reference, status = v_status, recorded_by = auth.uid()
  where id = p_schedule;

  perform public.loamy_audit_internal('repayment_recorded', 'facility', v_row.facility_id,
    jsonb_build_object('schedule_id', p_schedule, 'amount_paid', p_amount_paid, 'status', v_status));
end;
$$;

-- Sweep overdue instalments (upcoming + past due date, unpaid) → 'overdue'.
-- Called by the dashboard/portfolio load; officer/admin scoped read anyway.
create or replace function public.loamy_mark_overdue_repayments()
returns void
language sql
security definer
set search_path = public
as $$
  update public.repayment_schedule
  set status = 'overdue', updated_at = now()
  where status = 'upcoming' and due_date < current_date;
$$;

grant execute on function public.loamy_activate_facility(uuid, numeric, text, int, date, numeric) to authenticated;
grant execute on function public.loamy_record_disbursement(uuid, numeric, date, text) to authenticated;
grant execute on function public.loamy_record_repayment(uuid, numeric, date, text) to authenticated;
grant execute on function public.loamy_mark_overdue_repayments() to authenticated;
revoke all on function public.loamy_activate_facility(uuid, numeric, text, int, date, numeric) from public, anon;
revoke all on function public.loamy_record_disbursement(uuid, numeric, date, text) from public, anon;
revoke all on function public.loamy_record_repayment(uuid, numeric, date, text) from public, anon;
revoke all on function public.loamy_mark_overdue_repayments() from public, anon;

-- ----------------------------------------------------------------------------
-- 6) Portfolio aggregate for the bank dashboard — REAL figures from serviced
--    facilities (bank-confirmed), scoped to the officer's bank.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_bank_portfolio()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bank uuid := public.loamy_officer_bank();
begin
  if v_bank is null then raise exception 'Bank officers only'; end if;
  return jsonb_build_object(
    'total_principal', coalesce((select sum(principal) from public.facilities where bank_id = v_bank and status = 'active'), 0),
    'active_facilities', (select count(*) from public.facilities where bank_id = v_bank and status = 'active'),
    'borrowers', (select count(distinct borrower_id) from public.facilities where bank_id = v_bank and status = 'active'),
    'disbursed_mtd', coalesce((
      select sum(d.amount) from public.disbursement_records d
      join public.facilities f on f.id = d.facility_id
      where f.bank_id = v_bank and date_trunc('month', d.disbursed_on) = date_trunc('month', current_date)), 0),
    'by_sector', (
      select coalesce(jsonb_object_agg(sector, total), '{}'::jsonb)
      from (select sector, sum(principal) total from public.facilities
            where bank_id = v_bank and status = 'active' group by sector) t),
    'par30_amount', coalesce((
      select sum(f.principal) from public.facilities f
      where f.bank_id = v_bank and f.status = 'active'
        and exists (select 1 from public.repayment_schedule r
                    where r.facility_id = f.id and r.status = 'overdue'
                      and r.due_date < current_date - interval '30 days')), 0),
    'top_borrowers', (
      select coalesce(jsonb_agg(x order by x.outstanding desc), '[]'::jsonb) from (
        select p.full_name, p.digital_id,
               f.principal - coalesce((select sum(amount_paid) from public.repayment_schedule r where r.facility_id = f.id and r.amount_paid is not null), 0) as outstanding
        from public.facilities f join public.profiles p on p.id = f.borrower_id
        where f.bank_id = v_bank and f.status = 'active'
        order by outstanding desc limit 5) x));
end;
$$;

grant execute on function public.loamy_bank_portfolio() to authenticated;
revoke all on function public.loamy_bank_portfolio() from public, anon;
