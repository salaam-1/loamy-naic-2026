-- ============================================================================
-- FIX — the application bundle leaked an internal user id.
-- ----------------------------------------------------------------------------
-- Slice 3 added the financing event trail to loamy_application_bundle so a
-- bank officer could see who did what. It returned `financing_events.detail`
-- VERBATIM, and that column is not a display payload -- it is an internal
-- record. `loamy_apply_financing_for_transaction` writes:
--
--   jsonb_build_object('transaction', v_t.id, 'commodity', v_t.commodity,
--                      'quantity', v_t.quantity, 'seller', v_t.seller_id, ...)
--
-- so every bundle carried the SELLER'S INTERNAL USER ID to the bank. Loamy's
-- standing rule is that internal ids are never exposed; the bundle already
-- takes care to send an applicant's display name and digital id rather than
-- their uuid, and this undid that in the same function.
--
-- Caught by the slice-3 security test "exposes no internal user id" -- which
-- had been passing vacuously because its own setup was failing silently on a
-- wrong column name, so the whole suite skipped. Two defects hiding each
-- other.
--
-- THE FIX: the trail returns only the fields a portal needs. `detail` is not
-- forwarded at all, because whitelisting a blob that other functions also
-- write to would break again the next time someone adds a key to it.
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

    'transaction', case when v_t.id is null then null else jsonb_build_object(
      'ref', v_t.ref, 'commodity', v_t.commodity,
      'quantity', v_t.quantity, 'unit', v_t.unit,
      'subtotal', v_t.subtotal, 'currency', v_t.currency,
      'status', v_t.status,
      'payment_state', v_t.payment_state,
      'fulfilment_state', v_t.fulfilment_state,
      -- Display name and state only; the same fields the public marketplace
      -- already publishes. No seller id, no contact, no seller financials.
      'seller_name', (select s.full_name from public.profiles s where s.id = v_t.seller_id),
      'seller_state', (select s.state from public.profiles s where s.id = v_t.seller_id),
      'batch_ref', (select cb.ref from public.commodity_batches cb where cb.id = v_t.batch_id)
    ) end,

    'bank', jsonb_build_object(
      'name', v_b.name, 'ref', v_b.ref,
      'integration_mode', coalesce(v_b.integration_mode, 'sandbox'),
      'is_sandbox', coalesce(v_b.integration_mode, 'sandbox') = 'sandbox',
      'supports_supplier_direct', coalesce(v_b.supports_supplier_direct, false)),

    'permitted_decisions', to_jsonb(public.loamy_financing_permitted_decisions(v_app.status)),

    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'event_type', e.event_type, 'actor_kind', e.actor_kind,
        'previous_status', e.previous_status, 'new_status', e.new_status,
        'amount', e.amount, 'note', e.note,
        -- NAMED FIELDS ONLY. `detail` is an internal record that other
        -- functions also write to -- forwarding it leaked the seller's user
        -- id, and whitelisting keys would break again the next time one is
        -- added.
        'source', e.detail->>'source',
        'is_sandbox', coalesce((e.detail->>'is_sandbox')::boolean, false),
        'tenor_days', (e.detail->>'tenor_days'),
        'bank_reference', e.detail->>'bank_reference',
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
