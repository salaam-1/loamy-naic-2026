-- TEMPORARY diagnostic view (dropped by the next migration): exposes the
-- portal's existing CHECK constraint definitions on profiles so the platform
-- signup can send category values the portal accepts. Reads catalog metadata
-- only — no user data.
create or replace view public.loamy_tmp_schema_probe as
select c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.profiles'::regclass
  and c.contype = 'c';

grant select on public.loamy_tmp_schema_probe to anon, authenticated;
