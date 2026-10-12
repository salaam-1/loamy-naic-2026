-- ============================================================================
-- FEE RULE LIFECYCLE — a guarded, audited, reversible server-side operation.
-- ----------------------------------------------------------------------------
-- WHAT HAPPENED
--   On 2026-09-21 at 11:30:55 the ₦2,500 verification_commission rule for
--   farm_verification (FEE-000022) was ended by an accidental click in the
--   admin fee surface. From that moment loamy_accrue_commission returned
--   {"reason":"no_commission_rule"} and every Growth Partner who completed an
--   approved farm verification accrued NOTHING. Nobody was told. There was no
--   confirmation step, no reason recorded, no audit row, and no way back.
--
-- WHY IT WAS POSSIBLE
--   `loamy_fee_schedules_write_admin` was a single `FOR ALL` policy, so the
--   browser could UPDATE the table directly. AdminFees.tsx did exactly that:
--   one onClick, one `update({active:false, effective_to:now})`, live.
--
--   A fee rule is not ordinary configuration. It decides what members are
--   charged and what partners are paid, it takes effect for everyone the
--   instant it changes, and `loamy_resolve_fee` requires ALL THREE of
--   `active`, `effective_from <= now()` and `effective_to is null or > now()`
--   -- so ending a rule is a two-column change that silently disables a
--   payout path.
--
-- WHAT THIS MIGRATION DOES
--   1. Removes UPDATE and DELETE on fee_schedules from every client,
--      including admin. Read stays open, INSERT stays admin-only (creating a
--      rule is a deliberate form with validation). Ending a rule now has
--      exactly one door.
--   2. loamy_end_fee_rule  -- admin only, REQUIRES a written reason, refuses
--      to end a rule twice, and writes an audit row naming the amount and
--      scope it just switched off.
--   3. loamy_restore_fee_rule -- the way back. It does NOT reopen the ended
--      row (see below); it clones it into a NEW rule effective from now.
--
-- WHY RESTORE CREATES A NEW RULE RATHER THAN REACTIVATING THE OLD ONE
--   Because `effective_from`/`effective_to` describe a PERIOD DURING WHICH A
--   RULE WAS IN FORCE, and that period is a historical fact. FEE-000022 was
--   genuinely in force from 2026-09-20 09:50:49 to 2026-09-21 11:30:55 and
--   genuinely was not in force afterwards. Clearing its `effective_to` would
--   assert it had been in force continuously, which is false, and would erase
--   the evidence that a gap existed -- a gap during which real approved work
--   accrued nothing and reconciliation must be able to see why.
--
--   Historical accuracy does not depend on the schedule row anyway: every
--   transaction and every partner earning carries its own `fee_snapshot`,
--   frozen at the moment it resolved. Past records are unaffected either way.
--   So the honest repair is a new period, starting now, never backdated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Close the direct-mutation door.
-- ----------------------------------------------------------------------------
drop policy if exists "loamy_fee_schedules_write_admin" on public.fee_schedules;

-- Creating a rule stays a direct, admin-only insert: it goes through a form
-- that validates basis/cap/min interactions, and a new rule cannot silently
-- switch anything OFF.
drop policy if exists "loamy_fee_schedules_insert_admin" on public.fee_schedules;
create policy "loamy_fee_schedules_insert_admin"
  on public.fee_schedules for insert to authenticated
  with check (public.loamy_is_admin());

-- NO update policy and NO delete policy, deliberately. PostgREST reports zero
-- rows matched rather than an error for an unpermitted UPDATE, so a client
-- that tries anyway fails silently and changes nothing -- which is the
-- outcome we want. Ending a rule goes through loamy_end_fee_rule.
comment on table public.fee_schedules is
  'Fee rules. INSERT is admin-only; UPDATE and DELETE are granted to NOBODY. A rule is ended through loamy_end_fee_rule and reinstated through loamy_restore_fee_rule, both of which require a reason and write an audit row. Direct mutation was removed after an accidental click disabled the Growth Partner commission on 2026-09-21.';

-- ----------------------------------------------------------------------------
-- 2. Ending a rule — deliberate, explained, audited.
-- ----------------------------------------------------------------------------
/**
 * End a fee rule.
 *
 * Not a delete and not a rate edit: a fee rule is a historical fact about a
 * period, and settlement reconciliation has to be able to find the rule that
 * was in force at any past moment.
 *
 * A reason is mandatory. The accidental end that prompted this function would
 * have been impossible to explain afterwards -- `created_by` was null, no
 * audit row existed, and the only evidence was a timestamp.
 */
create or replace function public.loamy_end_fee_rule(
  p_rule_id uuid,
  p_reason  text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r public.fee_schedules%rowtype;
begin
  if not public.loamy_is_admin() then
    raise exception 'Fee rules are administrative.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why this rule is being ended. It changes what members are charged or what partners are paid.';
  end if;

  select * into v_r from public.fee_schedules where id = p_rule_id for update;
  if v_r.id is null then raise exception 'Fee rule not found.'; end if;

  -- Idempotent, so a double-click cannot move effective_to a second time and
  -- quietly rewrite when the rule stopped applying.
  if not v_r.active or (v_r.effective_to is not null and v_r.effective_to <= now()) then
    return jsonb_build_object(
      'ended', false, 'reason', 'already_ended',
      'ref', v_r.ref, 'effective_to', v_r.effective_to);
  end if;

  update public.fee_schedules
     set active = false, effective_to = now()
   where id = p_rule_id;

  -- Names the money, so the audit trail is readable without a join.
  perform public.loamy_audit_internal(
    'fee_rule_ended', 'fee_schedule', p_rule_id,
    jsonb_build_object(
      'ref', v_r.ref, 'scope', v_r.scope, 'transaction_type', v_r.transaction_type,
      'basis', v_r.basis, 'value', v_r.value, 'payer', v_r.payer,
      'reason', btrim(p_reason)));

  return jsonb_build_object(
    'ended', true, 'ref', v_r.ref, 'scope', v_r.scope,
    'value', v_r.value, 'basis', v_r.basis);
end;
$$;

revoke all on function public.loamy_end_fee_rule(uuid, text) from public, anon;
grant execute on function public.loamy_end_fee_rule(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The way back.
-- ----------------------------------------------------------------------------
/**
 * Reinstate an ended rule as a NEW rule effective from now.
 *
 * Copies every commercial term from the source -- basis, value, payer, min,
 * max, scope and every narrowing dimension -- so a restore cannot become a
 * quiet rate change. The ONLY things that differ are `effective_from` (now,
 * never backdated), `created_by` (whoever restored it), and a note pointing
 * at the rule it came from.
 *
 * The source row is left exactly as it is. See the header: its closed period
 * is a fact, and the gap it leaves is evidence that reconciliation needs.
 */
create or replace function public.loamy_restore_fee_rule(
  p_rule_id uuid,
  p_reason  text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.fee_schedules%rowtype;
  v_new_id  uuid;
  v_new_ref text;
  v_live    text;
begin
  if not public.loamy_is_admin() then
    raise exception 'Fee rules are administrative.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why this rule is being reinstated.';
  end if;

  select * into v_src from public.fee_schedules where id = p_rule_id;
  if v_src.id is null then raise exception 'Fee rule not found.'; end if;

  if v_src.active and (v_src.effective_to is null or v_src.effective_to > now()) then
    return jsonb_build_object('restored', false, 'reason', 'still_in_force', 'ref', v_src.ref);
  end if;

  -- A second click must not create a second identical rule. Two rules of
  -- equal specificity for one scope is exactly the ambiguity the resolver
  -- has to break by date, and it is never what anybody intended.
  select f.ref into v_live
  from public.fee_schedules f
  where f.scope = v_src.scope
    and f.transaction_type is not distinct from v_src.transaction_type
    and f.user_role        is not distinct from v_src.user_role
    and f.partner_id       is not distinct from v_src.partner_id
    and f.commodity_group  is not distinct from v_src.commodity_group
    and f.active
    and f.effective_from <= now()
    and (f.effective_to is null or f.effective_to > now())
  limit 1;

  if v_live is not null then
    return jsonb_build_object(
      'restored', false, 'reason', 'equivalent_rule_already_in_force', 'ref', v_live);
  end if;

  insert into public.fee_schedules (
    scope, transaction_type, user_role, partner_id, commodity_group,
    basis, value, payer, min_fee, max_fee,
    active, effective_from, effective_to, note, created_by)
  values (
    v_src.scope, v_src.transaction_type, v_src.user_role, v_src.partner_id, v_src.commodity_group,
    -- Every commercial term copied verbatim. A restore is not a rate change.
    v_src.basis, v_src.value, v_src.payer, v_src.min_fee, v_src.max_fee,
    true,
    now(),   -- explicit, and never backdated
    null,
    'Reinstates ' || coalesce(v_src.ref, v_src.id::text) || ': ' || btrim(p_reason),
    auth.uid())
  returning id, ref into v_new_id, v_new_ref;

  perform public.loamy_audit_internal(
    'fee_rule_restored', 'fee_schedule', v_new_id,
    jsonb_build_object(
      'restored_from', v_src.ref, 'restored_from_id', v_src.id,
      'new_ref', v_new_ref, 'scope', v_src.scope,
      'transaction_type', v_src.transaction_type,
      'basis', v_src.basis, 'value', v_src.value, 'payer', v_src.payer,
      -- Recorded so the outage is measurable afterwards.
      'gap_from', v_src.effective_to, 'gap_to', now(),
      'reason', btrim(p_reason)));

  return jsonb_build_object(
    'restored', true, 'new_ref', v_new_ref, 'new_id', v_new_id,
    'restored_from', v_src.ref, 'scope', v_src.scope,
    'value', v_src.value, 'basis', v_src.basis, 'payer', v_src.payer,
    'gap_from', v_src.effective_to, 'gap_to', now());
end;
$$;

revoke all on function public.loamy_restore_fee_rule(uuid, text) from public, anon;
grant execute on function public.loamy_restore_fee_rule(uuid, text) to authenticated;
