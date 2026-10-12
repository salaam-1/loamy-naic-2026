-- ============================================================================
-- Loamy Platform · Extras · Service bookings (warehouse + logistics)
-- Turns the Stage-3 directory (browse + contact) into a real BOOKING REQUEST
-- flow. NO payment fields, NO amounts, NO settlement — bookings carry dates,
-- a description, and a status only. Arrangements conclude off-platform, as
-- everywhere else in Loamy.
-- ============================================================================

create table if not exists public.service_bookings (
  id             uuid primary key default gen_random_uuid(),
  directory_id   uuid not null references public.service_directory (id) on delete cascade,
  booker_id      uuid not null references public.profiles (id) on delete cascade,
  service_type   text not null check (service_type in ('warehouse','logistics')),
  start_date     date not null,
  end_date       date,   -- warehouses use a range; logistics may be one-off
  details        text not null default '',  -- e.g. "50t maize" or "Kano→Lagos, 30t"
  status         text not null default 'requested'
    check (status in ('requested','accepted','declined','completed','cancelled')),
  owner_response text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint service_bookings_dates check (end_date is null or end_date >= start_date)
);

create index if not exists service_bookings_booker_idx on public.service_bookings (booker_id, created_at desc);
create index if not exists service_bookings_directory_idx on public.service_bookings (directory_id, status);

-- SECURITY-REVIEW: two-party private data (booker + service owner). No amount
-- or payment column exists here and none may be added — bookings track intent
-- and status only; money stays off-platform. Contact exchange after acceptance
-- goes through loamy_get_booking_contacts (name + phone only), the same
-- pattern as listing interests.
alter table public.service_bookings enable row level security;

drop policy if exists "loamy_bookings_select" on public.service_bookings;
create policy "loamy_bookings_select"
  on public.service_bookings for select to authenticated
  using (
    booker_id = auth.uid()
    or public.loamy_is_admin()
    or exists (
      select 1 from public.service_directory d
      where d.id = directory_id and d.owner_id = auth.uid()
    )
  );

-- Booker creates a request against someone else's active directory entry.
drop policy if exists "loamy_bookings_insert" on public.service_bookings;
create policy "loamy_bookings_insert"
  on public.service_bookings for insert to authenticated
  with check (
    booker_id = auth.uid()
    and status = 'requested'
    and exists (
      select 1 from public.service_directory d
      where d.id = directory_id and d.owner_id <> auth.uid()
        and d.service_type = service_type
    )
  );

-- Both parties may update; the guard trigger enforces WHO may make WHICH move.
drop policy if exists "loamy_bookings_update" on public.service_bookings;
create policy "loamy_bookings_update"
  on public.service_bookings for update to authenticated
  using (
    booker_id = auth.uid()
    or exists (select 1 from public.service_directory d where d.id = directory_id and d.owner_id = auth.uid())
  )
  with check (
    booker_id = auth.uid()
    or exists (select 1 from public.service_directory d where d.id = directory_id and d.owner_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Transition guard: booker may cancel an open/accepted request; owner may
-- accept/decline a request and mark an accepted one completed. Party columns
-- are frozen.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_booking_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  is_booker boolean := auth.uid() = old.booker_id;
  is_owner  boolean;
begin
  select owner_id into v_owner from public.service_directory where id = old.directory_id;
  is_owner := auth.uid() = v_owner;

  if new.booker_id is distinct from old.booker_id
     or new.directory_id is distinct from old.directory_id
     or new.service_type is distinct from old.service_type then
    raise exception 'Booking parties cannot be changed';
  end if;
  if new.owner_response is distinct from old.owner_response and not is_owner then
    raise exception 'Only the service owner can write a response';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'requested' and new.status = 'cancelled' and is_booker then null;
    elsif old.status = 'accepted' and new.status = 'cancelled' and is_booker then null;
    elsif old.status = 'requested' and new.status in ('accepted','declined') and is_owner then null;
    elsif old.status = 'accepted' and new.status = 'completed' and is_owner then null;
    else
      raise exception 'Transition % -> % is not allowed for this party', old.status, new.status;
    end if;
  elsif not is_booker and not is_owner then
    raise exception 'Not a party to this booking';
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_bookings_guard on public.service_bookings;
create trigger loamy_bookings_guard
  before update on public.service_bookings
  for each row execute function public.loamy_booking_guard();

drop trigger if exists loamy_bookings_updated_at on public.service_bookings;
create trigger loamy_bookings_updated_at
  before update on public.service_bookings
  for each row execute function public.loamy_set_updated_at();

-- ----------------------------------------------------------------------------
-- Notifications: owner hears about a new request; booker hears the decision.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_booking_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_name  text;
begin
  select d.owner_id, d.business_name into v_owner, v_name
  from public.service_directory d where d.id = coalesce(new.directory_id, old.directory_id);

  if tg_op = 'INSERT' then
    perform public.loamy_create_notification_internal(
      v_owner, 'New booking request',
      'You have a new ' || new.service_type || ' booking request. Review it under Bookings.',
      'booking');
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public.loamy_create_notification_internal(
        new.booker_id, 'Booking accepted',
        'Your booking with "' || v_name || '" was accepted. Contact details are now available; arrangements conclude directly between you.',
        'booking');
    elsif new.status = 'declined' then
      perform public.loamy_create_notification_internal(
        new.booker_id, 'Booking declined',
        'Your booking with "' || v_name || '" was declined.', 'booking');
    elsif new.status = 'completed' then
      perform public.loamy_create_notification_internal(
        new.booker_id, 'Booking marked completed',
        'Your booking with "' || v_name || '" was marked completed.', 'booking');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_bookings_notify on public.service_bookings;
create trigger loamy_bookings_notify
  after insert or update on public.service_bookings
  for each row execute function public.loamy_booking_notify();

-- ----------------------------------------------------------------------------
-- Contact exchange after acceptance (name + phone only, parties only).
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: same disclosure discipline as loamy_get_interest_contacts —
-- parties only, accepted/completed only, name + phone only. No other field.
create or replace function public.loamy_get_booking_contacts(p_booking uuid)
returns table (party text, full_name text, phone text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_booking public.service_bookings%rowtype;
  v_owner   uuid;
begin
  select * into v_booking from public.service_bookings where id = p_booking;
  if v_booking.id is null then
    raise exception 'Booking not found';
  end if;
  select owner_id into v_owner from public.service_directory where id = v_booking.directory_id;

  if auth.uid() is distinct from v_booking.booker_id and auth.uid() is distinct from v_owner then
    raise exception 'Not a party to this booking';
  end if;
  if v_booking.status not in ('accepted','completed') then
    raise exception 'Contact details are shared after the owner accepts';
  end if;

  return query
  select 'booker'::text, p.full_name, p.phone from public.profiles p where p.id = v_booking.booker_id
  union all
  select 'owner'::text, p.full_name, p.phone from public.profiles p where p.id = v_owner;
end;
$$;

revoke all on function public.loamy_get_booking_contacts(uuid) from public;
revoke all on function public.loamy_get_booking_contacts(uuid) from anon;
grant execute on function public.loamy_get_booking_contacts(uuid) to authenticated;

-- Feature flag for the booking surfaces.
update public.platform_config
set flags = flags || '{"service_booking": true}'::jsonb
where id = 1;
