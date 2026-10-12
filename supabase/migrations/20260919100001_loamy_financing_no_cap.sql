-- ============================================================================
-- Farmer financing: REMOVE the ₦500,000 pilot cap.
-- ----------------------------------------------------------------------------
-- A farmer now states the full amount they need; the partner bank decides what
-- it can offer. Loamy imposes no limit of its own (and still makes no credit
-- decision — see the Stage 2 note: there is no approved/declined status here).
--
-- Two things change:
--   1. the DB check constraint `financing_amount_cap` is dropped;
--   2. loamy_risk_assessment's "vs cap" factor becomes a "vs large-exposure
--      reference" factor, reading an ADMIN-TUNABLE figure from
--      platform_config.settings (defaulting to 500,000 so today's bank scores
--      are unchanged) instead of a hardcoded cap.
-- ============================================================================

alter table public.financing_applications
  drop constraint if exists financing_amount_cap;

comment on column public.financing_applications.amount_requested is
  'Amount the applicant asked the partner bank for. No platform-side cap — the bank decides.';

-- Admin-tunable settings bag (separate from feature `flags`).
alter table public.platform_config
  add column if not exists settings jsonb not null default '{}'::jsonb;

update public.platform_config
set settings = jsonb_build_object('financing_large_exposure_ngn', 500000) || coalesce(settings, '{}'::jsonb)
where id = 1;

-- ----------------------------------------------------------------------------
-- loamy_risk_assessment — re-created with the cap factor replaced.
-- ----------------------------------------------------------------------------
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
  v_exposure_ref numeric;
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

  -- Requested amount vs the bank's large-exposure reference. There is no
  -- platform cap on what a farmer may ask for; this reference is an
  -- admin-tunable risk signal only (platform_config.settings).
  select coalesce((settings->>'financing_large_exposure_ngn')::numeric, 500000)
    into v_exposure_ref from public.platform_config where id = 1;
  if v_exposure_ref is null or v_exposure_ref <= 0 then v_exposure_ref := 500000; end if;
  pts := case
    when v_app.amount_requested > v_exposure_ref * 0.8 then -10
    when v_app.amount_requested > v_exposure_ref * 0.5 then -5
    else 5 end;
  score := score + pts;
  factors := factors || jsonb_build_object(
    'key', 'amount_ratio', 'label', 'Requested amount vs exposure reference',
    'detail', round(100.0 * v_app.amount_requested / v_exposure_ref)
              || '% of the ' || to_char(v_exposure_ref, 'FM999,999,999,999') || ' reference',
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
