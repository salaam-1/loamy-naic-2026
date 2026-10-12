-- ============================================================================
-- Loamy Platform · Stage 5 · Migration 3 of 3
-- `repayment_milestones`: post-decision monitoring. The bank records that a
-- facility went live EXTERNALLY and tracks milestone status only — Loamy
-- never records or moves payments. Then flip the bank_portal flag ON.
-- ============================================================================

create table if not exists public.repayment_milestones (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.financing_applications (id) on delete cascade,
  milestone_type text not null check (milestone_type in ('instalment','delivery')),
  due_date       date not null,
  status         text not null default 'upcoming' check (status in ('upcoming','met','missed')),
  note           text,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists repayment_milestones_app_idx
  on public.repayment_milestones (application_id, due_date);

-- SECURITY-REVIEW: milestone STATUS tracking only — no amounts paid, no
-- payment records, no settlement data may ever be added to this table.
-- Access: officers of the application's bank (and admin). Milestones exist
-- only for applications with a recorded external decision.
alter table public.repayment_milestones enable row level security;

drop policy if exists "loamy_milestones_select" on public.repayment_milestones;
create policy "loamy_milestones_select"
  on public.repayment_milestones for select to authenticated
  using (
    public.loamy_is_admin()
    or exists (
      select 1 from public.financing_applications a
      where a.id = application_id and a.bank_id = public.loamy_officer_bank()
    )
  );

drop policy if exists "loamy_milestones_insert_bank" on public.repayment_milestones;
create policy "loamy_milestones_insert_bank"
  on public.repayment_milestones for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.financing_applications a
      where a.id = application_id
        and a.bank_id = public.loamy_officer_bank()
        and a.status = 'decided_external'
    )
  );

drop policy if exists "loamy_milestones_update_bank" on public.repayment_milestones;
create policy "loamy_milestones_update_bank"
  on public.repayment_milestones for update to authenticated
  using (exists (
    select 1 from public.financing_applications a
    where a.id = application_id and a.bank_id = public.loamy_officer_bank()
  ))
  with check (exists (
    select 1 from public.financing_applications a
    where a.id = application_id and a.bank_id = public.loamy_officer_bank()
  ));

drop policy if exists "loamy_milestones_delete_bank" on public.repayment_milestones;
create policy "loamy_milestones_delete_bank"
  on public.repayment_milestones for delete to authenticated
  using (exists (
    select 1 from public.financing_applications a
    where a.id = application_id and a.bank_id = public.loamy_officer_bank()
  ));

drop trigger if exists loamy_milestones_updated_at on public.repayment_milestones;
create trigger loamy_milestones_updated_at
  before update on public.repayment_milestones
  for each row execute function public.loamy_set_updated_at();

-- Stage 5 ships the bank portal: flip the flag.
update public.platform_config
set flags = flags || '{"bank_portal": true}'::jsonb
where id = 1;
