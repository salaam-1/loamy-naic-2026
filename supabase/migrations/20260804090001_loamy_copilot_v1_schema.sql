-- ============================================================================
-- Loamy Platform · Co-pilot v1 · Migration 1 of 1 (data foundation)
-- Additive schema for the retrieval-only Co-pilot assistant. NOTHING here is
-- activated: the `copilot` feature flag ships OFF (build-for-the-shelf).
--
-- Design rules encoded by this schema:
--   • The Co-pilot answers ONLY from uploaded rows (market_prices_history,
--     macro_context, market_events) and admin overrides (copilot_qa_overrides).
--     There is no table of model-generated "facts".
--   • It never predicts a price. `predictions` exists as an EMPTY seam, gated
--     behind a separate flag, for a future validated model — see HANDOFF.md.
--   • Every upload is a versioned batch (upload_batches); rollback = deactivate.
--   • NO livestock. market_prices_history.commodity is free text (the reference
--     set is broader than the 15-item marketplace taxonomy), so the livestock
--     exclusion is enforced at the upload portal, not by a CHECK here — the
--     upload validator MUST reject any livestock/animal-product commodity.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) upload_batches — every upload is a versioned, reversible batch. Created
--    first because the data tables reference it.
-- ----------------------------------------------------------------------------
create table if not exists public.upload_batches (
  id           uuid primary key default gen_random_uuid(),
  uploaded_by  uuid references public.profiles (id) on delete set null,
  uploaded_at  timestamptz not null default now(),
  file_name    text not null,
  row_count    integer not null default 0 check (row_count >= 0),
  data_type    text not null check (data_type in ('prices', 'macro', 'events')),
  notes        text,
  active       boolean not null default true
);

create index if not exists upload_batches_type_idx
  on public.upload_batches (data_type, uploaded_at desc);

-- Admin-only surface (the upload portal + batch manager live in the admin shell).
alter table public.upload_batches enable row level security;

drop policy if exists "loamy_upload_batches_select_admin" on public.upload_batches;
create policy "loamy_upload_batches_select_admin"
  on public.upload_batches for select to authenticated
  using (public.loamy_is_admin());

drop policy if exists "loamy_upload_batches_write_admin" on public.upload_batches;
create policy "loamy_upload_batches_write_admin"
  on public.upload_batches for all to authenticated
  using (public.loamy_is_admin())
  with check (public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 1) market_prices_history — the uploaded reference dataset. The single
--    source of truth for Price Check. Free-text commodity (broader than the
--    marketplace taxonomy); livestock excluded at upload time.
-- ----------------------------------------------------------------------------
create table if not exists public.market_prices_history (
  id                uuid primary key default gen_random_uuid(),
  date              date not null,
  state             text,
  lga               text,
  market            text,
  latitude          numeric,
  longitude         numeric,
  commodity         text not null,
  price_type        text not null check (price_type in ('retail', 'wholesale', 'farmgate')),
  price_ngn_per_kg  numeric not null check (price_ngn_per_kg > 0),
  source            text,
  quality_flag      text,
  upload_batch_id   uuid references public.upload_batches (id) on delete cascade,
  created_at        timestamptz not null default now()
);

create index if not exists market_prices_history_commodity_date_idx
  on public.market_prices_history (commodity, date);
create index if not exists market_prices_history_state_commodity_date_idx
  on public.market_prices_history (state, commodity, date);
create index if not exists market_prices_history_batch_idx
  on public.market_prices_history (upload_batch_id);

alter table public.market_prices_history enable row level security;

-- Every signed-in user reads the reference history.
drop policy if exists "loamy_mph_select" on public.market_prices_history;
create policy "loamy_mph_select"
  on public.market_prices_history for select to authenticated
  using (true);

-- Admin-only writes (INSERT/UPDATE/DELETE) — only through the upload portal.
drop policy if exists "loamy_mph_write_admin" on public.market_prices_history;
create policy "loamy_mph_write_admin"
  on public.market_prices_history for all to authenticated
  using (public.loamy_is_admin())
  with check (public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 2) macro_context — admin-uploaded FX / food-CPI series used to contextualise
--    (never to forecast) price movements.
-- ----------------------------------------------------------------------------
create table if not exists public.macro_context (
  id               uuid primary key default gen_random_uuid(),
  year             integer not null check (year between 1990 and 2100),
  month            integer not null check (month between 1 and 12),
  ngn_per_usd      numeric,
  food_cpi         numeric,
  upload_batch_id  uuid references public.upload_batches (id) on delete cascade,
  created_at       timestamptz not null default now()
);

create index if not exists macro_context_period_idx
  on public.macro_context (year, month);

alter table public.macro_context enable row level security;

drop policy if exists "loamy_macro_select" on public.macro_context;
create policy "loamy_macro_select"
  on public.macro_context for select to authenticated
  using (true);

drop policy if exists "loamy_macro_write_admin" on public.macro_context;
create policy "loamy_macro_write_admin"
  on public.macro_context for all to authenticated
  using (public.loamy_is_admin())
  with check (public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 3) market_events — dated, hand-verified events used to ANNOTATE charts and
--    explain historical movements. Never predictive.
-- ----------------------------------------------------------------------------
create table if not exists public.market_events (
  id               uuid primary key default gen_random_uuid(),
  start_date       date not null,
  end_date         date,
  event            text not null,
  region           text,
  upload_batch_id  uuid references public.upload_batches (id) on delete cascade
);

create index if not exists market_events_start_idx
  on public.market_events (start_date);

alter table public.market_events enable row level security;

drop policy if exists "loamy_market_events_select" on public.market_events;
create policy "loamy_market_events_select"
  on public.market_events for select to authenticated
  using (true);

drop policy if exists "loamy_market_events_write_admin" on public.market_events;
create policy "loamy_market_events_write_admin"
  on public.market_events for all to authenticated
  using (public.loamy_is_admin())
  with check (public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 4) copilot_conversations + copilot_messages — per-user chat threads.
-- SECURITY-REVIEW: conversation privacy. Conversation content may contain
-- business-sensitive detail. A user may read/insert ONLY their own threads and
-- messages; admin may read all (for the flagged-questions loop) but never write
-- as a user. Verify no policy path lets one user read another's rows via the
-- messages table (the messages policies re-check ownership through the parent
-- conversation, not just conversation_id equality).
-- ----------------------------------------------------------------------------
create table if not exists public.copilot_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  started_at  timestamptz not null default now(),
  language    text not null default 'en'
);

create index if not exists copilot_conversations_user_idx
  on public.copilot_conversations (user_id, started_at desc);

alter table public.copilot_conversations enable row level security;

drop policy if exists "loamy_copilot_conv_select_own" on public.copilot_conversations;
create policy "loamy_copilot_conv_select_own"
  on public.copilot_conversations for select to authenticated
  using (user_id = auth.uid() or public.loamy_is_admin());

drop policy if exists "loamy_copilot_conv_insert_own" on public.copilot_conversations;
create policy "loamy_copilot_conv_insert_own"
  on public.copilot_conversations for insert to authenticated
  with check (user_id = auth.uid());

create table if not exists public.copilot_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.copilot_conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  data_sources     jsonb not null default '[]'::jsonb,
  data_as_of       date,
  was_answered     boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists copilot_messages_conv_idx
  on public.copilot_messages (conversation_id, created_at);

alter table public.copilot_messages enable row level security;

-- Ownership is proven through the parent conversation, never trusted from the
-- client — this is the anti-cross-user-leakage guarantee.
drop policy if exists "loamy_copilot_msg_select_own" on public.copilot_messages;
create policy "loamy_copilot_msg_select_own"
  on public.copilot_messages for select to authenticated
  using (
    public.loamy_is_admin()
    or exists (
      select 1 from public.copilot_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "loamy_copilot_msg_insert_own" on public.copilot_messages;
create policy "loamy_copilot_msg_insert_own"
  on public.copilot_messages for insert to authenticated
  with check (
    exists (
      select 1 from public.copilot_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 5) copilot_qa_overrides — admin-authored answers that take precedence over
--    generated responses. Retrieval reads the ACTIVE ones; admin writes.
-- ----------------------------------------------------------------------------
create table if not exists public.copilot_qa_overrides (
  id                uuid primary key default gen_random_uuid(),
  question_pattern  text not null,
  answer            text not null,
  language          text not null default 'en',
  active            boolean not null default true,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists copilot_qa_overrides_active_idx
  on public.copilot_qa_overrides (active, language);

alter table public.copilot_qa_overrides enable row level security;

-- Any signed-in user's retrieval may read ACTIVE overrides; admin sees all.
drop policy if exists "loamy_copilot_overrides_select" on public.copilot_qa_overrides;
create policy "loamy_copilot_overrides_select"
  on public.copilot_qa_overrides for select to authenticated
  using (active or public.loamy_is_admin());

drop policy if exists "loamy_copilot_overrides_write_admin" on public.copilot_qa_overrides;
create policy "loamy_copilot_overrides_write_admin"
  on public.copilot_qa_overrides for all to authenticated
  using (public.loamy_is_admin())
  with check (public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 6) copilot_flagged_questions — the improvement loop. Every question the
--    Co-pilot could NOT answer from data lands here. A user logs their own;
--    admin reviews all.
-- ----------------------------------------------------------------------------
create table if not exists public.copilot_flagged_questions (
  id               uuid primary key default gen_random_uuid(),
  question         text not null,
  language         text not null default 'en',
  user_id          uuid references public.profiles (id) on delete set null,
  asked_at         timestamptz not null default now(),
  resolved         boolean not null default false,
  resolution_note  text
);

create index if not exists copilot_flagged_unresolved_idx
  on public.copilot_flagged_questions (resolved, asked_at desc);

alter table public.copilot_flagged_questions enable row level security;

-- Insert your own; only admin reads/updates (the review queue).
drop policy if exists "loamy_copilot_flagged_insert_own" on public.copilot_flagged_questions;
create policy "loamy_copilot_flagged_insert_own"
  on public.copilot_flagged_questions for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);

drop policy if exists "loamy_copilot_flagged_select_admin" on public.copilot_flagged_questions;
create policy "loamy_copilot_flagged_select_admin"
  on public.copilot_flagged_questions for select to authenticated
  using (public.loamy_is_admin());

drop policy if exists "loamy_copilot_flagged_update_admin" on public.copilot_flagged_questions;
create policy "loamy_copilot_flagged_update_admin"
  on public.copilot_flagged_questions for update to authenticated
  using (public.loamy_is_admin())
  with check (public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 7) predictions — FUTURE-MODEL SEAM ONLY. Ships EMPTY and unused, gated behind
--    the `copilot_predictions` flag (OFF). A validated model (beaten the naive
--    baseline) plugs in here without refactoring. The product must never render
--    a predicted price until that flag is deliberately turned on. See HANDOFF.md.
-- ----------------------------------------------------------------------------
create table if not exists public.predictions (
  id                uuid primary key default gen_random_uuid(),
  commodity         text not null,
  state             text,
  target_date       date not null,
  predicted_price   numeric,
  confidence_low    numeric,
  confidence_high   numeric,
  model_version     text,
  generated_at      timestamptz not null default now()
);

create index if not exists predictions_lookup_idx
  on public.predictions (commodity, state, target_date);

alter table public.predictions enable row level security;

drop policy if exists "loamy_predictions_select" on public.predictions;
create policy "loamy_predictions_select"
  on public.predictions for select to authenticated
  using (true);

drop policy if exists "loamy_predictions_write_admin" on public.predictions;
create policy "loamy_predictions_write_admin"
  on public.predictions for all to authenticated
  using (public.loamy_is_admin())
  with check (public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 8) Feature flags — BOTH ship OFF. `copilot` gates the whole assistant;
--    `copilot_predictions` gates the (empty) prediction seam independently.
-- ----------------------------------------------------------------------------
update public.platform_config
set flags = flags || '{"copilot": false, "copilot_predictions": false}'::jsonb
where id = 1;
