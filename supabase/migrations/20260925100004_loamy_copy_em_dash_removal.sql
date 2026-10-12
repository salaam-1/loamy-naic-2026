-- ==========================================================================
-- Remove the em dash from copy the member actually reads.
--
-- WHY A MIGRATION AT ALL
--   The house rule is that no user-facing copy uses an em dash. Most Loamy
--   copy lives in React, but a real share of what a member reads is emitted
--   by Postgres: RPC error messages, notification bodies, journey hints and
--   the bilingual Co-pilot concept answers. Those cannot be fixed in the
--   client, so they are fixed here.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--   Six `comment on column` strings still contain an em dash. A column
--   comment is read by engineers through psql, never by a member, so it is
--   not user-facing copy, and rewriting it would churn schema documentation
--   for no reader benefit.
--
-- HOW, AND WHY THIS SHAPE
--   Each function is rewritten from `pg_get_functiondef` of the version that
--   is actually installed, not from a body pasted out of a migration file.
--
--   An earlier draft of this comment justified that by claiming several of
--   these functions had been redefined after the wording landed. That claim
--   was checked against the migration history and it is FALSE: seven of the
--   eight are defined exactly once, and the eighth
--   (loamy_request_farm_verification, introduced in stage 2 and redefined in
--   stage 4) carries the wording in its LATEST definition. Pasting the latest
--   authored body would not have reverted anything.
--
--   The real reason to read the catalog is drift. A pasted body is a second
--   source of truth: if the installed function ever differs from the file, a
--   paste silently overwrites it, and an out-of-band fix disappears with no
--   diff to show for it. Reading what is installed and changing only
--   punctuation cannot do that. The trade is that the result depends on the
--   current body rather than being byte-identical across environments, which
--   is acceptable here because the transformation is always "the installed
--   body, with this punctuation corrected", and because anything this
--   migration does not recognise makes it raise instead of half-fixing.
--
--   Structurally it also cannot drift: pg_get_functiondef reproduces the
--   signature, return type, volatility, SECURITY DEFINER and SET search_path
--   from the catalog, and CREATE OR REPLACE FUNCTION leaves existing
--   privileges and ownership untouched.
--
--   Only punctuation changes. No signature, no body logic, no grant, no
--   security attribute and no RLS policy is altered, and the rewrite is
--   skipped for any function whose text does not change.
--
-- PRODUCTION DATA
--   No member row is read or written. The only data change is to
--   public.copilot_concepts, which is platform-authored reference content.
-- ==========================================================================

do $mig$
declare
  r       record;
  v_src   text;
  v_new   text;
  v_n     int;
  v_count int := 0;
  v_pairs text[][] := array[
    ['Nothing to check out — your', 'Nothing to check out: your'],
    ['requested quantity — %s', 'requested quantity: %s'],
    ['now available — payment', 'now available. Payment'],
    ['Nothing to order — your', 'Nothing to order: your'],
    ['a field visit — assign', 'a field visit. Assign'],
    ['Sandbox simulation — not a', 'Sandbox simulation, not a'],
    ['already complete — use', 'already complete. Use'],
    ['Nothing yet — wait', 'Nothing yet. Wait'],
    ['pay directly — no financing', 'pay directly, so no financing']
  ];
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%—%'
  loop
    v_src := pg_get_functiondef(r.oid);
    v_new := v_src;
    for v_n in 1 .. array_length(v_pairs, 1) loop
      v_new := replace(v_new, v_pairs[v_n][1], v_pairs[v_n][2]);
    end loop;

    -- A function still holding an em dash after substitution is one this
    -- migration did not anticipate. Fail loudly rather than half-fix it.
    if v_new like '%—%' then
      raise exception 'Unhandled em dash in %; add a substitution pair.', r.proname;
    end if;

    if v_new is distinct from v_src then
      execute v_new;
      v_count := v_count + 1;
    end if;
  end loop;

  raise notice 'rewrote % function definition(s)', v_count;
end $mig$;

-- --------------------------------------------------------------------------
-- Co-pilot concept answers. These are rows, not code, so a targeted update is
-- enough, and the English and Hausa bodies stay in step with one another.
-- --------------------------------------------------------------------------
do $mig$
declare
  v_n     int;
  v_pairs text[][] := array[
    ['the platform — it links', 'the platform. It links'],
    ['cikin dandalin — tana ha', 'cikin dandalin. Tana ha'],
    ['are real — a Growth Partner', 'are real. A Growth Partner'],
    ['na gaske ne — abokin ha', 'na gaske ne. Abokin ha'],
    ['partner bank — Loamy never lends', 'partner bank. Loamy never lends'],
    ['shawarar tallafi — Loamy ba ya', 'shawarar tallafi. Loamy ba ya'],
    ['(Paystack) — not by Loamy — until', '(Paystack), not by Loamy, until'],
    ['(Paystack) — ba Loamy ba — har sai', '(Paystack), ba Loamy ba, har sai']
  ];
begin
  for v_n in 1 .. array_length(v_pairs, 1) loop
    update public.copilot_concepts
       set body_en = replace(body_en, v_pairs[v_n][1], v_pairs[v_n][2]),
           body_ha = replace(body_ha, v_pairs[v_n][1], v_pairs[v_n][2]);
  end loop;
end $mig$;

-- --------------------------------------------------------------------------
-- Proof, not hope: refuse to finish while a member can still be shown one.
-- --------------------------------------------------------------------------
do $mig$
declare v_bad int;
begin
  select count(*) into v_bad
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%—%';
  if v_bad > 0 then
    raise exception '% function(s) still contain an em dash.', v_bad;
  end if;

  select count(*) into v_bad from public.copilot_concepts
   where body_en like '%—%' or body_ha like '%—%';
  if v_bad > 0 then
    raise exception '% co-pilot concept row(s) still contain an em dash.', v_bad;
  end if;
end $mig$;
