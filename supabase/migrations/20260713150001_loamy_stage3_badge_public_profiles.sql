-- ============================================================================
-- Loamy Platform · Stage 3 · Migration 1 of 5
-- Marketplace trust layer foundations:
--   1) profiles.verified_badge — set ONLY by Stage 4's admin-approved
--      verification workflow; protected from self-set by trigger.
--   2) loamy_public_profiles — the LIMITED profile surface other users may
--      see on marketplace cards (name, category, state, avatar, badge).
-- ============================================================================

alter table public.profiles
  add column if not exists verified_badge boolean not null default false;

comment on column public.profiles.verified_badge is
  'Marketplace trust badge. Set only by the Stage 4 verification workflow (admin approval); never client-writable.';

-- SECURITY-REVIEW: the portal''s own policy lets users UPDATE their own
-- profiles row, which would let anyone set verified_badge = true on
-- themselves. This trigger closes that: the badge only changes when the
-- sanctioned workflow function has set the transaction-local flag (same
-- mechanism as farms.verification_status). Verify no other code path sets
-- 'loamy.status_change_authorized'.
create or replace function public.loamy_protect_profile_badge()
returns trigger
language plpgsql
as $$
begin
  if new.verified_badge is distinct from old.verified_badge
     and coalesce(current_setting('loamy.status_change_authorized', true), '') <> 'true' then
    raise exception 'verified_badge can only change through the verification workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_profiles_protect_badge on public.profiles;
create trigger loamy_profiles_protect_badge
  before update on public.profiles
  for each row execute function public.loamy_protect_profile_badge();

-- ----------------------------------------------------------------------------
-- Limited public profile surface for marketplace cards.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: this view DELIBERATELY bypasses profiles RLS (it runs as
-- its owner) to expose a fixed, minimal column set to signed-in users:
-- display name, category, state, avatar, verification badge. The column list
-- IS the security contract — phone, email, digital_id, BVN/NIN, referral
-- data, role, and everything else must NEVER be added here. Contact exchange
-- happens only through loamy_get_interest_contacts after acceptance.
create or replace view public.loamy_public_profiles as
select
  id,
  full_name,
  category,
  state,
  avatar_url,
  verified_badge
from public.profiles;

revoke all on public.loamy_public_profiles from public;
revoke all on public.loamy_public_profiles from anon;
grant select on public.loamy_public_profiles to authenticated;
