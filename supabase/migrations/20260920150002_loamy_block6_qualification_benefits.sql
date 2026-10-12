-- ============================================================================
-- BLOCK 6 (b) — qualification, benefits, and the legacy path split in two.
-- ----------------------------------------------------------------------------
-- REGISTERED IS NOT SUCCESSFUL (directive 5). A referral qualifies only when
-- the programme's own condition is met, and the condition is data.
--
-- THE LEGACY FUNCTION IS SPLIT ALONG THE LINE THAT MATTERS:
--
--   field_assisted   a Growth Partner physically onboarded a farmer. Real
--                    work, so it keeps a commission -- now through the Block 5
--                    fee schedule rather than the old rates blob.
--
--   referral_link    someone shared a link. That is not field work, and
--                    paying for it is the affiliate model Loamy has decided
--                    against. Benefits only.
--
-- It also repairs the function outright: since 20260920140004 it has been
-- inserting into partner_earnings without setting loamy.commission_authorized,
-- so every onboarding attribution has raised. No test covered it, which is
-- how it survived a full green suite.
-- ============================================================================

-- A rate for field-assisted onboarding, in the authoritative schedule rather
-- than platform_config.partner_rates.
insert into public.fee_schedules (scope, transaction_type, basis, value, payer, note)
select 'verification_commission', 'field_onboarding', 'flat',
       coalesce((select (partner_rates->>'onboarding')::numeric
                 from public.platform_config where id = 1), 500),
       'loamy',
       'Block 6: migrated from platform_config.partner_rates.onboarding.'
where not exists (
  select 1 from public.fee_schedules
  where scope = 'verification_commission' and transaction_type = 'field_onboarding');

-- ----------------------------------------------------------------------------
-- 1. Does this referral qualify yet?
-- ----------------------------------------------------------------------------
/**
 * Evaluates the programme's own rule against the referred member's state.
 * Returns the answer AND the evidence, so a member can see what is missing.
 */
create or replace function public.loamy_referral_qualifies(p_referral_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_r    public.referrals%rowtype;
  v_prog public.referral_programmes%rowtype;
  v_type text;
  v_met  boolean := false;
  v_detail jsonb;
  v_n    int;
begin
  select * into v_r from public.referrals where id = p_referral_id;
  if v_r.id is null then
    return jsonb_build_object('found', false);
  end if;
  select * into v_prog from public.referral_programmes where id = v_r.programme_id;

  v_type := coalesce(v_prog.qualification->>'type', 'profile_complete');

  if v_type = 'profile_complete' then
    select onboarding_complete into v_met from public.profiles where id = v_r.referred_id;
    v_detail := jsonb_build_object('needs', 'a completed profile');

  elsif v_type = 'identity_verified' then
    select coalesce(verified_badge, false) into v_met from public.profiles where id = v_r.referred_id;
    v_detail := jsonb_build_object('needs', 'a verified identity');

  elsif v_type = 'first_transaction' then
    select count(*) into v_n from public.transactions
     where (buyer_id = v_r.referred_id or seller_id = v_r.referred_id)
       and status = 'completed';
    v_met := v_n >= coalesce((v_prog.qualification->>'min_completed')::int, 1);
    v_detail := jsonb_build_object('needs', 'a completed marketplace transaction',
                                   'completed', v_n);

  elsif v_type = 'first_listing' then
    select count(*) into v_n from public.listings where seller_id = v_r.referred_id;
    v_met := v_n >= 1;
    v_detail := jsonb_build_object('needs', 'a first listing', 'listings', v_n);

  elsif v_type = 'manual' then
    v_met := false;
    v_detail := jsonb_build_object('needs', 'review by Loamy');

  else
    -- An unknown rule qualifies NOTHING. Failing open here would hand out
    -- benefits on a typo.
    v_met := false;
    v_detail := jsonb_build_object('needs', 'an unrecognised condition',
                                   'rule_type', v_type);
  end if;

  return jsonb_build_object(
    'found', true,
    'qualifies', coalesce(v_met, false),
    'rule_type', v_type,
    'detail', v_detail,
    'already', v_r.status in ('qualified','benefit_earned','benefit_redeemed'),
    'invalidated', v_r.status = 'invalidated');
end;
$$;

grant execute on function public.loamy_referral_qualifies(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Qualify, and award what the programme says.
-- ----------------------------------------------------------------------------
/**
 * Idempotent. Awards only the benefits named in the programme, and only of
 * the non-cash kinds the table permits -- a programme that tried to describe
 * a cash benefit is rejected by the CHECK constraint, not by a code path
 * someone could forget.
 */
create or replace function public.loamy_qualify_referral(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r     public.referrals%rowtype;
  v_prog  public.referral_programmes%rowtype;
  v_check jsonb;
  v_b     jsonb;
  v_target uuid;
  v_awarded int := 0;
begin
  select * into v_r from public.referrals where id = p_referral_id for update;
  if v_r.id is null then
    return jsonb_build_object('qualified', false, 'reason', 'no_such_referral');
  end if;
  if v_r.status = 'invalidated' then
    return jsonb_build_object('qualified', false, 'reason', 'invalidated');
  end if;
  if v_r.status in ('qualified','benefit_earned','benefit_redeemed') then
    return jsonb_build_object('qualified', true, 'reason', 'already_qualified');
  end if;

  v_check := public.loamy_referral_qualifies(p_referral_id);
  if not (v_check->>'qualifies')::boolean then
    return jsonb_build_object('qualified', false, 'reason', 'condition_not_met',
      'detail', v_check->'detail');
  end if;

  select * into v_prog from public.referral_programmes where id = v_r.programme_id;

  perform set_config('loamy.referral_authorized', 'true', true);

  update public.referrals
     set status = 'qualified', qualified_at = now()
   where id = p_referral_id;

  for v_b in select * from jsonb_array_elements(coalesce(v_prog.benefits, '[]'::jsonb)) loop
    v_target := case when coalesce(v_b->>'to', 'referrer') = 'referred'
                     then v_r.referred_id else v_r.referrer_id end;

    insert into public.referral_benefits (
      referral_id, user_id, benefit_code, label, kind)
    values (p_referral_id, v_target,
            v_b->>'code', coalesce(v_b->>'label', v_b->>'code'),
            coalesce(v_b->>'kind', 'recognition'))
    on conflict (referral_id, benefit_code, user_id) do nothing;
    v_awarded := v_awarded + 1;
  end loop;

  if v_awarded > 0 then
    update public.referrals set status = 'benefit_earned' where id = p_referral_id;
  end if;

  perform set_config('loamy.referral_authorized', 'false', true);

  insert into public.notifications (user_id, title, body, type)
  values (v_r.referrer_id, 'Referral qualified',
          'Someone you referred has met the programme condition. Your platform benefits are on your Invite page.',
          'general');

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (coalesce(auth.uid(), v_r.referred_id), 'system', 'referral_qualified',
          'referral', p_referral_id,
          jsonb_build_object('benefits_awarded', v_awarded, 'rule', v_check->>'rule_type'));

  return jsonb_build_object('qualified', true, 'benefits_awarded', v_awarded,
    'note', 'Benefits are non-cash. Loamy referrals pay no commission.');
end;
$$;

revoke all on function public.loamy_qualify_referral(uuid) from public, anon;
grant execute on function public.loamy_qualify_referral(uuid) to authenticated;

/** Re-check my own referral, and the one that brought me in. */
create or replace function public.loamy_check_my_referrals()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_n int := 0;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  for v_id in
    select id from public.referrals
     where (referred_id = v_uid or referrer_id = v_uid)
       and status in ('registered','clicked','created')
  loop
    if (public.loamy_qualify_referral(v_id)->>'qualified')::boolean then
      v_n := v_n + 1;
    end if;
  end loop;

  return jsonb_build_object('checked', true, 'newly_qualified', v_n);
end;
$$;

revoke all on function public.loamy_check_my_referrals() from public, anon;
grant execute on function public.loamy_check_my_referrals() to authenticated;

-- Qualify automatically when the referred member completes onboarding.
create or replace function public.loamy_referral_on_profile_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if new.onboarding_complete is true and old.onboarding_complete is distinct from true then
    select id into v_id from public.referrals
     where referred_id = new.id and status in ('registered','clicked','created');
    if v_id is not null then
      begin
        perform public.loamy_qualify_referral(v_id);
      exception when others then
        -- A benefit failure must never block someone finishing signup.
        insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
        values (new.id, 'system', 'referral_qualify_failed', 'referral', v_id,
                jsonb_build_object('error', sqlerrm));
      end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_profiles_referral_qualify on public.profiles;
create trigger loamy_profiles_referral_qualify
  after update on public.profiles
  for each row execute function public.loamy_referral_on_profile_complete();

-- ----------------------------------------------------------------------------
-- 3. Redeeming and revoking.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_redeem_benefit(p_benefit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_b public.referral_benefits%rowtype;
begin
  select * into v_b from public.referral_benefits where id = p_benefit_id;
  if v_b.id is null or v_b.user_id <> v_uid then
    raise exception 'Benefit not found.';
  end if;
  if v_b.status <> 'earned' then
    return jsonb_build_object('redeemed', false, 'reason', 'not_available',
      'status', v_b.status);
  end if;
  if v_b.expires_at is not null and v_b.expires_at <= now() then
    return jsonb_build_object('redeemed', false, 'reason', 'expired');
  end if;

  perform set_config('loamy.referral_authorized', 'true', true);
  update public.referral_benefits
     set status = 'redeemed', redeemed_at = now() where id = p_benefit_id;
  update public.referrals
     set status = 'benefit_redeemed' where id = v_b.referral_id;
  perform set_config('loamy.referral_authorized', 'false', true);

  return jsonb_build_object('redeemed', true);
end;
$$;

revoke all on function public.loamy_redeem_benefit(uuid) from public, anon;
grant execute on function public.loamy_redeem_benefit(uuid) to authenticated;

/** Invalidate a referral after review. History survives. */
create or replace function public.loamy_invalidate_referral(
  p_referral_id uuid, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not public.loamy_is_admin() then
    raise exception 'Only an administrator invalidates a referral.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Invalidating a referral requires a recorded reason.';
  end if;

  perform set_config('loamy.referral_authorized', 'true', true);
  update public.referrals
     set status = 'invalidated', invalidated_at = now(), invalidation_reason = trim(p_reason)
   where id = p_referral_id;
  -- Benefits are revoked, never deleted.
  update public.referral_benefits
     set status = 'revoked', revoked_reason = trim(p_reason)
   where referral_id = p_referral_id and status in ('earned','redeemed');
  perform set_config('loamy.referral_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'admin', 'referral_invalidated', 'referral', p_referral_id,
          jsonb_build_object('reason', trim(p_reason)));

  return jsonb_build_object('invalidated', true);
end;
$$;

revoke all on function public.loamy_invalidate_referral(uuid,text) from public, anon;
grant execute on function public.loamy_invalidate_referral(uuid,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The member's own view.
-- ----------------------------------------------------------------------------
/**
 * Deliberately carries NO monetary field. Showing "₦0 earned" would tell a
 * member this is an affiliate programme that has not paid out yet, which is
 * the opposite of true.
 */
create or replace function public.loamy_my_referral_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  return jsonb_build_object(
    'code', public.loamy_my_referral_code(),

    'counts', (
      select jsonb_build_object(
        'registered', count(*) filter (where status = 'registered'),
        'qualified',  count(*) filter (where status in ('qualified','benefit_earned','benefit_redeemed')),
        'invalidated', count(*) filter (where status = 'invalidated'),
        'total', count(*))
      from public.referrals where referrer_id = v_uid),

    -- Who they referred, WITHOUT exposing the referred member's private
    -- detail (directive 17). A first name and a month, nothing more.
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ref', r.ref,
        'display', split_part(coalesce(p.full_name, 'A member'), ' ', 1),
        'status', r.status,
        'joined', to_char(r.attributed_at, 'Mon YYYY'),
        'qualified_at', r.qualified_at,
        'progress', case when r.status in ('registered','clicked','created')
                         then public.loamy_referral_qualifies(r.id)->'detail' end
      ) order by r.attributed_at desc), '[]'::jsonb)
      from public.referrals r
      join public.profiles p on p.id = r.referred_id
      where r.referrer_id = v_uid),

    'benefits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ref', b.ref, 'code', b.benefit_code, 'label', b.label,
        'kind', b.kind, 'status', b.status,
        'awarded_at', b.awarded_at, 'expires_at', b.expires_at,
        'id', b.id) order by b.awarded_at desc), '[]'::jsonb)
      from public.referral_benefits b where b.user_id = v_uid),

    'is_cash_programme', false,
    'note', 'Loamy referrals earn platform benefits. They do not pay commission. Growth Partners earn commission for field work, which is a separate programme.');
end;
$$;

revoke all on function public.loamy_my_referral_summary() from public, anon;
grant execute on function public.loamy_my_referral_summary() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Admin: the programme itself.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_upsert_referral_programme(
  p_name text,
  p_qualification jsonb,
  p_benefits jsonb,
  p_attribution_window_hours int default 72,
  p_eligible_roles text[] default '{}',
  p_description text default null,
  p_activate boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_b jsonb;
begin
  if not public.loamy_is_admin() then
    raise exception 'Only an administrator configures the referral programme.';
  end if;

  -- A programme cannot describe a cash benefit. Caught here with a readable
  -- message rather than as a constraint violation at award time.
  for v_b in select * from jsonb_array_elements(coalesce(p_benefits, '[]'::jsonb)) loop
    if coalesce(v_b->>'kind', 'recognition') not in (
         'recognition','badge','access','early_access','visibility','resource') then
      raise exception
        'Referral benefits are non-cash. "%" is not an allowed benefit kind.', v_b->>'kind';
    end if;
    if v_b ? 'amount' or v_b ? 'currency' or v_b ? 'naira' then
      raise exception
        'Referral benefits carry no monetary amount. Growth Partner commission is the separate, paid programme.';
    end if;
  end loop;

  if p_activate then
    update public.referral_programmes set active = false, effective_to = now()
     where active and effective_to is null;
  end if;

  insert into public.referral_programmes (
    name, description, qualification, benefits,
    attribution_window_hours, eligible_roles, active, created_by)
  values (p_name, p_description, coalesce(p_qualification, '{"type":"profile_complete"}'::jsonb),
          coalesce(p_benefits, '[]'::jsonb),
          coalesce(p_attribution_window_hours, 72), coalesce(p_eligible_roles, '{}'),
          p_activate, v_uid)
  returning id into v_id;

  update public.referral_programmes
     set ref = public.loamy_register_ref('referral_programme', v_id, 'RPG')
   where id = v_id and ref is null;

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'admin', 'referral_programme_set', 'referral_programme', v_id,
          jsonb_build_object('name', p_name, 'qualification', p_qualification));

  return jsonb_build_object('saved', true, 'programme_id', v_id);
end;
$$;

revoke all on function public.loamy_upsert_referral_programme(
  text,jsonb,jsonb,int,text[],text,boolean) from public, anon;
grant execute on function public.loamy_upsert_referral_programme(
  text,jsonb,jsonb,int,text[],text,boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. The legacy path, split and repaired.
-- ----------------------------------------------------------------------------
-- It returned void; it now returns the attribution result, so the caller can
-- tell a refusal from a success. A return type cannot be changed in place.
drop function if exists public.loamy_record_referral(text, text);

create or replace function public.loamy_record_referral(
  p_ref_code text, p_method text default 'referral_link'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_partner uuid;
  v_name    text;
  v_attr    jsonb;
  v_ob      uuid;
  v_fee     jsonb;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_method not in ('field_assisted','referral_link') then
    raise exception 'Invalid onboarding method';
  end if;

  -- Record the relationship through the one referral model, whichever path
  -- this is. Fraud controls and the attribution window live there.
  v_attr := public.loamy_attribute_referral(p_ref_code, p_method);
  if not (v_attr->>'attributed')::boolean then
    return v_attr;
  end if;

  select id into v_partner from public.profiles
   where username = lower(trim(p_ref_code)) or upper(digital_id) = upper(trim(p_ref_code));

  -- FIELD-ASSISTED ONLY gets a commission. A shared link is not field work,
  -- and paying for it would be the affiliate model Loamy has decided against.
  if p_method = 'field_assisted' and public.loamy_can_verify(v_partner) then
    insert into public.onboarded_farmers (partner_id, farmer_id, onboarding_method)
    values (v_partner, v_uid, p_method)
    on conflict (farmer_id) do nothing
    returning id into v_ob;

    if v_ob is not null then
      v_fee := public.loamy_resolve_fee('verification_commission', 0, 'field_onboarding');
      if (v_fee->>'resolved')::boolean then
        -- Block 5's guard requires this flag. Its absence is why every
        -- onboarding attribution has been failing since 20260920140004.
        perform set_config('loamy.commission_authorized', 'true', true);
        insert into public.partner_earnings (
          partner_id, earning_type, reference_id, amount, status,
          payer_kind, fee_snapshot)
        values (v_partner, 'onboarding', v_ob, (v_fee->>'fee')::numeric, 'pending',
                case v_fee->>'payer' when 'platform' then 'loamy'
                                     else coalesce(v_fee->>'payer', 'loamy') end,
                v_fee);
        perform set_config('loamy.commission_authorized', 'false', true);
      end if;
    end if;
  end if;

  select full_name into v_name from public.profiles where id = v_uid;
  insert into public.notifications (user_id, title, body, type)
  values (v_partner,
          case when p_method = 'field_assisted' then 'Farmer onboarded'
               else 'Someone joined through you' end,
          coalesce(v_name, 'A new member') || ' joined through you ('
            || replace(p_method, '_', ' ') || '). '
            || case when p_method = 'field_assisted'
                    then 'Your onboarding commission is pending review.'
                    else 'Referrals earn platform benefits, not commission.' end,
          'partner');

  return v_attr || jsonb_build_object(
    'commission_accrued', p_method = 'field_assisted' and v_ob is not null);
end;
$$;

revoke all on function public.loamy_record_referral(text,text) from public, anon;
grant execute on function public.loamy_record_referral(text,text) to authenticated;

comment on function public.loamy_record_referral(text,text) is
  'BLOCK 6. Split along the line that matters: field_assisted is operational work and earns commission; referral_link earns platform benefits only.';
