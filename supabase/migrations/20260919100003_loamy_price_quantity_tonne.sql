-- ============================================================================
-- Ambassador price network: QUANTITY per observation + tonne-scale units.
-- ----------------------------------------------------------------------------
-- Field agents quote bulk produce per ton ("N850,000-900,000 for 2 tonnes"),
-- not only per bag. Two additions:
--
--   1. tonne-scale rows in commodity_units, so 'tonne' resolves to 1000 kg
--      instead of falling back to the numeric-prefix guess;
--   2. a `quantity` on each submission -- the price range covers
--      quantity x unit, so the per-kg normalisation divides by
--      quantity * kg_equivalent.
--
-- quantity defaults to 1, so every existing row keeps its current per-kg
-- value and nothing already validated shifts.
-- ============================================================================

-- 1. Tonne-scale units (admin can refine per commodity/region as always).
insert into public.commodity_units (commodity, unit_name, kg_equivalent) values
  (null, 'tonne', 1000),
  (null, 'ton', 1000),
  (null, 'metric ton', 1000),
  (null, 'half tonne', 500),
  (null, '10kg', 10),
  (null, '5kg', 5)
on conflict do nothing;

-- 2. quantity column.
alter table public.ambassador_price_submissions
  add column if not exists quantity numeric not null default 1 check (quantity > 0);

comment on column public.ambassador_price_submissions.quantity is
  'How many units the quoted low-high range covers. per-kg = price / (quantity * kg_equivalent_at_submission).';

-- 3. Submission RPC, re-created with p_quantity. The old 11-argument signature
--    is dropped so PostgREST cannot resolve an ambiguous overload.
drop function if exists public.loamy_submit_ambassador_price(text,text,text,text,uuid,numeric,numeric,text,date,text,text);

-- SECURITY-REVIEW: unchanged from the original -- definer so it can read peer
-- submissions and partner_assignments for the anomaly checks; thresholds still
-- come from price_validation_config, never hardcoded.
create or replace function public.loamy_submit_ambassador_price(
  p_state text, p_lga text, p_market text, p_commodity text, p_variety uuid,
  p_price_low numeric, p_price_high numeric, p_unit text, p_observed_date date,
  p_note text default null, p_photo_url text default null, p_quantity numeric default 1
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kg numeric; v_low_kg numeric; v_high_kg numeric; v_qty numeric;
  v_flags text[] := '{}'; v_status text := 'validated'; v_id uuid;
  v_cfg public.price_validation_config%rowtype; v_mid numeric; v_smid numeric; v_this numeric;
begin
  if not public.loamy_can_report_prices() then raise exception 'Only ambassadors and admins can submit prices.'; end if;
  if p_price_low < 0 or p_price_high < p_price_low then raise exception 'Enter a valid low-high range.'; end if;
  if coalesce(p_commodity,'') = '' or coalesce(p_market,'') = '' or coalesce(p_state,'') = '' then
    raise exception 'Commodity, market and state are required.';
  end if;
  v_qty := coalesce(p_quantity, 1);
  if v_qty <= 0 then raise exception 'Quantity must be greater than zero.'; end if;

  select * into v_cfg from public.price_validation_config where id = 1;

  -- kg equivalent: admin lookup first (commodity+region -> commodity -> any),
  -- else numeric prefix, else 1.
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

  -- The quoted range covers v_qty units, so normalise across the whole lot.
  v_low_kg := p_price_low / (v_kg * v_qty);
  v_high_kg := p_price_high / (v_kg * v_qty);
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
    ambassador_id, state, lga, market_name, commodity, variety_id, price_low, price_high, unit, quantity,
    kg_equivalent_at_submission, price_low_per_kg, price_high_per_kg, observed_date, note, photo_url, status, flags)
  values (v_uid, p_state, p_lga, p_market, p_commodity, p_variety, p_price_low, p_price_high, p_unit, v_qty,
    v_kg, v_low_kg, v_high_kg, p_observed_date, p_note, p_photo_url, v_status, v_flags)
  returning id into v_id;

  if v_status = 'validated' and v_cfg.submission_rate > 0 then
    insert into public.partner_earnings (partner_id, earning_type, reference_id, amount)
    values (v_uid, 'price_submission', v_id, v_cfg.submission_rate);
  end if;

  return jsonb_build_object('id', v_id, 'status', v_status, 'flags', to_jsonb(v_flags),
                            'per_kg_low', round(v_low_kg, 2), 'per_kg_high', round(v_high_kg, 2),
                            'kg_equivalent', v_kg, 'quantity', v_qty);
end;
$$;

revoke all on function public.loamy_submit_ambassador_price(text,text,text,text,uuid,numeric,numeric,text,date,text,text,numeric) from public, anon;
grant execute on function public.loamy_submit_ambassador_price(text,text,text,text,uuid,numeric,numeric,text,date,text,text,numeric) to authenticated;

-- 4. Surface quantity on the identity-safe validated view (still NO submitter id).
--    Dropped and recreated rather than CREATE OR REPLACEd: inserting a column
--    mid-list changes the column order, which OR REPLACE refuses.
drop view if exists public.loamy_validated_prices;

create view public.loamy_validated_prices
with (security_invoker = false) as
select
  s.id, s.commodity, cv.variety_name, cv.local_name_hausa, s.state, s.lga, s.market_name,
  s.price_low, s.price_high, s.unit, s.quantity, s.price_low_per_kg, s.price_high_per_kg,
  s.observed_date, s.note
from public.ambassador_price_submissions s
left join public.commodity_varieties cv on cv.id = s.variety_id
where s.status = 'validated';

revoke all on public.loamy_validated_prices from public;
grant select on public.loamy_validated_prices to anon, authenticated;
