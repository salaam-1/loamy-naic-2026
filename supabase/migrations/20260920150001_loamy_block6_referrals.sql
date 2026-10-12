-- ============================================================================
-- BLOCK 6 (a) — ordinary user referrals. Deliberately NOT an affiliate scheme.
-- ----------------------------------------------------------------------------
-- The distinction this block exists to hold:
--
--   ORDINARY REFERRAL      ecosystem growth. Non-cash benefits only.
--   GROWTH PARTNER WORK    operational service. Cash, via partner_earnings.
--
-- They are separate graphs and they must never meet. If User A refers Farmer
-- B, and Growth Partner C later verifies B's farm, C is paid and A is not.
-- That is directive 14, and it is a test.
--
-- THE ENFORCEMENT IS STRUCTURAL, NOT EDITORIAL. referral_benefits has no
-- amount column, no currency column and a CHECK constraint listing only
-- non-monetary kinds. There is no schema in which an ordinary referral
-- produces a naira figure, which is a stronger guarantee than a rule someone
-- has to remember.
--
-- NOTHING IS HARD-CODED. The qualifying condition and the benefits both come
-- from referral_programmes, so "what counts as a successful referral" is a
-- business decision that can change without a migration -- and changing it
-- never rewrites what a past referral earned.
--
-- ALSO FIXES TWO LIVE DEFECTS, both found while auditing:
--
--   1. loamy_record_referral paid CASH for a referral_link. That is an
--      affiliate payment, which is the thing Loamy has decided not to be.
--      Field-assisted onboarding is real work and keeps its commission;
--      sharing a link does not.
--
--   2. Block 5's commission guard broke that same function. It inserts into
--      partner_earnings without setting loamy.commission_authorized, so every
--      onboarding attribution has been raising since 20260920140004. No test
--      covered it. Both paths are rebuilt here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The programme. Configurable, versioned by effectivity.
-- ----------------------------------------------------------------------------
create table if not exists public.referral_programmes (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique,
  name        text not null,
  description text,

  -- What has to happen for a referral to count. A rule, not a constant.
  --   { "type": "profile_complete" }
  --   { "type": "identity_verified" }
  --   { "type": "first_transaction", "min_completed": 1 }
  --   { "type": "first_listing" }
  --   { "type": "manual" }
  qualification jsonb not null default '{"type":"profile_complete"}'::jsonb,

  -- How long after signup an attribution may still be claimed.
  attribution_window_hours int not null default 72
    check (attribution_window_hours between 1 and 8760),

  -- What the referrer gets. NON-CASH by construction -- see the CHECK on
  -- referral_benefits.kind.
  --   [{ "code":"founding_badge", "label":"Founding Member badge",
  --      "kind":"badge", "to":"referrer" }]
  benefits    jsonb not null default '[]'::jsonb,

  -- Who may refer under this programme. Empty = anyone.
  eligible_roles text[] not null default '{}',

  active      boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.referral_programmes enable row level security;

drop policy if exists referral_programmes_read on public.referral_programmes;
create policy referral_programmes_read on public.referral_programmes
  for select to authenticated using (true);
-- Written by admins through loamy_upsert_referral_programme only.

comment on table public.referral_programmes is
  'BLOCK 6. The active referral programme: what qualifies a referral and what the referrer receives. Both configurable, so neither is hard-coded and changing them never rewrites history.';

insert into public.referral_programmes (name, description, qualification, benefits, ref)
select
  'Loamy ecosystem growth (default)',
  'Non-cash recognition for bringing genuine participants onto Loamy. This is not an affiliate programme and pays no commission.',
  '{"type":"profile_complete"}'::jsonb,
  '[
    {"code":"referrer_recognition","label":"Referral recognition on your profile","kind":"recognition","to":"referrer"},
    {"code":"early_access","label":"Early access to new Loamy features","kind":"access","to":"referrer"}
  ]'::jsonb,
  'RPG-000001'
where not exists (select 1 from public.referral_programmes);

-- ----------------------------------------------------------------------------
-- 2. Attribution. One per referred user, and immutable once made.
-- ----------------------------------------------------------------------------
create table if not exists public.referrals (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique,

  referrer_id  uuid not null references public.profiles (id) on delete cascade,
  -- One attribution per person, ever. The unique constraint IS the rule.
  referred_id  uuid not null unique references public.profiles (id) on delete cascade,

  programme_id uuid not null references public.referral_programmes (id) on delete restrict,
  code_used    text not null,
  source       text not null default 'referral_link'
    check (source in ('referral_link','username_link','code_entry','field_assisted','import')),

  status       text not null default 'registered'
    check (status in (
      'created', 'clicked', 'registered',
      'qualified',            -- the programme condition was met
      'benefit_earned',
      'benefit_redeemed',
      'invalidated'           -- fraud review, or the referred account went away
    )),

  attributed_at timestamptz not null default now(),
  qualified_at  timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,

  -- Signals for review. A referral is never auto-rejected on these.
  flags        text[] not null default '{}',

  constraint referrals_no_self_referral check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id, attributed_at desc);
create index if not exists referrals_status_idx on public.referrals (status);

alter table public.referrals enable row level security;

comment on table public.referrals is
  'BLOCK 6. Immutable attribution. A referred user cannot change who referred them, and a referral NEVER creates a cash entitlement -- see referral_benefits, which has no amount column.';

-- A member sees referrals they made, and the one that brought them in.
drop policy if exists referrals_mine on public.referrals;
create policy referrals_mine on public.referrals
  for select to authenticated
  using (referrer_id = auth.uid() or referred_id = auth.uid() or public.loamy_is_admin());

-- No write policy at all. Attribution happens in loamy_attribute_referral.
create or replace function public.loamy_referral_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('loamy.referral_authorized', true), '') <> 'true' then
    raise exception 'Referral attribution is recorded by the referral workflow, not directly.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Referral history is never deleted. Invalidate it instead.';
  end if;
  -- Directive 4: the referrer cannot move once attributed.
  if tg_op = 'UPDATE' and new.referrer_id is distinct from old.referrer_id then
    raise exception 'Referral attribution is immutable.';
  end if;
  if tg_op = 'UPDATE' and new.referred_id is distinct from old.referred_id then
    raise exception 'Referral attribution is immutable.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists loamy_referrals_guard on public.referrals;
create trigger loamy_referrals_guard
  before insert or update or delete on public.referrals
  for each row execute function public.loamy_referral_guard();

drop trigger if exists loamy_referrals_ref on public.referrals;
create trigger loamy_referrals_ref
  before insert on public.referrals
  for each row execute function public.loamy_assign_ref('referral', 'REFR');

-- ----------------------------------------------------------------------------
-- 3. Benefits. Non-cash by construction.
-- ----------------------------------------------------------------------------
create table if not exists public.referral_benefits (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique,
  referral_id  uuid not null references public.referrals (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,

  benefit_code text not null,
  label        text not null,

  -- THE STRUCTURAL GUARANTEE. There is no 'cash', no 'payout', no 'naira'.
  -- An ordinary referral cannot produce money because the schema has nowhere
  -- to put it: this table has no amount column and no currency column.
  kind         text not null check (kind in (
    'recognition',   -- shown on the profile
    'badge',
    'access',        -- a feature or programme opened up
    'early_access',
    'visibility',    -- marketplace placement
    'resource'       -- training or educational material
  )),

  status       text not null default 'earned'
    check (status in ('earned','redeemed','expired','revoked')),

  awarded_at   timestamptz not null default now(),
  redeemed_at  timestamptz,
  expires_at   timestamptz,
  revoked_reason text,

  unique (referral_id, benefit_code, user_id)
);

create index if not exists referral_benefits_user_idx
  on public.referral_benefits (user_id, status, awarded_at desc);

alter table public.referral_benefits enable row level security;

comment on table public.referral_benefits is
  'BLOCK 6, directive 2/15. Non-cash benefits. Deliberately has NO amount and NO currency column: an ordinary referral has nowhere to record money, which is a stronger guarantee than a policy.';

drop policy if exists referral_benefits_mine on public.referral_benefits;
create policy referral_benefits_mine on public.referral_benefits
  for select to authenticated
  using (user_id = auth.uid() or public.loamy_is_admin());

create or replace function public.loamy_benefit_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('loamy.referral_authorized', true), '') <> 'true' then
    raise exception 'Benefits are awarded by the referral workflow, not directly.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Benefit history is never deleted. Revoke it instead.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists loamy_referral_benefits_guard on public.referral_benefits;
create trigger loamy_referral_benefits_guard
  before insert or update or delete on public.referral_benefits
  for each row execute function public.loamy_benefit_guard();

drop trigger if exists loamy_referral_benefits_ref on public.referral_benefits;
create trigger loamy_referral_benefits_ref
  before insert on public.referral_benefits
  for each row execute function public.loamy_assign_ref('referral_benefit', 'BEN');

-- ----------------------------------------------------------------------------
-- 4. The active programme.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_active_referral_programme()
returns public.referral_programmes
language sql
stable
security definer
set search_path = public
as $$
  select * from public.referral_programmes
  where active
    and effective_from <= now()
    and (effective_to is null or effective_to > now())
  order by effective_from desc
  limit 1;
$$;

grant execute on function public.loamy_active_referral_programme() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. My referral code.
-- ----------------------------------------------------------------------------
/**
 * A member's handle is their referral code, so there is one public identity
 * rather than two. Members without a username fall back to their digital_id.
 */
create or replace function public.loamy_my_referral_code()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_p public.profiles%rowtype; v_prog public.referral_programmes;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  select * into v_p from public.profiles where id = v_uid;
  v_prog := public.loamy_active_referral_programme();

  return jsonb_build_object(
    'code', coalesce(v_p.username, v_p.digital_id),
    'is_username', v_p.username is not null,
    'link_path', case when v_p.username is not null
                      then '/u/' || v_p.username
                      else '/signup?ref=' || coalesce(v_p.digital_id, '') end,
    'programme', case when v_prog.id is null then null else jsonb_build_object(
      'ref', v_prog.ref, 'name', v_prog.name,
      'qualification', v_prog.qualification,
      'attribution_window_hours', v_prog.attribution_window_hours,
      'benefits', v_prog.benefits) end,
    -- Said plainly wherever the code is shown.
    'note', 'Referrals earn Loamy platform benefits. They are not a commission and pay no money.');
end;
$$;

revoke all on function public.loamy_my_referral_code() from public, anon;
grant execute on function public.loamy_my_referral_code() to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Attribution, with the fraud controls that can actually be enforced.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_attribute_referral(
  p_code   text,
  p_source text default 'referral_link'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_code    text := lower(trim(coalesce(p_code, '')));
  v_ref     uuid;
  v_me      public.profiles%rowtype;
  v_prog    public.referral_programmes;
  v_flags   text[] := '{}';
  v_id      uuid;
  v_recent  int;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_source not in ('referral_link','username_link','code_entry','field_assisted','import') then
    raise exception 'Unknown referral source: %', p_source;
  end if;

  select * into v_me from public.profiles where id = v_uid;
  v_prog := public.loamy_active_referral_programme();
  if v_prog.id is null then
    return jsonb_build_object('attributed', false, 'reason', 'no_active_programme');
  end if;

  -- Resolve the code: a handle, or a digital id.
  select id into v_ref from public.profiles
   where username = v_code or upper(digital_id) = upper(v_code);
  if v_ref is null then
    return jsonb_build_object('attributed', false, 'reason', 'unknown_code');
  end if;

  -- ---- Fraud controls (directive 3). --------------------------------------

  if v_ref = v_uid then
    return jsonb_build_object('attributed', false, 'reason', 'self_referral',
      'message', 'You cannot refer yourself.');
  end if;

  if exists (select 1 from public.referrals where referred_id = v_uid) then
    return jsonb_build_object('attributed', false, 'reason', 'already_attributed',
      'message', 'This account already has a referrer, and that cannot be changed.');
  end if;

  -- Circular: the person referring you is someone you referred.
  if exists (select 1 from public.referrals
             where referrer_id = v_uid and referred_id = v_ref) then
    return jsonb_build_object('attributed', false, 'reason', 'circular_referral');
  end if;

  -- And one step further out, which is where real rings start.
  if exists (
    select 1 from public.referrals a
    join public.referrals b on b.referrer_id = a.referred_id
    where a.referrer_id = v_uid and b.referred_id = v_ref) then
    return jsonb_build_object('attributed', false, 'reason', 'circular_referral');
  end if;

  if not public.loamy_is_active(v_ref) then
    return jsonb_build_object('attributed', false, 'reason', 'referrer_inactive');
  end if;

  if coalesce(array_length(v_prog.eligible_roles, 1), 0) > 0 then
    if not exists (select 1 from public.profiles p
                   where p.id = v_ref and p.platform_role = any (v_prog.eligible_roles)) then
      return jsonb_build_object('attributed', false, 'reason', 'referrer_not_eligible');
    end if;
  end if;

  -- The window. Late attribution is refused rather than flagged, because
  -- after it the claim cannot be distinguished from a retrofit.
  if v_me.created_at < now() - make_interval(hours => v_prog.attribution_window_hours) then
    return jsonb_build_object('attributed', false, 'reason', 'attribution_window_closed',
      'window_hours', v_prog.attribution_window_hours,
      'message', format('A referrer can only be recorded within %s hours of signing up.',
                        v_prog.attribution_window_hours));
  end if;

  -- ---- Signals that mean REVIEW, not refusal. -----------------------------
  select count(*) into v_recent
  from public.referrals
  where referrer_id = v_ref and attributed_at > now() - interval '24 hours';
  if v_recent >= 10 then
    v_flags := array_append(v_flags, 'high_referral_velocity');
  end if;

  if exists (select 1 from public.referrals r
             join public.profiles p on p.id = r.referred_id
             where r.referrer_id = v_ref and r.status = 'invalidated') then
    v_flags := array_append(v_flags, 'referrer_has_invalidated_referrals');
  end if;

  perform set_config('loamy.referral_authorized', 'true', true);
  insert into public.referrals (
    referrer_id, referred_id, programme_id, code_used, source, status, flags)
  values (v_ref, v_uid, v_prog.id, v_code, p_source, 'registered', v_flags)
  returning id into v_id;
  perform set_config('loamy.referral_authorized', 'false', true);

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'member', 'referral_attributed', 'referral', v_id,
          jsonb_build_object('referrer', v_ref, 'source', p_source, 'flags', to_jsonb(v_flags)));

  insert into public.notifications (user_id, title, body, type)
  values (v_ref, 'Someone joined through you',
          'A new member signed up with your referral link. Benefits are awarded once they qualify under the current programme.',
          'general');

  return jsonb_build_object('attributed', true, 'referral_id', v_id,
    'status', 'registered',
    'flags', to_jsonb(v_flags),
    -- Registered is NOT successful (directive 5).
    'note', 'Recorded. This referral becomes successful only when the programme condition is met.');
end;
$$;

revoke all on function public.loamy_attribute_referral(text,text) from public, anon;
grant execute on function public.loamy_attribute_referral(text,text) to authenticated;
