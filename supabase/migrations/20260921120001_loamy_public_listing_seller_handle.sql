-- ============================================================================
-- PHASE 4 / SLICE 2 — the seller's public handle on a listing.
-- ----------------------------------------------------------------------------
-- Commodity detail must link the seller to their Phase 3B public profile at
-- /u/:username. The view carried `seller_display_name` but no handle, so the
-- name was plain text and the identity graph stopped at the listing.
--
-- WHAT IS AND IS NOT ADDED
--   The handle only, and only when the profile can actually be opened. A
--   `private` profile yields NULL, so the UI renders no link rather than a
--   link to a page that will correctly refuse to load.
--
--   No user id. The whole point of the Phase 3B payload is that an anonymous
--   visitor never receives a stable internal identifier, and putting one on
--   every marketplace row would undo that in the busiest place on the site.
--
--   `members` visibility DOES yield a handle: a signed-out visitor following
--   it gets the same not-found state as a handle that does not exist, which
--   is the designed behaviour and leaks nothing.
--
-- Everything else in the view is copied verbatim from 20260919150001.
-- ============================================================================

drop view if exists public.loamy_public_listings;

create view public.loamy_public_listings
with (security_invoker = false) as
select
  l.id,
  l.ref                      as listing_ref,
  l.commodity,
  l.listing_type,
  l.quantity_kg              as quantity,
  l.unit,
  l.price_per_unit,
  l.currency,
  l.state,
  l.lga,
  l.photos,
  l.quality_grade,
  l.description,
  l.available_from,
  l.created_at,
  p.full_name                as seller_display_name,
  p.category                 as seller_category,
  coalesce(p.verified_badge, false) as seller_verified,
  -- Null for a private profile: no link is better than a broken one.
  case when p.profile_visibility = 'private' then null else p.username end
                             as seller_username,

  -- Part 15: the distinction, as data.
  l.claim_basis,
  b.ref                      as batch_ref,
  coalesce(b.verification_status, 'unverified') as verification_status,
  coalesce(b.origin_traced, false)              as origin_traced,
  -- Origin at STATE granularity only. Never the farm, never coordinates.
  b.origin_state
from public.listings l
join public.profiles p on p.id = l.seller_id
left join public.commodity_batches b on b.id = l.batch_id
where l.status = 'active';

revoke all on public.loamy_public_listings from public;
grant select on public.loamy_public_listings to anon, authenticated;

comment on view public.loamy_public_listings is
  'Public marketplace surface. Carries verification_status/origin_traced/batch_ref so a buyer can tell verified stock from a declaration, and seller_username so the seller links to their public profile. Deliberately excludes the seller user id, farm identity, coordinates and current_location.';
