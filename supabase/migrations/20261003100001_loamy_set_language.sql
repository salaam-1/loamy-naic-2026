-- ============================================================================
-- Save a member's interface language, and nothing else.
--
-- WHERE THE PREFERENCE LIVES, AND WHY NOT A NEW TABLE
--   public.role_details is already the per-account settings store: primary key
--   (user_id), one jsonb `role_data`, RLS scoped to the owner. A language
--   preference is exactly that shape, so adding a table or a column would be
--   duplicating a concept the schema already has.
--
-- WHY AN RPC RATHER THAN A CLIENT UPDATE
--   RLS already lets a member update their own role_details row, so the client
--   COULD write this directly. It must not. `role_data` also carries
--   `can_verify` (admin-granted, trigger-protected) and `bank_id` (the officer's
--   bank). A client-side read-modify-write of the whole jsonb would put those
--   keys on a round trip through the browser, where a stale read or a race
--   silently drops or reverts them.
--
--   This function changes ONE key, server-side, with `||`. Every other property
--   of role_data survives untouched, and the client never holds the blob.
--
-- SECURITY PROPERTIES
--   * The caller is auth.uid(). There is deliberately NO user_id parameter, so
--     there is no shape of this call that edits somebody else's preference.
--   * The language is whitelisted against the five locales the product ships.
--     Anything else raises; the catalogue is not open to client input.
--   * SECURITY DEFINER with a pinned search_path, matching loamy_set_username.
--     DEFINER is needed for the merge, not to widen reach: both the INSERT and
--     the ON CONFLICT target are keyed on v_uid.
--   * EXECUTE is granted to `authenticated` only; public and anon are revoked.
--   * Idempotent: setting the same language twice is a no-op write that returns
--     the same result.
--   * It cannot grant a capability. `can_verify` is never written, so the
--     loamy_protect_can_verify triggers see no change and do not fire their
--     exception; and an INSERT carrying only `language` leaves can_verify absent,
--     which the insert-side trigger reads as false.
-- ============================================================================

create or replace function public.loamy_set_language(p_lang text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_lang text := lower(trim(coalesce(p_lang, '')));
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  -- The five locales the product actually ships. Keep in step with
  -- src/lib/i18n/types.ts; a language the interface cannot render is not a
  -- preference, it is a way to make somebody's account unusable.
  if v_lang not in ('en', 'ha', 'ig', 'yo', 'fr') then
    raise exception 'Unsupported language: %', coalesce(p_lang, '(null)');
  end if;

  insert into public.role_details (user_id, role_data)
  values (v_uid, jsonb_build_object('language', v_lang))
  on conflict (user_id) do update
    set role_data = coalesce(public.role_details.role_data, '{}'::jsonb)
                    || jsonb_build_object('language', v_lang);

  return jsonb_build_object('language', v_lang);
end;
$$;

revoke all on function public.loamy_set_language(text) from public, anon;
grant execute on function public.loamy_set_language(text) to authenticated;

comment on function public.loamy_set_language(text) is
  'Sets only role_data.language for the calling user. No user_id parameter by design; locale is whitelisted; every other role_data key is preserved.';
