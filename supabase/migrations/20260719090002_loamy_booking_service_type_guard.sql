-- ============================================================================
-- Fix: the insert policy's `d.service_type = service_type` was a no-op — inside
-- the subquery the unqualified name binds to the directory column (d.service_type
-- = d.service_type, always true), not the new booking row. Rather than rely on
-- RLS name resolution, force service_type to match the target directory in a
-- BEFORE INSERT trigger, so a mismatch is impossible regardless of client input.
-- Caught by scripts/verify-extras.mjs ("Mismatched service_type").
-- ============================================================================

create or replace function public.loamy_booking_set_service_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.service_type := (select service_type from public.service_directory where id = new.directory_id);
  if new.service_type is null then
    raise exception 'Directory entry not found';
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_bookings_set_service_type on public.service_bookings;
create trigger loamy_bookings_set_service_type
  before insert on public.service_bookings
  for each row execute function public.loamy_booking_set_service_type();
