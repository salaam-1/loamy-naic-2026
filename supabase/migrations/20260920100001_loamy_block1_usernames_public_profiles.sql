-- ============================================================================
-- BLOCK 1 (a) — usernames and the public identity surface.
-- ----------------------------------------------------------------------------
-- Until now a member had a display name and nothing addressable. You could not
-- link to someone, and two "Musa Ibrahim"s were indistinguishable.
--
-- A username is a PUBLIC, PERMANENT-ISH HANDLE, which makes it a security
-- object, not a profile field:
--
--   * It is lowercase [a-z0-9_] only. Mixed case and unicode invite homograph
--     impersonation -- "Ioamy" reads as "loamy" in most UI fonts.
--   * Names that imply the platform or an official function are reserved.
--   * Changes are rate-limited and recorded, because a handle that can be
--     changed hourly is a handle that can be used to impersonate and vanish.
--   * A released handle is quarantined for 90 days against reuse BY SOMEONE
--     ELSE, so a trader cannot drop @kano-maize and have a rival pick it up
--     the same afternoon and inherit their reputation.
--
-- Visibility defaults to 'members', not 'public'. There are already 353
-- profiles in this project. None of those people agreed to be visible to the
-- anonymous internet, and a migration is not consent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The columns.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists username            text,
  add column if not exists username_changed_at timestamptz,
  add column if not exists bio                 text,
  add column if not exists headline            text,
  add column if not exists profile_visibility  text not null default 'members';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_username_format') then
    alter table public.profiles add constraint profiles_username_format
      check (username is null or username ~ '^[a-z0-9_]{3,30}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_visibility_valid') then
    alter table public.profiles add constraint profiles_visibility_valid
      check (profile_visibility in ('public','members','private'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_bio_length') then
    alter table public.profiles add constraint profiles_bio_length
      check (bio is null or length(bio) <= 600);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_headline_length') then
    alter table public.profiles add constraint profiles_headline_length
      check (headline is null or length(headline) <= 120);
  end if;
end $$;

create unique index if not exists profiles_username_key on public.profiles (username)
  where username is not null;

comment on column public.profiles.username is
  'Public handle. Lowercase [a-z0-9_], 3-30. Set only through loamy_set_username -- direct writes are refused by loamy_username_guard.';
comment on column public.profiles.profile_visibility is
  'public = anyone incl. signed-out; members = signed-in only (default); private = nobody but the owner and admins.';

-- ----------------------------------------------------------------------------
-- 2. Reserved handles, and the history that makes quarantine possible.
-- ----------------------------------------------------------------------------
create table if not exists public.reserved_usernames (
  name    text primary key,
  reason  text not null,
  created_at timestamptz not null default now()
);
alter table public.reserved_usernames enable row level security;

drop policy if exists reserved_usernames_read on public.reserved_usernames;
create policy reserved_usernames_read on public.reserved_usernames
  for select to authenticated using (true);
-- No insert/update/delete policy: admins manage this through migrations.

insert into public.reserved_usernames (name, reason) values
  ('loamy','platform'), ('loamyapp','platform'), ('loamyofficial','platform'),
  ('admin','platform'), ('administrator','platform'), ('root','platform'),
  ('support','platform'), ('help','platform'), ('helpdesk','platform'),
  ('security','platform'), ('billing','platform'), ('payments','platform'),
  ('official','impersonation'), ('verified','impersonation'),
  ('verification','impersonation'), ('agent','impersonation'),
  ('verificationagent','impersonation'), ('growthpartner','impersonation'),
  ('bank','impersonation'), ('cbn','impersonation'), ('nirsal','impersonation'),
  ('api','technical'), ('www','technical'), ('app','technical'),
  ('dashboard','technical'), ('login','technical'), ('signup','technical'),
  ('marketplace','technical'), ('trace','technical'), ('me','technical'),
  ('settings','technical'), ('null','technical'), ('undefined','technical')
on conflict (name) do nothing;

create table if not exists public.username_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  username    text not null,
  claimed_at  timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists username_history_name_idx on public.username_history (username);
create index if not exists username_history_user_idx on public.username_history (user_id);

alter table public.username_history enable row level security;

drop policy if exists username_history_own on public.username_history;
create policy username_history_own on public.username_history
  for select to authenticated
  using (user_id = auth.uid() or public.loamy_is_admin());
-- Writes happen only inside loamy_set_username.

comment on table public.username_history is
  'Every handle a member has held. Makes a released handle traceable and lets loamy_set_username quarantine it against reuse by a different person.';

-- ----------------------------------------------------------------------------
-- 3. The guard: username is not an ordinary profile column.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_username_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.username is distinct from old.username
     and coalesce(current_setting('loamy.username_authorized', true), '') <> 'true' then
    raise exception 'A username is set through loamy_set_username, not by writing to the profile.';
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_profiles_username_guard on public.profiles;
create trigger loamy_profiles_username_guard
  before update on public.profiles
  for each row execute function public.loamy_username_guard();

-- ----------------------------------------------------------------------------
-- 4. Claiming a handle.
-- ----------------------------------------------------------------------------
/**
 * Returns { available: bool, reason?: text }. Deliberately callable before
 * committing, so the UI can say "taken" without the member losing their form.
 */
create or replace function public.loamy_username_available(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_name text := lower(trim(coalesce(p_username, '')));
begin
  if v_name !~ '^[a-z0-9_]{3,30}$' then
    return jsonb_build_object('available', false, 'reason', 'format',
      'message', 'Use 3-30 characters: lowercase letters, numbers or underscore.');
  end if;
  if v_name ~ '^[0-9_]+$' then
    return jsonb_build_object('available', false, 'reason', 'format',
      'message', 'A username needs at least one letter.');
  end if;
  if exists (select 1 from public.reserved_usernames where name = v_name) then
    return jsonb_build_object('available', false, 'reason', 'reserved',
      'message', 'That name is reserved.');
  end if;
  if exists (select 1 from public.profiles where username = v_name
             and id is distinct from auth.uid()) then
    return jsonb_build_object('available', false, 'reason', 'taken',
      'message', 'That name is taken.');
  end if;
  -- Quarantine: released within 90 days, and held by someone else.
  if exists (select 1 from public.username_history h
             where h.username = v_name
               and h.released_at is not null
               and h.released_at > now() - interval '90 days'
               and h.user_id is distinct from auth.uid()) then
    return jsonb_build_object('available', false, 'reason', 'recently_released',
      'message', 'That name was recently in use and is not available yet.');
  end if;
  return jsonb_build_object('available', true);
end;
$$;

grant execute on function public.loamy_username_available(text) to authenticated;

create or replace function public.loamy_set_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := lower(trim(coalesce(p_username, '')));
  v_old   text;
  v_last  timestamptz;
  v_check jsonb;
  v_wait  int;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if not public.loamy_is_active(v_uid) then
    raise exception 'This account is not active.';
  end if;

  select username, username_changed_at into v_old, v_last
  from public.profiles where id = v_uid;

  if v_old = v_name then
    return jsonb_build_object('changed', false, 'username', v_name,
      'reason', 'unchanged');
  end if;

  -- 30 days between changes. A handle that moves freely is an impersonation
  -- tool; the first claim is free.
  if v_old is not null and v_last is not null and v_last > now() - interval '30 days' then
    v_wait := ceil(extract(epoch from (v_last + interval '30 days' - now())) / 86400.0);
    return jsonb_build_object('changed', false, 'reason', 'rate_limited',
      'days_remaining', v_wait,
      'message', format('You can change your username again in %s day(s).', v_wait));
  end if;

  v_check := public.loamy_username_available(v_name);
  if not (v_check->>'available')::boolean then
    return jsonb_build_object('changed', false, 'reason', v_check->>'reason',
      'message', v_check->>'message');
  end if;

  if v_old is not null then
    update public.username_history
       set released_at = now()
     where user_id = v_uid and username = v_old and released_at is null;
  end if;

  perform set_config('loamy.username_authorized', 'true', true);
  update public.profiles
     set username = v_name, username_changed_at = now()
   where id = v_uid;
  perform set_config('loamy.username_authorized', 'false', true);

  insert into public.username_history (user_id, username) values (v_uid, v_name);

  perform public.loamy_audit_internal('username_set', 'profile', v_uid,
    jsonb_build_object('from', v_old, 'to', v_name));

  return jsonb_build_object('changed', true, 'username', v_name);
exception
  when unique_violation then
    return jsonb_build_object('changed', false, 'reason', 'taken',
      'message', 'That name was just taken.');
end;
$$;

revoke all on function public.loamy_set_username(text) from public, anon;
grant execute on function public.loamy_set_username(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Visibility and the profile text a member controls.
-- ----------------------------------------------------------------------------
-- bio / headline / profile_visibility are ordinary self-service columns: the
-- existing profiles RLS already restricts updates to the owner. They are
-- length-capped above. No guard is needed because none of them is a claim
-- about anything -- unlike verified_badge, which has always been guarded.

-- ----------------------------------------------------------------------------
-- 6. The public profile surface.
-- ----------------------------------------------------------------------------
-- The COLUMN LIST IS THE SECURITY CONTRACT. phone, email, digital_id,
-- financing, farm coordinates and role_data must never appear here.
create or replace function public.loamy_profile_by_username(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_name    text := lower(trim(coalesce(p_username, '')));
  v_p       public.profiles%rowtype;
  v_viewer  uuid := auth.uid();
  v_roles   text[];
  v_out     jsonb;
begin
  select * into v_p from public.profiles where username = v_name;

  -- A profile that exists but may not be seen is reported exactly as one that
  -- does not exist. Otherwise the 404 becomes an enumeration oracle.
  if v_p.id is null
     or v_p.active is not true
     or v_p.profile_visibility = 'private'
     or (v_p.profile_visibility = 'members' and v_viewer is null)
  then
    if v_p.id is not null and (v_p.id = v_viewer or public.loamy_is_admin()) then
      null; -- the owner and admins always see it
    else
      return jsonb_build_object('found', false);
    end if;
  end if;

  select coalesce(array_agg(distinct r.role), '{}')
    into v_roles
  from public.user_platform_roles r
  where r.user_id = v_p.id and r.role <> 'bank';

  v_out := jsonb_build_object(
    'found', true,
    'username', v_p.username,
    'display_name', v_p.full_name,
    'headline', v_p.headline,
    'bio', v_p.bio,
    'avatar_url', v_p.avatar_url,
    'state', v_p.state,
    'category', v_p.category,
    'roles', to_jsonb(v_roles),
    'verified_badge', v_p.verified_badge,
    'member_since', v_p.created_at,
    'is_self', v_p.id = v_viewer,
    'visibility', v_p.profile_visibility);

  -- Commercial footprint: counts only, never the underlying rows.
  v_out := v_out || jsonb_build_object(
    'active_listings', (select count(*) from public.listings l
                        where l.seller_id = v_p.id and l.status = 'active'),
    'completed_transactions', (select count(*) from public.transactions t
                        where (t.buyer_id = v_p.id or t.seller_id = v_p.id)
                          and t.status = 'completed'),
    'commodities', (select coalesce(jsonb_agg(distinct l.commodity), '[]'::jsonb)
                        from public.listings l
                        where l.seller_id = v_p.id and l.status = 'active'),
    'states_served', (select coalesce(jsonb_agg(distinct l.state), '[]'::jsonb)
                        from public.listings l
                        where l.seller_id = v_p.id and l.status = 'active'));

  return v_out;
end;
$$;

grant execute on function public.loamy_profile_by_username(text) to authenticated, anon;

comment on function public.loamy_profile_by_username(text) is
  'BLOCK 1. The public identity surface. Returns found=false for a profile that exists but may not be seen, so the response cannot be used to enumerate members.';

-- Resolve a user id to a handle, for linking from listings and trace output.
-- Runs as owner (RLS bypassed), so the WHERE clause IS the access control:
-- private profiles never appear, and this is granted to signed-in members
-- only. Signed-out visitors resolve a handle through
-- loamy_profile_by_username, which applies the visibility rule per profile.
create or replace view public.loamy_profile_handles as
select id, username, full_name, avatar_url, verified_badge, profile_visibility
from public.profiles
where username is not null
  and active is true
  and profile_visibility <> 'private';

alter view public.loamy_profile_handles set (security_invoker = off);
revoke all on public.loamy_profile_handles from public, anon;
grant select on public.loamy_profile_handles to authenticated;
