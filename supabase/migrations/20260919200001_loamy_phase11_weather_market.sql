-- ============================================================================
-- PHASE 11 — weather and market intelligence.
-- ----------------------------------------------------------------------------
-- Directive Parts 13 and 14.
--
-- Part 13: weather attaches to agricultural ENTITIES, not a generic widget.
-- Store provider metadata and timestamps; cache observations. Never fabricate.
--
-- Part 14: distinguish OBSERVED MARKET DATA from USER GENERATED DATA from
-- MODEL/AI INFERENCE. "Never present AI-generated estimates as confirmed
-- market prices."
--
-- The market price pipeline already exists and is good (ambassador
-- submissions, anomaly flagging, admin review, per-kg normalisation). What it
-- lacked was the LABEL: nothing in the schema said which kind of number a row
-- was. This adds that, and it is a column rather than a convention so a future
-- model-derived estimate cannot quietly enter through the same door.
--
-- SECURITY-REVIEW: weather rows are keyed to farm coordinates, so a weather
-- observation is a weak location disclosure. Rows tied to a farm are readable
-- by the farm's owner and admin only; region-level rows (no subject) are open
-- to signed-in members, because a state-level forecast reveals nothing.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Weather observations, attached to entities.
-- ----------------------------------------------------------------------------
create table if not exists public.weather_observations (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,

  -- What it is about. Null subject = a region-level reading.
  subject_type  text check (subject_type is null or subject_type in ('farm','region')),
  subject_id    uuid,
  state         text,
  lga           text,
  latitude      numeric check (latitude  is null or (latitude  between -90 and 90)),
  longitude     numeric check (longitude is null or (longitude between -180 and 180)),

  -- Forecast or an observation of what already happened.
  kind          text not null check (kind in ('observation','forecast')),
  observed_for  date not null,

  temp_min_c    numeric,
  temp_max_c    numeric,
  precip_mm     numeric check (precip_mm is null or precip_mm >= 0),
  precip_prob   numeric check (precip_prob is null or (precip_prob >= 0 and precip_prob <= 100)),
  humidity_pct  numeric check (humidity_pct is null or (humidity_pct >= 0 and humidity_pct <= 100)),
  wind_max_kph  numeric,
  weather_code  int,

  -- Part 13: provider metadata is mandatory, so a reading is always
  -- attributable and a provider swap is visible in the data.
  provider      text not null,
  provider_meta jsonb not null default '{}'::jsonb,
  fetched_at    timestamptz not null default now(),

  -- RAW PROVIDER DATA vs LOAMY INTERPRETATION, kept apart by column.
  -- Anything Loamy concluded goes in interpretation, never mixed into the
  -- measured fields above.
  interpretation text,

  created_at    timestamptz not null default now(),
  unique (subject_type, subject_id, observed_for, kind, provider)
);

create index if not exists weather_subject_idx on public.weather_observations (subject_type, subject_id, observed_for desc);
create index if not exists weather_region_idx  on public.weather_observations (state, observed_for desc);

alter table public.weather_observations enable row level security;

drop policy if exists "loamy_weather_select" on public.weather_observations;
create policy "loamy_weather_select"
  on public.weather_observations for select to authenticated
  using (
    -- Region-level readings are not sensitive.
    subject_type is null or subject_type = 'region'
    -- A farm's readings belong to its owner.
    or (subject_type = 'farm' and exists (
          select 1 from public.farms f where f.id = subject_id and f.owner_id = auth.uid()))
    or public.loamy_is_admin()
  );

drop trigger if exists loamy_weather_assign_ref on public.weather_observations;
create trigger loamy_weather_assign_ref
  before insert on public.weather_observations
  for each row execute function public.loamy_assign_ref('weather_observation', 'WX');

/**
 * Cache a reading. Callers are the farm owner (for their own farm) or admin.
 * Upserts on the natural key so re-fetching a forecast refreshes rather than
 * duplicating.
 *
 * `interpretation` is accepted but is stored in its own column and must never
 * be a promise: the directive is explicit that weather is decision support,
 * not a guarantee of yield.
 */
create or replace function public.loamy_record_weather(
  p_subject_type text,
  p_subject_id   uuid,
  p_kind         text,
  p_observed_for date,
  p_provider     text,
  p_temp_min_c   numeric default null,
  p_temp_max_c   numeric default null,
  p_precip_mm    numeric default null,
  p_precip_prob  numeric default null,
  p_humidity_pct numeric default null,
  p_wind_max_kph numeric default null,
  p_weather_code int default null,
  p_state        text default null,
  p_lga          text default null,
  p_provider_meta jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_lat numeric; v_lng numeric; v_state text; v_lga text;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if coalesce(trim(p_provider), '') = '' then
    raise exception 'A weather reading must name its provider.';
  end if;

  if p_subject_type = 'farm' then
    select f.latitude, f.longitude, f.state, f.lga into v_lat, v_lng, v_state, v_lga
    from public.farms f where f.id = p_subject_id and (f.owner_id = v_uid or public.loamy_is_admin());
    if v_state is null then
      raise exception 'You can only record weather for your own farm.';
    end if;
  else
    v_state := p_state; v_lga := p_lga;
  end if;

  insert into public.weather_observations (
    subject_type, subject_id, state, lga, latitude, longitude, kind, observed_for,
    temp_min_c, temp_max_c, precip_mm, precip_prob, humidity_pct, wind_max_kph,
    weather_code, provider, provider_meta
  ) values (
    p_subject_type, p_subject_id, v_state, v_lga, v_lat, v_lng, p_kind, p_observed_for,
    p_temp_min_c, p_temp_max_c, p_precip_mm, p_precip_prob, p_humidity_pct, p_wind_max_kph,
    p_weather_code, p_provider, coalesce(p_provider_meta, '{}'::jsonb)
  )
  on conflict (subject_type, subject_id, observed_for, kind, provider) do update
    set temp_min_c = excluded.temp_min_c, temp_max_c = excluded.temp_max_c,
        precip_mm = excluded.precip_mm, precip_prob = excluded.precip_prob,
        humidity_pct = excluded.humidity_pct, wind_max_kph = excluded.wind_max_kph,
        weather_code = excluded.weather_code, provider_meta = excluded.provider_meta,
        fetched_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.loamy_record_weather(text,uuid,text,date,text,numeric,numeric,numeric,numeric,numeric,numeric,int,text,text,jsonb) from public, anon;
grant execute on function public.loamy_record_weather(text,uuid,text,date,text,numeric,numeric,numeric,numeric,numeric,numeric,int,text,text,jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Market data: say what KIND of number each row is.
-- ----------------------------------------------------------------------------
-- Part 14's three categories, as a column. A convention would have let a
-- future model-derived estimate enter through the same door as a field
-- observation and be read as one.
alter table public.ambassador_price_submissions
  add column if not exists data_class text not null default 'observed'
    check (data_class in ('observed','user_generated','model_inference'));

alter table public.market_price_updates
  add column if not exists data_class text not null default 'observed'
    check (data_class in ('observed','user_generated','model_inference'));

comment on column public.ambassador_price_submissions.data_class is
  'observed = a field agent saw this price. user_generated = a member stated it. model_inference = Loamy estimated it. Never present the third as a confirmed price.';

-- Surface it on the identity-safe validated view so every consumer sees it.
drop view if exists public.loamy_validated_prices;

create view public.loamy_validated_prices
with (security_invoker = false) as
select
  s.id, s.commodity, cv.variety_name, cv.local_name_hausa, s.state, s.lga, s.market_name,
  s.price_low, s.price_high, s.unit, s.quantity, s.price_low_per_kg, s.price_high_per_kg,
  s.observed_date, s.note,
  s.data_class
from public.ambassador_price_submissions s
left join public.commodity_varieties cv on cv.id = s.variety_id
where s.status = 'validated';

revoke all on public.loamy_validated_prices from public;
grant select on public.loamy_validated_prices to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Regional price intelligence — trends and spreads, from observed data only.
-- ----------------------------------------------------------------------------
create or replace view public.loamy_market_intelligence as
select
  s.commodity,
  s.state,
  count(*)                                              as observation_count,
  round(min(s.price_low_per_kg), 2)                     as low_per_kg,
  round(max(s.price_high_per_kg), 2)                    as high_per_kg,
  round(avg((s.price_low_per_kg + s.price_high_per_kg) / 2), 2) as avg_per_kg,
  max(s.observed_date)                                  as latest_observation,
  -- Freshness is part of the answer: a stale median must not read as current.
  (current_date - max(s.observed_date))                 as days_since_latest
from public.ambassador_price_submissions s
where s.status = 'validated'
  and s.data_class = 'observed'          -- model output never enters the aggregate
  and s.observed_date >= current_date - 90
group by s.commodity, s.state;

alter view public.loamy_market_intelligence set (security_invoker = false);
revoke all on public.loamy_market_intelligence from public;
grant select on public.loamy_market_intelligence to anon, authenticated;

comment on view public.loamy_market_intelligence is
  'Regional price aggregates over the last 90 days, from OBSERVED field data only. days_since_latest is returned so a stale figure cannot be read as current.';
