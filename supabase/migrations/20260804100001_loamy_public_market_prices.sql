-- ============================================================================
-- Public market-prices read path. The marketplace storefront's "Today's Market
-- Prices" rail is visible to signed-out visitors, but market_prices is granted
-- only to `authenticated`. Expose a LIMITED, safe-column view to anon instead.
-- ============================================================================

-- SECURITY-REVIEW ★ PUBLIC DATA SURFACE ★
-- loamy_public_market_prices returns only the reference-price columns already
-- shown in the app (commodity, state, price, date, source note). It carries NO
-- personal data: entered_by / created_by / any user id are deliberately
-- excluded. Runs with the view owner's rights (security_invoker off) so anon can
-- read admin-entered prices without the base table being granted to anon. The
-- market_prices base table keeps its RLS (select only to authenticated) and is
-- NOT granted to anon. Any column added here is a public disclosure — review
-- before adding.
create or replace view public.loamy_public_market_prices
with (security_invoker = false) as
select
  mp.id,
  mp.commodity,
  mp.state,
  mp.price_per_kg,
  mp.recorded_date,
  mp.source_note,
  mp.created_at
from public.market_prices mp;

-- Public read: anon (signed-out visitors) + authenticated. Nothing else.
revoke all on public.loamy_public_market_prices from public;
grant select on public.loamy_public_market_prices to anon, authenticated;
