-- ============================================================================
-- BLOCK 3 (a) — the behavioural foundation.
-- ----------------------------------------------------------------------------
-- The directive is explicit that the data foundation comes BEFORE any
-- recommendation logic, and that statistical models come after both. This
-- migration is the foundation and nothing else: it recommends nothing.
--
-- Two decisions that constrain everything built on top:
--
--   1. A member can read ONLY THEIR OWN events. Not aggregated-but-joinable,
--      not "anonymised". A seller who can see which buyers viewed their
--      listing and when has been handed a targeting list, and a buyer who can
--      see a rival's cart has been handed their sourcing strategy.
--
--   2. Events are APPEND-ONLY and the actor is taken from auth.uid(), never
--      from the payload. Otherwise a member can manufacture a history --
--      500 views of their own listing -- and any ranking built on this data
--      becomes a self-service dial. The directive calls this out as
--      "behaviour integrity"; it is enforced here, not in the UI.
--
-- Deliberately NOT collected: IP address, precise device fingerprint, exact
-- geolocation, referrer URL. None of them improve a commodity recommendation
-- enough to justify holding them.
-- ============================================================================

create table if not exists public.discovery_events (
  id          uuid primary key default gen_random_uuid(),

  -- WHO. Defaulted and enforced, never supplied.
  actor_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,

  -- WHAT.
  event_type  text not null check (event_type in (
    'search', 'view_listing', 'view_seller',
    'save_listing', 'unsave_listing',
    'add_to_cart', 'remove_from_cart',
    'start_checkout', 'abandon_checkout',
    'enquire', 'contact_seller',
    'request_verification', 'request_financing',
    'complete_transaction',
    'reject_listing', 'report_listing'
  )),

  -- ON WHAT. Nullable: a search has no object.
  object_type text check (object_type is null or object_type in (
    'listing', 'seller', 'batch', 'transaction', 'buy_request', 'search'
  )),
  object_id   uuid,

  -- CONTEXT — the commercial shape of the moment, which is what a
  -- recommendation actually needs. Not who the person is.
  commodity   text,
  state       text,
  quantity    numeric check (quantity is null or quantity >= 0),
  unit        text,
  price_per_unit numeric check (price_per_unit is null or price_per_unit >= 0),

  -- A search's terms, kept separate from free metadata so it can be indexed
  -- and, later, aged out on its own schedule.
  search_terms text check (search_terms is null or length(search_terms) <= 200),

  -- WHERE FROM. A coarse surface name, not a URL and not a referrer.
  source      text not null default 'app' check (source in (
    'app', 'marketplace', 'search', 'recommendation', 'seller_profile',
    'cart', 'checkout', 'trace', 'copilot', 'buy_request'
  )),

  -- A client-generated opaque session id, so a journey can be reconstructed
  -- without identifying a device. Not a cookie, not a fingerprint.
  session_ref text check (session_ref is null or session_ref ~ '^[a-z0-9]{6,40}$'),

  -- Anything else, bounded. No PII belongs here and the guard below refuses
  -- the obvious attempts.
  metadata    jsonb not null default '{}'::jsonb,

  occurred_at timestamptz not null default now()
);

create index if not exists discovery_events_actor_idx
  on public.discovery_events (actor_id, occurred_at desc);
create index if not exists discovery_events_type_idx
  on public.discovery_events (event_type, occurred_at desc);
create index if not exists discovery_events_object_idx
  on public.discovery_events (object_type, object_id, occurred_at desc);
create index if not exists discovery_events_commodity_idx
  on public.discovery_events (commodity, occurred_at desc)
  where commodity is not null;

alter table public.discovery_events enable row level security;

comment on table public.discovery_events is
  'BLOCK 3. Append-only behavioural log. A member reads only their own rows. The actor is taken from auth.uid(), never from the payload, so a history cannot be manufactured.';

-- ----------------------------------------------------------------------------
-- 1. Your own events, and nobody else's.
-- ----------------------------------------------------------------------------
drop policy if exists discovery_events_own on public.discovery_events;
create policy discovery_events_own on public.discovery_events
  for select to authenticated
  using (actor_id = auth.uid() or public.loamy_is_admin());

-- Inserts go through loamy_record_discovery_event. There is no update or
-- delete policy at all: a behavioural log that can be rewritten is not one.
drop policy if exists discovery_events_insert_self on public.discovery_events;
create policy discovery_events_insert_self on public.discovery_events
  for insert to authenticated
  with check (actor_id = auth.uid());

create or replace function public.loamy_discovery_event_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare k text;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'The discovery log is append-only.';
  end if;

  -- The actor is who you are, whatever the payload said.
  new.actor_id := auth.uid();
  if new.actor_id is null then raise exception 'Not signed in.'; end if;

  -- Bound the free-form blob, and refuse the keys people reach for first.
  if length(new.metadata::text) > 2000 then
    raise exception 'Event metadata is too large.';
  end if;
  foreach k in array array['email','phone','bvn','nin','password','token','ip','address']
  loop
    if new.metadata ? k then
      raise exception 'Event metadata must not carry %.', k;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists loamy_discovery_events_guard on public.discovery_events;
create trigger loamy_discovery_events_guard
  before insert or update or delete on public.discovery_events
  for each row execute function public.loamy_discovery_event_guard();

-- ----------------------------------------------------------------------------
-- 2. Recording one.
-- ----------------------------------------------------------------------------
/**
 * Never raises on a bad event. Telemetry that can break a page is worse than
 * telemetry that silently drops a row, so this returns a result instead.
 */
create or replace function public.loamy_record_discovery_event(
  p_event_type  text,
  p_object_type text default null,
  p_object_id   uuid default null,
  p_commodity   text default null,
  p_state       text default null,
  p_quantity    numeric default null,
  p_unit        text default null,
  p_price_per_unit numeric default null,
  p_search_terms text default null,
  p_source      text default 'app',
  p_session_ref text default null,
  p_metadata    jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('recorded', false, 'reason', 'not_signed_in');
  end if;

  insert into public.discovery_events (
    event_type, object_type, object_id, commodity, state, quantity, unit,
    price_per_unit, search_terms, source, session_ref, metadata)
  values (
    p_event_type, p_object_type, p_object_id, p_commodity, p_state, p_quantity,
    p_unit, p_price_per_unit,
    nullif(left(trim(coalesce(p_search_terms, '')), 200), ''),
    coalesce(p_source, 'app'), p_session_ref, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  return jsonb_build_object('recorded', true, 'event_id', v_id);
exception
  when others then
    return jsonb_build_object('recorded', false, 'reason', 'rejected',
                              'detail', sqlerrm);
end;
$$;

revoke all on function public.loamy_record_discovery_event(
  text,text,uuid,text,text,numeric,text,numeric,text,text,text,jsonb) from public, anon;
grant execute on function public.loamy_record_discovery_event(
  text,text,uuid,text,text,numeric,text,numeric,text,text,text,jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Buyer preferences — explicit first, inferred later.
-- ----------------------------------------------------------------------------
-- The directive is clear about the order: explicit settings now, behavioural
-- inference later. So this table holds what the buyer SAID, and the inferred
-- view below is kept separate and labelled, so the two are never confused
-- when a recommendation has to explain itself.
create table if not exists public.buyer_preferences (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  commodities   text[] not null default '{}',
  states        text[] not null default '{}',
  delivery_states text[] not null default '{}',
  typical_quantity_min numeric check (typical_quantity_min is null or typical_quantity_min >= 0),
  typical_quantity_max numeric check (typical_quantity_max is null or typical_quantity_max >= 0),
  typical_unit  text,
  price_ceiling numeric check (price_ceiling is null or price_ceiling >= 0),
  preferred_sellers uuid[] not null default '{}',
  -- The market whose price this buyer reasons in. There is no national
  -- benchmark, so a comparison needs a named market or it does not happen.
  reference_market text,
  verified_sellers_only boolean not null default false,
  updated_at    timestamptz not null default now(),

  constraint buyer_preferences_quantity_range
    check (typical_quantity_min is null or typical_quantity_max is null
           or typical_quantity_max >= typical_quantity_min)
);

alter table public.buyer_preferences enable row level security;

drop policy if exists buyer_preferences_own on public.buyer_preferences;
create policy buyer_preferences_own on public.buyer_preferences
  for all to authenticated
  using (user_id = auth.uid() or public.loamy_is_admin())
  with check (user_id = auth.uid());

comment on table public.buyer_preferences is
  'BLOCK 3. What the buyer SAID they want. Inferred preferences are computed separately and labelled as inferred, so a recommendation can always say which it used.';

-- ----------------------------------------------------------------------------
-- 4. Inferred preferences — derived, never stored as if declared.
-- ----------------------------------------------------------------------------
/**
 * What this buyer's own behaviour suggests, with the EVIDENCE COUNT attached
 * to every element. A caller that wants to say "because you regularly buy
 * maize" can check that 'regularly' is more than once.
 *
 * Reads only the caller's own events.
 */
create or replace function public.loamy_inferred_preferences(p_days int default 180)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_since timestamptz;
  v_comm  jsonb;
  v_state jsonb;
  v_qty   numeric;
  v_n     int;
begin
  if v_uid is null then
    return jsonb_build_object('available', false, 'reason', 'not_signed_in');
  end if;
  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 180), 730)));

  select count(*) into v_n
  from public.discovery_events
  where actor_id = v_uid and occurred_at >= v_since;

  -- Weighted: an intent to buy says more than a glance.
  select coalesce(jsonb_agg(x order by (x->>'weight')::numeric desc), '[]'::jsonb)
    into v_comm
  from (
    select jsonb_build_object(
             'commodity', commodity,
             'events', count(*),
             'weight', sum(case event_type
                             when 'complete_transaction' then 10
                             when 'request_financing' then 6
                             when 'start_checkout' then 5
                             when 'add_to_cart' then 4
                             when 'enquire' then 3
                             when 'save_listing' then 2
                             when 'reject_listing' then -2
                             else 1 end)) as x
    from public.discovery_events
    where actor_id = v_uid and occurred_at >= v_since and commodity is not null
    group by commodity
    having sum(case event_type
                 when 'complete_transaction' then 10
                 when 'request_financing' then 6
                 when 'start_checkout' then 5
                 when 'add_to_cart' then 4
                 when 'enquire' then 3
                 when 'save_listing' then 2
                 when 'reject_listing' then -2
                 else 1 end) > 0
    limit 10
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('state', state, 'events', n)
                            order by n desc), '[]'::jsonb)
    into v_state
  from (
    select state, count(*) as n
    from public.discovery_events
    where actor_id = v_uid and occurred_at >= v_since and state is not null
    group by state order by count(*) desc limit 10
  ) s;

  select percentile_cont(0.5) within group (order by quantity)
    into v_qty
  from public.discovery_events
  where actor_id = v_uid and occurred_at >= v_since and quantity is not null and quantity > 0;

  return jsonb_build_object(
    'available', true,
    'basis', 'inferred_from_your_activity',
    'window_days', p_days,
    'event_count', v_n,
    -- Below this, inference is noise. The caller is told rather than left to
    -- guess from a short list.
    'confident', v_n >= 10,
    'commodities', v_comm,
    'states', v_state,
    'median_quantity', v_qty);
end;
$$;

revoke all on function public.loamy_inferred_preferences(int) from public, anon;
grant execute on function public.loamy_inferred_preferences(int) to authenticated;

comment on function public.loamy_inferred_preferences(int) is
  'BLOCK 3. Reads ONLY the caller''s own events. Returns confident=false below 10 events, so a caller never presents noise as a preference.';
