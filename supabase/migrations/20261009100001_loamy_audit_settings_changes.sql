-- Audit changes to platform_config.settings.
--
-- THE GAP THIS CLOSES
--   `loamy_audit_config_change()` records only `flags` and `partner_rates`.
--   `platform_config.settings` has carried platform-wide tunables since
--   20260919100001 -- eligibility weights, the wallet withdrawal minimum, the
--   verification distance and clock-skew thresholds -- and NONE of those
--   changes has ever been audited. Adding AI configuration under
--   `settings.ai` made the gap visible; it did not create it.
--
--   `flags` and `partner_rates` auditing is unchanged. This is additive.
--
-- WHY A DATABASE-LEVEL SECRET GUARD AS WELL
--   The application already refuses to write secret-shaped values
--   (`assertNoSecrets` in src/lib/aiSettings.ts). That guard runs in a
--   browser, and a browser is not where a security boundary belongs. An
--   admin with a REST client, a future code path, or a script can update this
--   row directly. So the refusal is enforced here too, where it cannot be
--   bypassed, and the audit row can never be the thing that leaks a
--   credential into a table built to be read.
--
-- NOT APPLIED TO ANY ENVIRONMENT BY THIS COMMIT. Applying it to staging
-- needs explicit authorization; production is out of scope entirely.

-- ---------------------------------------------------------------------------
-- 1. Refuse secret-shaped content in `settings`, before it is stored.
-- ---------------------------------------------------------------------------

create or replace function public.loamy_settings_reject_secrets()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  path    text;
  v       jsonb;
  segment text;
  leaf    text;
begin
  if new.settings is null then
    return new;
  end if;
  -- `is not distinct from` rather than `=`, so a NULL old value does not make
  -- the comparison NULL and skip validation by accident.
  if tg_op = 'UPDATE' and new.settings is not distinct from old.settings then
    return new;
  end if;

  -- Walk every leaf. `jsonb_each` only reaches the top level, so this
  -- flattens first: a credential three objects deep is still a credential.
  for path, v in
    select * from jsonb_each(public.loamy_jsonb_flatten(new.settings))
  loop
    -- The LAST path segment is the field name. Extracting it first is what
    -- makes camelCase detectable: a dotted-path regex anchored on `[._]`
    -- cannot see the boundary inside `hostedToken`, and an earlier version of
    -- this trigger let exactly that through.
    segment := regexp_replace(path, '^.*[.\[]', '');
    segment := regexp_replace(segment, '\]$', '');

    -- 1. Exact field name, case-insensitive. A deny list, not a substring
    --    match: `maxOutputTokens` is a count and must not be rejected.
    if lower(regexp_replace(segment, '[^a-zA-Z_]', '', 'g')) = any (array[
      'token','apitoken','accesstoken','authtoken','bearertoken','hostedtoken',
      'refreshtoken','idtoken','secret','clientsecret','apisecret',
      'apikey','api_key','key','privatekey','secretkey','publickey',
      'password','passwd','pass','credential','credentials',
      'authorization','auth','servicerole','service_role'
    ]) then
      raise exception
        'platform_config.settings may not contain credential-shaped key "%". '
        'It is readable by every authenticated member; use a server-side secret.', path
        using errcode = 'check_violation';
    end if;

    -- 2. camelCase suffix, case-SENSITIVE and SINGULAR. `hostedToken` is a
    --    credential; `maxOutputTokens` is a number, and the plural is the
    --    whole distinction. This mirrors `SECRET_SUFFIX` in
    --    src/lib/aiSettings.ts so the two layers cannot disagree.
    if segment ~ '(Token|Secret|Password|Credential|ApiKey|PrivateKey|Authorization)$' then
      raise exception
        'platform_config.settings may not contain credential-shaped key "%". '
        'It is readable by every authenticated member; use a server-side secret.', path
        using errcode = 'check_violation';
    end if;

    -- 3. Credential-shaped VALUE, under any key at all. This is the net that
    --    catches a field name nobody anticipated.
    if jsonb_typeof(v) = 'string' then
      leaf := v #>> '{}';
      if leaf ~ '^hf_[A-Za-z0-9]{10,}'
         or leaf ~ '^sk-[A-Za-z0-9]{10,}'
         or leaf ~ '^eyJ[A-Za-z0-9_-]{10,}\.'
         or leaf ~* '^Bearer\s+\S+'
      then
        raise exception
          'platform_config.settings value at "%" looks like a credential. '
          'Use a server-side secret instead.', path
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  return new;
end;
$$;

-- Flatten a jsonb document to dotted leaf paths, so the walk above is a
-- simple loop rather than recursive SQL at every call site.
create or replace function public.loamy_jsonb_flatten(doc jsonb, prefix text default '')
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  out jsonb := '{}'::jsonb;
  k   text;
  v   jsonb;
  i   int;
  elem jsonb;
begin
  if doc is null then return out; end if;

  if jsonb_typeof(doc) = 'object' then
    for k, v in select * from jsonb_each(doc) loop
      out := out || public.loamy_jsonb_flatten(
        v, case when prefix = '' then k else prefix || '.' || k end);
    end loop;
    return out;
  end if;

  if jsonb_typeof(doc) = 'array' then
    i := 0;
    for elem in select * from jsonb_array_elements(doc) loop
      out := out || public.loamy_jsonb_flatten(elem, prefix || '[' || i || ']');
      i := i + 1;
    end loop;
    return out;
  end if;

  -- A scalar leaf.
  return jsonb_build_object(prefix, doc);
end;
$$;

-- INSERT as well as UPDATE. The single-row CHECK (id = 1) plus the primary
-- key make an INSERT practically impossible once the row is seeded, and
-- `service_role` bypasses RLS -- so covering both costs nothing and removes
-- the need to reason about whether an upsert takes the insert or the update
-- path.
drop trigger if exists loamy_platform_config_reject_secrets on public.platform_config;
create trigger loamy_platform_config_reject_secrets
  before insert or update on public.platform_config
  for each row execute function public.loamy_settings_reject_secrets();

-- ---------------------------------------------------------------------------
-- 2. Extend the configuration audit to cover `settings`.
-- ---------------------------------------------------------------------------

-- Replaces the existing function. `flags` and `partner_rates` behaviour is
-- preserved exactly; `settings` is added alongside, and the changed top-level
-- KEY NAMES are recorded so a reviewer can see what moved without reading two
-- whole documents.
create or replace function public.loamy_audit_config_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed text[];
begin
  if new.settings is distinct from old.settings then
    select coalesce(array_agg(key order by key), '{}')
      into changed
      from (
        select key from jsonb_object_keys(coalesce(new.settings, '{}'::jsonb)) as key
        union
        select key from jsonb_object_keys(coalesce(old.settings, '{}'::jsonb)) as key
      ) k
     where coalesce(new.settings -> key, 'null'::jsonb)
           is distinct from coalesce(old.settings -> key, 'null'::jsonb);
  end if;

  perform public.loamy_audit_internal('config_changed', 'platform_config', null,
    jsonb_build_object(
      'flags_before', old.flags, 'flags_after', new.flags,
      'rates_before', old.partner_rates, 'rates_after', new.partner_rates,
      -- Added. The before/after documents are safe to store because the
      -- trigger above refuses to let a credential into this column at all.
      'settings_changed_keys', coalesce(changed, '{}'),
      'settings_before', old.settings, 'settings_after', new.settings));
  return new;
end;
$$;

-- The trigger itself is unchanged and is re-asserted so this migration is
-- self-contained if replayed against a fresh database.
drop trigger if exists loamy_platform_config_audit on public.platform_config;
create trigger loamy_platform_config_audit
  after update on public.platform_config
  for each row execute function public.loamy_audit_config_change();

-- ---------------------------------------------------------------------------
-- 3. Ordering note
-- ---------------------------------------------------------------------------
-- The reject trigger is BEFORE UPDATE and the audit trigger is AFTER UPDATE,
-- so a rejected change raises before any audit row is written. A rejected
-- secret therefore leaves no trace in `audit_events` -- which is the point:
-- an audit trail that records the credential it refused would be its own
-- disclosure.
