-- ============================================================================
-- BLOCK 5 (a) — Growth Partner operational identity, tasks and checklists.
-- ----------------------------------------------------------------------------
-- The Growth Partner is Loamy's distributed evidence layer. They convert
-- physical facts into structured digital evidence. They are NOT the final
-- authority, and nothing here lets them become one.
--
-- WHAT IS REUSED, deliberately:
--
--   partner_assignments   already models service areas as (state, lgas[]),
--                         many rows per partner. Nationwide by construction;
--                         no state is hard-coded anywhere. It gains commodity
--                         specialisation and a radius.
--   verification_tasks    already the authoritative case. Widened, not forked.
--   partner_earnings      already the commission record. Given a real state
--                         machine in (d) rather than a replacement table.
--   disputes              already the dispute concept. Made able to point at
--                         a verification case instead of growing a twin.
--
-- WHAT IS NEW, and why it could not be reused:
--
--   growth_partner_operations
--       training status, availability and suspension. These CANNOT live in
--       role_details, because role_data is owner-writable -- an agent would
--       be able to self-certify as trained and unsuspend themselves. This
--       table has no client write path at all.
--
--   verification_checklists
--       versioned question sets. A checklist that changed in place would
--       silently rewrite what every historical verification meant.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Operational state. Admin-written, agent-readable.
-- ----------------------------------------------------------------------------
create table if not exists public.growth_partner_operations (
  user_id          uuid primary key references public.profiles (id) on delete cascade,

  training_status  text not null default 'pending_training'
    check (training_status in ('pending_training','training_required','trained','suspended')),
  trained_at       timestamptz,
  trained_by       uuid references public.profiles (id) on delete set null,

  -- Task types this agent is cleared for. Empty = the unrestricted set only.
  cleared_task_types text[] not null default '{}',

  availability     text not null default 'available'
    check (availability in ('available','busy','unavailable')),
  -- The agent controls this one; everything else is admin-only.
  availability_note text,

  suspended        boolean not null default false,
  suspended_at     timestamptz,
  suspended_by     uuid references public.profiles (id) on delete set null,
  suspension_reason text,

  max_open_tasks   int not null default 5 check (max_open_tasks between 1 and 50),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.growth_partner_operations enable row level security;

comment on table public.growth_partner_operations is
  'BLOCK 5. Training, availability and suspension for a Growth Partner. Deliberately NOT in role_details, which is owner-writable -- an agent must not be able to certify or unsuspend themselves.';

drop policy if exists gp_ops_read on public.growth_partner_operations;
create policy gp_ops_read on public.growth_partner_operations
  for select to authenticated
  using (user_id = auth.uid() or public.loamy_is_admin());

-- No insert/update/delete policy. Everything goes through a function.
create or replace function public.loamy_gp_ops_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('loamy.gp_ops_authorized', true), '') <> 'true' then
    raise exception 'Growth Partner operational state is set through its own functions.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists loamy_gp_ops_guard on public.growth_partner_operations;
create trigger loamy_gp_ops_guard
  before insert or update or delete on public.growth_partner_operations
  for each row execute function public.loamy_gp_ops_guard();

-- ----------------------------------------------------------------------------
-- 2. Service areas: nationwide, multiple, specialised.
-- ----------------------------------------------------------------------------
alter table public.partner_assignments
  add column if not exists commodities   text[] not null default '{}',
  add column if not exists radius_km     numeric check (radius_km is null or radius_km > 0),
  add column if not exists communities   text[] not null default '{}',
  add column if not exists assigned_by   uuid references public.profiles (id) on delete set null,
  add column if not exists note          text;

comment on table public.partner_assignments is
  'BLOCK 5. A Growth Partner''s service areas: one row per (state, lgas[]). Many rows per partner, any state -- nothing restricts Loamy to a founding region.';

-- ----------------------------------------------------------------------------
-- 3. The controlled task-type vocabulary.
-- ----------------------------------------------------------------------------
alter table public.verification_tasks drop constraint if exists verification_tasks_task_type_check;
alter table public.verification_tasks add constraint verification_tasks_task_type_check
  check (task_type in (
    'identity_verification',
    'farmer_verification',
    'farm_verification',
    'farm_geospatial',
    'business_verification',
    'buyer_verification',
    'seller_verification',
    'commodity_verification',
    'batch_verification',
    'quantity_verification',
    'quality_verification',
    'transaction_verification',
    'loading_verification',
    'warehouse_verification',
    'warehouse_arrival_verification',
    'logistics_verification',
    'delivery_verification',
    'document_verification',
    'market_price_collection',
    'field_support'
  ));

-- Task types an agent may only take once cleared for them. A restricted type
-- touches money or someone's credit, so training is not optional.
create table if not exists public.restricted_task_types (
  task_type text primary key,
  reason    text not null
);
alter table public.restricted_task_types enable row level security;

drop policy if exists restricted_task_types_read on public.restricted_task_types;
create policy restricted_task_types_read on public.restricted_task_types
  for select to authenticated using (true);

insert into public.restricted_task_types (task_type, reason) values
  ('commodity_verification', 'Gates supplier-direct settlement.'),
  ('batch_verification',     'Gates supplier-direct settlement.'),
  ('quantity_verification',  'Determines what a buyer pays for.'),
  ('loading_verification',   'Evidence that goods actually moved.'),
  ('transaction_verification','Touches a live commercial agreement.'),
  ('document_verification',  'Handles third-party documents.')
on conflict (task_type) do nothing;

-- ----------------------------------------------------------------------------
-- 4. The full task lifecycle.
-- ----------------------------------------------------------------------------
alter table public.verification_tasks drop constraint if exists verification_tasks_status_check;
alter table public.verification_tasks add constraint verification_tasks_status_check
  check (status in (
    'pending',                  -- created, not yet published to agents
    'available',                -- open for an agent to claim
    'assigned',                 -- allocated to one agent
    'accepted',                 -- that agent has taken it on
    'in_progress',
    'submitted',                -- evidence submitted
    'under_review',
    'approved',
    'rejected',
    'needs_more_information',
    'resubmit_requested',       -- retained: the original word for the above
    'expired',
    'cancelled'
  ));

alter table public.verification_tasks
  add column if not exists accepted_at    timestamptz,
  add column if not exists assigned_at    timestamptz,
  add column if not exists expires_at     timestamptz,
  add column if not exists checklist_key  text,
  add column if not exists checklist_version int,
  add column if not exists related_transaction_id uuid
    references public.transactions (id) on delete set null,
  add column if not exists assignment_factors jsonb not null default '{}'::jsonb;

comment on column public.verification_tasks.assignment_factors is
  'BLOCK 5, directive 6. The factors that led to this assignment, recorded so the decision is auditable. Deliberately not a single opaque score.';

-- ONE agent at a time. The partial unique index is what makes double
-- assignment impossible rather than merely discouraged.
create unique index if not exists verification_tasks_one_live_agent
  on public.verification_tasks (id)
  where assigned_to is not null
    and status in ('assigned','accepted','in_progress','submitted','under_review');

create index if not exists verification_tasks_available_idx
  on public.verification_tasks (status, expires_at)
  where status in ('pending','available');

-- ----------------------------------------------------------------------------
-- 5. Versioned checklists.
-- ----------------------------------------------------------------------------
create table if not exists public.verification_checklists (
  id          uuid primary key default gen_random_uuid(),
  task_type   text not null,
  version     int not null check (version > 0),
  -- [{ key, label, kind: 'boolean'|'text'|'number', required }]
  items       jsonb not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  unique (task_type, version)
);

alter table public.verification_checklists enable row level security;

drop policy if exists checklists_read on public.verification_checklists;
create policy checklists_read on public.verification_checklists
  for select to authenticated using (true);
-- Written by migration only: a checklist edited in place would silently
-- rewrite what every past verification meant.

comment on table public.verification_checklists is
  'BLOCK 5, directive 15. Versioned question sets. A task records the key AND version it was answered against, so changing a checklist later never alters the meaning of historical records.';

insert into public.verification_checklists (task_type, version, items) values
  ('farm_verification', 1, '[
    {"key":"identity_confirmed","label":"Farmer identity confirmed","kind":"boolean","required":true},
    {"key":"farm_visited","label":"Farm physically visited","kind":"boolean","required":true},
    {"key":"gps_captured","label":"GPS captured at the farm","kind":"boolean","required":true},
    {"key":"photos_captured","label":"Photographs captured","kind":"boolean","required":true},
    {"key":"crop_observed","label":"Crop observed","kind":"text","required":true},
    {"key":"observed_hectares","label":"Observed area (hectares)","kind":"number","required":false},
    {"key":"farmer_present","label":"Farmer present during the visit","kind":"boolean","required":true},
    {"key":"farm_accessible","label":"Farm accessible by road","kind":"boolean","required":false},
    {"key":"anomaly","label":"Any anomaly observed","kind":"text","required":false},
    {"key":"agent_comments","label":"Agent comments","kind":"text","required":false}
  ]'::jsonb),
  ('commodity_verification', 1, '[
    {"key":"commodity_matches","label":"Commodity matches the listing","kind":"boolean","required":true},
    {"key":"quantity_observed","label":"Quantity observed","kind":"number","required":true},
    {"key":"unit","label":"Unit","kind":"text","required":true},
    {"key":"condition","label":"Condition of the stock","kind":"text","required":true},
    {"key":"storage_location","label":"Where the stock is held","kind":"text","required":true},
    {"key":"seller_present","label":"Seller or representative present","kind":"boolean","required":true},
    {"key":"gps_captured","label":"GPS captured at the store","kind":"boolean","required":true},
    {"key":"photos_captured","label":"Photographs captured","kind":"boolean","required":true},
    {"key":"available_for_sale","label":"Stock available for immediate sale","kind":"boolean","required":true},
    {"key":"anomaly","label":"Any anomaly observed","kind":"text","required":false}
  ]'::jsonb),
  ('loading_verification', 1, '[
    {"key":"commodity_matches","label":"Commodity matches the purchase","kind":"boolean","required":true},
    {"key":"quantity_loaded","label":"Quantity loaded","kind":"number","required":true},
    {"key":"unit","label":"Unit","kind":"text","required":true},
    {"key":"vehicle_registration","label":"Vehicle registration","kind":"text","required":true},
    {"key":"waybill_ref","label":"Waybill reference","kind":"text","required":false},
    {"key":"carrier_reference","label":"Driver or carrier reference","kind":"text","required":false},
    {"key":"photos_captured","label":"Loading photographed","kind":"boolean","required":true},
    {"key":"gps_captured","label":"GPS captured at the loading point","kind":"boolean","required":true},
    {"key":"anomaly","label":"Any anomaly observed","kind":"text","required":false}
  ]'::jsonb),
  ('market_price_collection', 1, '[
    {"key":"market_name","label":"Market visited","kind":"text","required":true},
    {"key":"commodity","label":"Commodity","kind":"text","required":true},
    {"key":"price_low","label":"Lowest price seen","kind":"number","required":true},
    {"key":"price_high","label":"Highest price seen","kind":"number","required":true},
    {"key":"unit","label":"Unit sold by","kind":"text","required":true},
    {"key":"traders_asked","label":"Number of traders asked","kind":"number","required":true},
    {"key":"photos_captured","label":"Market photographed","kind":"boolean","required":false}
  ]'::jsonb)
on conflict (task_type, version) do nothing;

/** The current checklist for a task type, with its version. */
create or replace function public.loamy_checklist_for(p_task_type text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when c.id is null then jsonb_build_object('available', false)
              else jsonb_build_object('available', true, 'task_type', c.task_type,
                                      'version', c.version, 'items', c.items) end
  from (select * from public.verification_checklists
         where task_type = p_task_type and active
         order by version desc limit 1) c
  right join (select 1) x on true;
$$;

grant execute on function public.loamy_checklist_for(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Server receipt time, alongside the device's own claim.
-- ----------------------------------------------------------------------------
alter table public.verification_evidence
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists clock_skew_seconds numeric,
  add column if not exists superseded_by uuid references public.verification_evidence (id)
    on delete set null;

comment on column public.verification_evidence.captured_at is
  'The DEVICE''s claim about when this was taken. Never authoritative on its own -- field phones drift.';
comment on column public.verification_evidence.received_at is
  'Server time. Authoritative for ordering. Directive 12.';
comment on column public.verification_evidence.superseded_by is
  'Set when a later capture replaces this one. The original is never deleted or overwritten -- directive 13.';

-- ----------------------------------------------------------------------------
-- 7. Disputes can point at a verification, not only a transaction.
-- ----------------------------------------------------------------------------
alter table public.disputes alter column transaction_id drop not null;
alter table public.disputes
  add column if not exists verification_case_id uuid
    references public.verification_tasks (id) on delete set null;

alter table public.disputes drop constraint if exists disputes_has_subject;
alter table public.disputes add constraint disputes_has_subject
  check (transaction_id is not null or verification_case_id is not null);

comment on column public.disputes.verification_case_id is
  'BLOCK 5, directive 30. A verification can be disputed without a transaction behind it. The dispute concept is reused rather than twinned.';

-- ----------------------------------------------------------------------------
-- 8. Market price collection: say what KIND of data this is.
-- ----------------------------------------------------------------------------
alter table public.market_price_updates
  add column if not exists data_class text not null default 'user_generated'
    check (data_class in ('observed','user_generated','model_inference')),
  add column if not exists collected_via_case uuid
    references public.verification_tasks (id) on delete set null,
  add column if not exists market_name text,
  add column if not exists traders_sampled int check (traders_sampled is null or traders_sampled >= 0);

comment on column public.market_price_updates.data_class is
  'BLOCK 5, directive 32. observed = a person physically saw it. user_generated = reported without field evidence. model_inference = computed. These must never be mixed: a prediction presented as an observation is a lie about provenance.';
