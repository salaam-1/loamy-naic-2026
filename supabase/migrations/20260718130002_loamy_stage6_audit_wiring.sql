-- ============================================================================
-- Loamy Platform · Stage 6 · Migration 2 of 3
-- Wires the audit trail + suspension checks into the EXISTING security-
-- definer functions and adds definer triggers at the remaining key mutation
-- points. Function behavior is otherwise unchanged.
-- ============================================================================

-- ---- Suspension checks in capability helpers -------------------------------
create or replace function public.loamy_officer_bank(p_user uuid default auth.uid())
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.profiles p
  join public.role_details rd on rd.user_id = p.id
  join public.banks b on b.id = (rd.role_data ->> 'bank_id')::uuid
  where p.id = p_user
    and p.platform_role = 'bank'
    and p.active
    and coalesce((rd.role_data ->> 'active')::boolean, true)
    and b.active;
$$;

create or replace function public.loamy_can_verify(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (rd.role_data ->> 'can_verify')::boolean
     from public.role_details rd
     join public.profiles p on p.id = rd.user_id
     where rd.user_id = p_user and p.platform_role = 'growth_partner' and p.active),
    false
  );
$$;

-- ---- can_verify grants: audit ----------------------------------------------
create or replace function public.loamy_set_can_verify(p_user uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_user and platform_role = 'growth_partner'
  ) then
    raise exception 'User is not a growth partner';
  end if;

  insert into public.role_details (user_id, role_data)
  values (p_user, jsonb_build_object('can_verify', p_value))
  on conflict (user_id)
  do update set role_data = public.role_details.role_data || jsonb_build_object('can_verify', p_value),
                updated_at = now();

  perform public.loamy_audit_internal(
    case when p_value then 'can_verify_granted' else 'can_verify_revoked' end,
    'profile', p_user, '{}'::jsonb);

  perform public.loamy_create_notification_internal(
    p_user,
    case when p_value then 'Verification capability granted' else 'Verification capability revoked' end,
    case when p_value
      then 'You can now claim and complete farm verification tasks in your territory.'
      else 'Your verification capability has been revoked by an administrator.' end,
    'verification');
end;
$$;

-- ---- Verification review: audit --------------------------------------------
create or replace function public.loamy_review_verification_task(
  p_task uuid, p_decision text, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.verification_tasks%rowtype;
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if p_decision not in ('approved','rejected','resubmit_requested') then
    raise exception 'Invalid decision';
  end if;
  select * into v_task from public.verification_tasks where id = p_task for update;
  if v_task.id is null or v_task.status <> 'submitted' then
    raise exception 'Only submitted tasks can be reviewed';
  end if;

  perform set_config('loamy.status_change_authorized', 'true', true);

  update public.verification_tasks
  set status = p_decision,
      reviewer_id = auth.uid(),
      reviewer_note = p_note,
      completed_at = case when p_decision in ('approved','rejected') then now() else null end
  where id = p_task;

  if p_decision = 'approved' then
    update public.farms set verification_status = 'verified' where id = v_task.subject_farm_id;
    update public.profiles set verified_badge = true where id = v_task.subject_user_id;
    perform public.loamy_accrue_earning_internal(v_task.assigned_to, 'verification', v_task.id);
  elsif p_decision = 'rejected' then
    update public.farms set verification_status = 'rejected' where id = v_task.subject_farm_id;
  end if;

  perform set_config('loamy.status_change_authorized', '', true);

  perform public.loamy_audit_internal('verification_' || p_decision, 'verification_task', p_task,
    jsonb_build_object('farm_id', v_task.subject_farm_id, 'partner_id', v_task.assigned_to,
                       'note', p_note));

  if v_task.assigned_to is not null then
    perform public.loamy_create_notification_internal(
      v_task.assigned_to,
      case p_decision
        when 'approved' then 'Verification approved'
        when 'rejected' then 'Verification rejected'
        else 'Resubmission requested' end,
      coalesce(p_note, ''), 'verification');
  end if;
  perform public.loamy_create_notification_internal(
    v_task.subject_user_id,
    case p_decision
      when 'approved' then 'Your farm is now verified'
      when 'rejected' then 'Farm verification unsuccessful'
      else 'Verification needs another visit' end,
    case p_decision
      when 'approved' then 'Your farm passed field verification. Your marketplace profile now carries the verified badge.'
      when 'rejected' then 'The field verification could not confirm your farm details. Review your farm profile and request verification again.'
      else 'The review team asked the field partner to gather more evidence. No action needed from you yet.' end,
    'verification');
end;
$$;

-- ---- Bank status transitions: suspension check + audit ---------------------
create or replace function public.loamy_bank_set_status(
  p_app uuid, p_status text, p_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app  public.financing_applications%rowtype;
  v_bank uuid := public.loamy_officer_bank();
begin
  if v_bank is null then
    raise exception 'Bank officers only';
  end if;
  if p_status not in ('under_review','info_requested','decided_external') then
    raise exception 'Invalid status for bank transition';
  end if;
  select * into v_app from public.financing_applications where id = p_app for update;
  if v_app.id is null or v_app.bank_id is distinct from v_bank then
    raise exception 'Application not found for your bank';
  end if;
  if v_app.status not in ('submitted','under_review','info_requested') then
    raise exception 'Application is not in a reviewable state (%)', v_app.status;
  end if;
  if p_status = 'decided_external' and coalesce(btrim(p_message), '') = '' then
    raise exception 'A decision note is required (e.g. "Decision communicated to applicant on <date>")';
  end if;

  update public.financing_applications
  set status = p_status,
      reviewed_by = auth.uid(),
      decision_note = case when p_status = 'decided_external' then p_message else decision_note end
  where id = p_app;

  perform public.loamy_audit_internal('application_' || p_status, 'financing_application', p_app,
    jsonb_build_object('bank_id', v_bank));

  perform public.loamy_create_notification_internal(
    v_app.applicant_id,
    case p_status
      when 'under_review' then 'Application under review'
      when 'info_requested' then 'Bank requested more information'
      else 'Decision communicated by your bank' end,
    case p_status
      when 'under_review' then 'The partner bank is reviewing your financing application.'
      when 'info_requested' then coalesce(p_message, 'Please review your application details.')
      else 'The bank has made its decision and communicates it to you directly. Note: ' || p_message end,
    'financing');
end;
$$;

-- ---- Bank officer lifecycle: audit -----------------------------------------
create or replace function public.loamy_setup_bank_officer(p_user uuid, p_bank uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if not exists (select 1 from public.banks where id = p_bank) then
    raise exception 'Bank not found';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'User not found';
  end if;

  update public.profiles
  set platform_role = 'bank', onboarding_complete = true
  where id = p_user;

  insert into public.role_details (user_id, role_data)
  values (p_user, jsonb_build_object('bank_id', p_bank, 'active', true))
  on conflict (user_id)
  do update set role_data = public.role_details.role_data
                || jsonb_build_object('bank_id', p_bank, 'active', true),
                updated_at = now();

  perform public.loamy_audit_internal('bank_officer_created', 'profile', p_user,
    jsonb_build_object('bank_id', p_bank));

  for v_admin in select id from public.profiles where role = 'admin' loop
    perform public.loamy_create_notification_internal(
      v_admin, 'Bank officer account created',
      'A new bank officer was assigned to ' ||
        (select name from public.banks where id = p_bank) || '.',
      'admin');
  end loop;

  perform public.loamy_create_notification_internal(
    p_user, 'Bank portal access granted',
    'Your account has access to the ' ||
      (select name from public.banks where id = p_bank) || ' portal on Loamy.',
    'bank');
end;
$$;

create or replace function public.loamy_set_bank_officer_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_user and platform_role = 'bank'
  ) then
    raise exception 'User is not a bank officer';
  end if;
  update public.role_details
  set role_data = role_data || jsonb_build_object('active', p_active),
      updated_at = now()
  where user_id = p_user;
  perform public.loamy_audit_internal(
    case when p_active then 'bank_officer_reactivated' else 'bank_officer_deactivated' end,
    'profile', p_user, '{}'::jsonb);
end;
$$;

-- ---- Suspension checks in actor paths --------------------------------------
-- Request-verification and referral attribution refuse suspended actors.
-- (Bodies otherwise identical to Stage 4/5 versions.)
create or replace function public.loamy_guard_active_actor()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.loamy_is_active(auth.uid()) then
    raise exception 'This account is deactivated. Contact the Loamy team.';
  end if;
end;
$$;

revoke all on function public.loamy_guard_active_actor() from public;
revoke all on function public.loamy_guard_active_actor() from anon;
grant execute on function public.loamy_guard_active_actor() to authenticated;

-- Prepend the active-actor guard by wrapping the two farmer/partner actions.
create or replace function public.loamy_request_farm_verification_guarded(p_farm_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.loamy_guard_active_actor();
  perform public.loamy_request_farm_verification(p_farm_id);
end;
$$;

revoke all on function public.loamy_request_farm_verification_guarded(uuid) from public;
revoke all on function public.loamy_request_farm_verification_guarded(uuid) from anon;
grant execute on function public.loamy_request_farm_verification_guarded(uuid) to authenticated;

-- ---- Definer triggers at remaining key mutation points ---------------------
create or replace function public.loamy_audit_price_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.loamy_audit_internal('price_entered', 'market_price', new.id,
    jsonb_build_object('commodity', new.commodity, 'state', new.state,
                       'price_per_kg', new.price_per_kg));
  return new;
end;
$$;

drop trigger if exists loamy_market_prices_audit on public.market_prices;
create trigger loamy_market_prices_audit
  after insert on public.market_prices
  for each row execute function public.loamy_audit_price_entry();

create or replace function public.loamy_audit_config_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.loamy_audit_internal('config_changed', 'platform_config', null,
    jsonb_build_object(
      'flags_before', old.flags, 'flags_after', new.flags,
      'rates_before', old.partner_rates, 'rates_after', new.partner_rates));
  return new;
end;
$$;

drop trigger if exists loamy_platform_config_audit on public.platform_config;
create trigger loamy_platform_config_audit
  after update on public.platform_config
  for each row execute function public.loamy_audit_config_change();

create or replace function public.loamy_audit_app_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.loamy_audit_internal('application_status_changed',
      'financing_application', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_financing_audit on public.financing_applications;
create trigger loamy_financing_audit
  after update on public.financing_applications
  for each row execute function public.loamy_audit_app_transition();
