-- ============================================================================
-- A public @handle is marketplace identity, so an institution cannot claim one.
--
-- WHY
--   `loamy_set_username` gated on "signed in" and "active" only. A bank officer
--   could therefore claim a public handle and appear in the member directory
--   through the API, even though the portal has no reason to offer it. Nothing
--   escalated, but the public identity system exists so a buyer can find a
--   seller, and a partner bank is neither.
--
--   Verified before changing anything: 0 of 16 bank profiles on production and
--   0 of 6 on staging hold a username, so nothing existing depends on this.
--
-- SCOPE, AND THE ONE DELIBERATE ASYMMETRY
--   This refuses platform_role 'bank' only.
--
--   It does NOT refuse the `role = 'admin'` flag. That flag is an overlay: an
--   administrator also holds a real platform role and may legitimately be a
--   farmer or a buyer with a shopfront of their own. Blocking them here would
--   take away something they are entitled to. The admin surface simply does not
--   render the card, which is a presentation decision rather than an
--   authorization one.
--
-- EVERYTHING ELSE IS UNCHANGED
--   The 30-day rate limit, the availability check, history release, the audit
--   row, the session-flag guard around the profile update and the
--   unique_violation handler are all carried over exactly as they were.
-- ============================================================================

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
  v_prole text;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if not public.loamy_is_active(v_uid) then
    raise exception 'This account is not active.';
  end if;

  select username, username_changed_at, platform_role
    into v_old, v_last, v_prole
  from public.profiles where id = v_uid;

  -- Institutional accounts have no marketplace shopfront.
  if v_prole = 'bank' then
    return jsonb_build_object('changed', false, 'reason', 'not_applicable',
      'message', 'A public handle is for marketplace members. Institutional accounts do not have one.');
  end if;

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
