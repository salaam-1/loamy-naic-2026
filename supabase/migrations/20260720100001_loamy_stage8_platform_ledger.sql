-- ============================================================================
-- Loamy Platform · Stage 8 (PHASE 2) · Platform transactions / settlements
-- A RECORD-ONLY ledger of financial events that happened on the bank's/PSP's
-- licensed rails: marketplace settlements (self-reported by a party), facility
-- disbursements, and repayments. Loamy does NOT execute or hold funds — every
-- row is a reference/record. GMV = marketplace settlement gross; platform
-- revenue = recorded fees (from an admin-set fee rate, 0 until configured).
-- ============================================================================

-- Admin-set platform fee (basis points) applied to marketplace settlements.
-- 0 by default → revenue is honestly zero until a real fee schedule is set.
alter table public.platform_config
  add column if not exists platform_fee_bps int not null default 0 check (platform_fee_bps >= 0 and platform_fee_bps <= 10000);

comment on column public.platform_config.platform_fee_bps is
  'Marketplace platform fee in basis points (100 = 1%). Applied at settlement time. 0 = no fee (default).';

create table if not exists public.platform_transactions (
  id                 uuid primary key default gen_random_uuid(),
  txn_type           text not null check (txn_type in
    ('marketplace_settlement','facility_disbursement','facility_repayment')),
  gross_amount       numeric not null check (gross_amount >= 0),
  fee_amount         numeric not null default 0 check (fee_amount >= 0),  -- platform revenue
  currency           text not null default 'NGN',
  subject_type       text,
  subject_id         uuid,
  from_user          uuid references public.profiles (id) on delete set null,
  to_user            uuid references public.profiles (id) on delete set null,
  external_reference text,
  status             text not null default 'recorded' check (status in ('recorded','reconciled')),
  occurred_on        date not null default current_date,
  recorded_by        uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists platform_txn_time_idx on public.platform_transactions (occurred_on desc);
create index if not exists platform_txn_type_idx on public.platform_transactions (txn_type, occurred_on desc);
create index if not exists platform_txn_party_idx on public.platform_transactions (from_user, to_user);

-- SECURITY-REVIEW: this is a RECORD ledger — no balance is held, no transfer
-- is executed, no card/account credential is stored. Admin reads all; a user
-- reads only rows they are a party to. Inserts happen ONLY through the
-- security-definer functions below. Verify no client insert path is ever added.
alter table public.platform_transactions enable row level security;

drop policy if exists "loamy_platform_txn_select" on public.platform_transactions;
create policy "loamy_platform_txn_select"
  on public.platform_transactions for select to authenticated
  using (public.loamy_is_admin() or from_user = auth.uid() or to_user = auth.uid());

-- Internal ledger append (no client grant).
create or replace function public.loamy_ledger_append_internal(
  p_type text, p_gross numeric, p_fee numeric, p_subject_type text, p_subject uuid,
  p_from uuid, p_to uuid, p_reference text, p_occurred date
)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.platform_transactions
    (txn_type, gross_amount, fee_amount, subject_type, subject_id, from_user, to_user, external_reference, occurred_on, recorded_by)
  values (p_type, p_gross, coalesce(p_fee, 0), p_subject_type, p_subject, p_from, p_to, p_reference, coalesce(p_occurred, current_date), auth.uid())
  returning id;
$$;

revoke all on function public.loamy_ledger_append_internal(text, numeric, numeric, text, uuid, uuid, uuid, text, date) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Marketplace settlement — a party to a CONCLUDED interest records the value
-- the deal settled for off-platform. This is the GMV source. Self-reported,
-- once per interest; fee computed from the admin-set rate.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_record_marketplace_settlement(
  p_interest uuid, p_gross numeric, p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interest public.listing_interests%rowtype;
  v_seller   uuid;
  v_bps      int;
  v_fee      numeric;
  v_id       uuid;
begin
  select * into v_interest from public.listing_interests where id = p_interest;
  if v_interest.id is null then raise exception 'Interest not found'; end if;
  v_seller := public.loamy_interest_counterparty(v_interest.listing_id, v_interest.directory_id);
  if auth.uid() is distinct from v_interest.buyer_id and auth.uid() is distinct from v_seller then
    raise exception 'Only a party to this deal can record its settlement';
  end if;
  if v_interest.status <> 'concluded_externally' then
    raise exception 'Only a concluded deal can be settled';
  end if;
  if p_gross <= 0 then raise exception 'Settled value must be positive'; end if;
  if exists (select 1 from public.platform_transactions
             where subject_type = 'listing_interest' and subject_id = p_interest) then
    raise exception 'This deal already has a recorded settlement';
  end if;

  select platform_fee_bps into v_bps from public.platform_config where id = 1;
  v_fee := round(p_gross * coalesce(v_bps, 0) / 10000.0, 2);

  v_id := public.loamy_ledger_append_internal(
    'marketplace_settlement', p_gross, v_fee, 'listing_interest', p_interest,
    v_interest.buyer_id, v_seller, p_reference, current_date);

  perform public.loamy_audit_internal('settlement_recorded', 'listing_interest', p_interest,
    jsonb_build_object('gross', p_gross, 'fee', v_fee));
  return v_id;
end;
$$;

revoke all on function public.loamy_record_marketplace_settlement(uuid, numeric, text) from public, anon;
grant execute on function public.loamy_record_marketplace_settlement(uuid, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Stage-7 servicing fns now ALSO append to the ledger (one source of truth for
-- platform transactions). Bodies are the Stage-7 versions + a ledger append.
-- ----------------------------------------------------------------------------
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

  perform public.loamy_ledger_append_internal(
    'facility_disbursement', p_amount, 0, 'facility', p_facility,
    null, v_fac.borrower_id, p_reference, coalesce(p_disbursed_on, current_date));

  perform public.loamy_audit_internal('disbursement_recorded', 'facility', p_facility,
    jsonb_build_object('amount', p_amount, 'reference', p_reference));
  perform public.loamy_create_notification_internal(
    v_fac.borrower_id, 'Disbursement recorded',
    'The bank recorded a disbursement on your facility. Payment is made on bank rails; Loamy records it for your history.',
    'financing');
  return v_id;
end;
$$;

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

  if p_amount_paid > 0 then
    perform public.loamy_ledger_append_internal(
      'facility_repayment', p_amount_paid, 0, 'facility', v_row.facility_id,
      v_fac.borrower_id, null, p_reference, coalesce(p_paid_on, current_date));
  end if;

  perform public.loamy_audit_internal('repayment_recorded', 'facility', v_row.facility_id,
    jsonb_build_object('schedule_id', p_schedule, 'amount_paid', p_amount_paid, 'status', v_status));
end;
$$;

-- ----------------------------------------------------------------------------
-- Admin platform metrics (real; zero until events are recorded).
-- ----------------------------------------------------------------------------
create or replace function public.loamy_platform_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.loamy_is_admin() then raise exception 'Admin only'; end if;
  return jsonb_build_object(
    'gmv_mtd', coalesce((select sum(gross_amount) from public.platform_transactions
      where txn_type = 'marketplace_settlement' and date_trunc('month', occurred_on) = date_trunc('month', current_date)), 0),
    'gmv_total', coalesce((select sum(gross_amount) from public.platform_transactions where txn_type = 'marketplace_settlement'), 0),
    'financing_disbursed_mtd', coalesce((select sum(gross_amount) from public.platform_transactions
      where txn_type = 'facility_disbursement' and date_trunc('month', occurred_on) = date_trunc('month', current_date)), 0),
    'revenue_mtd', coalesce((select sum(fee_amount) from public.platform_transactions
      where date_trunc('month', occurred_on) = date_trunc('month', current_date)), 0),
    'revenue_total', coalesce((select sum(fee_amount) from public.platform_transactions), 0),
    'txn_count_mtd', (select count(*) from public.platform_transactions
      where date_trunc('month', occurred_on) = date_trunc('month', current_date)),
    'txn_count_total', (select count(*) from public.platform_transactions));
end;
$$;

revoke all on function public.loamy_platform_metrics() from public, anon;
grant execute on function public.loamy_platform_metrics() to authenticated;
