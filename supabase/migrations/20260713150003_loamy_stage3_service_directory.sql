-- ============================================================================
-- Loamy Platform · Stage 3 · Migration 3 of 5
-- `service_directory`: browsable warehouse & logistics directory. One entry
-- per owner; booking workflows come in a later stage — Stage 3 is browse +
-- the same interest→accept contact-exchange pattern as listings.
-- ============================================================================

create table if not exists public.service_directory (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null unique references public.profiles (id) on delete cascade,
  service_type    text not null check (service_type in ('warehouse','logistics')),
  business_name   text not null,
  state           text not null,
  lga             text,
  capacity_note   text,
  routes_note     text,
  contact_visible boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists service_directory_browse_idx
  on public.service_directory (service_type, state);

-- SECURITY-REVIEW: directory entries are deliberately public-to-signed-in
-- (that is their purpose) but contain business info only. Contact exchange
-- still flows through the interest→accept pattern; contact_visible is a
-- future opt-in and nothing reads it yet — verify before any stage starts to.
alter table public.service_directory enable row level security;

drop policy if exists "loamy_directory_select" on public.service_directory;
create policy "loamy_directory_select"
  on public.service_directory for select to authenticated
  using (true);

drop policy if exists "loamy_directory_insert_own" on public.service_directory;
create policy "loamy_directory_insert_own"
  on public.service_directory for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "loamy_directory_update_own" on public.service_directory;
create policy "loamy_directory_update_own"
  on public.service_directory for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "loamy_directory_delete_own" on public.service_directory;
create policy "loamy_directory_delete_own"
  on public.service_directory for delete to authenticated
  using (owner_id = auth.uid());

drop trigger if exists loamy_directory_updated_at on public.service_directory;
create trigger loamy_directory_updated_at
  before update on public.service_directory
  for each row execute function public.loamy_set_updated_at();
