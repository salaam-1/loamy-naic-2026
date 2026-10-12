-- ============================================================================
-- PHASE 4 SLICE 3 — make the bank financing decision reachable.
-- ----------------------------------------------------------------------------
-- The decision engine already exists and is correct: loamy_financing_decision
-- validates the amount, derives the actor and the bank from the session,
-- records provenance, marks sandbox results, and writes an append-only event.
-- Nothing here replaces any of that. No new financing engine, no new table.
--
-- What is missing is everything AROUND it:
--
--   1. The bank loses SELECT on an application the moment it decides one,
--      because loamy_financing_select_bank still lists the four Stage 5
--      statuses. Approve, and the row vanishes from your own portal.
--   2. loamy_bank_pipeline carries the same stale four-value filter, so a
--      decided application drops out of the queue as well.
--   3. loamy_application_bundle -- the bank's ENTIRE window onto an
--      application, since officers have no raw table access -- predates
--      Phase 6. It carries no application ref, no transaction context, and
--      none of the decision fields, so the portal could not display the
--      provenance or the sandbox warning even if it wanted to.
--   4. Nothing tells the UI which decisions are valid right now, so a portal
--      would have to hard-code a transition table that could drift from the
--      function's own guard.
--
-- SECURITY-REVIEW ** THE ONE BOUNDARY THAT MATTERS **
--   Widening a status list is not widening access. Every change below keeps
--   `bank_id = public.loamy_officer_bank()` exactly as it was, and keeps
--   drafts invisible to banks. A bank officer seeing another bank's
--   application would be a regulatory incident, and no statement here relaxes
--   that predicate. The slice-3 security tests assert it from both sides.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The bank keeps reading its own application after deciding it.
-- ----------------------------------------------------------------------------
-- Stage 5 predated approve/reject, so its status list stops at
-- decided_external. The fix is to name the lifecycle rather than a snapshot of
-- it: everything EXCEPT draft, for the assigned bank only.
drop policy if exists "loamy_financing_select_bank" on public.financing_applications;
create policy "loamy_financing_select_bank"
  on public.financing_applications for select to authenticated
  using (
    -- Drafts remain invisible to banks by definition; an applicant has not
    -- asked anyone to look at them yet.
    status <> 'draft'
    -- UNCHANGED, and the reason this policy exists at all.
    and bank_id = public.loamy_officer_bank()
  );

comment on policy "loamy_financing_select_bank" on public.financing_applications is
  'Officers of the ASSIGNED bank read every non-draft status. Widened in Phase 4 slice 3 from the four Stage 5 statuses, which made an application disappear from its own bank the moment that bank approved it. The bank_id predicate is unchanged.';

-- ----------------------------------------------------------------------------
-- 2. Which decisions may be OFFERED — one definition, used by both sides.
-- ----------------------------------------------------------------------------
/**
 * The single source of truth for "what can this application do next".
 *
 * Deliberately NARROWER than loamy_financing_decision's own guard, never
 * wider. The guard refuses only disbursed/completed/cancelled/expired, which
 * would technically allow re-deciding an approved application; that is a
 * correction path the bank may legitimately need, so it is left alone. But it
 * must not be OFFERED as a button, because a portal showing "Approve" on an
 * already-approved application is telling the officer something false.
 *
 * Returning this from the server rather than hard-coding it in the client
 * means the portal cannot drift from the database, and a client that ignores
 * it still meets the guard.
 */
create or replace function public.loamy_financing_permitted_decisions(p_status text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_status
    -- Not visible to a bank at all; see the select policy above.
    when 'draft' then array[]::text[]
    when 'submitted' then array[
      'under_review','additional_information_required',
      'approved','partially_approved','rejected']
    when 'under_review' then array[
      'additional_information_required',
      'approved','partially_approved','rejected']
    -- Two words for one state. info_requested is the legacy value written by
    -- loamy_bank_set_status; additional_information_required is what the
    -- authoritative function writes. Both behave identically here.
    when 'info_requested' then array[
      'under_review','approved','partially_approved','rejected']
    when 'additional_information_required' then array[
      'under_review','approved','partially_approved','rejected']
    -- Already decided. A correction remains possible through the function,
    -- but it is not an action the portal invites.
    when 'approved' then array[]::text[]
    when 'partially_approved' then array[]::text[]
    when 'rejected' then array[]::text[]
    when 'decided_external' then array[]::text[]
    -- Terminal, and refused by the guard itself.
    else array[]::text[]
  end;
$$;

revoke all on function public.loamy_financing_permitted_decisions(text) from public, anon;
grant execute on function public.loamy_financing_permitted_decisions(text) to authenticated;

comment on function public.loamy_financing_permitted_decisions(text) is
  'Decisions a portal may OFFER for an application in this status. Narrower than loamy_financing_decision''s guard, never wider -- the guard stays authoritative.';

-- ----------------------------------------------------------------------------
-- 3. A draft was never submitted, so it cannot be decided.
-- ----------------------------------------------------------------------------
-- The only impossible transition the guard did not block. An applicant may
-- create a draft naming a bank, and an officer of that bank could then decide
-- an application nobody had submitted. RLS and the bundle both hide drafts, so
-- this was narrow, but a draft is in no permitted path.
--
-- Everything else in this function is UNCHANGED. It is reproduced in full
-- because CREATE OR REPLACE requires the whole body, not because it was
-- rewritten -- compare against 20260920130001.
create or replace function public.loamy_financing_decision(
  p_application_id uuid,
  p_decision       text,
  p_approved_amount numeric default null,
  p_conditions     text default null,
  p_note           text default null,
  p_tenor_days     int default null,
  p_pricing_note   text default null,
  p_bank_reference text default null,
  p_expires_at     timestamptz default null,
  p_source         text default 'bank_officer'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_a    public.financing_applications%rowtype;
  v_bank uuid := public.loamy_officer_bank();
  v_b    public.banks%rowtype;
  v_sandbox boolean := false;
begin
  select * into v_a from public.financing_applications where id = p_application_id for update;
  if v_a.id is null then raise exception 'Application not found.'; end if;

  -- Only an officer of the ASSIGNED bank, or an admin acting for them.
  if not (public.loamy_is_admin() or (v_bank is not null and v_a.bank_id = v_bank)) then
    raise exception 'Only the assigned bank can decide this application.';
  end if;
  if p_decision not in ('approved','partially_approved','rejected',
                        'additional_information_required','under_review') then
    raise exception 'Unknown decision: %', p_decision;
  end if;
  -- NEW in slice 3: a draft has not been submitted to anyone.
  if v_a.status = 'draft' then
    raise exception 'This application has not been submitted yet.';
  end if;
  if v_a.status in ('disbursed','completed','cancelled','expired') then
    raise exception 'This application is % and cannot be re-decided.', v_a.status;
  end if;
  if p_source not in ('bank_officer','bank_api','sandbox_adapter') then
    raise exception 'Unknown decision source: %', p_source;
  end if;

  select * into v_b from public.banks where id = v_a.bank_id;
  v_sandbox := coalesce(v_b.integration_mode, 'sandbox') = 'sandbox'
               or p_source = 'sandbox_adapter';

  -- A sandbox adapter may not write a decision for a bank that is LIVE. The
  -- simulator must never be able to produce a real-looking approval.
  if p_source = 'sandbox_adapter' and coalesce(v_b.integration_mode, '') = 'live' then
    raise exception 'The sandbox adapter cannot decide for a live bank integration.';
  end if;

  if p_decision in ('approved','partially_approved') then
    if p_approved_amount is null or p_approved_amount <= 0 then
      raise exception 'An approval needs an approved amount.';
    end if;
    if p_approved_amount > v_a.amount_requested then
      raise exception 'Approved amount cannot exceed the amount requested.';
    end if;
  end if;

  perform set_config('loamy.financing_decision_authorized', 'true', true);
  update public.financing_applications
     set status = p_decision,
         approved_amount = case when p_decision in ('approved','partially_approved')
                                then p_approved_amount else approved_amount end,
         conditions    = coalesce(p_conditions, conditions),
         decision_note = coalesce(p_note, decision_note),
         tenor_days    = coalesce(p_tenor_days, tenor_days),
         pricing_note  = coalesce(p_pricing_note, pricing_note),
         bank_reference = coalesce(p_bank_reference, bank_reference),
         expires_at    = coalesce(p_expires_at, expires_at),
         decision_source = p_source,
         is_sandbox    = v_sandbox,
         reviewed_by   = v_uid,
         decided_at    = case when p_decision in ('approved','partially_approved','rejected')
                              then now() else decided_at end,
         updated_at    = now()
   where id = p_application_id;
  perform set_config('loamy.financing_decision_authorized', 'false', true);

  insert into public.financing_events (
    application_id, event_type, actor_id, actor_kind, previous_status, new_status, amount, note, detail)
  values (p_application_id, p_decision, v_uid, 'bank', v_a.status, p_decision,
          p_approved_amount, p_note,
          jsonb_build_object('source', p_source, 'is_sandbox', v_sandbox,
                             'tenor_days', p_tenor_days, 'bank_reference', p_bank_reference));

  insert into public.notifications (user_id, title, body, type)
  values (v_a.applicant_id, 'Financing update',
          case when v_sandbox
               then 'Your financing application has been updated (sandbox simulation).'
               else 'Your financing application has been updated by the bank.' end,
          'finance');

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'bank', 'financing_decision', 'financing_application', p_application_id,
          jsonb_build_object('decision', p_decision, 'approved_amount', p_approved_amount,
                             'source', p_source, 'is_sandbox', v_sandbox));
end;
$$;

revoke all on function public.loamy_financing_decision(
  uuid,text,numeric,text,text,int,text,text,timestamptz,text) from public, anon;
grant execute on function public.loamy_financing_decision(
  uuid,text,numeric,text,text,int,text,text,timestamptz,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The pipeline keeps decided applications, and carries enough to sort them.
-- ----------------------------------------------------------------------------
-- Dropped rather than replaced: the return type gains columns, which
-- CREATE OR REPLACE cannot do. BankPipeline.tsx is the only caller.
drop function if exists public.loamy_bank_pipeline();

create function public.loamy_bank_pipeline()
returns table (
  id uuid, ref text, applicant_name text, digital_id text, verified_badge boolean,
  product_type text, structure text, amount_requested numeric, approved_amount numeric,
  state text, status text, risk_tier text,
  is_sandbox boolean, decision_source text, decided_at timestamptz,
  transaction_ref text, commodity text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.ref, p.full_name, p.digital_id, p.verified_badge,
         a.product_type, a.structure, a.amount_requested, a.approved_amount,
         p.state, a.status, (public.loamy_risk_assessment(a.id) ->> 'tier'),
         a.is_sandbox, a.decision_source, a.decided_at,
         t.ref, coalesce(t.commodity, a.product_type),
         a.created_at
  from public.financing_applications a
  join public.profiles p on p.id = a.applicant_id
  left join public.transactions t on t.id = a.transaction_id
  where a.bank_id = public.loamy_officer_bank()
    -- The full lifecycle, not the four Stage 5 statuses. A decided
    -- application belongs in the bank's own record of what it decided.
    and a.status <> 'draft';
$$;

revoke all on function public.loamy_bank_pipeline() from public, anon;
grant execute on function public.loamy_bank_pipeline() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. The bundle carries the decision, its provenance, and its transaction.
-- ----------------------------------------------------------------------------
/**
 * The bank's entire window onto an application. Officers have NO raw table
 * access to applicant data, so anything the portal shows must come through
 * here.
 *
 * SECURITY-REVIEW ** WHAT SLICE 3 ADDED, AND WHY EACH IS SAFE **
 *   · application ref, and the decision fields (approved_amount, tenor_days,
 *     pricing_note, bank_reference, conditions, expires_at, decided_at,
 *     decision_source, is_sandbox) -- all written BY this bank, about its own
 *     application. Showing a bank its own decision discloses nothing new.
 *   · transaction context (ref, commodity, quantity, unit, subtotal,
 *     currency, status) -- this is what the bank is being asked to finance.
 *     Withholding it would be the actual defect.
 *   · seller display name and state -- the same fields loamy_public_listings
 *     already publishes to anyone browsing the marketplace. No seller id, no
 *     seller contact, no seller financials.
 *   · bank integration_mode and is_sandbox -- so the portal can say plainly
 *     that a decision is a simulation.
 *   · the financing_events trail for THIS application.
 *   · permitted_decisions, from the shared definition above.
 *
 *   Unchanged: the caller must be an admin or an officer of the assigned
 *   bank, and drafts are refused. No internal user id is exposed --
 *   applicant_id and seller_id are deliberately absent, as before.
 */
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
  v_t    public.transactions%rowtype;
  v_b    public.banks%rowtype;
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

  select * into v_t from public.transactions where id = v_app.transaction_id;
  select * into v_b from public.banks where id = v_app.bank_id;

  return jsonb_build_object(
    'application', jsonb_build_object(
      'id', v_app.id, 'ref', v_app.ref,
      'product_type', v_app.product_type, 'structure', v_app.structure,
      'amount_requested', v_app.amount_requested, 'purpose', v_app.purpose,
      'intended_items', v_app.intended_items,
      'disbursement_preference', v_app.disbursement_preference,
      'status', v_app.status, 'status_history', v_app.status_history,
      'decision_note', v_app.decision_note,
      -- The bank's own answer, read back to the bank.
      'approved_amount', v_app.approved_amount,
      'disbursed_amount', v_app.disbursed_amount,
      'conditions', v_app.conditions,
      'tenor_days', v_app.tenor_days,
      'pricing_note', v_app.pricing_note,
      'bank_reference', v_app.bank_reference,
      'expires_at', v_app.expires_at,
      'decided_at', v_app.decided_at,
      'decision_source', v_app.decision_source,
      'is_sandbox', v_app.is_sandbox,
      'repayment_status', v_app.repayment_status,
      'submitted_at', v_app.created_at, 'updated_at', v_app.updated_at),

    -- What the money is for. Null when the application is not
    -- transaction-linked (the older farmer input-financing path).
    'transaction', case when v_t.id is null then null else jsonb_build_object(
      'ref', v_t.ref, 'commodity', v_t.commodity,
      'quantity', v_t.quantity, 'unit', v_t.unit,
      'subtotal', v_t.subtotal, 'currency', v_t.currency,
      'status', v_t.status,
      'payment_state', v_t.payment_state,
      'fulfilment_state', v_t.fulfilment_state,
      -- Already public on the marketplace listing; no id, no contact.
      'seller_name', (select s.full_name from public.profiles s where s.id = v_t.seller_id),
      'seller_state', (select s.state from public.profiles s where s.id = v_t.seller_id),
      'batch_ref', (select cb.ref from public.commodity_batches cb where cb.id = v_t.batch_id)
    ) end,

    -- So the portal can say plainly whether this is a live integration.
    'bank', jsonb_build_object(
      'name', v_b.name, 'ref', v_b.ref,
      'integration_mode', coalesce(v_b.integration_mode, 'sandbox'),
      'is_sandbox', coalesce(v_b.integration_mode, 'sandbox') = 'sandbox',
      'supports_supplier_direct', coalesce(v_b.supports_supplier_direct, false)),

    'permitted_decisions', to_jsonb(public.loamy_financing_permitted_decisions(v_app.status)),

    -- The decision trail, so the portal is not the only record of who did what.
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'event_type', e.event_type, 'actor_kind', e.actor_kind,
        'previous_status', e.previous_status, 'new_status', e.new_status,
        'amount', e.amount, 'note', e.note, 'detail', e.detail,
        'occurred_at', e.occurred_at) order by e.occurred_at desc), '[]'::jsonb)
      from public.financing_events e where e.application_id = v_app.id),

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
          select max(t2.completed_at) from public.verification_tasks t2
          where t2.subject_farm_id = f.id and t2.status = 'approved'),
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
          'id', a.id, 'ref', a.ref,
          'amount_requested', a.amount_requested, 'status', a.status,
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

revoke all on function public.loamy_application_bundle(uuid) from public, anon;
grant execute on function public.loamy_application_bundle(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Deprecate the Stage 5 status path, without breaking it.
-- ----------------------------------------------------------------------------
-- loamy_bank_set_status still works and older data still carries the statuses
-- it wrote. It is not dropped: 'decided_external' rows exist in production and
-- that transition has no equivalent in the authoritative function. But new
-- review, information-request and decision traffic goes through
-- loamy_financing_decision, which records the note on the row, the provenance,
-- the sandbox flag, and an append-only event -- none of which this does.
comment on function public.loamy_bank_set_status(uuid, text, text) is
  'DEPRECATED (Phase 4 slice 3). Superseded by loamy_financing_decision, which records the decision, its provenance, the sandbox flag and an append-only event. Retained because decided_external has no equivalent there and live rows carry it. Its p_message is sent to the applicant as a notification and is NOT persisted on the application.';
