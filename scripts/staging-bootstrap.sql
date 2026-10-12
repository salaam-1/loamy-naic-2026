-- Staging bootstrap: restore Supabase's standard default privileges.
--
-- WHY THIS IS NEEDED
--   A Supabase project normally carries
--     alter default privileges in schema public grant all on tables
--       to postgres, anon, authenticated, service_role;
--   so every table created afterwards is reachable by the API roles, and RLS
--   is the actual boundary. That is the model this codebase is built on:
--   "The anon key is browser-safe; every query relies on RLS" (README).
--
--   When the migration history is replayed into a FRESH project by the CLI,
--   the objects are created by the CLI's migration role, which does not
--   inherit those default privileges. The result is a project where every
--   table answers `42501: permission denied` instead of exercising RLS.
--
--   That is not a stricter environment, it is a MISLEADING one: a security
--   test asserting "this actor cannot read that row" would pass because the
--   grant is missing, not because the policy works. Staging would go green
--   while proving nothing about production.
--
-- WHY THIS IS NOT "WEAKENING" ANYTHING
--   It reproduces production rather than diverging from it. Verified against
--   production: an authenticated INSERT into wallet_entries there is refused
--   by the table's TRIGGER (SQLSTATE 23001), not by a missing grant, and anon
--   SELECT on profiles returns 200 with an empty set rather than 42501. Both
--   show production grants broadly and relies on RLS.
--
-- SCOPE
--   Staging only. Never run against production, which already has these.
--
-- ORDER MATTERS, AND THIS IS THE PART THAT BIT US
--   Run this BEFORE `supabase db push`, not after.
--
--   `alter default privileges` applies to objects created AFTERWARDS, so
--   running it first means every table the migrations create is reachable on
--   creation, and each migration's own `revoke ... from anon` then lands on
--   top and stays. Running it afterwards instead reverses those revokes: the
--   migrations declare 61 table/view and 521 function privilege statements,
--   and a blanket grant run last silently overrides every one of them.
--
--   Both mistakes were made here on 2026-09-23 and both were caught by the
--   security suite, not by review: `refuses a signed-out visitor` and `keeps
--   the handle directory away from signed-out visitors` both failed because
--   staging really had become more permissive than production.
--
-- USAGE
--   supabase link --project-ref <staging-ref>
--   supabase db query --linked --file scripts/staging-bootstrap.sql   # FIRST
--   supabase db push                                                  # then

grant usage on schema public to anon, authenticated, service_role;

-- TABLES and SEQUENCES only.
--
-- FUNCTIONS ARE DELIBERATELY EXCLUDED. The migrations manage function
-- privileges precisely, e.g.
--     revoke all on function public.loamy_transaction_fulfilment(uuid)
--       from public, anon;
--     grant execute on function public.loamy_transaction_fulfilment(uuid)
--       to authenticated;
-- A blanket `grant all on all functions ... to anon` run AFTER the migrations
-- silently reverses every one of those revokes. It was in an earlier version
-- of this file, and the security suite caught it: "refuses a signed-out
-- visitor" failed because anon really could call the function on staging.
-- That is worse than a missing staging environment, because it is a staging
-- environment that quietly permits what production forbids.
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- And for anything created later, so a future migration does not reintroduce
-- the same gap.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
-- No default privilege for functions, for the reason above.
