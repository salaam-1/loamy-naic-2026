-- ============================================================================
-- Processor Dashboard — PART 6: inspection dispatch
-- ============================================================================
-- An award can be inspected before release. Where the buyer chose Loamy Growth
-- Partners, the job is offered to partners whose territory covers the pickup
-- location; the partner captures on-site GPS + photos + a checklist (the Stage-4
-- evidence pattern). Company-inspector / third-party modes let an authorised
-- company member file the report. Evidence lives in a PRIVATE bucket.
--
-- SECURITY-REVIEW: inspection evidence access — the buyer sees the report and
-- its photos (they commissioned it) but not the partner's raw identity data;
-- partner identity is handled as in Stage 4. The pool of unassigned jobs is
-- visible ONLY to partners whose territory covers the location. Verify no
-- cross-company leakage and that evidence photos never reach public storage.
-- ============================================================================

create table if not exists public.inspection_jobs (
  id                 uuid primary key default gen_random_uuid(),
  award_id           uuid not null references public.rfq_awards(id) on delete cascade,
  rfq_id             uuid not null references public.rfqs(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete cascade,
  supplier_id        uuid not null references auth.users(id) on delete cascade,
  mode               text not null check (mode in ('loamy_partner','company_inspector','third_party')),
  assigned_partner_id uuid references public.profiles(id) on delete set null,
  state              text,
  lga                text,
  location           text,
  scheduled_for      timestamptz,
  status             text not null default 'requested'
                       check (status in ('requested','assigned','in_progress','submitted','accepted','disputed','cancelled')),
  findings           jsonb not null default '{}'::jsonb,
  photos             text[] not null default '{}',
  gps_lat            numeric,
  gps_lng            numeric,
  quantity_verified  numeric,
  quality_notes      text,
  moisture_reading   numeric,
  recommendation     text check (recommendation in ('pass','fail','conditional')),
  submitted_at       timestamptz,
  reviewed_by        uuid references public.profiles(id) on delete set null,
  reviewed_at        timestamptz,
  review_note        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists inspection_company_idx on public.inspection_jobs(company_id, status);
create index if not exists inspection_partner_idx on public.inspection_jobs(assigned_partner_id, status);
create index if not exists inspection_pool_idx on public.inspection_jobs(status, state) where assigned_partner_id is null;

alter table public.inspection_jobs enable row level security;

-- Buyer company members, the assigned partner, and admin read directly. The
-- unassigned pool is reached through loamy_available_inspections (below).
drop policy if exists inspection_select on public.inspection_jobs;
create policy inspection_select on public.inspection_jobs
  for select to authenticated
  using (
    company_id in (select public.loamy_user_company_ids())
    or assigned_partner_id = auth.uid()
    or public.loamy_is_admin()
  );

-- Territory: does the calling partner cover this state/lga?
create or replace function public.loamy_covers_location(p_state text, p_lga text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.partner_assignments pa
    where pa.partner_id = auth.uid()
      and pa.active
      and pa.state = p_state
      and (coalesce(array_length(pa.lgas, 1), 0) = 0 or p_lga = any (pa.lgas))
  );
$$;

grant execute on function public.loamy_covers_location(text, text) to authenticated;

-- Company members who may file/accept an inspection (owner/Director/Manager/QA).
create or replace function public.loamy_company_can_inspect(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target and user_id = auth.uid()
      and (is_owner or company_role in ('Procurement Director','Procurement Manager','Quality Assurance Officer'))
  );
$$;

grant execute on function public.loamy_company_can_inspect(uuid) to authenticated;

-- Create an inspection for an award. Buyer procurement role required.
create or replace function public.loamy_request_inspection(
  p_award_id uuid,
  p_location text default null,
  p_scheduled_for timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.rfq_awards;
  r public.rfqs;
  v_state text; v_lga text;
  v_id uuid; v_company_name text;
begin
  select * into a from public.rfq_awards where id = p_award_id;
  if not found then raise exception 'Award not found'; end if;
  select * into r from public.rfqs where id = a.rfq_id;
  if not public.loamy_company_can_procure(r.company_id) then
    raise exception 'Not authorised to request an inspection';
  end if;
  if exists (select 1 from public.inspection_jobs where award_id = p_award_id and status not in ('cancelled')) then
    raise exception 'An inspection already exists for this award';
  end if;

  select state into v_state from public.profiles where id = a.supplier_id;
  v_lga := null;

  insert into public.inspection_jobs (
    award_id, rfq_id, company_id, supplier_id, mode, state, lga, location, scheduled_for, status
  ) values (
    p_award_id, a.rfq_id, r.company_id, a.supplier_id, r.inspection_mode, v_state, v_lga,
    coalesce(p_location, r.delivery_address), p_scheduled_for,
    case when r.inspection_mode = 'loamy_partner' then 'requested' else 'assigned' end
  ) returning id into v_id;

  update public.rfq_awards set status = 'in_progress', updated_at = now()
  where id = p_award_id and status = 'awarded';

  -- Offer to partners covering the supplier's territory.
  if r.inspection_mode = 'loamy_partner' and v_state is not null then
    select name into v_company_name from public.companies where id = r.company_id;
    insert into public.notifications (user_id, title, body, type)
    select distinct pa.partner_id,
      'Inspection available in ' || v_state,
      'An inspection for ' || r.commodity || ' (' || r.reference || ') is available in your territory.',
      'inspection'
    from public.partner_assignments pa
    where pa.active and pa.state = v_state
      and (coalesce(array_length(pa.lgas, 1), 0) = 0 or v_lga = any (pa.lgas));
  end if;

  return v_id;
end;
$$;

grant execute on function public.loamy_request_inspection(uuid, text, timestamptz) to authenticated;

-- Partner claims a pooled inspection in their territory.
create or replace function public.loamy_claim_inspection(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare j public.inspection_jobs;
begin
  select * into j from public.inspection_jobs where id = p_job_id;
  if not found then raise exception 'Inspection not found'; end if;
  if j.status <> 'requested' or j.assigned_partner_id is not null then
    raise exception 'This inspection is no longer available';
  end if;
  if not public.loamy_covers_location(j.state, j.lga) then
    raise exception 'This inspection is outside your territory';
  end if;
  update public.inspection_jobs
    set assigned_partner_id = auth.uid(), status = 'assigned', updated_at = now()
  where id = p_job_id;
end;
$$;

grant execute on function public.loamy_claim_inspection(uuid) to authenticated;

-- Submit the inspection report. The assigned partner (loamy_partner mode) or an
-- authorised company member (company_inspector / third_party) may submit.
create or replace function public.loamy_submit_inspection(
  p_job_id uuid,
  p_findings jsonb default '{}',
  p_photos text[] default '{}',
  p_gps_lat numeric default null,
  p_gps_lng numeric default null,
  p_quantity_verified numeric default null,
  p_quality_notes text default null,
  p_moisture_reading numeric default null,
  p_recommendation text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.inspection_jobs;
  v_ok boolean;
  v_buyer uuid;
begin
  select * into j from public.inspection_jobs where id = p_job_id;
  if not found then raise exception 'Inspection not found'; end if;
  if j.status not in ('assigned','in_progress') then
    raise exception 'This inspection cannot be submitted in its current state';
  end if;

  if j.mode = 'loamy_partner' then
    v_ok := (j.assigned_partner_id = auth.uid());
  else
    v_ok := public.loamy_company_can_inspect(j.company_id);
  end if;
  if not v_ok then raise exception 'Not authorised to submit this inspection'; end if;

  if p_recommendation is not null and p_recommendation not in ('pass','fail','conditional') then
    raise exception 'Recommendation must be pass, fail or conditional';
  end if;

  update public.inspection_jobs set
    findings = coalesce(p_findings, '{}'::jsonb),
    photos = coalesce(p_photos, '{}'),
    gps_lat = p_gps_lat, gps_lng = p_gps_lng,
    quantity_verified = p_quantity_verified,
    quality_notes = nullif(trim(p_quality_notes), ''),
    moisture_reading = p_moisture_reading,
    recommendation = p_recommendation,
    status = 'submitted', submitted_at = now(), updated_at = now()
  where id = p_job_id;

  -- Notify the buyer's procurement lead(s).
  insert into public.notifications (user_id, title, body, type)
  select cm.user_id,
    'Inspection report submitted',
    'The inspection for award ' || left(j.award_id::text, 8) || ' has been submitted for your review.',
    'inspection'
  from public.company_members cm
  where cm.company_id = j.company_id
    and (cm.is_owner or cm.company_role in ('Procurement Director','Procurement Manager','Quality Assurance Officer'));
end;
$$;

grant execute on function public.loamy_submit_inspection(uuid, jsonb, text[], numeric, numeric, numeric, text, numeric, text) to authenticated;

-- Buyer reviews the submitted report: accept (award → inspected) or dispute.
create or replace function public.loamy_review_inspection(
  p_job_id uuid,
  p_accept boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare j public.inspection_jobs;
begin
  select * into j from public.inspection_jobs where id = p_job_id;
  if not found then raise exception 'Inspection not found'; end if;
  if not public.loamy_company_can_procure(j.company_id) then
    raise exception 'Not authorised to review this inspection';
  end if;
  if j.status <> 'submitted' then raise exception 'Only a submitted inspection can be reviewed'; end if;

  update public.inspection_jobs set
    status = case when p_accept then 'accepted' else 'disputed' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), ''), updated_at = now()
  where id = p_job_id;

  if p_accept then
    update public.rfq_awards set status = 'inspected', updated_at = now() where id = j.award_id;
  end if;

  insert into public.notifications (user_id, title, body, type)
  values (j.supplier_id,
    case when p_accept then 'Inspection passed' else 'Inspection needs attention' end,
    case when p_accept then 'Your consignment passed inspection.' else 'The buyer flagged the inspection. ' || coalesce(nullif(trim(p_note), ''), '') end,
    'inspection');
end;
$$;

grant execute on function public.loamy_review_inspection(uuid, boolean, text) to authenticated;

-- Buyer/partner view enriched with award + rfq context + partner display name.
create or replace view public.loamy_inspection_jobs_v as
  select
    j.id, j.award_id, j.rfq_id, j.company_id, j.supplier_id, j.mode,
    j.assigned_partner_id, j.state, j.lga, j.location, j.scheduled_for, j.status,
    j.findings, j.photos, j.gps_lat, j.gps_lng, j.quantity_verified, j.quality_notes,
    j.moisture_reading, j.recommendation, j.submitted_at, j.reviewed_at, j.review_note, j.created_at,
    r.reference as rfq_reference, r.commodity, r.unit,
    a.awarded_quantity,
    ap.full_name as partner_name,
    sp.full_name as supplier_name
  from public.inspection_jobs j
  join public.rfqs r on r.id = j.rfq_id
  join public.rfq_awards a on a.id = j.award_id
  left join public.profiles ap on ap.id = j.assigned_partner_id
  join public.profiles sp on sp.id = j.supplier_id
  where j.company_id in (select public.loamy_user_company_ids())
     or j.assigned_partner_id = auth.uid()
     or public.loamy_is_admin();

grant select on public.loamy_inspection_jobs_v to authenticated;

-- Partner pool: unassigned Loamy-partner jobs in the caller's territory.
create or replace view public.loamy_available_inspections as
  select
    j.id, j.rfq_id, j.state, j.lga, j.location, j.scheduled_for, j.created_at,
    r.reference as rfq_reference, r.commodity, r.unit, a.awarded_quantity
  from public.inspection_jobs j
  join public.rfqs r on r.id = j.rfq_id
  join public.rfq_awards a on a.id = j.award_id
  where j.status = 'requested'
    and j.assigned_partner_id is null
    and j.mode = 'loamy_partner'
    and public.loamy_covers_location(j.state, j.lga);

grant select on public.loamy_available_inspections to authenticated;

-- Private evidence bucket (signed-URL only), path convention {job_id}/{file}.
insert into storage.buckets (id, name, public)
values ('inspection-evidence', 'inspection-evidence', false)
on conflict (id) do nothing;

-- READ: admin, the assigned partner, or the buyer company's members.
drop policy if exists "insp_evidence_read" on storage.objects;
create policy "insp_evidence_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inspection-evidence'
    and (
      public.loamy_is_admin()
      or exists (
        select 1 from public.inspection_jobs j
        where j.id::text = (storage.foldername(name))[1]
          and (j.assigned_partner_id = auth.uid()
               or j.company_id in (select public.loamy_user_company_ids()))
      )
    )
  );

-- WRITE / DELETE: whoever may submit the report while it is still editable.
drop policy if exists "insp_evidence_write" on storage.objects;
create policy "insp_evidence_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-evidence'
    and exists (
      select 1 from public.inspection_jobs j
      where j.id::text = (storage.foldername(name))[1]
        and j.status in ('assigned','in_progress')
        and (
          (j.mode = 'loamy_partner' and j.assigned_partner_id = auth.uid())
          or (j.mode <> 'loamy_partner' and public.loamy_company_can_inspect(j.company_id))
        )
    )
  );

drop policy if exists "insp_evidence_delete" on storage.objects;
create policy "insp_evidence_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'inspection-evidence'
    and exists (
      select 1 from public.inspection_jobs j
      where j.id::text = (storage.foldername(name))[1]
        and j.status in ('assigned','in_progress')
        and (
          (j.mode = 'loamy_partner' and j.assigned_partner_id = auth.uid())
          or (j.mode <> 'loamy_partner' and public.loamy_company_can_inspect(j.company_id))
        )
    )
  );
