-- ============================================================================
-- Loamy Platform · Stage 2 · Migration 3 of 4
-- `financing_applications`: farmers APPLY through Loamy; the partner bank
-- DECIDES at the bank. There is deliberately NO 'approved'/'declined' status
-- in Loamy — the terminal state is 'decided_external' and the bank-side stage
-- populates decision_note. Loamy never holds, moves, or processes money.
-- ============================================================================

create table if not exists public.financing_applications (
  id                      uuid primary key default gen_random_uuid(),
  applicant_id            uuid not null references public.profiles (id) on delete cascade,
  farm_id                 uuid references public.farms (id) on delete set null,
  product_type            text not null default 'input_financing'
    check (product_type in ('input_financing')),
  structure               text not null default 'murabaha',
  -- ₦500,000 pilot cap for input financing, enforced at the DB as well as the form.
  amount_requested        numeric not null default 0
    check (amount_requested >= 0),
  purpose                 text not null default '',
  intended_items          jsonb not null default '[]'::jsonb,
  disbursement_preference text
    check (disbursement_preference is null
           or disbursement_preference in ('supplier_payment','cash')),
  status                  text not null default 'submitted'
    check (status in ('draft','submitted','under_review','info_requested','decided_external')),
  decision_note           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Pilot cap applies to every row, drafts included.
  constraint financing_amount_cap
    check (product_type <> 'input_financing' or amount_requested <= 500000),
  -- A non-draft application must be complete.
  constraint financing_submitted_complete
    check (status = 'draft'
           or (amount_requested > 0
               and length(btrim(purpose)) > 0
               and disbursement_preference is not null))
);

create index if not exists financing_applications_applicant_idx
  on public.financing_applications (applicant_id, created_at desc);

-- SECURITY-REVIEW: financing data — livelihood + requested amounts. Engineer
-- to review before real applicants: (1) applicant-only visibility below,
-- (2) clients can only ever hold 'draft'/'submitted' status (the bank-side
-- stage moves rows onward via its own reviewed path), (3) decision_note is
-- bank-authored and never client-writable outside drafts.
alter table public.financing_applications enable row level security;

drop policy if exists "loamy_financing_select_own" on public.financing_applications;
create policy "loamy_financing_select_own"
  on public.financing_applications for select to authenticated
  using (auth.uid() = applicant_id);

drop policy if exists "loamy_financing_select_admin" on public.financing_applications;
create policy "loamy_financing_select_admin"
  on public.financing_applications for select to authenticated
  using (public.loamy_is_admin());

-- Applicants create their own rows as draft or submitted, and may only attach
-- their OWN farm.
drop policy if exists "loamy_financing_insert_own" on public.financing_applications;
create policy "loamy_financing_insert_own"
  on public.financing_applications for insert to authenticated
  with check (
    auth.uid() = applicant_id
    and status in ('draft','submitted')
    and (farm_id is null or exists (
      select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()
    ))
  );

-- Updates are restricted to DRAFTS (a submitted application is immutable to
-- the applicant); a draft may transition to 'submitted'.
drop policy if exists "loamy_financing_update_own_draft" on public.financing_applications;
create policy "loamy_financing_update_own_draft"
  on public.financing_applications for update to authenticated
  using (auth.uid() = applicant_id and status = 'draft')
  with check (
    auth.uid() = applicant_id
    and status in ('draft','submitted')
    and (farm_id is null or exists (
      select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()
    ))
  );

-- Applicants may discard their own drafts only.
drop policy if exists "loamy_financing_delete_own_draft" on public.financing_applications;
create policy "loamy_financing_delete_own_draft"
  on public.financing_applications for delete to authenticated
  using (auth.uid() = applicant_id and status = 'draft');

drop trigger if exists loamy_financing_updated_at on public.financing_applications;
create trigger loamy_financing_updated_at
  before update on public.financing_applications
  for each row execute function public.loamy_set_updated_at();

-- ----------------------------------------------------------------------------
-- Self-notification helper for the activity feed (e.g. "Application
-- submitted"). Unlike loamy_create_notification (service_role only), this is
-- callable by any signed-in user but can ONLY write to the caller's own feed.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: security-definer. The user_id is pinned to auth.uid() —
-- verify it stays that way; a parameterised target here would let any user
-- spam any other user.
create or replace function public.loamy_log_my_event(
  n_title text,
  n_body  text default '',
  n_type  text default 'activity'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into public.notifications (user_id, title, body, type)
  values (auth.uid(), n_title, coalesce(n_body, ''), coalesce(n_type, 'activity'));
end;
$$;

revoke all on function public.loamy_log_my_event(text, text, text) from public;
revoke all on function public.loamy_log_my_event(text, text, text) from anon;
grant execute on function public.loamy_log_my_event(text, text, text) to authenticated;
