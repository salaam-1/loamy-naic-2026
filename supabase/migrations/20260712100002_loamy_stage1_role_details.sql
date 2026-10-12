-- ============================================================================
-- Loamy Platform · Stage 1 · Migration 2 of 4
-- `role_details`: one row per user, role-specific structured data as jsonb.
-- (jsonb keeps Stage 1 simple; the backend engineer can normalize later.)
-- ============================================================================

create table if not exists public.role_details (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  role_data  jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- SECURITY-REVIEW: role_data holds user-supplied business/farm details
-- (business names, farm size, LGA, commodities). It must NEVER hold BVN, NIN,
-- bank account numbers, or any government-ID data — the onboarding field
-- definitions in src/lib/roles.ts are the ONLY keys the app writes here;
-- review that list before any stage extends it. RLS below is strict
-- owner-only (plus admin read) because location + livelihood data is
-- personally identifying in aggregate.
alter table public.role_details enable row level security;

drop policy if exists "loamy_role_details_select_own" on public.role_details;
create policy "loamy_role_details_select_own"
  on public.role_details for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "loamy_role_details_insert_own" on public.role_details;
create policy "loamy_role_details_insert_own"
  on public.role_details for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "loamy_role_details_update_own" on public.role_details;
create policy "loamy_role_details_update_own"
  on public.role_details for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admin read-all (security-definer role check; same pattern as the portal).
drop policy if exists "loamy_role_details_select_admin" on public.role_details;
create policy "loamy_role_details_select_admin"
  on public.role_details for select
  to authenticated
  using (public.loamy_is_admin());

-- No delete policy: rows are removed only via the FK cascade when the
-- auth user / profile is deleted.

drop trigger if exists loamy_role_details_updated_at on public.role_details;
create trigger loamy_role_details_updated_at
  before update on public.role_details
  for each row execute function public.loamy_set_updated_at();
