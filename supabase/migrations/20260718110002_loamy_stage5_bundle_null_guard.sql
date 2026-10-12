-- ============================================================================
-- Fix: NULL-comparison guard in the bundle + risk functions. For a
-- non-officer caller loamy_officer_bank() is NULL and `bank_id = NULL`
-- evaluates to NULL (not false), so `not (admin or NULL)` failed to raise
-- and the APPLICANT could call the bank-facing functions on their own
-- application. Guards now require an explicit non-null officer bank.
-- Caught by scripts/verify-stage5.mjs ("Applicant cannot pull the bank bundle").
-- ============================================================================

create or replace function public.loamy_application_bundle(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_app  public.financing_applications%rowtype;
  v_bank uuid := public.loamy_officer_bank();
begin
  select * into v_app from public.financing_applications where id = p_app;
  if v_app.id is null then
    raise exception 'Application not found';
  end if;
  if v_app.status = 'draft' then
    raise exception 'Drafts are not visible to banks';
  end if;
  if not (public.loamy_is_admin() or (v_bank is not null and v_app.bank_id = v_bank)) then
    raise exception 'Not authorized for this application';
  end if;

  return jsonb_build_object(
    'application', jsonb_build_object(
      'id', v_app.id, 'product_type', v_app.product_type, 'structure', v_app.structure,
      'amount_requested', v_app.amount_requested, 'purpose', v_app.purpose,
      'intended_items', v_app.intended_items,
      'disbursement_preference', v_app.disbursement_preference,
      'status', v_app.status, 'status_history', v_app.status_history,
      'decision_note', v_app.decision_note,
      'submitted_at', v_app.created_at, 'updated_at', v_app.updated_at),
    'identity', (
      select jsonb_build_object(
        'full_name', p.full_name, 'digital_id', p.digital_id, 'phone', p.phone,
        'state', p.state, 'verified_badge', p.verified_badge,
        'member_since', p.created_at)
      from public.profiles p where p.id = v_app.applicant_id),
    'farms', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'farm_name', f.farm_name, 'state', f.state, 'lga', f.lga,
        'size_hectares', f.size_hectares, 'primary_crops', f.primary_crops,
        'ownership_type', f.ownership_type,
        'verification_status', f.verification_status,
        'latitude', f.latitude, 'longitude', f.longitude,
        'verified_at', (
          select max(t.completed_at) from public.verification_tasks t
          where t.subject_farm_id = f.id and t.status = 'approved'),
        'crop_records', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'crop', c.crop, 'season_year', c.season_year,
            'planting_date', c.planting_date,
            'expected_harvest_date', c.expected_harvest_date,
            'actual_harvest_date', c.actual_harvest_date,
            'expected_yield_kg', c.expected_yield_kg,
            'actual_yield_kg', c.actual_yield_kg)
            order by c.season_year desc), '[]'::jsonb)
          from public.crop_records c where c.farm_id = f.id))
        order by f.created_at), '[]'::jsonb)
      from public.farms f where f.owner_id = v_app.applicant_id),
    'activity', jsonb_build_object(
      'active_listings', (select count(*) from public.listings l
        where l.seller_id = v_app.applicant_id and l.status = 'active'),
      'concluded_deals', (select count(*) from public.listing_interests i
        where i.status = 'concluded_externally'
          and (i.buyer_id = v_app.applicant_id
               or public.loamy_interest_counterparty(i.listing_id, i.directory_id) = v_app.applicant_id)),
      'onboarded_by_partner', (select count(*) > 0 from public.onboarded_farmers o
        where o.farmer_id = v_app.applicant_id)),
    'financing_context', jsonb_build_object(
      'prior_applications', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id, 'amount_requested', a.amount_requested, 'status', a.status,
          'decision_note', a.decision_note, 'created_at', a.created_at)
          order by a.created_at desc), '[]'::jsonb)
        from public.financing_applications a
        where a.applicant_id = v_app.applicant_id and a.id <> v_app.id
          and a.status <> 'draft'),
      'milestones', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'milestone_type', m.milestone_type, 'due_date', m.due_date,
          'status', m.status) order by m.due_date), '[]'::jsonb)
        from public.repayment_milestones m
        join public.financing_applications a on a.id = m.application_id
        where a.applicant_id = v_app.applicant_id)));
end;
$$;

create or replace function public.loamy_risk_assessment(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_app       public.financing_applications%rowtype;
  v_bank      uuid := public.loamy_officer_bank();
  factors     jsonb := '[]'::jsonb;
  score       int := 0;
  pts         int;
  n           int;
  tier        text;
begin
  select * into v_app from public.financing_applications where id = p_app;
  if v_app.id is null or v_app.status = 'draft' then
    raise exception 'Application not available';
  end if;
  if not (public.loamy_is_admin() or (v_bank is not null and v_app.bank_id = v_bank)) then
    raise exception 'Not authorized';
  end if;

  -- Verification: verified farm(s)
  select count(*) into n from public.farms
  where owner_id = v_app.applicant_id and verification_status = 'verified';
  pts := case when n > 0 then 25 else -25 end;
  score := score + pts;
  factors := factors || jsonb_build_object(
    'key', 'farm_verification', 'label', 'Farm verification',
    'detail', n || ' field-verified farm(s)', 'points', pts);

  -- Identity badge
  select case when verified_badge then 15 else -10 end into pts
  from public.profiles where id = v_app.applicant_id;
  score := score + pts;
  factors := factors || jsonb_build_object(
    'key', 'identity', 'label', 'Identity verification',
    'detail', case when pts > 0 then 'Verified badge held' else 'No verified badge' end,
    'points', pts);

  -- Production history: seasons with recorded actual yields (capped)
  select count(*) into n
  from public.crop_records c
  join public.farms f on f.id = c.farm_id
  where f.owner_id = v_app.applicant_id and c.actual_yield_kg is not null;
  pts := least(n * 5, 20);
  score := score + pts;
  factors := factors || jsonb_build_object(
    'key', 'production_history', 'label', 'Production history',
    'detail', n || ' season record(s) with actual yields', 'points', pts);

  -- Marketplace activity: concluded connections (capped)
  select count(*) into n from public.listing_interests i
  where i.status = 'concluded_externally'
    and (i.buyer_id = v_app.applicant_id
         or public.loamy_interest_counterparty(i.listing_id, i.directory_id) = v_app.applicant_id);
  pts := least(n * 5, 15);
  score := score + pts;
  factors := factors || jsonb_build_object(
    'key', 'marketplace', 'label', 'Marketplace connections',
    'detail', n || ' concluded connection(s)', 'points', pts);

  -- Requested amount vs product cap
  pts := case
    when v_app.amount_requested > 400000 then -10
    when v_app.amount_requested > 250000 then -5
    else 5 end;
  score := score + pts;
  factors := factors || jsonb_build_object(
    'key', 'amount_ratio', 'label', 'Requested amount vs cap',
    'detail', round(100.0 * v_app.amount_requested / 500000) || '% of the pilot cap',
    'points', pts);

  -- Prior applications with recorded external decisions (capped)
  select count(*) into n from public.financing_applications a
  where a.applicant_id = v_app.applicant_id and a.id <> v_app.id
    and a.status = 'decided_external';
  pts := least(n * 5, 10);
  score := score + pts;
  factors := factors || jsonb_build_object(
    'key', 'prior_decisions', 'label', 'Prior recorded decisions',
    'detail', n || ' prior application(s) with a recorded decision', 'points', pts);

  -- Milestones: met (+, capped) / missed (strong −, capped)
  select count(*) into n from public.repayment_milestones m
  join public.financing_applications a on a.id = m.application_id
  where a.applicant_id = v_app.applicant_id and m.status = 'met';
  pts := least(n * 5, 15);
  score := score + pts;
  factors := factors || jsonb_build_object(
    'key', 'milestones_met', 'label', 'Milestones met',
    'detail', n || ' milestone(s) met on monitored facilities', 'points', pts);

  select count(*) into n from public.repayment_milestones m
  join public.financing_applications a on a.id = m.application_id
  where a.applicant_id = v_app.applicant_id and m.status = 'missed';
  pts := greatest(n * -20, -40);
  score := score + pts;
  factors := factors || jsonb_build_object(
    'key', 'milestones_missed', 'label', 'Milestones missed',
    'detail', n || ' missed milestone(s)', 'points', pts);

  tier := case
    when score >= 50 then 'Low'
    when score >= 25 then 'Medium'
    when score >= 0 then 'High'
    else 'Very High' end;

  return jsonb_build_object(
    'method', 'Rule-based, from platform records',
    'score', score, 'tier', tier, 'factors', factors,
    'computed_at', now());
end;
$$;
