-- ============================================================================
-- MODEL FREEZE — make the schema inspectable so the freeze can be CHECKED.
-- ----------------------------------------------------------------------------
-- The system-of-record document names, for each concept, the one authoritative
-- table. A document alone does not stop a twelfth "deal" table appearing
-- during the next build; it only records the disappointment afterwards.
--
-- So the freeze is a manifest plus a test, and the test needs to see the live
-- schema. PostgREST does not expose information_schema, so this function does
-- -- admin only, read only, names only.
--
-- It returns NO row counts and NO column values. It is a structural inventory,
-- not a data export.
-- ============================================================================

create or replace function public.loamy_model_inventory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tables jsonb;
  v_views  jsonb;
  v_fns    jsonb;
  v_rls    jsonb;
begin
  if not public.loamy_is_admin() then
    raise exception 'The model inventory is administrative.';
  end if;

  select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) into v_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';

  select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) into v_views
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v','m');

  select coalesce(jsonb_agg(distinct p.proname), '[]'::jsonb) into v_fns
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'loamy!_%' escape '!';

  -- Any table in public WITHOUT row-level security is a finding in itself.
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) into v_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity is false;

  return jsonb_build_object(
    'tables', v_tables,
    'views', v_views,
    'loamy_functions', v_fns,
    'tables_without_rls', v_rls,
    'taken_at', now());
end;
$$;

revoke all on function public.loamy_model_inventory() from public, anon;
grant execute on function public.loamy_model_inventory() to authenticated;

comment on function public.loamy_model_inventory() is
  'MODEL FREEZE. Structural inventory of public: table, view and function NAMES only, no data. Admin only. Used by tests/security/model-freeze.test.ts to hold the authoritative model to its manifest.';
