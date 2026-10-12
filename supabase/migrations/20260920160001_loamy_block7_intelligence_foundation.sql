-- ============================================================================
-- BLOCK 7 (a) — intelligence with lineage, and an evidence hierarchy.
-- ----------------------------------------------------------------------------
-- WHAT IS REUSED, deliberately:
--
--   discovery_events     already the behavioural log, already actor-stamped
--                        from auth.uid(), already readable only by its own
--                        actor. Block 7 adds NO second "user did something"
--                        table -- directive 3 is explicit and it is right.
--   market_price_updates already carries data_class (observed /
--                        user_generated / model_inference) from Block 5.
--   loamy_institutional_* already applies a k-anonymity FLOOR that withholds
--                        rather than rounds. Block 7 uses the same setting.
--
-- WHAT IS NEW, and why nothing existing could carry it:
--
--   intelligence_outputs   a GENERATED artefact with provenance. Nothing in
--                          the schema records "this conclusion, from this
--                          data, by this model version, at this time".
--                          Without it, directive 23/24 is impossible: a model
--                          change would silently rewrite history.
--
--   intelligence_feedback  directive 25. A member saying "not useful" must
--                          never touch the underlying observation, so it
--                          cannot live on the price row.
--
--   data_quality_findings  directive 28. Bad data is FLAGGED, never deleted,
--                          which needs somewhere to put the finding.
--
-- THE RULE THAT SHAPES EVERYTHING HERE: an inference must never be able to
-- pass as an observation. Classification is a NOT NULL column, not a
-- convention, and every reader gets it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The evidence hierarchy (directive 27).
-- ----------------------------------------------------------------------------
/**
 * Not all activity is equal, and treating it as equal is how a marketplace
 * convinces itself that demand exists because people looked.
 *
 * A completed transaction is the strongest evidence there is. A search is the
 * weakest. The weights are DATA so they can be tuned without a code change,
 * and they are returned alongside every signal so the arithmetic is visible.
 */
create table if not exists public.evidence_weights (
  signal_type text primary key,
  weight      numeric not null check (weight >= 0),
  tier        int not null check (tier between 1 and 8),
  note        text
);

alter table public.evidence_weights enable row level security;

drop policy if exists evidence_weights_read on public.evidence_weights;
create policy evidence_weights_read on public.evidence_weights
  for select to authenticated using (true);

insert into public.evidence_weights (signal_type, weight, tier, note) values
  ('complete_transaction',  100, 1, 'Money and goods actually moved.'),
  ('verified_batch',         60, 2, 'A Loamy agent physically saw the stock.'),
  ('accepted_order',         40, 3, 'Both parties agreed terms.'),
  ('request_financing',      25, 4, 'A buyer committed to an application.'),
  ('add_to_cart',            12, 5, 'Intent, but reversible and cheap.'),
  ('start_checkout',         15, 5, 'Stronger intent than a cart alone.'),
  ('enquire',                10, 5, 'A buyer took the trouble to ask.'),
  ('save_listing',            6, 6, 'Interest worth remembering.'),
  ('listing',                 5, 6, 'Claimed supply, not proven supply.'),
  ('view_listing',            2, 7, 'Attention, nothing more.'),
  ('view_seller',             2, 7, 'Attention, nothing more.'),
  ('search',                  1, 8, 'The weakest signal there is.')
on conflict (signal_type) do update
  set weight = excluded.weight, tier = excluded.tier, note = excluded.note;

comment on table public.evidence_weights is
  'BLOCK 7, directive 27. A completed transaction outweighs a search by two orders of magnitude, on purpose. Views are not demand.';

create or replace function public.loamy_evidence_weight(p_signal text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select weight from public.evidence_weights where signal_type = p_signal), 0);
$$;

grant execute on function public.loamy_evidence_weight(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Generated intelligence, with its lineage.
-- ----------------------------------------------------------------------------
create table if not exists public.intelligence_outputs (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,

  output_type   text not null check (output_type in (
    'demand_signal','supply_signal','price_pattern','seasonal_pattern',
    'funnel','data_quality','market_summary'
  )),

  -- Directive 2. NOT NULL, so an inference can never be silently filed as an
  -- observation.
  classification text not null check (classification in (
    'observed',          -- counted from records that exist
    'user_generated',    -- reported by a member, unverified
    'model_inference'    -- computed or predicted
  )),

  -- What it is about.
  commodity     text,
  state         text,
  market        text,
  period_start  timestamptz,
  period_end    timestamptz,

  -- The conclusion, and the arithmetic behind it.
  headline      text not null,
  value_numeric numeric,
  value_text    text,
  -- { population, observations, sources[], weights, breakdown }
  evidence      jsonb not null default '{}'::jsonb,

  -- Directive 23/24. A later model must not rewrite an earlier answer.
  model_key     text not null default 'deterministic_v1',
  model_version text not null default '1',
  inputs_digest text,

  -- Honest limits, carried with the output.
  confidence    text check (confidence is null or confidence in ('low','medium','high')),
  limitations   text,

  -- Superseded, never overwritten.
  superseded_by uuid references public.intelligence_outputs (id) on delete set null,

  -- Who may see it. Null = any signed-in member.
  audience      text check (audience is null or audience in
                  ('member','admin','institution','bank')),
  audience_id   uuid references public.profiles (id) on delete cascade,

  generated_at  timestamptz not null default now(),
  generated_by  uuid references public.profiles (id) on delete set null
);

create index if not exists intelligence_outputs_lookup_idx
  on public.intelligence_outputs (output_type, commodity, state, generated_at desc);
create index if not exists intelligence_outputs_current_idx
  on public.intelligence_outputs (output_type, generated_at desc)
  where superseded_by is null;

alter table public.intelligence_outputs enable row level security;

comment on table public.intelligence_outputs is
  'BLOCK 7, directive 21/23/24. A generated insight WITH its lineage: what, from what, by which model version, when. Append-only and superseded rather than rewritten, so a model change never rewrites history.';

drop policy if exists intelligence_outputs_read on public.intelligence_outputs;
create policy intelligence_outputs_read on public.intelligence_outputs
  for select to authenticated
  using (
    public.loamy_is_admin()
    or (audience is null)
    or (audience = 'member' and audience_id = auth.uid())
    or (audience = 'institution' and public.loamy_has_institutional_scope('aggregate_trade'))
  );

create or replace function public.loamy_intelligence_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('loamy.intelligence_authorized', true), '') <> 'true' then
    raise exception 'Intelligence outputs are written by the intelligence workflow.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Intelligence history is never deleted. Supersede it instead.';
  end if;
  -- Directive 24: the conclusion and its provenance are frozen once written.
  if tg_op = 'UPDATE' then
    if new.headline is distinct from old.headline
       or new.classification is distinct from old.classification
       or new.evidence is distinct from old.evidence
       or new.model_version is distinct from old.model_version
       or new.value_numeric is distinct from old.value_numeric then
      raise exception 'A generated insight cannot be edited. Generate a new one and supersede this.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists loamy_intelligence_outputs_guard on public.intelligence_outputs;
create trigger loamy_intelligence_outputs_guard
  before insert or update or delete on public.intelligence_outputs
  for each row execute function public.loamy_intelligence_guard();

drop trigger if exists loamy_intelligence_outputs_ref on public.intelligence_outputs;
create trigger loamy_intelligence_outputs_ref
  before insert on public.intelligence_outputs
  for each row execute function public.loamy_assign_ref('intelligence_output', 'INS');

-- ----------------------------------------------------------------------------
-- 3. Feedback, kept away from the source data.
-- ----------------------------------------------------------------------------
create table if not exists public.intelligence_feedback (
  id         uuid primary key default gen_random_uuid(),
  output_id  uuid not null references public.intelligence_outputs (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  verdict    text not null check (verdict in ('useful','not_useful','incorrect','outdated')),
  note       text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (output_id, user_id)
);

alter table public.intelligence_feedback enable row level security;

comment on table public.intelligence_feedback is
  'BLOCK 7, directive 25. Separate from source data ON PURPOSE: a member clicking "not useful" must never alter an observed price.';

drop policy if exists intelligence_feedback_own on public.intelligence_feedback;
create policy intelligence_feedback_own on public.intelligence_feedback
  for select to authenticated
  using (user_id = auth.uid() or public.loamy_is_admin());

drop policy if exists intelligence_feedback_insert on public.intelligence_feedback;
create policy intelligence_feedback_insert on public.intelligence_feedback
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists intelligence_feedback_update on public.intelligence_feedback;
create policy intelligence_feedback_update on public.intelligence_feedback
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The actor is who you are, whatever the payload claimed.
create or replace function public.loamy_feedback_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  if new.user_id is null then raise exception 'Not signed in.'; end if;
  return new;
end;
$$;

drop trigger if exists loamy_intelligence_feedback_actor on public.intelligence_feedback;
create trigger loamy_intelligence_feedback_actor
  before insert or update on public.intelligence_feedback
  for each row execute function public.loamy_feedback_actor();

-- ----------------------------------------------------------------------------
-- 4. Data quality findings (directive 28).
-- ----------------------------------------------------------------------------
create table if not exists public.data_quality_findings (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique,
  finding     text not null check (finding in (
    'duplicate_listing','impossible_quantity','missing_unit','stale_price',
    'incompatible_unit','invalid_location','missing_timestamp',
    'abnormal_transaction','duplicate_batch_evidence','negative_availability'
  )),
  subject_type text not null,
  subject_id   uuid,
  detail       jsonb not null default '{}'::jsonb,
  severity     text not null default 'review' check (severity in ('info','review','urgent')),
  status       text not null default 'open' check (status in ('open','acknowledged','resolved','not_an_issue')),
  resolution_note text,
  resolved_by  uuid references public.profiles (id) on delete set null,
  detected_at  timestamptz not null default now(),
  resolved_at  timestamptz
);

create index if not exists dq_findings_open_idx
  on public.data_quality_findings (finding, status, detected_at desc);

alter table public.data_quality_findings enable row level security;

comment on table public.data_quality_findings is
  'BLOCK 7, directive 28. Bad data is FLAGGED and kept, never silently deleted -- deleting it destroys the evidence of how it got there.';

drop policy if exists dq_findings_admin on public.data_quality_findings;
create policy dq_findings_admin on public.data_quality_findings
  for select to authenticated using (public.loamy_is_admin());

create or replace function public.loamy_dq_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('loamy.intelligence_authorized', true), '') <> 'true' then
    raise exception 'Data quality findings are written by the quality workflow.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A data quality finding is resolved, never deleted.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists loamy_dq_findings_guard on public.data_quality_findings;
create trigger loamy_dq_findings_guard
  before insert or update or delete on public.data_quality_findings
  for each row execute function public.loamy_dq_guard();

drop trigger if exists loamy_dq_findings_ref on public.data_quality_findings;
create trigger loamy_dq_findings_ref
  before insert on public.data_quality_findings
  for each row execute function public.loamy_assign_ref('data_quality_finding', 'DQF');

-- ----------------------------------------------------------------------------
-- 5. Recording an insight, with its lineage.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_record_intelligence(
  p_output_type    text,
  p_classification text,
  p_headline       text,
  p_evidence       jsonb,
  p_commodity      text default null,
  p_state          text default null,
  p_market         text default null,
  p_period_start   timestamptz default null,
  p_period_end     timestamptz default null,
  p_value_numeric  numeric default null,
  p_value_text     text default null,
  p_model_key      text default 'deterministic_v1',
  p_model_version  text default '1',
  p_confidence     text default null,
  p_limitations    text default null,
  p_audience       text default null,
  p_audience_id    uuid default null,
  p_supersedes     uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if not public.loamy_is_admin() then
    raise exception 'Intelligence is generated by the platform, not by members.';
  end if;

  -- An insight with no evidence is an opinion. Directive 22.
  if p_evidence is null or p_evidence = '{}'::jsonb then
    raise exception 'An intelligence output must carry its evidence.';
  end if;
  if not (p_evidence ? 'population') then
    raise exception 'An intelligence output must state the population it was drawn from.';
  end if;

  perform set_config('loamy.intelligence_authorized', 'true', true);

  insert into public.intelligence_outputs (
    output_type, classification, commodity, state, market,
    period_start, period_end, headline, value_numeric, value_text,
    evidence, model_key, model_version,
    inputs_digest, confidence, limitations, audience, audience_id, generated_by)
  values (
    p_output_type, p_classification, p_commodity, p_state, p_market,
    p_period_start, p_period_end, p_headline, p_value_numeric, p_value_text,
    p_evidence, p_model_key, p_model_version,
    md5(coalesce(p_evidence::text, '') || coalesce(p_commodity, '') || coalesce(p_state, '')),
    p_confidence, p_limitations, p_audience, p_audience_id, v_uid)
  returning id into v_id;

  -- Supersede rather than overwrite. Both rows survive.
  if p_supersedes is not null then
    update public.intelligence_outputs set superseded_by = v_id where id = p_supersedes;
  end if;

  perform set_config('loamy.intelligence_authorized', 'false', true);

  return jsonb_build_object('recorded', true, 'output_id', v_id);
end;
$$;

revoke all on function public.loamy_record_intelligence(
  text,text,text,jsonb,text,text,text,timestamptz,timestamptz,numeric,text,
  text,text,text,text,text,uuid,uuid) from public, anon;
grant execute on function public.loamy_record_intelligence(
  text,text,text,jsonb,text,text,text,timestamptz,timestamptz,numeric,text,
  text,text,text,text,text,uuid,uuid) to authenticated;
