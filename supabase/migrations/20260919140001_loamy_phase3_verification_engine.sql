-- ============================================================================
-- PHASE 3 — verification engine.
-- ----------------------------------------------------------------------------
-- Directive Part 11 (case / evidence / review as separate things), Part 7 of
-- the master directive (field anti-fraud), Part 23 (Growth Partner work).
--
-- The rule the whole design serves:
--
--     EVIDENCE COLLECTION is not PLATFORM APPROVAL.
--
-- A Growth Partner collects; the platform decides. An agent must never be able
-- to produce an approved verification on their own, and that is enforced in
-- the database, not in the UI.
--
-- DELIBERATE REUSE: `verification_tasks` already carries assign/claim/review
-- for farm verification, and the private evidence bucket's storage policy is
-- keyed to `verification_tasks.id` as the folder name. Forking a parallel
-- `verification_cases` table would have meant two sources of truth, a storage
-- policy rewrite, and rebuilding the working TaskDetail UI. So the table is
-- EXTENDED into the general case entity and exposed under the directive's name
-- as a view. Evidence moves OUT of the jsonb blob into real rows.
--
-- SECURITY-REVIEW ** FIELD EVIDENCE + PRIVATE LOCATION **
-- Evidence rows carry GPS of private farmland, device fingerprints and
-- references into a private bucket. Read access is the assigned agent, the
-- requester, and admin — NEVER the subject being verified (a farmer must not
-- see the agent's raw observations about them, which is why the existing
-- status-only view for farmers stays the farmer's surface).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Distance helper.
-- ----------------------------------------------------------------------------
-- REUSED, not redefined: loamy_haversine_m(lat1, lng1, lat2, lng2) already
-- exists from Stage 4 (20260715090002) and is correct. CREATE OR REPLACE
-- cannot rename input parameters, so redefining it with different argument
-- names fails outright -- which is the right outcome, because two distance
-- functions would be one too many.

-- ----------------------------------------------------------------------------
-- 1. Case: generalise verification_tasks to every verification type.
-- ----------------------------------------------------------------------------
alter table public.verification_tasks drop constraint if exists verification_tasks_task_type_check;
alter table public.verification_tasks add constraint verification_tasks_task_type_check
  check (task_type in (
    'identity_verification',
    'farm_verification',
    'farm_geospatial',
    'business_verification',
    'seller_verification',
    'commodity_verification',
    'quantity_verification',
    'quality_verification',
    'warehouse_verification',
    'logistics_verification',
    'transaction_verification',
    'delivery_verification'
  ));

alter table public.verification_tasks
  add column if not exists ref            text unique,
  -- Generic subject, alongside the existing subject_farm_id. A commodity
  -- verification points at a batch; a warehouse one at a warehouse.
  add column if not exists subject_type   text,
  add column if not exists subject_id     uuid,
  -- Who asked for it. Null = platform-initiated (the original farm flow).
  add column if not exists requested_by   uuid references public.profiles (id) on delete set null,
  -- Where the agent is expected to be, so GPS can be checked against something.
  add column if not exists expected_lat   numeric check (expected_lat is null or (expected_lat between -90 and 90)),
  add column if not exists expected_lng   numeric check (expected_lng is null or (expected_lng between -180 and 180)),
  add column if not exists expected_state text,
  add column if not exists expected_lga   text,
  add column if not exists due_at         timestamptz,
  -- Accumulated anti-fraud signals. A flagged case must be looked at.
  add column if not exists flags          text[] not null default '{}',
  -- Random QA sampling, so clean-looking work is still spot-checked.
  add column if not exists sampled_for_review boolean not null default false,
  add column if not exists submitted_at   timestamptz;

comment on table public.verification_tasks is
  'VERIFICATION CASE (directive Part 11). Evidence lives in verification_evidence; decisions in verification_reviews. An agent collects; the platform approves.';

drop trigger if exists loamy_vtasks_assign_ref on public.verification_tasks;
create trigger loamy_vtasks_assign_ref
  before insert on public.verification_tasks
  for each row execute function public.loamy_assign_ref('verification_case', 'VER');

do $$
declare r record;
begin
  for r in select id from public.verification_tasks where ref is null loop
    update public.verification_tasks
       set ref = public.loamy_register_ref('verification_case', r.id, 'VER')
     where id = r.id;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Evidence — real rows, not a jsonb blob.
-- ----------------------------------------------------------------------------
-- Directive: "Do not allow uploaded photos/videos to be detached from the
-- entity/event they prove." The FK does that; the not-null case_id makes an
-- orphan impossible.
create table if not exists public.verification_evidence (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique,
  case_id        uuid not null references public.verification_tasks (id) on delete cascade,

  evidence_type  text not null check (evidence_type in
                   ('photo','video','gps_point','checklist','measurement','document','note')),
  -- Path in the PRIVATE verification-evidence bucket. Never a public URL.
  storage_path   text,
  -- Hash of the uploaded file, supplied by the capturing client. Used only to
  -- FLAG re-used evidence — it is a fraud signal, never an auth decision.
  content_hash   text,

  -- WHO / WHEN / WHERE, the three things that make evidence evidence.
  captured_by    uuid not null references public.profiles (id) on delete cascade,
  captured_at    timestamptz not null,
  captured_lat   numeric check (captured_lat is null or (captured_lat between -90 and 90)),
  captured_lng   numeric check (captured_lng is null or (captured_lng between -180 and 180)),
  gps_accuracy_m numeric check (gps_accuracy_m is null or gps_accuracy_m >= 0),
  device_hash    text,

  -- WHAT was observed.
  observation    jsonb not null default '{}'::jsonb,
  quantity       numeric,
  unit           text,
  note           text,

  -- Distance from where the agent was supposed to be, computed server-side.
  distance_from_subject_m numeric,
  flags          text[] not null default '{}',
  status         text not null default 'submitted'
                   check (status in ('submitted','accepted','rejected','flagged')),
  created_at     timestamptz not null default now()
);

create index if not exists vevidence_case_idx on public.verification_evidence (case_id, created_at);
create index if not exists vevidence_hash_idx on public.verification_evidence (content_hash) where content_hash is not null;
create index if not exists vevidence_agent_idx on public.verification_evidence (captured_by, created_at desc);

alter table public.verification_evidence enable row level security;

-- The assigned agent, the requester, and admin. NOT the subject.
drop policy if exists "loamy_vevidence_select" on public.verification_evidence;
create policy "loamy_vevidence_select"
  on public.verification_evidence for select to authenticated
  using (exists (
    select 1 from public.verification_tasks t
    where t.id = case_id
      and (t.assigned_to = auth.uid() or t.requested_by = auth.uid() or public.loamy_is_admin())
  ));

-- No client INSERT/UPDATE/DELETE: everything goes through the RPC, which is
-- what runs the fraud checks and stamps captured_by.

drop trigger if exists loamy_vevidence_assign_ref on public.verification_evidence;
create trigger loamy_vevidence_assign_ref
  before insert on public.verification_evidence
  for each row execute function public.loamy_assign_ref('verification_evidence', 'EVD');

-- ----------------------------------------------------------------------------
-- 3. Review — the platform's decision, kept separate from the evidence.
-- ----------------------------------------------------------------------------
create table if not exists public.verification_reviews (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique,
  case_id     uuid not null references public.verification_tasks (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  decision    text not null check (decision in ('approved','rejected','more_evidence_required')),
  note        text,
  checklist   jsonb not null default '{}'::jsonb,
  -- What the reviewer saw when deciding, so a later audit can reconstruct it.
  flags_at_review text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists vreviews_case_idx on public.verification_reviews (case_id, created_at desc);

alter table public.verification_reviews enable row level security;

drop policy if exists "loamy_vreviews_select" on public.verification_reviews;
create policy "loamy_vreviews_select"
  on public.verification_reviews for select to authenticated
  using (exists (
    select 1 from public.verification_tasks t
    where t.id = case_id
      and (t.assigned_to = auth.uid() or t.requested_by = auth.uid() or public.loamy_is_admin())
  ));

drop trigger if exists loamy_vreviews_assign_ref on public.verification_reviews;
create trigger loamy_vreviews_assign_ref
  before insert on public.verification_reviews
  for each row execute function public.loamy_assign_ref('verification_review', 'VRV');

-- ----------------------------------------------------------------------------
-- 4. Anti-fraud thresholds — configurable, never hardcoded.
-- ----------------------------------------------------------------------------
update public.platform_config
set settings = jsonb_build_object(
      'verification_max_distance_m',   5000,   -- evidence further than this is flagged
      'verification_max_gps_accuracy_m', 100,  -- coarser fixes are flagged
      'verification_sample_rate_pct',  10      -- share of clean cases spot-checked
    ) || coalesce(settings, '{}'::jsonb)
where id = 1;

-- ----------------------------------------------------------------------------
-- 5. Submitting evidence — the only write path, and where fraud checks run.
-- ----------------------------------------------------------------------------
/**
 * Flags, never blocks. A suspicious capture is recorded WITH its flags and
 * surfaced to the reviewer, because a hard block would teach agents to work
 * around the check and would lose the signal. The reviewer decides.
 *
 * Checks: task-to-agent authorization, case state, timestamp sanity, GPS
 * presence/accuracy/plausibility, and re-used evidence.
 */
create or replace function public.loamy_submit_evidence(
  p_case_id       uuid,
  p_evidence_type text,
  p_captured_at   timestamptz,
  p_storage_path  text default null,
  p_content_hash  text default null,
  p_lat           numeric default null,
  p_lng           numeric default null,
  p_accuracy_m    numeric default null,
  p_device_hash   text default null,
  p_observation   jsonb default '{}'::jsonb,
  p_quantity      numeric default null,
  p_unit          text default null,
  p_note          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_case      public.verification_tasks%rowtype;
  v_flags     text[] := '{}';
  v_dist      numeric;
  v_max_dist  numeric;
  v_max_acc   numeric;
  v_id        uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_case from public.verification_tasks where id = p_case_id;
  if v_case.id is null then raise exception 'Verification case not found.'; end if;

  -- Task-to-agent authorization: only the assigned agent may submit.
  if v_case.assigned_to is distinct from v_uid then
    raise exception 'Only the agent assigned to this case can submit evidence.';
  end if;
  if v_case.status not in ('assigned','in_progress','resubmit_requested') then
    raise exception 'This case is % and is not accepting evidence.', v_case.status;
  end if;

  select coalesce((settings->>'verification_max_distance_m')::numeric, 5000),
         coalesce((settings->>'verification_max_gps_accuracy_m')::numeric, 100)
    into v_max_dist, v_max_acc
  from public.platform_config where id = 1;

  -- Timestamp sanity.
  if p_captured_at > now() + interval '5 minutes' then
    v_flags := array_append(v_flags, 'future_timestamp');
  end if;
  if p_captured_at < v_case.created_at then
    v_flags := array_append(v_flags, 'captured_before_case_existed');
  end if;

  -- GPS presence, accuracy and plausibility.
  if p_evidence_type in ('photo','video','gps_point','measurement') then
    if p_lat is null or p_lng is null then
      v_flags := array_append(v_flags, 'no_gps');
    else
      if p_accuracy_m is not null and p_accuracy_m > v_max_acc then
        v_flags := array_append(v_flags, 'low_gps_accuracy');
      end if;
      if v_case.expected_lat is not null and v_case.expected_lng is not null then
        v_dist := public.loamy_haversine_m(p_lat, p_lng, v_case.expected_lat, v_case.expected_lng);
        if v_dist > v_max_dist then
          v_flags := array_append(v_flags, 'gps_far_from_subject');
        end if;
      end if;
    end if;
  end if;

  -- Re-used evidence: the same file offered against a different case.
  if p_content_hash is not null and exists (
       select 1 from public.verification_evidence
       where content_hash = p_content_hash and case_id <> p_case_id) then
    v_flags := array_append(v_flags, 'duplicate_evidence');
  end if;

  insert into public.verification_evidence (
    case_id, evidence_type, storage_path, content_hash, captured_by, captured_at,
    captured_lat, captured_lng, gps_accuracy_m, device_hash, observation,
    quantity, unit, note, distance_from_subject_m, flags, status
  ) values (
    p_case_id, p_evidence_type, p_storage_path, p_content_hash, v_uid, p_captured_at,
    p_lat, p_lng, p_accuracy_m, p_device_hash, coalesce(p_observation, '{}'::jsonb),
    p_quantity, p_unit, p_note, v_dist, v_flags,
    case when array_length(v_flags, 1) is null then 'submitted' else 'flagged' end
  ) returning id into v_id;

  -- Bubble the flags up so a reviewer sees them on the case.
  update public.verification_tasks
     set status = case when status = 'assigned' then 'in_progress' else status end,
         flags  = (select array(select distinct unnest(flags || v_flags))),
         updated_at = now()
   where id = p_case_id;

  return jsonb_build_object('evidence_id', v_id, 'flags', to_jsonb(v_flags),
                            'distance_m', v_dist);
end;
$$;

revoke all on function public.loamy_submit_evidence(uuid,text,timestamptz,text,text,numeric,numeric,numeric,text,jsonb,numeric,text,text) from public, anon;
grant execute on function public.loamy_submit_evidence(uuid,text,timestamptz,text,text,numeric,numeric,numeric,text,jsonb,numeric,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Submitting the case for review.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_submit_verification_case(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_case public.verification_tasks%rowtype;
  v_n    int;
  v_rate numeric;
begin
  select * into v_case from public.verification_tasks where id = p_case_id;
  if v_case.id is null then raise exception 'Verification case not found.'; end if;
  if v_case.assigned_to is distinct from v_uid then
    raise exception 'Only the assigned agent can submit this case.';
  end if;
  if v_case.status not in ('assigned','in_progress','resubmit_requested') then
    raise exception 'This case is % and cannot be submitted.', v_case.status;
  end if;

  select count(*) into v_n from public.verification_evidence where case_id = p_case_id;
  if v_n = 0 then
    raise exception 'Submit at least one piece of evidence before sending this case for review.';
  end if;

  select coalesce((settings->>'verification_sample_rate_pct')::numeric, 10)
    into v_rate from public.platform_config where id = 1;

  update public.verification_tasks
     set status = 'submitted',
         submitted_at = now(),
         -- Spot-check a share of clean work too, so "no flags" is not a blind spot.
         sampled_for_review = (array_length(flags, 1) is not null)
                              or (random() * 100 < coalesce(v_rate, 10)),
         updated_at = now()
   where id = p_case_id;
end;
$$;

revoke all on function public.loamy_submit_verification_case(uuid) from public, anon;
grant execute on function public.loamy_submit_verification_case(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Review — platform only. This is where approval actually happens.
-- ----------------------------------------------------------------------------
/**
 * The separation the directive insists on: the agent who collected the
 * evidence can never be the reviewer, even if they are also an admin.
 *
 * On approval the outcome is APPLIED through the entity's own controlled path
 * (a batch goes through loamy_batch_transition, a farm through its status
 * column) rather than by writing 'verified' somewhere convenient.
 */
create or replace function public.loamy_review_verification_case(
  p_case_id  uuid,
  p_decision text,
  p_note     text default null,
  p_checklist jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_case public.verification_tasks%rowtype;
begin
  if not public.loamy_is_admin() then
    raise exception 'Only the platform can decide a verification.';
  end if;
  if p_decision not in ('approved','rejected','more_evidence_required') then
    raise exception 'Unknown decision: %', p_decision;
  end if;

  select * into v_case from public.verification_tasks where id = p_case_id for update;
  if v_case.id is null then raise exception 'Verification case not found.'; end if;
  if v_case.status <> 'submitted' then
    raise exception 'Only a submitted case can be reviewed (this one is %).', v_case.status;
  end if;

  -- Collector and approver must be different people, always.
  if v_case.assigned_to = v_uid then
    raise exception 'The agent who collected this evidence cannot also approve it.';
  end if;

  insert into public.verification_reviews (case_id, reviewer_id, decision, note, checklist, flags_at_review)
  values (p_case_id, v_uid, p_decision, p_note, coalesce(p_checklist, '{}'::jsonb), v_case.flags);

  update public.verification_tasks
     set status = case p_decision
                    when 'approved' then 'approved'
                    when 'rejected' then 'rejected'
                    else 'resubmit_requested' end,
         reviewer_id = v_uid,
         reviewer_note = p_note,
         completed_at = case when p_decision in ('approved','rejected') then now() else null end,
         updated_at = now()
   where id = p_case_id;

  update public.verification_evidence
     set status = case when p_decision = 'approved' then 'accepted'
                       when p_decision = 'rejected' then 'rejected'
                       else status end
   where case_id = p_case_id and status in ('submitted','flagged');

  -- Apply the outcome through the subject's own controlled path.
  if p_decision = 'approved' then
    if v_case.task_type = 'farm_verification' and v_case.subject_farm_id is not null then
      perform set_config('loamy.status_change_authorized', 'true', true);
      update public.farms set verification_status = 'verified' where id = v_case.subject_farm_id;
      perform set_config('loamy.status_change_authorized', 'false', true);
    elsif v_case.subject_type = 'commodity_batch' and v_case.subject_id is not null then
      perform public.loamy_batch_transition(
        v_case.subject_id, 'verified', null, 'verification_case', p_case_id,
        null, null, null, null, '{}'::jsonb, '{}'::jsonb, 'Approved verification');
    end if;

    -- Provenance: an approved field observation is a first-class fact.
    perform public.loamy_record_observation(
      coalesce(v_case.subject_type, 'farm'),
      coalesce(v_case.subject_id, v_case.subject_farm_id),
      'verification', 'field_captured', null, 'verified', null, null, 1.0,
      jsonb_build_object('case_ref', v_case.ref), p_note, now());
  end if;

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'admin', 'verification_decided', 'verification_case', p_case_id,
          jsonb_build_object('decision', p_decision, 'flags', to_jsonb(v_case.flags),
                             'agent', v_case.assigned_to));
end;
$$;

revoke all on function public.loamy_review_verification_case(uuid,text,text,jsonb) from public, anon;
grant execute on function public.loamy_review_verification_case(uuid,text,text,jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Directive-named view + agent performance.
-- ----------------------------------------------------------------------------
create or replace view public.loamy_verification_cases as
select
  t.id               as case_id,
  t.ref              as case_ref,
  t.task_type        as verification_type,
  coalesce(t.subject_type, case when t.subject_farm_id is not null then 'farm' end) as subject_type,
  coalesce(t.subject_id, t.subject_farm_id) as subject_id,
  t.subject_user_id,
  t.requested_by,
  t.assigned_to,
  t.status,
  t.priority,
  t.flags,
  t.sampled_for_review,
  t.expected_state,
  t.expected_lga,
  t.due_at,
  t.submitted_at,
  t.completed_at,
  t.created_at,
  t.updated_at,
  (select count(*) from public.verification_evidence e where e.case_id = t.id) as evidence_count
from public.verification_tasks t;

alter view public.loamy_verification_cases set (security_invoker = on);
grant select on public.loamy_verification_cases to authenticated;

-- Agent performance, for the review-sampling and pattern-detection the
-- directive asks for. Admin-only by virtue of the underlying RLS.
create or replace view public.loamy_partner_verification_stats as
select
  t.assigned_to                                             as partner_id,
  count(*)                                                  as cases_total,
  count(*) filter (where t.status = 'approved')             as cases_approved,
  count(*) filter (where t.status = 'rejected')             as cases_rejected,
  count(*) filter (where array_length(t.flags, 1) is not null) as cases_flagged,
  round(avg(extract(epoch from (t.submitted_at - t.created_at)) / 3600.0)::numeric, 1)
                                                            as avg_hours_to_submit,
  (select count(*) from public.verification_evidence e
    where e.captured_by = t.assigned_to and 'duplicate_evidence' = any (e.flags))
                                                            as duplicate_evidence_count
from public.verification_tasks t
where t.assigned_to is not null
group by t.assigned_to;

alter view public.loamy_partner_verification_stats set (security_invoker = on);
grant select on public.loamy_partner_verification_stats to authenticated;

comment on table public.verification_evidence is
  'Field evidence, one row per capture. Never detached from its case. Written only by loamy_submit_evidence, which stamps the collector and runs the fraud checks.';
comment on table public.verification_reviews is
  'Platform decisions. Separate from evidence by design: collection is not approval.';
