-- ============================================================================
-- BLOCK 4 (j) — remove the superseded loamy_financing_decision overload.
-- ----------------------------------------------------------------------------
-- 130001 added tenor, pricing, bank reference, expiry and decision source to
-- loamy_financing_decision. Because those parameters carry defaults, Postgres
-- kept BOTH signatures, and PostgREST then refused every call:
--
--   PGRST203: Could not choose the best candidate function between
--             loamy_financing_decision(uuid,text,numeric,text,text)
--             loamy_financing_decision(uuid,text,numeric,text,text,int,text,text,timestamptz,text)
--
-- Which broke the Phase 6 suite -- a live regression introduced by an
-- "additive" change. CREATE OR REPLACE only replaces a function with the SAME
-- argument list; adding a defaulted parameter creates a second function.
--
-- Dropping the old signature is safe precisely because the new one defaults
-- every added parameter, so existing five-argument callers are unaffected.
-- ============================================================================

drop function if exists public.loamy_financing_decision(uuid, text, numeric, text, text);

-- Re-assert the grant on the surviving signature, since dropping a sibling
-- overload is a good moment to be explicit about which one is callable.
revoke all on function public.loamy_financing_decision(
  uuid,text,numeric,text,text,int,text,text,timestamptz,text) from public, anon;
grant execute on function public.loamy_financing_decision(
  uuid,text,numeric,text,text,int,text,text,timestamptz,text) to authenticated;
