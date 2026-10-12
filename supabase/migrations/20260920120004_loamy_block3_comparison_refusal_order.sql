-- ============================================================================
-- BLOCK 3 (d) — report the refusal a person can act on.
-- ----------------------------------------------------------------------------
-- Found by tests/security/block3-discovery.test.ts: a price per LITRE compared
-- against a grain reference returned `no_reference_data` rather than
-- `unit_not_convertible`, because the reference lookup ran first and happened
-- to fail first.
--
-- Both refusals were true. Only one is useful.
--
--   no_reference_data     "nobody has posted a Bayelsa maize price" -- the
--                         buyer waits, or picks another market
--   unit_not_convertible  "a price per litre is not comparable to a grain
--                         reference at all" -- no market will ever fix it
--
-- Ordering matters because the UI prints the reason. Telling someone to pick
-- a different market, when no market could ever work, sends them round a loop.
--
-- So: check the intrinsic problem with the LISTING first, then the
-- environmental one.
-- ============================================================================

create or replace function public.loamy_price_comparison(
  p_price_per_unit numeric,
  p_unit           text,
  p_commodity      text,
  p_market_state   text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ref  jsonb;
  v_kg   numeric;
  v_per_kg numeric;
  v_mid  numeric;
  v_diff numeric;
begin
  -- 1. Intrinsic to this listing. No market can resolve it.
  if coalesce(p_price_per_unit, 0) <= 0 then
    return jsonb_build_object('comparable', false, 'reason', 'no_price');
  end if;

  v_kg := public.loamy_unit_kg(p_unit, p_commodity);
  if v_kg is null then
    return jsonb_build_object('comparable', false, 'reason', 'unit_not_convertible',
      'unit', p_unit,
      'message', format('A price per %s cannot be compared with a weight-based reference.',
                        coalesce(p_unit, 'that unit')));
  end if;

  -- 2. Environmental. A different market, or tomorrow's posting, may fix it.
  v_ref := public.loamy_reference_price(p_commodity, p_market_state);
  if not (v_ref->>'available')::boolean then
    return jsonb_build_object('comparable', false,
      'reason', v_ref->>'reason', 'message', v_ref->>'message');
  end if;

  v_per_kg := p_price_per_unit / v_kg;
  v_mid    := (v_ref->>'midpoint_per_kg')::numeric;
  if v_mid is null or v_mid = 0 then
    return jsonb_build_object('comparable', false, 'reason', 'no_reference_data');
  end if;

  v_diff := round(((v_per_kg - v_mid) / v_mid) * 100, 2);

  return jsonb_build_object(
    'comparable', true,
    'price_per_kg', round(v_per_kg, 4),
    'reference_per_kg', v_mid,
    'market', v_ref->>'market',
    'recorded_date', v_ref->>'recorded_date',
    'stale', (v_ref->>'stale')::boolean,
    'difference_percent', v_diff,
    'direction', case when v_diff < 0 then 'below' when v_diff > 0 then 'above' else 'level' end,
    'label', case
               when v_diff = 0 then format('level with %s reference', v_ref->>'market')
               else format('%s%% %s %s reference',
                           to_char(abs(v_diff), 'FM990.0'),
                           case when v_diff < 0 then 'below' else 'above' end,
                           v_ref->>'market')
             end);
end;
$$;

grant execute on function public.loamy_price_comparison(numeric,text,text,text) to authenticated, anon;
