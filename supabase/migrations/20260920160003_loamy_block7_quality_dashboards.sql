-- ============================================================================
-- BLOCK 7 (c) — data quality, feedback, and role-scoped intelligence.
-- ----------------------------------------------------------------------------
-- DATA QUALITY FLAGS, NEVER DELETES (directive 28). A duplicate listing or an
-- impossible quantity is evidence of how it got there; deleting it destroys
-- the only record of the problem.
--
-- FEEDBACK CANNOT REACH THE SOURCE (directive 25). loamy_submit_intelligence_
-- feedback writes to its own table and has no path to market_price_updates or
-- anything else factual. A member clicking "not useful" changes an opinion
-- about an insight, not the observation underneath it.
--
-- EVERY ROLE SEES ITS OWN INTELLIGENCE, SCOPED (directive 30/18/19). A bank
-- sees ITS OWN pipeline and nothing of another institution's. A government
-- user gets aggregates through the existing institutional functions, which
-- already carry the k-anonymity floor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Data quality.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_run_data_quality()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_found int := 0;
  v_stale_days int := 30;
  r record;
begin
  if not public.loamy_is_admin() then
    raise exception 'Data quality checks are administrative.';
  end if;

  perform set_config('loamy.intelligence_authorized', 'true', true);

  -- Listings whose unit cannot be converted, so no price comparison can ever
  -- be made against them.
  for r in
    select l.id, l.commodity, l.unit
    from public.listings l
    where l.status = 'active'
      and public.loamy_unit_kg(l.unit, l.commodity) is null
  loop
    insert into public.data_quality_findings (finding, subject_type, subject_id, detail, severity)
    select 'incompatible_unit', 'listing', r.id,
           jsonb_build_object('commodity', r.commodity, 'unit', r.unit), 'review'
    where not exists (
      select 1 from public.data_quality_findings d
      where d.subject_id = r.id and d.finding = 'incompatible_unit' and d.status = 'open');
    v_found := v_found + 1;
  end loop;

  -- The same seller, the same commodity, the same state, listed more than
  -- once and still active. Not automatically wrong -- two stores, two
  -- listings -- so it is flagged for a human, not removed.
  for r in
    select l.seller_id, l.commodity, l.state, count(*) as n,
           (array_agg(l.id order by l.created_at))[1] as first_id
    from public.listings l
    where l.status = 'active'
    group by l.seller_id, l.commodity, l.state
    having count(*) > 1
  loop
    insert into public.data_quality_findings (finding, subject_type, subject_id, detail, severity)
    select 'duplicate_listing', 'listing', r.first_id,
           jsonb_build_object('seller_id', r.seller_id, 'commodity', r.commodity,
                              'state', r.state, 'count', r.n,
                              'note', 'Two stores can legitimately be two listings. Review, do not remove.'),
           'info'
    where not exists (
      select 1 from public.data_quality_findings d
      where d.subject_id = r.first_id and d.finding = 'duplicate_listing' and d.status = 'open');
    v_found := v_found + 1;
  end loop;

  -- A batch cannot have negative stock. If one does, an accounting path is
  -- wrong and needs finding.
  for r in
    select b.id, b.ref, b.available_quantity
    from public.commodity_batches b
    where b.available_quantity < 0
  loop
    insert into public.data_quality_findings (finding, subject_type, subject_id, detail, severity)
    select 'negative_availability', 'commodity_batch', r.id,
           jsonb_build_object('ref', r.ref, 'available_quantity', r.available_quantity), 'urgent'
    where not exists (
      select 1 from public.data_quality_findings d
      where d.subject_id = r.id and d.finding = 'negative_availability' and d.status = 'open');
    v_found := v_found + 1;
  end loop;

  -- Impossible quantities. A single listing of a hundred thousand tonnes is
  -- a typo, not a harvest.
  for r in
    select l.id, l.commodity, l.quantity_kg, l.unit
    from public.listings l
    where l.status = 'active'
      and l.quantity_kg * coalesce(public.loamy_unit_kg(l.unit, l.commodity), 1) > 100000000
  loop
    insert into public.data_quality_findings (finding, subject_type, subject_id, detail, severity)
    select 'impossible_quantity', 'listing', r.id,
           jsonb_build_object('commodity', r.commodity, 'quantity', r.quantity_kg,
                              'unit', r.unit), 'review'
    where not exists (
      select 1 from public.data_quality_findings d
      where d.subject_id = r.id and d.finding = 'impossible_quantity' and d.status = 'open');
    v_found := v_found + 1;
  end loop;

  -- A market whose latest observation is old. The price is not wrong; it is
  -- just not current, and a UI that shows it as current would be.
  for r in
    select m.commodity, m.state, max(m.recorded_date) as latest
    from public.market_price_updates m
    group by m.commodity, m.state
    having max(m.recorded_date) < current_date - v_stale_days
  loop
    insert into public.data_quality_findings (finding, subject_type, subject_id, detail, severity)
    select 'stale_price', 'market_price', null,
           jsonb_build_object('commodity', r.commodity, 'market', r.state,
                              'latest_observation', r.latest,
                              'days_old', current_date - r.latest), 'info'
    where not exists (
      select 1 from public.data_quality_findings d
      where d.finding = 'stale_price' and d.status = 'open'
        and d.detail->>'commodity' = r.commodity and d.detail->>'market' = r.state);
    v_found := v_found + 1;
  end loop;

  perform set_config('loamy.intelligence_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, detail)
  values (v_uid, 'admin', 'data_quality_run', 'data_quality',
          jsonb_build_object('checks_raised', v_found));

  return jsonb_build_object(
    'ran', true,
    'findings_considered', v_found,
    'open', (select count(*) from public.data_quality_findings where status = 'open'),
    'note', 'Findings are flagged for review. Nothing is deleted or corrected automatically.');
end;
$$;

revoke all on function public.loamy_run_data_quality() from public, anon;
grant execute on function public.loamy_run_data_quality() to authenticated;

create or replace function public.loamy_resolve_data_quality(
  p_finding_id uuid, p_status text, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not public.loamy_is_admin() then
    raise exception 'Only an administrator resolves a data quality finding.';
  end if;
  if p_status not in ('acknowledged','resolved','not_an_issue') then
    raise exception 'Unknown resolution: %', p_status;
  end if;

  perform set_config('loamy.intelligence_authorized', 'true', true);
  update public.data_quality_findings
     set status = p_status, resolution_note = p_note,
         resolved_by = v_uid,
         resolved_at = case when p_status <> 'acknowledged' then now() end
   where id = p_finding_id;
  perform set_config('loamy.intelligence_authorized', 'false', true);

  return jsonb_build_object('saved', true, 'status', p_status);
end;
$$;

revoke all on function public.loamy_resolve_data_quality(uuid,text,text) from public, anon;
grant execute on function public.loamy_resolve_data_quality(uuid,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Feedback on an insight — and nothing else.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_submit_intelligence_feedback(
  p_output_id uuid,
  p_verdict   text,
  p_note      text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_verdict not in ('useful','not_useful','incorrect','outdated') then
    raise exception 'Unknown verdict: %', p_verdict;
  end if;
  if not exists (select 1 from public.intelligence_outputs where id = p_output_id) then
    raise exception 'That insight does not exist.';
  end if;

  insert into public.intelligence_feedback (output_id, user_id, verdict, note)
  values (p_output_id, v_uid, p_verdict, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (output_id, user_id) do update
    set verdict = excluded.verdict, note = excluded.note, created_at = now();

  return jsonb_build_object(
    'recorded', true,
    -- Said explicitly, because this is exactly the boundary that gets blurred.
    'note', 'Recorded against the insight. The underlying observations are unchanged.');
end;
$$;

revoke all on function public.loamy_submit_intelligence_feedback(uuid,text,text) from public, anon;
grant execute on function public.loamy_submit_intelligence_feedback(uuid,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Intelligence for the role you actually hold (directive 30).
-- ----------------------------------------------------------------------------
create or replace function public.loamy_role_intelligence(
  p_commodity text default null,
  p_state     text default null,
  p_days      int default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_p    public.profiles%rowtype;
  v_role text;
  v_out  jsonb;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  select * into v_p from public.profiles where id = v_uid;
  v_role := coalesce(v_p.platform_role, 'trader');

  v_out := jsonb_build_object(
    'role', v_role,
    'commodity', p_commodity,
    'state', coalesce(p_state, v_p.state),
    'period_days', p_days,
    'generated_at', now());

  -- Everyone with a commodity in hand gets demand, supply and price history.
  -- These are aggregates with a participant floor; none exposes a person.
  if p_commodity is not null then
    v_out := v_out || jsonb_build_object(
      'demand', public.loamy_demand_signal(p_commodity, coalesce(p_state, v_p.state), p_days),
      'supply', public.loamy_supply_signal(p_commodity, coalesce(p_state, v_p.state), p_days));

    if coalesce(p_state, v_p.state) is not null then
      v_out := v_out || jsonb_build_object(
        'price_history', public.loamy_price_history(p_commodity, coalesce(p_state, v_p.state), 180),
        'seasonal', public.loamy_seasonal_pattern(p_commodity, coalesce(p_state, v_p.state), 3));
    end if;
  end if;

  -- Role-specific additions, each from the member's OWN records.
  if v_role in ('farmer') then
    v_out := v_out || jsonb_build_object('my_activity', jsonb_build_object(
      'farms', (select count(*) from public.farms where owner_id = v_uid),
      'verified_farms', (select count(*) from public.farms
                          where owner_id = v_uid and verification_status = 'verified'),
      'batches', (select count(*) from public.commodity_batches where origin_owner_id = v_uid),
      'active_listings', (select count(*) from public.listings
                           where seller_id = v_uid and status = 'active')));

  elsif v_role in ('trader','buyer','processor','exporter','input_supplier') then
    v_out := v_out || jsonb_build_object('my_activity', jsonb_build_object(
      'active_listings', (select count(*) from public.listings
                           where seller_id = v_uid and status = 'active'),
      'completed_purchases', (select count(*) from public.transactions
                               where buyer_id = v_uid and status = 'completed'),
      'completed_sales', (select count(*) from public.transactions
                           where seller_id = v_uid and status = 'completed')));

  elsif v_role = 'growth_partner' then
    v_out := v_out || jsonb_build_object('my_activity', jsonb_build_object(
      'open_tasks', (select count(*) from public.verification_tasks
                      where assigned_to = v_uid
                        and status in ('assigned','accepted','in_progress')),
      'approved_tasks', (select count(*) from public.verification_tasks
                          where assigned_to = v_uid and status = 'approved'),
      'price_observations', (select count(*) from public.market_price_updates
                              where recorded_by = v_uid)));

  elsif v_role in ('warehouse_owner','logistics_provider') then
    v_out := v_out || jsonb_build_object('my_activity', jsonb_build_object(
      'facilities', (select count(*) from public.service_directory where owner_id = v_uid),
      'jobs', (select count(*) from public.transport_jobs
                where assigned_provider_id = v_uid)));
  end if;

  return v_out;
end;
$$;

revoke all on function public.loamy_role_intelligence(text,text,int) from public, anon;
grant execute on function public.loamy_role_intelligence(text,text,int) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. A bank sees its OWN pipeline. Never another institution's.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_bank_portfolio_intelligence(p_days int default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bank  uuid := public.loamy_officer_bank();
  v_since timestamptz;
begin
  if v_bank is null then
    -- Same shape whether you are not an officer or the bank does not exist:
    -- the refusal must not confirm which.
    return jsonb_build_object('available', false, 'reason', 'not_authorised');
  end if;

  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 730)));

  return jsonb_build_object(
    'available', true,
    'classification', 'observed',
    'bank', (select name from public.banks where id = v_bank),
    'period_days', p_days,
    'period_start', v_since,

    -- Scoped by bank_id at every step. Directive 18.
    'pipeline', (
      select jsonb_build_object(
        'submitted', count(*) filter (where status = 'submitted'),
        'under_review', count(*) filter (where status = 'under_review'),
        'approved', count(*) filter (where status in ('approved','partially_approved')),
        'rejected', count(*) filter (where status = 'rejected'),
        'disbursed', count(*) filter (where status = 'disbursed'),
        'total', count(*))
      from public.financing_applications
      where bank_id = v_bank and created_at >= v_since),

    'amounts', (
      select jsonb_build_object(
        'requested', coalesce(sum(amount_requested), 0),
        'approved', coalesce(sum(approved_amount), 0),
        'disbursed', coalesce(sum(disbursed_amount), 0))
      from public.financing_applications
      where bank_id = v_bank and created_at >= v_since),

    'commodities', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'commodity', d.commodity, 'applications', d.n) order by d.n desc), '[]'::jsonb)
      from (
        select t.commodity, count(*) as n
        from public.financing_applications f
        join public.transactions t on t.id = f.transaction_id
        where f.bank_id = v_bank and f.created_at >= v_since
        group by t.commodity
      ) d),

    'verification_support', (
      select jsonb_build_object(
        'financed_batches_verified', count(*) filter (where b.verification_status = 'verified'),
        'financed_batches_total', count(*))
      from public.financing_applications f
      join public.commodity_batches b on b.id = f.batch_id
      where f.bank_id = v_bank and f.created_at >= v_since),

    'limitations', 'Your institution''s own applications only. Loamy does not aggregate across institutions, and this is evidence of activity -- not a credit assessment.');
end;
$$;

revoke all on function public.loamy_bank_portfolio_intelligence(int) from public, anon;
grant execute on function public.loamy_bank_portfolio_intelligence(int) to authenticated;

comment on function public.loamy_bank_portfolio_intelligence(int) is
  'BLOCK 7, directive 18. Scoped to the calling officer''s OWN bank at every step. There is no cross-institution view, and Loamy makes no credit assessment here.';
