-- ============================================================================
-- Public suppliers directory (Stage 5). Sellers are meant to be DISCOVERABLE,
-- so we expose an aggregate of sellers who have active listings, plus a
-- seller-scoped listings view for their storefront.
--
-- The original loamy_public_listings view is left UNCHANGED (verify-public.mjs
-- still holds). These new views expose seller_id (a UUID — not PII) to enable
-- storefront links; contact details (phone/email) remain gated behind
-- acceptance exactly as before. No new PII is disclosed.
-- ============================================================================

-- SECURITY-REVIEW ★ PUBLIC DATA SURFACE ★
-- loamy_public_suppliers: one row per seller with ≥1 ACTIVE listing. Safe
-- columns only (display name, category, state, verified flag, listing count).
-- No phone/email/digital_id/address.
create or replace view public.loamy_public_suppliers
with (security_invoker = false) as
select
  p.id                              as seller_id,
  p.full_name                       as seller_display_name,
  p.category                        as seller_category,
  p.state                           as seller_state,
  coalesce(p.verified_badge, false) as seller_verified,
  count(l.id)                       as listing_count
from public.profiles p
join public.listings l on l.seller_id = p.id and l.status = 'active'
group by p.id, p.full_name, p.category, p.state, p.verified_badge;

revoke all on public.loamy_public_suppliers from public;
grant select on public.loamy_public_suppliers to anon, authenticated;

-- SECURITY-REVIEW ★ PUBLIC DATA SURFACE ★
-- loamy_public_seller_listings: identical safe columns to loamy_public_listings
-- but WITH seller_id, so a supplier storefront can list that seller's active
-- listings. Same gating as the base public view.
create or replace view public.loamy_public_seller_listings
with (security_invoker = false) as
select
  l.id,
  l.seller_id,
  l.commodity,
  l.listing_type,
  l.quantity_kg              as quantity,
  l.unit,
  l.price_per_unit,
  l.currency,
  l.state,
  l.lga,
  l.photos,
  l.created_at,
  p.full_name                as seller_display_name,
  p.category                 as seller_category,
  coalesce(p.verified_badge, false) as seller_verified
from public.listings l
join public.profiles p on p.id = l.seller_id
where l.status = 'active';

revoke all on public.loamy_public_seller_listings from public;
grant select on public.loamy_public_seller_listings to anon, authenticated;
