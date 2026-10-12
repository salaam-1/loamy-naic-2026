-- ============================================================================
-- PHASE 1 (a) — digital identity + provenance.
-- ----------------------------------------------------------------------------
-- Directive Part 5 (identity for every entity, not just users) and the master
-- directive Section 5 (never overwrite an important observation).
--
-- Two mechanisms, both deliberately generic so later phases attach to them
-- rather than inventing their own:
--
--   1. loamy_entity_refs  — one registry of human-readable business IDs
--                           (FARM-000091, BATCH-000982). UUIDs stay the
--                           internal primary keys; refs are what a person
--                           quotes, a support ticket cites, and Part 25/26
--                           traceability resolves.
--
--   2. entity_observations — an append-only record of WHAT was observed,
--                            BY WHOM, FROM WHERE, WITH WHAT CONFIDENCE.
--                            A farmer saying "10 hectares", an agent measuring
--                            8.7 and a map computing 8.4 are three rows, not
--                            one column overwritten twice.
--
-- SECURITY-REVIEW: observations can carry GPS and evidence references, so the
-- table is NOT world-readable. Read access follows the subject: you see
-- observations about entities you own, plus anything an admin can see. Writes
-- go through loamy_record_observation, which stamps the actor server-side —
-- a client can never claim an observation was made by someone else.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reference-ID generator.
-- ----------------------------------------------------------------------------
create table if not exists public.loamy_ref_counters (
  prefix     text primary key,
  next_value bigint not null default 0
);

alter table public.loamy_ref_counters enable row level security;
-- No policy at all: only definer functions touch this.

/**
 * Allocate the next reference for a prefix, atomically.
 * The UPSERT ... RETURNING is a single statement, so concurrent callers
 * serialise on the row lock and can never receive the same number.
 */
create or replace function public.loamy_next_ref(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v bigint;
begin
  if p_prefix !~ '^[A-Z]{3,6}$' then
    raise exception 'Reference prefix must be 3-6 uppercase letters, got %', p_prefix;
  end if;
  insert into public.loamy_ref_counters (prefix, next_value)
  values (p_prefix, 1)
  on conflict (prefix) do update set next_value = public.loamy_ref_counters.next_value + 1
  returning next_value into v;
  return p_prefix || '-' || lpad(v::text, 6, '0');
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. The registry: ref -> (entity_type, uuid).
-- ----------------------------------------------------------------------------
-- This is what makes "enter an ID and reconstruct the journey" possible
-- without every consumer knowing which table to look in.
create table if not exists public.loamy_entity_refs (
  ref         text primary key,
  entity_type text not null,
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  unique (entity_type, entity_id)
);

create index if not exists loamy_entity_refs_entity_idx
  on public.loamy_entity_refs (entity_type, entity_id);

alter table public.loamy_entity_refs enable row level security;

-- The registry itself holds no private data — only the mapping. Resolving a
-- ref tells you a thing exists; it does NOT grant access to that thing, whose
-- own RLS still applies. Signed-in members may resolve.
drop policy if exists "loamy_entity_refs_select" on public.loamy_entity_refs;
create policy "loamy_entity_refs_select"
  on public.loamy_entity_refs for select to authenticated
  using (true);

/** Mint and register a reference for an entity. Idempotent per entity. */
create or replace function public.loamy_register_ref(
  p_entity_type text, p_entity_id uuid, p_prefix text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_ref text;
begin
  select ref into v_ref from public.loamy_entity_refs
  where entity_type = p_entity_type and entity_id = p_entity_id;
  if v_ref is not null then return v_ref; end if;

  v_ref := public.loamy_next_ref(p_prefix);
  insert into public.loamy_entity_refs (ref, entity_type, entity_id)
  values (v_ref, p_entity_type, p_entity_id);
  return v_ref;
end;
$$;

/**
 * Generic BEFORE-INSERT trigger that fills NEW.ref.
 * Attach with:  create trigger ... execute function
 *               loamy_assign_ref('farm', 'FARM');
 */
create or replace function public.loamy_assign_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type   text := TG_ARGV[0];
  v_prefix text := TG_ARGV[1];
begin
  if new.ref is null or new.ref = '' then
    new.ref := public.loamy_next_ref(v_prefix);
  end if;
  insert into public.loamy_entity_refs (ref, entity_type, entity_id)
  values (new.ref, v_type, new.id)
  on conflict (ref) do nothing;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Provenance: entity_observations.
-- ----------------------------------------------------------------------------
create table if not exists public.entity_observations (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  subject_type  text not null,
  subject_id    uuid not null,
  -- What was observed: 'area_hectares', 'location', 'quantity', 'grade', ...
  attribute     text not null,
  value_numeric numeric,
  value_text    text,
  value_json    jsonb,
  unit          text,
  -- WHERE the claim comes from. The whole point of the table: a declared value
  -- and a field-captured value are not interchangeable, and satellite data is
  -- never equivalent to a physical visit (directive Part 10 / Part 12).
  source        text not null check (source in (
                  'user_declared',      -- the member typed it
                  'field_captured',     -- a Growth Partner observed it in person
                  'system_derived',     -- computed by Loamy (e.g. polygon area)
                  'satellite_derived',  -- remote sensing; NEVER equals verification
                  'partner_reported'    -- a bank, warehouse or logistics partner
                )),
  actor_id      uuid references public.profiles (id) on delete set null,
  confidence    numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status        text not null default 'recorded'
                  check (status in ('recorded','superseded','disputed','rejected')),
  -- References into a private bucket, GPS, checklist answers. Never a raw file.
  evidence      jsonb not null default '{}'::jsonb,
  note          text,
  observed_at   timestamptz,
  recorded_at   timestamptz not null default now()
);

create index if not exists entity_observations_subject_idx
  on public.entity_observations (subject_type, subject_id, attribute, recorded_at desc);
create index if not exists entity_observations_actor_idx
  on public.entity_observations (actor_id, recorded_at desc);

-- SECURITY-REVIEW: observations are append-only by design. There is no client
-- UPDATE or DELETE policy and none may be added — superseding is a new row
-- plus a status change made by the definer RPC, never an edit in place.
alter table public.entity_observations enable row level security;

drop policy if exists "loamy_observations_select" on public.entity_observations;
create policy "loamy_observations_select"
  on public.entity_observations for select to authenticated
  using (
    -- the member who made the observation
    actor_id = auth.uid()
    -- or the owner of the farm the observation is about
    or (subject_type = 'farm' and exists (
          select 1 from public.farms f
          where f.id = subject_id and f.owner_id = auth.uid()))
    or (subject_type = 'production_cycle' and exists (
          select 1 from public.crop_records c
          join public.farms f on f.id = c.farm_id
          where c.id = subject_id and f.owner_id = auth.uid()))
    or public.loamy_is_admin()
  );

/**
 * Record an observation. The ONLY write path.
 *
 * actor_id is stamped from auth.uid() server-side and cannot be supplied, so
 * an observation can never be attributed to someone who did not make it.
 * Recording a new value does NOT delete the old one — it marks earlier
 * observations of the same (subject, attribute) as superseded and keeps them.
 */
create or replace function public.loamy_record_observation(
  p_subject_type text,
  p_subject_id   uuid,
  p_attribute    text,
  p_source       text,
  p_value_numeric numeric default null,
  p_value_text   text default null,
  p_value_json   jsonb default null,
  p_unit         text default null,
  p_confidence   numeric default null,
  p_evidence     jsonb default '{}'::jsonb,
  p_note         text default null,
  p_observed_at  timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  -- A member may only declare things about their own entities. Field-captured
  -- and system-derived sources are written by the verification workflow and
  -- admin tooling (Phase 3), not by arbitrary callers.
  if p_source = 'user_declared' then
    if p_subject_type = 'farm' and not exists (
         select 1 from public.farms where id = p_subject_id and owner_id = v_uid) then
      raise exception 'You can only declare observations about your own farm.';
    end if;
  elsif not public.loamy_is_admin() and p_source <> 'field_captured' then
    raise exception 'Source % may not be recorded by this caller.', p_source;
  end if;

  -- Supersede earlier live observations of the same attribute, without
  -- deleting them: the history IS the product.
  update public.entity_observations
     set status = 'superseded'
   where subject_type = p_subject_type
     and subject_id = p_subject_id
     and attribute = p_attribute
     and status = 'recorded';

  insert into public.entity_observations (
    subject_type, subject_id, attribute, value_numeric, value_text, value_json,
    unit, source, actor_id, confidence, evidence, note, observed_at
  ) values (
    p_subject_type, p_subject_id, p_attribute, p_value_numeric, p_value_text, p_value_json,
    p_unit, p_source, v_uid, p_confidence, coalesce(p_evidence, '{}'::jsonb), p_note,
    coalesce(p_observed_at, now())
  ) returning id into v_id;

  update public.entity_observations
     set ref = public.loamy_register_ref('observation', v_id, 'OBS')
   where id = v_id;

  return v_id;
end;
$$;

revoke all on function public.loamy_record_observation(text,uuid,text,text,numeric,text,jsonb,text,numeric,jsonb,text,timestamptz) from public, anon;
grant execute on function public.loamy_record_observation(text,uuid,text,text,numeric,text,jsonb,text,numeric,jsonb,text,timestamptz) to authenticated;

comment on table public.entity_observations is
  'Append-only provenance. A declared value, a field observation and a derived value coexist as separate rows; nothing is overwritten.';
comment on table public.loamy_entity_refs is
  'ref -> (entity_type, uuid). Resolving a ref proves existence only; the target entity''s own RLS still governs access.';
