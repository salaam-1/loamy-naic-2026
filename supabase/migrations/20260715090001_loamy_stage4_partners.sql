-- ============================================================================
-- Loamy Platform · Stage 4 · Migration 1 of 3
-- Growth Partner foundations: territory assignments, onboarding attribution,
-- earnings (TRACKED, NOT PAID), the can_verify capability, and partner rates.
--
-- HARD CONSTRAINT: no payment execution anywhere. partner_earnings records
-- what is earned; actual payout happens off-platform until Phase 2.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Admin-editable partner rates on platform_config (applied at accrual time).
-- ----------------------------------------------------------------------------
alter table public.platform_config
  add column if not exists partner_rates jsonb not null default
    '{"onboarding": 500, "verification": 1000}'::jsonb;

comment on column public.platform_config.partner_rates is
  'Naira amounts accrued per onboarding / per approved verification. Tracked only — payouts happen off-platform during the pilot.';

-- ----------------------------------------------------------------------------
-- 2) can_verify capability: Verification Officer is a CAPABILITY within
--    Growth Partner (role_data.can_verify), granted/revoked by admin only.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: security-definer read of another user''s role_data key.
-- Returns a single boolean, nothing else. Verify it never expands.
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
     where rd.user_id = p_user and p.platform_role = 'growth_partner'),
    false
  );
$$;

revoke all on function public.loamy_can_verify(uuid) from public;
revoke all on function public.loamy_can_verify(uuid) from anon;
grant execute on function public.loamy_can_verify(uuid) to authenticated;

-- Admin grants/revokes the capability. role_details RLS is owner-write, so
-- this is the ONLY path for an admin to flip another user's can_verify.
-- SECURITY-REVIEW: verify admin check stays first and only the can_verify
-- key is touched (never overwrite the partner's other role_data).
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

  perform public.loamy_create_notification_internal(
    p_user,
    case when p_value then 'Verification capability granted' else 'Verification capability revoked' end,
    case when p_value
      then 'You can now claim and complete farm verification tasks in your territory.'
      else 'Your verification capability has been revoked by an administrator.' end,
    'verification');
end;
$$;

-- Internal notification helper (callable only from our security-definer
-- functions — NOT granted to any client role).
create or replace function public.loamy_create_notification_internal(
  target_user uuid, n_title text, n_body text default '', n_type text default 'general'
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, title, body, type)
  values (target_user, n_title, coalesce(n_body, ''), coalesce(n_type, 'general'));
$$;

revoke all on function public.loamy_create_notification_internal(uuid, text, text, text) from public;
revoke all on function public.loamy_create_notification_internal(uuid, text, text, text) from anon;
revoke all on function public.loamy_create_notification_internal(uuid, text, text, text) from authenticated;

revoke all on function public.loamy_set_can_verify(uuid, boolean) from public;
revoke all on function public.loamy_set_can_verify(uuid, boolean) from anon;
grant execute on function public.loamy_set_can_verify(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) partner_assignments — which partner covers which territory. Admin-managed.
-- ----------------------------------------------------------------------------
create table if not exists public.partner_assignments (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.profiles (id) on delete cascade,
  state      text not null,
  lgas       text[] not null default '{}', -- empty = whole state
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists partner_assignments_partner_idx on public.partner_assignments (partner_id);
create index if not exists partner_assignments_state_idx on public.partner_assignments (state) where active;

alter table public.partner_assignments enable row level security;

drop policy if exists "loamy_assignments_select" on public.partner_assignments;
create policy "loamy_assignments_select"
  on public.partner_assignments for select to authenticated
  using (partner_id = auth.uid() or public.loamy_is_admin());

drop policy if exists "loamy_assignments_admin_write" on public.partner_assignments;
create policy "loamy_assignments_admin_write"
  on public.partner_assignments for insert to authenticated
  with check (public.loamy_is_admin());

drop policy if exists "loamy_assignments_admin_update" on public.partner_assignments;
create policy "loamy_assignments_admin_update"
  on public.partner_assignments for update to authenticated
  using (public.loamy_is_admin()) with check (public.loamy_is_admin());

drop policy if exists "loamy_assignments_admin_delete" on public.partner_assignments;
create policy "loamy_assignments_admin_delete"
  on public.partner_assignments for delete to authenticated
  using (public.loamy_is_admin());

-- ----------------------------------------------------------------------------
-- 4) onboarded_farmers — attribution trail (who brought whom).
-- ----------------------------------------------------------------------------
create table if not exists public.onboarded_farmers (
  id                uuid primary key default gen_random_uuid(),
  partner_id        uuid not null references public.profiles (id) on delete cascade,
  farmer_id         uuid not null unique references public.profiles (id) on delete cascade,
  onboarding_method text not null check (onboarding_method in ('field_assisted','referral_link')),
  created_at        timestamptz not null default now()
);

create index if not exists onboarded_farmers_partner_idx on public.onboarded_farmers (partner_id);

alter table public.onboarded_farmers enable row level security;

-- Partner sees own onboardings; the farmer can see who onboarded them; admin all.
drop policy if exists "loamy_onboarded_select" on public.onboarded_farmers;
create policy "loamy_onboarded_select"
  on public.onboarded_farmers for select to authenticated
  using (partner_id = auth.uid() or farmer_id = auth.uid() or public.loamy_is_admin());

-- No client INSERT/UPDATE/DELETE policies: rows are created only via the
-- attribution function below.

-- ----------------------------------------------------------------------------
-- 5) partner_earnings — tracked, never paid on-platform.
-- ----------------------------------------------------------------------------
create table if not exists public.partner_earnings (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references public.profiles (id) on delete cascade,
  earning_type text not null check (earning_type in ('onboarding','verification')),
  reference_id uuid not null,
  amount       numeric not null check (amount >= 0),
  status       text not null default 'accrued' check (status in ('accrued','paid_externally')),
  paid_note    text,
  created_at   timestamptz not null default now()
);

create index if not exists partner_earnings_partner_idx on public.partner_earnings (partner_id, created_at desc);

alter table public.partner_earnings enable row level security;

drop policy if exists "loamy_earnings_select" on public.partner_earnings;
create policy "loamy_earnings_select"
  on public.partner_earnings for select to authenticated
  using (partner_id = auth.uid() or public.loamy_is_admin());

-- Admin marks paid_externally AFTER the off-platform payout. No payment
-- execution exists anywhere in this codebase.
drop policy if exists "loamy_earnings_admin_update" on public.partner_earnings;
create policy "loamy_earnings_admin_update"
  on public.partner_earnings for update to authenticated
  using (public.loamy_is_admin()) with check (public.loamy_is_admin());

-- No client insert: accruals happen only inside security-definer workflow fns.

-- Internal accrual helper (not granted to clients).
create or replace function public.loamy_accrue_earning_internal(
  p_partner uuid, p_type text, p_reference uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
begin
  select coalesce((partner_rates ->> p_type)::numeric, 0)
    into v_amount from public.platform_config where id = 1;
  insert into public.partner_earnings (partner_id, earning_type, reference_id, amount)
  values (p_partner, p_type, p_reference, coalesce(v_amount, 0));
end;
$$;

revoke all on function public.loamy_accrue_earning_internal(uuid, text, uuid) from public;
revoke all on function public.loamy_accrue_earning_internal(uuid, text, uuid) from anon;
revoke all on function public.loamy_accrue_earning_internal(uuid, text, uuid) from authenticated;

-- ----------------------------------------------------------------------------
-- 6) Attribution: called by the NEWLY SIGNED-UP FARMER (their own session)
--    with the partner's referral code (digital_id). Covers both the partner's
--    assisted-signup flow and self-signup through a referral link.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: self-attribution model. Guards: caller attributes only
-- THEMSELVES, exactly once, within 24h of profile creation, to an existing
-- growth partner other than themselves. A partner cannot claim arbitrary or
-- old accounts because the call runs under the farmer's session and the
-- freshness window applies. Engineer to review before commission money is real.
create or replace function public.loamy_record_referral(p_ref_code text, p_method text default 'referral_link')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
  v_created timestamptz;
  v_name    text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_method not in ('field_assisted','referral_link') then
    raise exception 'Invalid onboarding method';
  end if;

  select id into v_partner
  from public.profiles
  where digital_id = upper(trim(p_ref_code)) and platform_role = 'growth_partner';
  if v_partner is null then
    raise exception 'Referral code does not belong to a growth partner';
  end if;
  if v_partner = auth.uid() then
    raise exception 'You cannot refer yourself';
  end if;

  select created_at, full_name into v_created, v_name
  from public.profiles where id = auth.uid();
  if v_created < now() - interval '24 hours' then
    raise exception 'Referral attribution is only possible within 24 hours of signup';
  end if;
  if exists (select 1 from public.onboarded_farmers where farmer_id = auth.uid()) then
    raise exception 'This account already has an onboarding attribution';
  end if;

  insert into public.onboarded_farmers (partner_id, farmer_id, onboarding_method)
  values (v_partner, auth.uid(), p_method);

  perform public.loamy_accrue_earning_internal(
    v_partner, 'onboarding',
    (select id from public.onboarded_farmers where farmer_id = auth.uid()));

  perform public.loamy_create_notification_internal(
    v_partner, 'New farmer onboarded',
    coalesce(v_name, 'A new member') || ' joined through you ('
      || replace(p_method, '_', ' ') || '). Your onboarding commission has accrued.',
    'partner');
end;
$$;

revoke all on function public.loamy_record_referral(text, text) from public;
revoke all on function public.loamy_record_referral(text, text) from anon;
grant execute on function public.loamy_record_referral(text, text) to authenticated;
