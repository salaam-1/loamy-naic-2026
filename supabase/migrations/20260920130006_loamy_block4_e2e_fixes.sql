-- ============================================================================
-- BLOCK 4 (f) — three defects the end-to-end test exposed.
-- ----------------------------------------------------------------------------
-- 1. VERIFYING SOLD STOCK WAS IMPOSSIBLE, and the reason is a conflation.
--
--    commodity_batches carries TWO orthogonal facts:
--      status              where the batch is in its commercial life
--      verification_status whether someone physically looked at it
--
--    Approving a verification fired a lifecycle transition to 'verified',
--    which is only reachable from created/listed/pending. So the moment a
--    batch was reserved by a buyer -- which is exactly when financing needs
--    it inspected -- verification became impossible:
--
--      "A batch that is reserved cannot go to verified"
--
--    Widening allowed_from would have been worse: 'verified' as a LIFECYCLE
--    status on a sold batch would regress it, losing the sale. The fix is to
--    stop conflating them. Past 'listed', approval sets verification_status
--    and leaves the commercial status alone.
--
-- 2. A SELLER COULD NOT SAY WHERE THEY GET PAID. seller_payout_accounts had
--    a SELECT policy and nothing else -- it was built for an Edge Function to
--    write. The settlement gate then failed forever on seller_payout_ready,
--    with no way for the seller to fix it. Now they can register their own,
--    through a function that audits the change.
--
-- 3. commodity_batches has origin_lga and current_location, not current_lga.
--    The transport request referenced a column that does not exist.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Verification no longer overwrites commercial status.
-- ----------------------------------------------------------------------------
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
  v_batch public.commodity_batches%rowtype;
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
      select * into v_batch from public.commodity_batches where id = v_case.subject_id;

      -- Verification is a FACT ABOUT THE STOCK, not a position in its
      -- commercial life. 'verified' as a LIFECYCLE status is only reachable
      -- from created/listed/pending, so a batch reserved by a buyer -- which
      -- is exactly when financing needs it inspected -- could never be
      -- verified at all. Widening the rule would be worse: it would regress a
      -- sold batch and lose the sale. So past 'listed', record the fact and
      -- leave the commercial status alone.
      if v_batch.status in ('created','listed','pending') then
        perform public.loamy_batch_transition(
          v_case.subject_id, 'verified', null, 'verification_case', p_case_id,
          null, null, null, null, '{}'::jsonb, '{}'::jsonb, 'Approved verification');
      else
        perform set_config('loamy.batch_system_authorized', 'true', true);
        update public.commodity_batches
           set verification_status = 'verified', updated_at = now()
         where id = v_case.subject_id;
        perform set_config('loamy.batch_system_authorized', 'false', true);

        insert into public.batch_events (
          batch_id, event_type, actor_id, previous_status, new_status,
          quantity_after, subject_type, subject_id, note)
        values (v_case.subject_id, 'verified', v_uid, v_batch.status, v_batch.status,
                v_batch.available_quantity, 'verification_case', p_case_id,
                'Verified while ' || v_batch.status || ' -- commercial status unchanged');
      end if;
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
grant execute on function public.loamy_review_verification_case(uuid,text,text,jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. A seller registers where they are paid.
-- ----------------------------------------------------------------------------
/**
 * Self-service, own row only, audited.
 *
 * The full account number is held because a transfer needs it. Nothing else
 * about the member's banking is stored here, and this is a PAYOUT
 * destination -- it is not, and must not become, a KYC record. Identity
 * verification belongs to the bank.
 */
create or replace function public.loamy_set_payout_account(
  p_bank_code      text,
  p_account_number text,
  p_bank_name      text default null,
  p_account_name   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_existing boolean;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if not public.loamy_is_active(v_uid) then raise exception 'This account is not active.'; end if;

  if coalesce(trim(p_bank_code), '') = '' then
    return jsonb_build_object('saved', false, 'reason', 'no_bank_code');
  end if;
  if p_account_number !~ '^[0-9]{10}$' then
    return jsonb_build_object('saved', false, 'reason', 'invalid_account_number',
      'message', 'A Nigerian account number is 10 digits.');
  end if;

  select exists (select 1 from public.seller_payout_accounts where user_id = v_uid)
    into v_existing;

  insert into public.seller_payout_accounts (
    user_id, bank_code, bank_name, account_number, account_name)
  values (v_uid, trim(p_bank_code), nullif(trim(coalesce(p_bank_name, '')), ''),
          trim(p_account_number), nullif(trim(coalesce(p_account_name, '')), ''))
  on conflict (user_id) do update
    set bank_code = excluded.bank_code,
        bank_name = coalesce(excluded.bank_name, public.seller_payout_accounts.bank_name),
        account_number = excluded.account_number,
        account_name = coalesce(excluded.account_name, public.seller_payout_accounts.account_name),
        -- A changed destination invalidates any previously resolved recipient.
        recipient_code = case when excluded.account_number
                                  is distinct from public.seller_payout_accounts.account_number
                             then null else public.seller_payout_accounts.recipient_code end;

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'member',
          case when v_existing then 'payout_account_changed' else 'payout_account_set' end,
          'profile', v_uid,
          -- Last four only in the audit trail. The log does not need the number.
          jsonb_build_object('bank_code', trim(p_bank_code),
                             'account_last4', right(trim(p_account_number), 4)));

  return jsonb_build_object('saved', true, 'changed', v_existing);
end;
$$;

revoke all on function public.loamy_set_payout_account(text,text,text,text) from public, anon;
grant execute on function public.loamy_set_payout_account(text,text,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The transport request referenced a column that does not exist.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_request_transport_for_transaction(
  p_transaction_id uuid,
  p_mode           text default 'loamy',
  p_pickup         text default null,
  p_dropoff        text default null,
  p_requested_date date default null,
  p_external_provider text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.transactions%rowtype;
  v_b   public.commodity_batches%rowtype;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if v_t.buyer_id <> v_uid and not public.loamy_is_admin() then
    raise exception 'Only the buyer arranges delivery for this purchase.';
  end if;
  if p_mode not in ('loamy','external') then
    raise exception 'Transport mode must be loamy or external.';
  end if;
  if v_t.status in ('cancelled','rejected','expired') then
    raise exception 'That purchase is %.', v_t.status;
  end if;

  if v_t.fulfilment_state = 'not_started' then
    return jsonb_build_object('created', false, 'reason', 'too_early',
      'message', 'Arrange transport once the seller has scheduled loading.');
  end if;

  if exists (select 1 from public.transport_jobs
             where transaction_id = p_transaction_id
               and status not in ('cancelled','failed')) then
    select id into v_id from public.transport_jobs
     where transaction_id = p_transaction_id and status not in ('cancelled','failed')
     order by created_at desc limit 1;
    return jsonb_build_object('created', false, 'reason', 'already_arranged', 'job_id', v_id);
  end if;

  if v_t.batch_id is not null then
    select * into v_b from public.commodity_batches where id = v_t.batch_id;
  end if;

  insert into public.transport_jobs (
    transaction_id, batch_id, requested_by, mode,
    pickup_location, dropoff_location,
    pickup_state, dropoff_state,
    commodity, quantity, unit,
    external_provider_name,
    status)
  values (
    p_transaction_id, v_t.batch_id, v_uid, p_mode,
    coalesce(p_pickup, v_b.current_location, v_b.origin_lga),
    p_dropoff,
    coalesce(v_b.current_state, v_b.origin_state),
    coalesce(v_t.delivery_state, p_dropoff),
    v_t.commodity, v_t.quantity, v_t.unit,
    case when p_mode = 'external' then p_external_provider end,
    case when p_mode = 'external' then 'booked' else 'broadcast' end)
  returning id into v_id;

  return jsonb_build_object('created', true, 'job_id', v_id, 'mode', p_mode);
end;
$$;

revoke all on function public.loamy_request_transport_for_transaction(
  uuid,text,text,text,date,text) from public, anon;
grant execute on function public.loamy_request_transport_for_transaction(
  uuid,text,text,text,date,text) to authenticated;
