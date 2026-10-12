-- ============================================================================
-- Loamy Platform · Stage 5 · Migration 2 of 3
-- Bank access to financing applications, the application bundle, transparent
-- rule-based risk scoring, and IMMUTABLE Credit Intelligence Report snapshots.
--
-- Access model: bank officers see SUBMITTED+ applications of THEIR bank only
-- (never drafts), and applicant data ONLY through the security-definer bundle
-- function — no raw table access to profiles/farms.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) financing_applications: bank routing + transition history.
-- ----------------------------------------------------------------------------
alter table public.financing_applications
  add column if not exists bank_id        uuid references public.banks (id),
  add column if not exists reviewed_by    uuid references public.profiles (id),
  add column if not exists status_history jsonb not null default '[]'::jsonb;

-- Single-bank pilot: route existing + future applications to LOTUS Bank.
update public.financing_applications
set bank_id = (select id from public.banks where name = 'LOTUS Bank')
where bank_id is null;

create or replace function public.loamy_financing_default_bank()
returns trigger
language plpgsql
as $$
begin
  if new.bank_id is null then
    new.bank_id := (select id from public.banks where name = 'LOTUS Bank');
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_financing_default_bank on public.financing_applications;
create trigger loamy_financing_default_bank
  before insert on public.financing_applications
  for each row execute function public.loamy_financing_default_bank();

-- Append-only transition history (timestamps per transition).
create or replace function public.loamy_financing_status_history()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.status_history := old.status_history || jsonb_build_object(
      'from', old.status, 'to', new.status, 'at', now(), 'by', auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_financing_status_history on public.financing_applications;
create trigger loamy_financing_status_history
  before update on public.financing_applications
  for each row execute function public.loamy_financing_status_history();

-- Bank officers read submitted+ applications of their own bank. Drafts are
-- invisible to banks by definition.
drop policy if exists "loamy_financing_select_bank" on public.financing_applications;
create policy "loamy_financing_select_bank"
  on public.financing_applications for select to authenticated
  using (
    status in ('submitted','under_review','info_requested','decided_external')
    and bank_id = public.loamy_officer_bank()
  );

-- ----------------------------------------------------------------------------
-- 2) Bank status controls. The ONLY transitions a bank can make in Loamy:
--    under_review / info_requested (with message) / decided_external (+note).
--    There is NO approve and NO decline — deliberately.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_bank_set_status(
  p_app uuid, p_status text, p_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app  public.financing_applications%rowtype;
  v_bank uuid := public.loamy_officer_bank();
begin
  if v_bank is null then
    raise exception 'Bank officers only';
  end if;
  if p_status not in ('under_review','info_requested','decided_external') then
    raise exception 'Invalid status for bank transition';
  end if;
  select * into v_app from public.financing_applications where id = p_app for update;
  if v_app.id is null or v_app.bank_id is distinct from v_bank then
    raise exception 'Application not found for your bank';
  end if;
  if v_app.status not in ('submitted','under_review','info_requested') then
    raise exception 'Application is not in a reviewable state (%)', v_app.status;
  end if;
  if p_status = 'decided_external' and coalesce(btrim(p_message), '') = '' then
    raise exception 'A decision note is required (e.g. "Decision communicated to applicant on <date>")';
  end if;

  update public.financing_applications
  set status = p_status,
      reviewed_by = auth.uid(),
      decision_note = case when p_status = 'decided_external' then p_message else decision_note end
  where id = p_app;

  perform public.loamy_create_notification_internal(
    v_app.applicant_id,
    case p_status
      when 'under_review' then 'Application under review'
      when 'info_requested' then 'Bank requested more information'
      else 'Decision communicated by your bank' end,
    case p_status
      when 'under_review' then 'The partner bank is reviewing your financing application.'
      when 'info_requested' then coalesce(p_message, 'Please review your application details.')
      else 'The bank has made its decision and communicates it to you directly. Note: ' || p_message end,
    'financing');
end;
$$;

revoke all on function public.loamy_bank_set_status(uuid, text, text) from public;
revoke all on function public.loamy_bank_set_status(uuid, text, text) from anon;
grant execute on function public.loamy_bank_set_status(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) THE application bundle — the only window a bank has onto applicant data.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW ★ KEY STAGE 5 SURFACE ★
-- Bank officers have NO raw access to profiles, farms, crop_records, or
-- marketplace tables. This function is their entire view. Verify:
--   (1) caller must be an ACTIVE officer of the application's bank (or admin),
--   (2) drafts are refused,
--   (3) the bundle exposes exactly the defined fields — applicant name,
--       digital_id, phone (bank KYC contact), state, badge; farm + records;
--       activity COUNTS (never counterparties); financing context. No BVN/NIN,
--       no email, no referral data, no evidence photos.
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
  if not (public.loamy_is_admin() or v_app.bank_id = v_bank) then
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

-- ----------------------------------------------------------------------------
-- 4) Risk classification — RULE-BASED, from platform records. Deterministic
--    and fully explainable: returns the factor breakdown, never a black box.
--    UI label, exactly: "Risk classification — rule-based, from platform
--    records." It is never labeled AI.
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
begin
  select * into v_app from public.financing_applications where id = p_app;
  if v_app.id is null or v_app.status = 'draft' then
    raise exception 'Application not available';
  end if;
  if not (public.loamy_is_admin() or v_app.bank_id = v_bank) then
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

revoke all on function public.loamy_application_bundle(uuid) from public;
revoke all on function public.loamy_application_bundle(uuid) from anon;
grant execute on function public.loamy_application_bundle(uuid) to authenticated;
revoke all on function public.loamy_risk_assessment(uuid) from public;
revoke all on function public.loamy_risk_assessment(uuid) from anon;
grant execute on function public.loamy_risk_assessment(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) Bank pipeline: one function returns exactly the row data the pipeline
--    table needs (no raw profile reads client-side).
-- ----------------------------------------------------------------------------
create or replace function public.loamy_bank_pipeline()
returns table (
  id uuid, applicant_name text, digital_id text, verified_badge boolean,
  product_type text, structure text, amount_requested numeric, state text,
  status text, risk_tier text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, p.full_name, p.digital_id, p.verified_badge,
         a.product_type, a.structure, a.amount_requested, p.state,
         a.status, (public.loamy_risk_assessment(a.id) ->> 'tier'), a.created_at
  from public.financing_applications a
  join public.profiles p on p.id = a.applicant_id
  where a.bank_id = public.loamy_officer_bank()
    and a.status in ('submitted','under_review','info_requested','decided_external')
  order by a.created_at desc;
$$;

revoke all on function public.loamy_bank_pipeline() from public;
revoke all on function public.loamy_bank_pipeline() from anon;
grant execute on function public.loamy_bank_pipeline() to authenticated;

-- ----------------------------------------------------------------------------
-- 6) credit_reports — IMMUTABLE snapshots. Regeneration inserts a new row;
--    nothing updates or deletes a report through the API.
-- ----------------------------------------------------------------------------
create table if not exists public.credit_reports (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.financing_applications (id) on delete cascade,
  bank_id        uuid not null references public.banks (id),
  generated_by   uuid not null references public.profiles (id),
  snapshot       jsonb not null,
  risk_tier      text not null,
  created_at     timestamptz not null default now()
);

create index if not exists credit_reports_app_idx
  on public.credit_reports (application_id, created_at desc);

-- SECURITY-REVIEW: report snapshots freeze the full application bundle —
-- treat as confidential bank documents. Read: generating bank's officers +
-- admin. NO update/delete policies (immutability) and NO client insert (only
-- the generate function below writes).
alter table public.credit_reports enable row level security;

drop policy if exists "loamy_credit_reports_select" on public.credit_reports;
create policy "loamy_credit_reports_select"
  on public.credit_reports for select to authenticated
  using (bank_id = public.loamy_officer_bank() or public.loamy_is_admin());

create or replace function public.loamy_generate_credit_report(p_app uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank   uuid := public.loamy_officer_bank();
  v_app    public.financing_applications%rowtype;
  v_bundle jsonb;
  v_risk   jsonb;
  v_id     uuid;
begin
  if v_bank is null then
    raise exception 'Bank officers only';
  end if;
  select * into v_app from public.financing_applications where id = p_app;
  if v_app.id is null or v_app.bank_id is distinct from v_bank or v_app.status = 'draft' then
    raise exception 'Application not available for your bank';
  end if;

  v_bundle := public.loamy_application_bundle(p_app);
  v_risk   := public.loamy_risk_assessment(p_app);

  insert into public.credit_reports (application_id, bank_id, generated_by, snapshot, risk_tier)
  values (p_app, v_bank, auth.uid(),
          jsonb_build_object('bundle', v_bundle, 'risk', v_risk,
                             'bank', (select name from public.banks where id = v_bank)),
          v_risk ->> 'tier')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.loamy_generate_credit_report(uuid) from public;
revoke all on function public.loamy_generate_credit_report(uuid) from anon;
grant execute on function public.loamy_generate_credit_report(uuid) to authenticated;
