-- ---------------------------------------------------------------------------
-- loamy_profile_by_username: carry the seller's active listings.
--
-- Phase 3B needs a member's active listings on their public profile. The
-- listings themselves are ALREADY public -- loamy_public_listings and
-- loamy_public_seller_listings expose exactly these rows to anon -- so
-- including them here discloses nothing new.
--
-- The alternative was to return the profile's user id so the client could
-- filter loamy_public_seller_listings itself. That was rejected: the payload
-- deliberately carries no internal id, and adding one to save a join would
-- hand every anonymous visitor a stable identifier for every member.
--
-- Everything else is copied verbatim from 20260920100001, including the
-- refusal that reports a private or missing profile identically so the 404
-- cannot become an enumeration oracle.
-- ---------------------------------------------------------------------------

create or replace function public.loamy_profile_by_username(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_name    text := lower(trim(coalesce(p_username, '')));
  v_p       public.profiles%rowtype;
  v_viewer  uuid := auth.uid();
  v_roles   text[];
  v_out     jsonb;
begin
  select * into v_p from public.profiles where username = v_name;

  -- A profile that exists but may not be seen is reported exactly as one that
  -- does not exist. Otherwise the 404 becomes an enumeration oracle.
  if v_p.id is null
     or v_p.active is not true
     or v_p.profile_visibility = 'private'
     or (v_p.profile_visibility = 'members' and v_viewer is null)
  then
    if v_p.id is not null and (v_p.id = v_viewer or public.loamy_is_admin()) then
      null; -- the owner and admins always see it
    else
      return jsonb_build_object('found', false);
    end if;
  end if;

  select coalesce(array_agg(distinct r.role), '{}')
    into v_roles
  from public.user_platform_roles r
  where r.user_id = v_p.id and r.role <> 'bank';

  v_out := jsonb_build_object(
    'found', true,
    'username', v_p.username,
    'display_name', v_p.full_name,
    'headline', v_p.headline,
    'bio', v_p.bio,
    'avatar_url', v_p.avatar_url,
    'state', v_p.state,
    'category', v_p.category,
    'roles', to_jsonb(v_roles),
    'verified_badge', v_p.verified_badge,
    'member_since', v_p.created_at,
    'is_self', v_p.id = v_viewer,
    'visibility', v_p.profile_visibility);

  -- Commercial footprint: counts only, never the underlying rows.
  v_out := v_out || jsonb_build_object(
    'active_listings', (select count(*) from public.listings l
                        where l.seller_id = v_p.id and l.status = 'active'),
    'completed_transactions', (select count(*) from public.transactions t
                        where (t.buyer_id = v_p.id or t.seller_id = v_p.id)
                          and t.status = 'completed'),
    'commodities', (select coalesce(jsonb_agg(distinct l.commodity), '[]'::jsonb)
                        from public.listings l
                        where l.seller_id = v_p.id and l.status = 'active'),
    'states_served', (select coalesce(jsonb_agg(distinct l.state), '[]'::jsonb)
                        from public.listings l
                        where l.seller_id = v_p.id and l.status = 'active'),
    -- The same active listings the public marketplace already shows, capped
    -- so a prolific seller cannot turn one profile view into a bulk export.
    'listings', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', x.id, 'commodity', x.commodity,
                          'listing_type', x.listing_type,
                          'quantity', x.quantity, 'unit', x.unit,
                          'price_per_unit', x.price_per_unit,
                          'currency', x.currency,
                          'state', x.state, 'lga', x.lga,
                          'photos', x.photos, 'created_at', x.created_at)
                          order by x.created_at desc), '[]'::jsonb)
                 from (select l.* from public.loamy_public_seller_listings l
                        where l.seller_id = v_p.id
                        order by l.created_at desc limit 12) x));

  return v_out;
end;
$$;

grant execute on function public.loamy_profile_by_username(text) to authenticated, anon;
