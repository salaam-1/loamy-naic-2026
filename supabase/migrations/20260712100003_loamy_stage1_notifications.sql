-- ============================================================================
-- Loamy Platform · Stage 1 · Migration 3 of 4
-- `notifications`: per-user in-app notifications.
-- Owners read and mark-as-read; INSERTS ONLY via security-definer function.
-- ============================================================================

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  body       text not null default '',
  type       text not null default 'general',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "loamy_notifications_select_own" on public.notifications;
create policy "loamy_notifications_select_own"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

-- Owners may update their own rows (mark as read). WITH CHECK pins user_id
-- so a row can never be reassigned to another user.
drop policy if exists "loamy_notifications_update_own" on public.notifications;
create policy "loamy_notifications_update_own"
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Deliberately NO insert and NO delete policies: with RLS enabled and no
-- policy, client inserts/deletes are denied outright.

-- SECURITY-REVIEW: the ONLY sanctioned write path into notifications.
-- SECURITY DEFINER bypasses RLS, so EXECUTE is revoked from public/anon/
-- authenticated and granted to service_role only (server-side code / edge
-- functions / later-stage admin tooling). Verify: (1) grants below stay
-- service_role-only, (2) `set search_path = public` remains, (3) no caller
-- is ever added that lets one user push notifications to another.
create or replace function public.loamy_create_notification(
  target_user uuid,
  n_title     text,
  n_body      text default '',
  n_type      text default 'general'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nid uuid;
begin
  insert into public.notifications (user_id, title, body, type)
  values (target_user, n_title, coalesce(n_body, ''), coalesce(n_type, 'general'))
  returning id into nid;
  return nid;
end;
$$;

revoke all on function public.loamy_create_notification(uuid, text, text, text) from public;
revoke all on function public.loamy_create_notification(uuid, text, text, text) from anon;
revoke all on function public.loamy_create_notification(uuid, text, text, text) from authenticated;
grant execute on function public.loamy_create_notification(uuid, text, text, text) to service_role;
