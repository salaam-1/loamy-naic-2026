-- ============================================================================
-- Public marketplace read path. Anonymous visitors may browse ACTIVE listings
-- through a LIMITED, safe-column view — never the base tables.
-- ============================================================================

-- SECURITY-REVIEW ★ PUBLIC DATA SURFACE ★
-- loamy_public_listings is the ONLY thing granted to the `anon` role. It runs
-- with the view owner's rights (security_invoker off) so it can read
-- listings+profiles, but it returns a FIXED safe column set: no seller_id, no
-- phone, no email, no user id, no farm coordinates, no personal data. Contact
-- exchange still happens only post-acceptance via loamy_get_interest_contacts.
-- The base tables (listings, profiles, farms, …) keep their RLS and are NOT
-- granted to anon — verify anon cannot select them directly (scripts/
-- verify-public.mjs). Any new column added here is a public disclosure; review
-- before adding. Only ACTIVE listings are exposed.
create or replace view public.loamy_public_listings
with (security_invoker = false) as
select
  l.id,
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

-- Public read: anon (signed-out visitors) + authenticated. Nothing else.
revoke all on public.loamy_public_listings from public;
grant select on public.loamy_public_listings to anon, authenticated;

-- Defensive: the listing-photos bucket is public-read (created in Stage 3);
-- re-assert it here so a public listing's photos resolve. The PRIVATE
-- verification-evidence bucket is untouched and must stay private.
update storage.buckets set public = true where id = 'listing-photos';
