-- ============================================================================
-- RECONCILIATION / HARDENING PASS — four findings from the full re-audit.
-- ----------------------------------------------------------------------------
-- 1. §11/§27  BVN columns existed (empty) -> DROPPED. "Loamy does NOT store
--             BVN" is absolute, and a reserved column is still a storage path.
-- 2. §7       GROWTH PARTNER ANONYMITY WAS BROKEN. A requester could read
--             verification_tasks.assigned_to and resolve it to the agent's
--             real name via loamy_public_profiles. Fixed.
-- 3. §16      Fees were ONE global platform_fee_bps. Now a schedule, resolved
--             by scope/role/partner, and SNAPSHOT onto each transaction so
--             history does not move when rates change.
-- 4. §15      Reconciliation was a view somebody had to remember to open. Now
--             explicit states, a run record, and an audit trail -- and it
--             never silently corrects anything.
--
-- Verified before writing: 0 profiles hold bvn_encrypted, 0 batches have
-- negative inventory, 0 reconciliation exceptions, 0 quantity drift between
-- batches and their event logs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Remove the BVN/NIN storage path entirely.
-- ----------------------------------------------------------------------------
-- These were reserved-but-unused columns from Stage 1. The directive is
-- absolute, and an unused column is an invitation: the next engineer under
-- deadline sees somewhere to put it. Verified empty across all 247 profiles
-- before dropping. bvn_verified / nin_verified (booleans, status only) stay --
-- they are the verified STATUS, never the number.
alter table public.profiles drop column if exists bvn_encrypted;
alter table public.profiles drop column if exists nin_encrypted;

comment on column public.profiles.bvn_verified is
  'Verified STATUS only, set by an approved provider flow. Loamy never stores the number itself -- the columns that could have are dropped (20260919270001).';

-- ----------------------------------------------------------------------------
-- 2. Growth Partner anonymity (§7).
-- ----------------------------------------------------------------------------
-- The inspected party and the requesting buyer see "Loamy Verification Agent".
-- Loamy always knows exactly who it was.
--
-- Dropped and recreated rather than CREATE OR REPLACEd: the agent_display
-- column is inserted mid-list, and OR REPLACE cannot reorder view columns.
drop view if exists public.loamy_verification_cases;

create view public.loamy_verification_cases as
select
  t.id               as case_id,
  t.ref              as case_ref,
  t.task_type        as verification_type,
  coalesce(t.subject_type, case when t.subject_farm_id is not null then 'farm' end) as subject_type,
  coalesce(t.subject_id, t.subject_farm_id) as subject_id,
  t.subject_user_id,
  t.requested_by,
  -- The agent's identity is revealed ONLY to the agent themselves and to
  -- admins. Everyone else -- including the buyer who paid for the inspection
  -- and the seller being inspected -- sees null and the display label.
  case when t.assigned_to = auth.uid() or public.loamy_is_admin()
       then t.assigned_to else null end as assigned_to,
  case when t.assigned_to is null then null
       when t.assigned_to = auth.uid() then 'You'
       when public.loamy_is_admin() then 'Agent ' || substr(t.assigned_to::text, 1, 8)
       else 'Loamy Verification Agent' end as agent_display,
  t.status,
  t.priority,
  -- Anti-fraud flags are operational, not for the parties: a seller learning
  -- which checks fired can tune the next submission around them.
  case when public.loamy_is_admin() then t.flags else null end as flags,
  case when public.loamy_is_admin() then t.sampled_for_review else null end as sampled_for_review,
  t.expected_state,
  t.expected_lga,
  t.due_at,
  t.submitted_at,
  t.completed_at,
  t.created_at,
  t.updated_at,
  (select count(*) from public.verification_evidence e where e.case_id = t.id) as evidence_count
from public.verification_tasks t;

alter view public.loamy_verification_cases set (security_invoker = on);
grant select on public.loamy_verification_cases to authenticated;

-- The base table still lets a requester read the row (they need status), so
-- mask the agent column there too. A view is not a permission boundary when
-- the underlying table is readable.
drop policy if exists "loamy_tasks_select" on public.verification_tasks;
create policy "loamy_tasks_select"
  on public.verification_tasks for select to authenticated
  using (
    assigned_to = auth.uid()
    or public.loamy_is_admin()
    or (
      status = 'pending' and assigned_to is null
      and public.loamy_can_verify(auth.uid())
      and subject_farm_id is not null
      and public.loamy_covers_farm(subject_farm_id)
    )
    -- A requester reaches their case through loamy_my_verification_cases,
    -- which masks the agent. Direct table reads are no longer granted to them.
  );

/**
 * What a requester (or the inspected party) is allowed to see about a case
 * they are involved in: progress and outcome, never the agent.
 */
create or replace function public.loamy_my_verification_cases()
returns table (
  case_id uuid, case_ref text, verification_type text,
  subject_type text, subject_id uuid, status text,
  agent_display text, evidence_count bigint,
  submitted_at timestamptz, completed_at timestamptz, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.ref, t.task_type,
         coalesce(t.subject_type, case when t.subject_farm_id is not null then 'farm' end),
         coalesce(t.subject_id, t.subject_farm_id),
         t.status,
         case when t.assigned_to is null then 'Not yet assigned'
              else 'Loamy Verification Agent' end,
         (select count(*) from public.verification_evidence e where e.case_id = t.id),
         t.submitted_at, t.completed_at, t.created_at
  from public.verification_tasks t
  where t.requested_by = auth.uid() or t.subject_user_id = auth.uid();
$$;

grant execute on function public.loamy_my_verification_cases() to authenticated;

-- Conflict-of-interest detection (§7): repeated pairings between one agent and
-- one seller or buyer. Admin-only by virtue of the underlying RLS.
create or replace view public.loamy_agent_conflict_signals as
select
  t.assigned_to                                   as partner_id,
  t.subject_user_id                               as counterparty_id,
  'subject'                                       as relationship,
  count(*)                                        as pairings,
  count(*) filter (where t.status = 'approved')   as approvals,
  max(t.created_at)                               as latest
from public.verification_tasks t
where t.assigned_to is not null and t.subject_user_id is not null
group by t.assigned_to, t.subject_user_id
having count(*) >= 3
union all
select
  t.assigned_to, t.requested_by, 'requester',
  count(*), count(*) filter (where t.status = 'approved'), max(t.created_at)
from public.verification_tasks t
where t.assigned_to is not null and t.requested_by is not null
group by t.assigned_to, t.requested_by
having count(*) >= 3;

alter view public.loamy_agent_conflict_signals set (security_invoker = on);
grant select on public.loamy_agent_conflict_signals to authenticated;

comment on view public.loamy_agent_conflict_signals is
  'Repeated agent-counterparty pairings (3+), for conflict-of-interest review. A signal to look at, never an automatic sanction.';

-- ----------------------------------------------------------------------------
-- 3. Fee schedule (§16).
-- ----------------------------------------------------------------------------
create table if not exists public.fee_schedules (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique,
  -- What kind of thing this fee applies to.
  scope          text not null check (scope in (
    'marketplace_transaction','verification','logistics','warehouse',
    'financing_facilitation','withdrawal')),
  -- Narrowing dimensions. NULL means "applies to anything" -- the more
  -- non-null columns match, the more specific the rule.
  transaction_type text,
  user_role      text,
  partner_id     uuid,
  commodity_group text,

  basis          text not null check (basis in ('bps','flat')),
  value          numeric not null check (value >= 0),
  payer          text not null default 'buyer' check (payer in ('buyer','seller','split','platform')),
  min_fee        numeric check (min_fee is null or min_fee >= 0),
  max_fee        numeric check (max_fee is null or max_fee >= 0),

  active         boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  note           text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists fee_schedules_lookup_idx
  on public.fee_schedules (scope, active, effective_from desc);

alter table public.fee_schedules enable row level security;

-- Readable by all signed-in members: a seller is entitled to know what a sale
-- will cost them before they agree to it.
drop policy if exists "loamy_fee_schedules_read" on public.fee_schedules;
create policy "loamy_fee_schedules_read"
  on public.fee_schedules for select to authenticated using (true);

drop policy if exists "loamy_fee_schedules_write_admin" on public.fee_schedules;
create policy "loamy_fee_schedules_write_admin"
  on public.fee_schedules for all to authenticated
  using (public.loamy_is_admin()) with check (public.loamy_is_admin());

drop trigger if exists loamy_fee_schedules_assign_ref on public.fee_schedules;
create trigger loamy_fee_schedules_assign_ref
  before insert on public.fee_schedules
  for each row execute function public.loamy_assign_ref('fee_schedule', 'FEE');

-- Seed from the single global figure so behaviour does not change on deploy.
insert into public.fee_schedules (scope, basis, value, payer, note)
select 'marketplace_transaction', 'bps', coalesce(platform_fee_bps, 0), 'split',
       'Migrated from the former global platform_fee_bps'
from public.platform_config where id = 1
  and not exists (select 1 from public.fee_schedules where scope = 'marketplace_transaction');

/**
 * Resolve the fee that applies, most specific rule wins.
 *
 * Specificity is simply how many narrowing dimensions matched, so adding a
 * dimension later does not require rewriting the ordering.
 */
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
    'payer', r.payer, 'schedule_ref', r.ref, 'schedule_id', r.id,
    'resolved_at', now());
end;
$$;

grant execute on function public.loamy_resolve_fee(text,numeric,text,text,uuid,text) to authenticated;

-- Snapshot the rules onto the transaction, so historical deals do not change
-- when someone edits the schedule next quarter.
alter table public.transactions
  add column if not exists fee_snapshot jsonb;

comment on column public.transactions.fee_snapshot is
  'The fee rule AS RESOLVED when this transaction was accepted. Frozen on purpose: changing the schedule must never rewrite past economics.';

create or replace function public.loamy_snapshot_transaction_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted'
     and new.fee_snapshot is null then
    new.fee_snapshot := public.loamy_resolve_fee(
      'marketplace_transaction', new.subtotal, 'marketplace', null, null, null);
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_transactions_fee_snapshot on public.transactions;
create trigger loamy_transactions_fee_snapshot
  before update on public.transactions
  for each row execute function public.loamy_snapshot_transaction_fee();

-- ----------------------------------------------------------------------------
-- 4. Reconciliation with explicit states (§15).
-- ----------------------------------------------------------------------------
alter table public.ledger_entries
  add column if not exists reconciliation_state text not null default 'pending'
    check (reconciliation_state in ('pending','matched','mismatch','review_required','resolved'));

alter table public.payment_events
  add column if not exists reconciliation_state text not null default 'pending'
    check (reconciliation_state in ('pending','matched','mismatch','review_required','resolved'));

create table if not exists public.reconciliation_runs (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  entries_checked int not null default 0,
  matched       int not null default 0,
  mismatched    int not null default 0,
  review_required int not null default 0,
  findings      jsonb not null default '[]'::jsonb,
  run_by        uuid references public.profiles (id) on delete set null
);

alter table public.reconciliation_runs enable row level security;

drop policy if exists "loamy_recon_runs_admin" on public.reconciliation_runs;
create policy "loamy_recon_runs_admin"
  on public.reconciliation_runs for select to authenticated
  using (public.loamy_is_admin());

drop trigger if exists loamy_recon_runs_assign_ref on public.reconciliation_runs;
create trigger loamy_recon_runs_assign_ref
  before insert on public.reconciliation_runs
  for each row execute function public.loamy_assign_ref('reconciliation_run', 'REC');

/**
 * Classify, never correct.
 *
 * The directive is explicit: "Do not silently correct discrepancies. Create an
 * audit record." So this marks state and records findings; a human decides
 * what to do. Safe to run on a schedule.
 */
create or replace function public.loamy_run_reconciliation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid;
  v_findings jsonb := '[]'::jsonb;
  v_checked int := 0; v_matched int := 0; v_mismatch int := 0; v_review int := 0;
  r record;
begin
  if not public.loamy_is_admin() then
    raise exception 'Reconciliation is an administrative process.';
  end if;

  insert into public.reconciliation_runs (run_by) values (auth.uid()) returning id into v_run;

  -- (a) Unbalanced ledger groups -- the most serious class.
  for r in
    select entry_group, round(sum(amount), 2) as delta
    from public.ledger_entries where status = 'posted'
    group by entry_group having abs(sum(amount)) > 0.0001
  loop
    v_mismatch := v_mismatch + 1;
    v_findings := v_findings || jsonb_build_object(
      'kind', 'unbalanced_group', 'group', r.entry_group, 'delta', r.delta,
      'state', 'mismatch');
    update public.ledger_entries set reconciliation_state = 'mismatch'
     where entry_group = r.entry_group;
  end loop;

  -- (b) A verified provider event with no ledger behind it: money the provider
  --     says moved that Loamy has not recorded.
  for r in
    select id, ref, amount from public.payment_events
    where verified and ledger_group is null
  loop
    v_review := v_review + 1;
    v_findings := v_findings || jsonb_build_object(
      'kind', 'payment_without_ledger', 'payment_event', r.ref, 'amount', r.amount,
      'state', 'review_required');
    update public.payment_events set reconciliation_state = 'review_required' where id = r.id;
  end loop;

  -- (c) A released escrow with no funding event: the worst case, money out
  --     with nothing in.
  for r in
    select w.id, w.ref, w.amount from public.escrow_workflows w
    where w.state = 'released'
      and not exists (select 1 from public.escrow_workflow_events e
                      where e.escrow_id = w.id and e.event_type = 'funded')
  loop
    v_review := v_review + 1;
    v_findings := v_findings || jsonb_build_object(
      'kind', 'released_without_funding', 'escrow', r.ref, 'amount', r.amount,
      'state', 'review_required');
  end loop;

  -- (d) Everything else that balances and has a reference: matched.
  update public.ledger_entries
     set reconciliation_state = 'matched', reconciled_at = now()
   where status = 'posted'
     and reconciliation_state = 'pending'
     and entry_group in (
       select entry_group from public.ledger_entries where status = 'posted'
       group by entry_group having abs(sum(amount)) <= 0.0001);
  get diagnostics v_matched = row_count;

  select count(*) into v_checked from public.ledger_entries where status = 'posted';

  update public.reconciliation_runs
     set finished_at = now(), entries_checked = v_checked, matched = v_matched,
         mismatched = v_mismatch, review_required = v_review, findings = v_findings
   where id = v_run;

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (auth.uid(), 'admin', 'reconciliation_run', 'reconciliation_run', v_run,
          jsonb_build_object('checked', v_checked, 'matched', v_matched,
                             'mismatched', v_mismatch, 'review_required', v_review));

  return jsonb_build_object(
    'run', v_run, 'checked', v_checked, 'matched', v_matched,
    'mismatched', v_mismatch, 'review_required', v_review,
    'findings', v_findings,
    'note', 'Discrepancies are classified and recorded, never auto-corrected.');
end;
$$;

revoke all on function public.loamy_run_reconciliation() from public, anon;
grant execute on function public.loamy_run_reconciliation() to authenticated;

comment on function public.loamy_run_reconciliation() is
  'Scheduled reconciliation (§15). Classifies into matched/mismatch/review_required and writes an audit record. Never silently corrects.';
