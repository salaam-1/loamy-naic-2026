-- ============================================================================
-- Loamy Platform · Stage 5 · Migration 4 of 4
-- Fix: the portal's signup trigger writes category/state as EMPTY STRINGS
-- when the metadata omits them, which violates the portal's own CHECK
-- constraints ('' is not in the allowed lists — NULL is fine). Bank officer
-- accounts legitimately have no category/state. Our existing BEFORE INSERT
-- trigger now nullifies empty strings before constraints are evaluated —
-- additive, and a no-op for every normal signup.
-- ============================================================================

-- DELIBERATE, DOCUMENTED portal-constraint relaxation (the one and only):
-- profiles.category becomes NULLABLE. Rationale: bank officers (and future
-- operational staff) are not agricultural participants — none of the 8
-- category labels applies. The portal's own signup always supplies a
-- category, so no portal write path is affected; the CHECK constraint on
-- allowed values remains fully intact. Flagged in the README for review.
alter table public.profiles alter column category drop not null;

create or replace function public.loamy_sync_platform_role()
returns trigger
language plpgsql
as $$
begin
  new.category := nullif(btrim(coalesce(new.category, '')), '');
  new.state    := nullif(btrim(coalesce(new.state, '')), '');
  if new.platform_role is null and new.category is not null then
    new.platform_role := public.loamy_normalize_role(new.category);
  end if;
  return new;
end;
$$;
