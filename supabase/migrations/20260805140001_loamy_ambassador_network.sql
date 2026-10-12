-- ============================================================================
-- Loamy · Ambassador Price Network (Co-pilot v2, Part B).
-- Growth Partners (ambassadors) submit daily local-market price RANGES with
-- variety + local unit. The server normalises to ₦/kg via an admin-maintained
-- commodity_units lookup (bag weights differ by commodity/region — NEVER
-- hardcoded), runs anomaly checks (flag, don't reject), and accrues a tracked
-- incentive on validated rows. End users see validated MARKET-LEVEL prices with
-- NO submitter identity. NO livestock.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) commodity_varieties — canonical commodity → local variety + Hausa name.
-- ---------------------------------------------------------------------------
create table if not exists public.commodity_varieties (
  id                 uuid primary key default gen_random_uuid(),
  commodity          text not null,
  variety_name       text not null,
  local_name_hausa   text,
  typical_unit       text,
  typical_kg_per_unit numeric,
  active             boolean not null default true,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists commodity_varieties_idx on public.commodity_varieties (commodity, active);

alter table public.commodity_varieties enable row level security;
drop policy if exists "loamy_varieties_select" on public.commodity_varieties;
create policy "loamy_varieties_select" on public.commodity_varieties for select to authenticated using (active or public.loamy_is_admin());
drop policy if exists "loamy_varieties_write_admin" on public.commodity_varieties;
create policy "loamy_varieties_write_admin" on public.commodity_varieties for all to authenticated using (public.loamy_is_admin()) with check (public.loamy_is_admin());

-- Seed from the Bakori feed (representative; admins extend). NO livestock.
insert into public.commodity_varieties (commodity, variety_name, local_name_hausa) values
  ('Maize','White maize','Farar masara'), ('Maize','Kabomo maize','Kabomo'), ('Maize','Red maize','Jar masara'),
  ('Millet','Dauro millet','Dauro'), ('Millet','Gero millet','Gero'),
  ('Cowpea','White beans','Farin wake'), ('Cowpea','Dan Amarya beans','Dan Amarya'),
  ('Soybeans','Dan Bulagi soybeans','Dan Bulagi'),
  ('Rice','Jamila rice','Jamila'), ('Rice','Faro rice','Faro'), ('Rice','Yar Yarima rice','Yar Yarima'),
  ('Rice','Dakuma rice','Dakuma'), ('Rice','Tuwo rice','Tuwo'), ('Rice','Samfarera rice','Samfarera'),
  ('Wheat','Local wheat','Alkama ta gida'), ('Wheat','Imported wheat','Alkama ta waje'),
  ('Groundnuts','Groundnuts','Gyada'),
  ('Bambara','Bambara nut (Kalwa)','Kalwa'),
  ('Okra','Okra (Kubewa)','Kubewa'),
  ('Tiger Nut','Small tiger nut','Karamin aya'), ('Tiger Nut','Large tiger nut','Babban aya'),
  ('Cassava','Cassava (Dan Wake)','Dan Wake'),
  ('Pepper','Dan Miyare pepper','Dan Miyare'), ('Pepper','Dan Zagade pepper','Dan Zagade'),
  ('Pepper','Dan Minci pepper','Dan Minci'), ('Pepper','Daushe pepper','Daushe'),
  ('Pepper','Dan Legas pepper','Dan Legas'), ('Pepper','Tarugu pepper','Tarugu'), ('Pepper','Shambo pepper','Shambo'),
  ('Onion','Onions','Albasa'),
  ('Tomato','Kauda tomatoes','Kauda')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2) commodity_units — local unit → kg equivalent (region-aware). A bag of
--    onions is not a bag of maize. Admin-editable.
-- ---------------------------------------------------------------------------
create table if not exists public.commodity_units (
  id            uuid primary key default gen_random_uuid(),
  commodity     text,               -- null = applies to any commodity
  unit_name     text not null,
  kg_equivalent numeric not null check (kg_equivalent > 0),
  region        text,               -- null = any region
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists commodity_units_idx on public.commodity_units (lower(unit_name), commodity);

alter table public.commodity_units enable row level security;
drop policy if exists "loamy_units_select" on public.commodity_units;
create policy "loamy_units_select" on public.commodity_units for select to authenticated using (active or public.loamy_is_admin());
drop policy if exists "loamy_units_write_admin" on public.commodity_units;
create policy "loamy_units_write_admin" on public.commodity_units for all to authenticated using (public.loamy_is_admin()) with check (public.loamy_is_admin());

-- Sensible starter conversions (admin refines per commodity/region).
insert into public.commodity_units (commodity, unit_name, kg_equivalent) values
  (null,'kg',1), (null,'100kg',100), (null,'50kg',50), (null,'50kg bag',50), (null,'25kg',25),
  (null,'bag',100), (null,'mudu',2.5), (null,'tiya',1.2), (null,'basket',12), (null,'crate',25),
  ('Onion','bag',90), ('Onion','basket',10), ('Tomato','basket',12), ('Tomato','crate',25),
  ('Pepper','bag',85), ('Pepper','basket',10)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3) price_validation_config — admin-tunable thresholds (NOT hardcoded).
-- ---------------------------------------------------------------------------
create table if not exists public.price_validation_config (
  id             integer primary key default 1 check (id = 1),
  market_dev_pct numeric not null default 40,   -- vs same market 7-day median
  state_dev_pct  numeric not null default 50,   -- vs other markets in state
  submission_rate numeric not null default 0,   -- ₦ accrued per validated submission
  updated_at     timestamptz not null default now()
);
insert into public.price_validation_config (id) values (1) on conflict do nothing;

alter table public.price_validation_config enable row level security;
drop policy if exists "loamy_pvc_select" on public.price_validation_config;
create policy "loamy_pvc_select" on public.price_validation_config for select to authenticated using (true);
drop policy if exists "loamy_pvc_write_admin" on public.price_validation_config;
create policy "loamy_pvc_write_admin" on public.price_validation_config for all to authenticated using (public.loamy_is_admin()) with check (public.loamy_is_admin());

-- ---------------------------------------------------------------------------
-- 4) ambassador_price_submissions — the field data. Written ONLY via the
--    security-definer RPC (so normalisation + validation always run).
-- ---------------------------------------------------------------------------
create table if not exists public.ambassador_price_submissions (
  id                         uuid primary key default gen_random_uuid(),
  ambassador_id              uuid not null references public.profiles (id) on delete cascade,
  state                      text not null,
  lga                        text,
  market_name                text not null,
  commodity                  text not null,
  variety_id                 uuid references public.commodity_varieties (id) on delete set null,
  price_low                  numeric not null check (price_low >= 0),
  price_high                 numeric not null check (price_high >= price_low),
  unit                       text not null,
  kg_equivalent_at_submission numeric not null check (kg_equivalent_at_submission > 0),
  price_low_per_kg           numeric not null,
  price_high_per_kg          numeric not null,
  observed_date              date not null,
  note                       text,
  photo_url                  text,
  submitted_at               timestamptz not null default now(),
  status                     text not null default 'pending' check (status in ('pending','validated','flagged','rejected')),
  flags                      text[] not null default '{}',
  validated_by               uuid references public.profiles (id) on delete set null,
  validation_note            text
);
create index if not exists aps_market_idx on public.ambassador_price_submissions (commodity, market_name, observed_date desc);
create index if not exists aps_state_idx on public.ambassador_price_submissions (commodity, state, observed_date desc);
create index if not exists aps_amb_idx on public.ambassador_price_submissions (ambassador_id, submitted_at desc);
create index if not exists aps_status_idx on public.ambassador_price_submissions (status, submitted_at desc);

-- SECURITY-REVIEW: submitter identity must NOT leak to end users. Only the
-- ambassador (own rows) and admins can read this base table. Everyone else sees
-- validated rows through loamy_validated_prices, which has NO ambassador_id /
-- validated_by. There is no client INSERT/UPDATE policy — all writes go through
-- the security-definer RPCs (loamy_submit_ambassador_price / _review_).
alter table public.ambassador_price_submissions enable row level security;

drop policy if exists "loamy_aps_select_own_admin" on public.ambassador_price_submissions;
create policy "loamy_aps_select_own_admin"
  on public.ambassador_price_submissions for select to authenticated
  using (ambassador_id = auth.uid() or public.loamy_is_admin());

-- Identity-safe view of VALIDATED prices for the marketplace + Co-pilot.
create or replace view public.loamy_validated_prices
with (security_invoker = false) as
select
  s.id, s.commodity, cv.variety_name, cv.local_name_hausa, s.state, s.lga, s.market_name,
  s.price_low, s.price_high, s.unit, s.price_low_per_kg, s.price_high_per_kg,
  s.observed_date, s.note
from public.ambassador_price_submissions s
left join public.commodity_varieties cv on cv.id = s.variety_id
where s.status = 'validated';

revoke all on public.loamy_validated_prices from public;
grant select on public.loamy_validated_prices to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) partner_earnings: allow the new 'price_submission' earning type.
-- ---------------------------------------------------------------------------
alter table public.partner_earnings drop constraint if exists partner_earnings_earning_type_check;
alter table public.partner_earnings add constraint partner_earnings_earning_type_check
  check (earning_type in ('onboarding','verification','price_submission'));

-- ---------------------------------------------------------------------------
-- 6) Submission RPC — normalise to ₦/kg, run anomaly checks, auto-validate or
--    flag, accrue incentive on validated. Flags, don't reject.
-- ---------------------------------------------------------------------------
-- SECURITY-REVIEW: validation thresholds are admin-configurable
-- (price_validation_config), not hardcoded. Runs as definer so it can read
-- peer submissions + partner_assignments for the anomaly comparisons.
create or replace function public.loamy_submit_ambassador_price(
  p_state text, p_lga text, p_market text, p_commodity text, p_variety uuid,
  p_price_low numeric, p_price_high numeric, p_unit text, p_observed_date date,
  p_note text default null, p_photo_url text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kg numeric; v_low_kg numeric; v_high_kg numeric;
  v_flags text[] := '{}'; v_status text := 'validated'; v_id uuid;
  v_cfg public.price_validation_config%rowtype; v_mid numeric; v_smid numeric; v_this numeric;
begin
  if not public.loamy_can_report_prices() then raise exception 'Only ambassadors and admins can submit prices.'; end if;
  if p_price_low < 0 or p_price_high < p_price_low then raise exception 'Enter a valid low–high range.'; end if;
  if coalesce(p_commodity,'') = '' or coalesce(p_market,'') = '' or coalesce(p_state,'') = '' then
    raise exception 'Commodity, market and state are required.';
  end if;

  select * into v_cfg from public.price_validation_config where id = 1;

  -- kg equivalent: admin lookup first (commodity+region → commodity → any), else numeric prefix, else 1.
  select kg_equivalent into v_kg from public.commodity_units
   where active and lower(unit_name) = lower(p_unit)
     and (commodity is null or lower(commodity) = lower(p_commodity))
   order by (case when lower(coalesce(commodity,'')) = lower(p_commodity) then 0 else 1 end),
            (case when region = p_state then 0 else 1 end)
   limit 1;
  if v_kg is null then
    v_kg := coalesce(nullif(regexp_replace(p_unit, '[^0-9.].*$', '', 'g'), '')::numeric, 1);
  end if;
  if v_kg <= 0 then v_kg := 1; end if;
  v_low_kg := p_price_low / v_kg;
  v_high_kg := p_price_high / v_kg;
  v_this := (v_low_kg + v_high_kg) / 2;

  -- duplicate: this ambassador already filed this commodity/market/day
  if exists (select 1 from public.ambassador_price_submissions s
             where s.ambassador_id = v_uid and s.commodity = p_commodity
               and lower(s.market_name) = lower(p_market) and s.observed_date = p_observed_date
               and s.status <> 'rejected') then
    v_flags := array_append(v_flags, 'duplicate');
  end if;

  -- >market_dev_pct from same market's validated 7-day median (per-kg)
  select percentile_cont(0.5) within group (order by (price_low_per_kg + price_high_per_kg) / 2)
    into v_mid from public.ambassador_price_submissions
   where commodity = p_commodity and lower(market_name) = lower(p_market)
     and status = 'validated' and observed_date >= p_observed_date - 7;
  if v_mid is not null and v_mid > 0 and abs((v_this - v_mid) / v_mid) > v_cfg.market_dev_pct / 100.0 then
    v_flags := array_append(v_flags, 'market_deviation');
  end if;

  -- >state_dev_pct from other markets in the same state that week
  select percentile_cont(0.5) within group (order by (price_low_per_kg + price_high_per_kg) / 2)
    into v_smid from public.ambassador_price_submissions
   where commodity = p_commodity and state = p_state and status = 'validated'
     and observed_date >= p_observed_date - 7;
  if v_smid is not null and v_smid > 0 and abs((v_this - v_smid) / v_smid) > v_cfg.state_dev_pct / 100.0 then
    v_flags := array_append(v_flags, 'state_deviation');
  end if;

  -- outside assigned territory (only if the ambassador HAS assignments)
  if exists (select 1 from public.partner_assignments a where a.partner_id = v_uid and a.active)
     and not exists (select 1 from public.partner_assignments a
                     where a.partner_id = v_uid and a.active and a.state = p_state
                       and (array_length(a.lgas, 1) is null or p_lga = any(a.lgas))) then
    v_flags := array_append(v_flags, 'outside_territory');
  end if;

  if array_length(v_flags, 1) is not null then v_status := 'flagged'; end if;

  insert into public.ambassador_price_submissions (
    ambassador_id, state, lga, market_name, commodity, variety_id, price_low, price_high, unit,
    kg_equivalent_at_submission, price_low_per_kg, price_high_per_kg, observed_date, note, photo_url, status, flags)
  values (v_uid, p_state, p_lga, p_market, p_commodity, p_variety, p_price_low, p_price_high, p_unit,
    v_kg, v_low_kg, v_high_kg, p_observed_date, p_note, p_photo_url, v_status, v_flags)
  returning id into v_id;

  if v_status = 'validated' and v_cfg.submission_rate > 0 then
    insert into public.partner_earnings (partner_id, earning_type, reference_id, amount)
    values (v_uid, 'price_submission', v_id, v_cfg.submission_rate);
  end if;

  return jsonb_build_object('id', v_id, 'status', v_status, 'flags', to_jsonb(v_flags),
                            'per_kg_low', round(v_low_kg, 2), 'per_kg_high', round(v_high_kg, 2), 'kg_equivalent', v_kg);
end;
$$;

revoke all on function public.loamy_submit_ambassador_price(text,text,text,text,uuid,numeric,numeric,text,date,text,text) from public, anon;
grant execute on function public.loamy_submit_ambassador_price(text,text,text,text,uuid,numeric,numeric,text,date,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Admin review RPC — approve / reject a flagged submission; accrue incentive
--    on approval if not already accrued.
-- ---------------------------------------------------------------------------
create or replace function public.loamy_review_ambassador_price(p_id uuid, p_action text, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_row public.ambassador_price_submissions%rowtype; v_cfg public.price_validation_config%rowtype;
begin
  if not public.loamy_is_admin() then raise exception 'Admin only.'; end if;
  select * into v_row from public.ambassador_price_submissions where id = p_id;
  if v_row.id is null then raise exception 'Submission not found.'; end if;
  select * into v_cfg from public.price_validation_config where id = 1;

  if p_action = 'approve' then
    update public.ambassador_price_submissions
      set status = 'validated', validated_by = auth.uid(), validation_note = p_note
      where id = p_id;
    if v_cfg.submission_rate > 0 and not exists (
        select 1 from public.partner_earnings where earning_type = 'price_submission' and reference_id = p_id) then
      insert into public.partner_earnings (partner_id, earning_type, reference_id, amount)
      values (v_row.ambassador_id, 'price_submission', p_id, v_cfg.submission_rate);
    end if;
  elsif p_action = 'reject' then
    update public.ambassador_price_submissions
      set status = 'rejected', validated_by = auth.uid(), validation_note = p_note
      where id = p_id;
  else
    raise exception 'action must be approve or reject';
  end if;
end;
$$;

revoke all on function public.loamy_review_ambassador_price(uuid, text, text) from public, anon;
grant execute on function public.loamy_review_ambassador_price(uuid, text, text) to authenticated;
