-- ============================================================================
-- Fix: bvn_verified / nin_verified were client-writable via the portal's own
-- "update your own profile" policy — a user could self-mark themselves KYC
-- verified. Extend the profile-badge protection trigger to also freeze the KYC
-- status + reference unless the sanctioned workflow flag is set, and have the
-- service-role KYC function set that flag. Caught by scripts/verify-stage9.mjs.
-- ============================================================================

create or replace function public.loamy_protect_profile_badge()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('loamy.status_change_authorized', true), '') = 'true' then
    return new; -- sanctioned workflow (badge approval / KYC record) may write
  end if;
  if new.verified_badge is distinct from old.verified_badge then
    raise exception 'verified_badge can only change through the verification workflow';
  end if;
  if new.bvn_verified is distinct from old.bvn_verified
     or new.nin_verified is distinct from old.nin_verified
     or new.kyc_reference is distinct from old.kyc_reference then
    raise exception 'KYC status can only change through the identity-verification workflow';
  end if;
  return new;
end;
$$;

create or replace function public.loamy_record_kyc_result(
  p_user uuid, p_field text, p_verified boolean, p_reference text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_field not in ('bvn','nin') then raise exception 'Invalid KYC field'; end if;
  perform set_config('loamy.status_change_authorized', 'true', true);
  if p_field = 'bvn' then
    update public.profiles set bvn_verified = p_verified, kyc_reference = coalesce(p_reference, kyc_reference) where id = p_user;
  else
    update public.profiles set nin_verified = p_verified, kyc_reference = coalesce(p_reference, kyc_reference) where id = p_user;
  end if;
  perform set_config('loamy.status_change_authorized', '', true);
end;
$$;

revoke all on function public.loamy_record_kyc_result(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.loamy_record_kyc_result(uuid, text, boolean, text) to service_role;
