-- ============================================================================
-- BLOCK 3 (c) — the discovery engine.
-- ----------------------------------------------------------------------------
-- Deterministic, explainable ranking. No model, no learned weights, nothing
-- that cannot be read off the row it ranked.
--
-- Four rules it is built to obey:
--
--  1. EVERY result carries its reasons, and every reason carries its
--     evidence. A card may never say "Recommended for you" with nothing
--     behind it. If the engine cannot name a reason, the listing is not
--     recommended -- it is merely a match.
--
--  2. CHEAPEST IS NOT BEST. Price is one signal among match, quantity,
--     verification, distance and seller reliability, and the weights are
--     returned with the result so the ordering can be audited. A buyer who
--     disagrees can see exactly what they are disagreeing with.
--
--  3. NO FAKE SUPERLATIVES. "Lowest observed price" is emitted only with the
--     comparison population and the moment attached -- "among 23 matching
--     listings, now". There is no BEST PRICE badge, because there is no
--     defined population behind those words.
--
--  4. HIDDEN SUPPLY IS SURFACED, NOT SOLD. A Benue listing shown to a Lagos
--     buyer is flagged as outside their usual sourcing, together with the
--     honest caveat that distance and freight may erase the price advantage.
--     The engine never implies cheaper means better.
--
-- Seller signals are drawn only from what is already public, plus counts. No
-- private seller information crosses this boundary.
--
-- The whole ranking is ONE pass. The population count and the minimum price
-- are window functions over the full match set, so they survive the LIMIT and
-- the query is not run twice to obtain them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Transparent seller signals.
-- ----------------------------------------------------------------------------
/**
 * Deliberately NOT a score. The directive is explicit: no opaque seller
 * number. These are the individual facts, each with its own denominator, so a
 * buyer can weigh them themselves.
 *
 * Every figure is suppressed below the point where it means anything --
 * a 100% fulfilment rate over one delivery is not a fulfilment rate.
 */
create or replace function public.loamy_seller_signals(p_seller uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_completed int;
  v_delivered int;
  v_failed    int;
  v_active    int;
  v_rating    jsonb;
  v_verified  boolean;
  v_since     timestamptz;
  v_min_n     int := 5;
begin
  select coalesce(verified_badge, false), created_at
    into v_verified, v_since
  from public.profiles where id = p_seller;

  select count(*) filter (where status = 'completed'),
         count(*) filter (where fulfilment_state in ('delivered','received')),
         count(*) filter (where fulfilment_state = 'failed')
    into v_completed, v_delivered, v_failed
  from public.transactions where seller_id = p_seller;

  select count(*) into v_active
  from public.listings where seller_id = p_seller and status = 'active';

  v_rating := public.loamy_rating_summary(p_seller);

  return jsonb_build_object(
    'verified', coalesce(v_verified, false),
    'member_since', v_since,
    'completed_transactions', coalesce(v_completed, 0),
    'active_listings', coalesce(v_active, 0),
    'rating', v_rating,
    -- Below the threshold the rate is not reported at all, rather than
    -- reported with a caveat nobody reads.
    'fulfilment', case
      when coalesce(v_delivered, 0) + coalesce(v_failed, 0) >= v_min_n then
        jsonb_build_object(
          'available', true,
          'rate_percent', round(100.0 * v_delivered / nullif(v_delivered + v_failed, 0), 1),
          'sample', v_delivered + v_failed)
      else
        jsonb_build_object('available', false, 'reason', 'too_few_deliveries',
                           'sample', coalesce(v_delivered, 0) + coalesce(v_failed, 0),
                           'minimum', v_min_n)
      end);
end;
$$;

grant execute on function public.loamy_seller_signals(uuid) to authenticated, anon;

comment on function public.loamy_seller_signals(uuid) is
  'BLOCK 3. Individual transparent signals, never an opaque score. Rates are withheld below a meaningful sample.';

-- ----------------------------------------------------------------------------
-- 2. Discovery.
-- ----------------------------------------------------------------------------
/**
 * p_view:
 *   'buy'         what can I buy right now  -- availability weighted
 *   'source'      where can I source this   -- quantity and reliability weighted
 *   'opportunity' where is supply I am not looking at -- hidden supply first
 *
 * The three views change WEIGHTS, not truth. The same listing shows the same
 * facts in all three; only the ordering and the emphasis move.
 */
create or replace function public.loamy_discover_supply(
  p_commodity        text default null,
  p_quantity         numeric default null,
  p_unit             text default null,
  p_delivery_state   text default null,
  p_reference_market text default null,
  p_view             text default 'buy',
  p_limit            int default 20,
  p_offset           int default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_prefs    public.buyer_preferences%rowtype;
  v_market   text;
  v_view     text := coalesce(nullif(trim(coalesce(p_view, '')), ''), 'buy');
  v_limit    int  := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset   int  := greatest(0, coalesce(p_offset, 0));
  v_rows     jsonb;
  v_pop      int;
  v_familiar text[];
  v_weights  jsonb;
  v_req_kg   numeric;
  v_bought   text[];
begin
  if v_uid is null then
    return jsonb_build_object('error', 'not_signed_in');
  end if;
  if v_view not in ('buy','source','opportunity') then
    return jsonb_build_object('error', 'unknown_view', 'view', p_view,
      'allowed', jsonb_build_array('buy','source','opportunity'));
  end if;

  select * into v_prefs from public.buyer_preferences where user_id = v_uid;

  -- The market this buyer reasons in. Never defaulted to "Nigeria".
  v_market := coalesce(nullif(trim(coalesce(p_reference_market, '')), ''),
                       v_prefs.reference_market);

  -- The request, normalised to kg once.
  v_req_kg := case when p_quantity is null then null
                   else p_quantity * coalesce(public.loamy_unit_kg(p_unit, p_commodity), 1) end;

  -- States this buyer already looks at: declared, plus where they have
  -- actually been active. Anything outside is candidate hidden supply.
  select array(
    select distinct s from (
      select unnest(coalesce(v_prefs.states, '{}')) as s
      union
      select unnest(coalesce(v_prefs.delivery_states, '{}'))
      union
      select e.state from public.discovery_events e
       where e.actor_id = v_uid and e.state is not null
         and e.occurred_at > now() - interval '180 days'
       group by e.state having count(*) >= 3
    ) t where s is not null
  ) into v_familiar;

  -- Commodities this buyer has actually completed a deal on. Gathered once,
  -- rather than re-queried per row inside the reason list.
  select array(
    select distinct e.commodity from public.discovery_events e
     where e.actor_id = v_uid and e.event_type = 'complete_transaction'
       and e.commodity is not null
  ) into v_bought;

  -- Weights, returned with the result so the ordering can be audited.
  v_weights := case v_view
    when 'buy' then jsonb_build_object(
      'commodity_match', 30, 'quantity_match', 20, 'price', 15,
      'verification', 15, 'proximity', 10, 'seller_reliability', 10, 'hidden_supply', 0)
    when 'source' then jsonb_build_object(
      'commodity_match', 25, 'quantity_match', 30, 'price', 10,
      'verification', 15, 'proximity', 5, 'seller_reliability', 15, 'hidden_supply', 0)
    else jsonb_build_object(
      'commodity_match', 20, 'quantity_match', 15, 'price', 20,
      'verification', 10, 'proximity', 0, 'seller_reliability', 10, 'hidden_supply', 25)
  end;

  with base as (
    select l.id, l.commodity, l.quantity_kg, l.unit, l.price_per_unit, l.currency,
           l.state, l.lga, l.photos, l.created_at, l.seller_id,
           p.full_name as seller_name,
           coalesce(p.verified_badge, false) as seller_verified,
           case when p.profile_visibility <> 'private' then p.username end as seller_username,
           public.loamy_unit_kg(l.unit, l.commodity) as kg_per_unit
    from public.listings l
    join public.profiles p on p.id = l.seller_id
    where l.status = 'active'
      and l.listing_type = 'commodity'
      and (p_commodity is null or l.commodity = p_commodity)
      and (v_prefs.verified_sellers_only is not true or coalesce(p.verified_badge, false))
      and p.active is true
  ),
  priced as (
    select b.*,
           case when b.kg_per_unit is not null then b.price_per_unit / b.kg_per_unit end as price_per_kg,
           case when b.kg_per_unit is not null then b.quantity_kg * b.kg_per_unit end as total_kg,
           -- Resolved once per row, not once per reason.
           case when v_market is null
                then jsonb_build_object('comparable', false, 'reason', 'no_market_specified')
                else public.loamy_price_comparison(b.price_per_unit, b.unit, b.commodity, v_market)
           end as comparison,
           (select count(*) from public.transactions t
             where t.seller_id = b.seller_id and t.status = 'completed') as seller_completed
    from base b
  ),
  scored as (
    select pr.*,
           -- Commodity match: exact, or nothing. "Close enough" on a
           -- commodity is a different crop.
           (case when p_commodity is null or pr.commodity = p_commodity then 1.0 else 0.0 end) as s_commodity,
           -- Can this seller actually cover the request?
           (case
              when v_req_kg is null then 0.6
              when pr.total_kg is null then 0.3
              when pr.total_kg >= v_req_kg then 1.0
              else greatest(0.0, pr.total_kg / nullif(v_req_kg, 0))
            end) as s_quantity,
           (case when pr.seller_verified then 1.0 else 0.0 end) as s_verified,
           -- Proximity: Loamy has no road distances, so it does not pretend
           -- to. Same state or not is what is actually known.
           (case
              when p_delivery_state is null then 0.5
              when pr.state = p_delivery_state then 1.0
              else 0.25
            end) as s_proximity,
           (case when pr.state = any (coalesce(v_familiar, '{}')) then 0.0 else 1.0 end) as s_hidden,
           -- Capped: a seller with 40 deals is not four times better than
           -- one with 10.
           least(1.0, (select count(*) from public.transactions t
                        where t.seller_id = pr.seller_id and t.status = 'completed') / 10.0) as s_reliability
    from priced pr
  ),
  ranked as (
    select s.*,
           -- Price score is RELATIVE TO THE MATCH SET, and is only part of
           -- the total. Cheapest does not win by itself.
           case when s.price_per_kg is null then 0.5
                else 1.0 - coalesce(
                  (s.price_per_kg - min(s.price_per_kg) over ())
                  / nullif(max(s.price_per_kg) over () - min(s.price_per_kg) over (), 0), 0)
           end as s_price,
           -- Window functions over the FULL match set: they survive the
           -- LIMIT below, so the population is never the page size.
           count(*) over ()               as population,
           min(s.price_per_kg) over ()    as lowest_per_kg
    from scored s
  ),
  final as (
    select r.*,
           round((
             (v_weights->>'commodity_match')::numeric    * r.s_commodity +
             (v_weights->>'quantity_match')::numeric     * r.s_quantity +
             (v_weights->>'price')::numeric              * r.s_price +
             (v_weights->>'verification')::numeric       * r.s_verified +
             (v_weights->>'proximity')::numeric          * r.s_proximity +
             (v_weights->>'seller_reliability')::numeric * r.s_reliability +
             (v_weights->>'hidden_supply')::numeric      * r.s_hidden
           ), 2) as score
    from ranked r
  ),
  page as (
    select * from final order by score desc, created_at desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb), max(population)
    into v_rows, v_pop
  from (
    select f.population,
           row_number() over (order by f.score desc, f.created_at desc) as ord,
           jsonb_build_object(
             'listing_id', f.id,
             'commodity', f.commodity,
             'quantity', f.quantity_kg,
             'unit', f.unit,
             'total_kg', f.total_kg,
             'price_per_unit', f.price_per_unit,
             'price_per_kg', round(f.price_per_kg, 4),
             'currency', f.currency,
             'state', f.state,
             'lga', f.lga,
             'photos', to_jsonb(f.photos),
             'created_at', f.created_at,

             -- Only what is already public about a seller.
             'seller', jsonb_build_object(
               'display_name', f.seller_name,
               'username', f.seller_username,
               'verified', f.seller_verified,
               'completed_transactions', f.seller_completed),

             'score', f.score,
             'score_breakdown', jsonb_build_object(
               'commodity_match', f.s_commodity,
               'quantity_match', round(f.s_quantity, 3),
               'price', round(f.s_price, 3),
               'verification', f.s_verified,
               'proximity', f.s_proximity,
               'seller_reliability', round(f.s_reliability, 3),
               'hidden_supply', f.s_hidden),

             'price_comparison', f.comparison,

             'hidden_supply', jsonb_build_object(
               'outside_your_usual_sourcing', f.s_hidden = 1.0,
               'caveat', case when f.s_hidden = 1.0
                 then 'Outside the states you usually buy from. Check freight and verification before comparing on price alone.'
               end),

             -- The superlative, ONLY with its population and its moment.
             'lowest_observed', case
               when f.price_per_kg is not null and f.lowest_per_kg is not null
                    and f.price_per_kg <= f.lowest_per_kg
               then jsonb_build_object(
                 'among', f.population, 'as_of', now(),
                 'label', format('Lowest observed price among %s matching listing(s)', f.population))
             end,

             -- Reasons. Each carries its evidence; a reason with none is not
             -- emitted, so a card can never say "Recommended for you" alone.
             'reasons', (
               select coalesce(jsonb_agg(r), '[]'::jsonb) from (
                 select jsonb_build_object('code','commodity_match',
                          'label', format('Matches your search for %s', f.commodity)) as r
                 where p_commodity is not null and f.commodity = p_commodity
                 union all
                 select jsonb_build_object('code','quantity_covers_request',
                          'label', format('Covers your requested quantity — %s %s available',
                                          f.quantity_kg, f.unit))
                 where v_req_kg is not null and f.s_quantity >= 1.0
                 union all
                 select jsonb_build_object('code','below_reference',
                          'label', f.comparison->>'label')
                 where (f.comparison->>'comparable')::boolean is true
                   and f.comparison->>'direction' = 'below'
                 union all
                 select jsonb_build_object('code','seller_verified', 'label','Verified seller')
                 where f.seller_verified
                 union all
                 select jsonb_build_object('code','in_delivery_state',
                          'label', format('Located in %s, your delivery state', f.state))
                 where p_delivery_state is not null and f.state = p_delivery_state
                 union all
                 select jsonb_build_object('code','you_buy_this',
                          'label', format('You have bought %s on Loamy before', f.commodity))
                 where f.commodity = any (coalesce(v_bought, '{}'))
                 union all
                 select jsonb_build_object('code','hidden_supply',
                          'label', format('Supply in %s, outside the states you usually search', f.state))
                 where f.s_hidden = 1.0 and array_length(coalesce(v_familiar, '{}'), 1) > 0
                 union all
                 select jsonb_build_object('code','established_seller',
                          'label', format('%s completed transactions on Loamy', f.seller_completed))
                 where f.seller_completed >= 5
               ) reasons(r)
             )
           ) as item
    from page f
  ) s;

  return jsonb_build_object(
    'view', v_view,
    'weights', v_weights,
    'reference_market', v_market,
    'reference_market_note', case when v_market is null
      then 'No reference market selected, so no price comparison is shown. Loamy has no national benchmark.' end,
    'matching_listings', coalesce(v_pop, 0),
    'returned', jsonb_array_length(v_rows),
    'familiar_states', to_jsonb(coalesce(v_familiar, '{}')),
    'generated_at', now(),
    'items', v_rows);
end;
$$;

revoke all on function public.loamy_discover_supply(
  text,numeric,text,text,text,text,int,int) from public, anon;
grant execute on function public.loamy_discover_supply(
  text,numeric,text,text,text,text,int,int) to authenticated;

comment on function public.loamy_discover_supply(text,numeric,text,text,text,text,int,int) is
  'BLOCK 3. Deterministic, explainable discovery. Returns its own weights and a per-listing score breakdown so the ordering can be audited. Superlatives carry their comparison population. One pass: population and minimum price are windows over the full match set.';
