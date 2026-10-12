-- ============================================================================
-- Loamy Platform · Stage 1 · Migration 4 of 4
-- `platform_config`: single-row feature-flag store (same shape idea as the
-- portal's launch_config). Later stages flip flags on; the UI hides any
-- feature whose flag is false or absent, so Stage 1 deploys safely while
-- later stages are built.
-- ============================================================================

create table if not exists public.platform_config (
  id         int primary key default 1 check (id = 1), -- enforce single row
  flags      jsonb not null default '{
    "marketplace": false,
    "financing_applications": false,
    "verification_workflow": false
  }'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.platform_config enable row level security;

-- Any signed-in user may read the flags (the UI needs them to build nav).
drop policy if exists "loamy_platform_config_read" on public.platform_config;
create policy "loamy_platform_config_read"
  on public.platform_config for select
  to authenticated
  using (true);

-- Only admins may change flags. No insert/delete policies: the single row
-- below is seeded here and never removed via the API.
drop policy if exists "loamy_platform_config_update_admin" on public.platform_config;
create policy "loamy_platform_config_update_admin"
  on public.platform_config for update
  to authenticated
  using (public.loamy_is_admin())
  with check (public.loamy_is_admin());

drop trigger if exists loamy_platform_config_updated_at on public.platform_config;
create trigger loamy_platform_config_updated_at
  before update on public.platform_config
  for each row execute function public.loamy_set_updated_at();

-- Seed the single row (no-op if it already exists).
insert into public.platform_config (id) values (1)
on conflict (id) do nothing;
