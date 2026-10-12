-- ============================================================================
-- BLOCK 1 (b) — ratings and reviews.
-- ----------------------------------------------------------------------------
-- A review on Loamy is a statement about a REAL DEAL, not a free-text opinion
-- about a stranger. That single constraint is what separates a reputation
-- system from a harassment surface, so it is enforced in the database:
--
--   * Every review cites a transaction, and the reviewer must have been a
--     party to it.
--   * The transaction must have actually concluded -- goods received, or the
--     deal completed. You cannot review someone for a deal that never
--     happened.
--   * One review per party per transaction. No brigading, no stacking.
--   * You cannot review yourself, and a buyer's review of a seller is a
--     different direction from a seller's review of a buyer.
--
-- PUBLICLY ANONYMOUS, INTERNALLY ATTRIBUTED, per the directive. The reader
-- sees "Verified buyer, Kano". Loamy knows exactly who wrote it, and a
-- moderator can act on it. Anonymity that also hides the author from the
-- platform is how a review system becomes unmoderatable.
--
-- Reviews are never deleted. An abusive one is hidden with a recorded reason,
-- because a reputation system whose history can be erased is not a record.
-- ============================================================================

create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique,

  transaction_id uuid not null references public.transactions (id) on delete restrict,
  reviewer_id    uuid not null references public.profiles (id) on delete restrict,
  subject_id     uuid not null references public.profiles (id) on delete restrict,
  direction      text not null check (direction in ('buyer_on_seller','seller_on_buyer')),

  rating         int  not null check (rating between 1 and 5),
  -- Optional breakdown. Null means "not answered", never zero.
  rating_quality        int check (rating_quality between 1 and 5),
  rating_communication  int check (rating_communication between 1 and 5),
  rating_timeliness     int check (rating_timeliness between 1 and 5),

  comment        text check (comment is null or length(comment) <= 1500),

  -- The subject's single public reply.
  response_text  text check (response_text is null or length(response_text) <= 1000),
  responded_at   timestamptz,

  status         text not null default 'visible'
                 check (status in ('visible','hidden_by_admin')),
  hidden_reason  text,
  hidden_by      uuid references public.profiles (id),
  hidden_at      timestamptz,

  -- Denormalised at write time so the public card can say "Verified buyer,
  -- Kano" without joining back to a profile the reader may not read.
  reviewer_role  text,
  reviewer_state text,

  created_at     timestamptz not null default now(),
  edited_at      timestamptz,

  constraint reviews_one_per_party_per_transaction unique (transaction_id, reviewer_id),
  constraint reviews_no_self_review check (reviewer_id <> subject_id)
);

create index if not exists reviews_subject_idx on public.reviews (subject_id, status, created_at desc);
create index if not exists reviews_reviewer_idx on public.reviews (reviewer_id);
create index if not exists reviews_transaction_idx on public.reviews (transaction_id);

alter table public.reviews enable row level security;

comment on table public.reviews is
  'BLOCK 1. Transaction-linked reviews. Written only by loamy_submit_review. Publicly anonymous, internally attributed, never deleted.';

-- ----------------------------------------------------------------------------
-- 1. No client write path.
-- ----------------------------------------------------------------------------
-- A member may read their own reviews (written and received) so the app can
-- show "you reviewed this deal". Everything else goes through the redacted
-- view below.
drop policy if exists reviews_select_own on public.reviews;
create policy reviews_select_own on public.reviews
  for select to authenticated
  using (reviewer_id = auth.uid() or subject_id = auth.uid() or public.loamy_is_admin());

-- Deliberately no insert/update/delete policy for anyone, including admins.
-- Every write goes through a definer function that records who did what.

create or replace function public.loamy_review_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('loamy.review_authorized', true), '') <> 'true' then
    raise exception 'Reviews are written through loamy_submit_review, loamy_respond_to_review or loamy_hide_review.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists loamy_reviews_guard on public.reviews;
create trigger loamy_reviews_guard
  before insert or update or delete on public.reviews
  for each row execute function public.loamy_review_guard();

-- ----------------------------------------------------------------------------
-- 2. Who may review what.
-- ----------------------------------------------------------------------------
/**
 * The eligibility answer, exposed so the UI can show the right thing rather
 * than offering a button that will be refused.
 *
 * Returns { eligible, reason, direction?, subject_id?, existing_review_id? }.
 */
create or replace function public.loamy_can_review(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_t    public.transactions%rowtype;
  v_dir  text;
  v_sub  uuid;
  v_ex   uuid;
begin
  if v_uid is null then
    return jsonb_build_object('eligible', false, 'reason', 'not_signed_in');
  end if;

  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then
    return jsonb_build_object('eligible', false, 'reason', 'no_such_transaction');
  end if;

  if v_t.buyer_id = v_uid then
    v_dir := 'buyer_on_seller'; v_sub := v_t.seller_id;
  elsif v_t.seller_id = v_uid then
    v_dir := 'seller_on_buyer'; v_sub := v_t.buyer_id;
  else
    -- Not a party. Reported as "no such transaction" so the endpoint cannot be
    -- used to discover who traded with whom.
    return jsonb_build_object('eligible', false, 'reason', 'no_such_transaction');
  end if;

  select id into v_ex from public.reviews
   where transaction_id = p_transaction_id and reviewer_id = v_uid;
  if v_ex is not null then
    return jsonb_build_object('eligible', false, 'reason', 'already_reviewed',
      'existing_review_id', v_ex, 'direction', v_dir, 'subject_id', v_sub);
  end if;

  -- The deal has to have actually happened. 'received' is the buyer
  -- confirming goods; 'completed' is the agreement closing.
  if not (v_t.status = 'completed' or v_t.fulfilment_state = 'received') then
    return jsonb_build_object('eligible', false, 'reason', 'not_concluded',
      'status', v_t.status, 'fulfilment_state', v_t.fulfilment_state,
      'message', 'You can leave a review once the goods have been received.');
  end if;

  if v_t.status = 'disputed' then
    return jsonb_build_object('eligible', false, 'reason', 'in_dispute',
      'message', 'This deal is in dispute. Reviews reopen once it is resolved.');
  end if;

  return jsonb_build_object('eligible', true, 'direction', v_dir, 'subject_id', v_sub);
end;
$$;

grant execute on function public.loamy_can_review(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Writing one.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_submit_review(
  p_transaction_id uuid,
  p_rating         int,
  p_comment        text default null,
  p_quality        int  default null,
  p_communication  int  default null,
  p_timeliness     int  default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_check jsonb;
  v_p     public.profiles%rowtype;
  v_id    uuid;
  v_ref   text;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if not public.loamy_is_active(v_uid) then
    raise exception 'This account is not active.';
  end if;

  v_check := public.loamy_can_review(p_transaction_id);
  if not (v_check->>'eligible')::boolean then
    return jsonb_build_object('submitted', false,
      'reason', v_check->>'reason',
      'message', coalesce(v_check->>'message', 'You cannot review this transaction.'));
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('submitted', false, 'reason', 'invalid_rating',
      'message', 'A rating is 1 to 5.');
  end if;

  select * into v_p from public.profiles where id = v_uid;
  v_ref := public.loamy_next_ref('REV');

  perform set_config('loamy.review_authorized', 'true', true);
  insert into public.reviews (
    ref, transaction_id, reviewer_id, subject_id, direction,
    rating, rating_quality, rating_communication, rating_timeliness,
    comment, reviewer_role, reviewer_state)
  values (
    v_ref, p_transaction_id, v_uid, (v_check->>'subject_id')::uuid, v_check->>'direction',
    p_rating, p_quality, p_communication, p_timeliness,
    nullif(trim(coalesce(p_comment, '')), ''), v_p.platform_role, v_p.state)
  returning id into v_id;
  perform set_config('loamy.review_authorized', 'false', true);

  perform public.loamy_audit_internal('review_submitted', 'review', v_id,
    jsonb_build_object('transaction_id', p_transaction_id, 'rating', p_rating,
                       'direction', v_check->>'direction'));

  return jsonb_build_object('submitted', true, 'review_id', v_id, 'ref', v_ref);
end;
$$;

revoke all on function public.loamy_submit_review(uuid,int,text,int,int,int) from public, anon;
grant execute on function public.loamy_submit_review(uuid,int,text,int,int,int) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The subject's right of reply, and moderation.
-- ----------------------------------------------------------------------------
-- One reply, and it can be corrected for 24 hours. A reply that can be
-- rewritten forever lets a seller retro-fit their side of an old argument.
create or replace function public.loamy_respond_to_review(
  p_review_id uuid, p_response text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_r   public.reviews%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_r from public.reviews where id = p_review_id;
  if v_r.id is null or v_r.subject_id <> v_uid then
    raise exception 'Only the person reviewed can reply to a review.';
  end if;
  if v_r.responded_at is not null and v_r.responded_at < now() - interval '24 hours' then
    return jsonb_build_object('saved', false, 'reason', 'reply_locked',
      'message', 'A reply can be edited for 24 hours, then it is part of the record.');
  end if;
  if length(coalesce(trim(p_response), '')) = 0 then
    return jsonb_build_object('saved', false, 'reason', 'empty');
  end if;

  perform set_config('loamy.review_authorized', 'true', true);
  update public.reviews
     set response_text = trim(p_response), responded_at = now()
   where id = p_review_id;
  perform set_config('loamy.review_authorized', 'false', true);

  perform public.loamy_audit_internal('review_response', 'review', p_review_id, '{}'::jsonb);
  return jsonb_build_object('saved', true);
end;
$$;

revoke all on function public.loamy_respond_to_review(uuid,text) from public, anon;
grant execute on function public.loamy_respond_to_review(uuid,text) to authenticated;

create or replace function public.loamy_hide_review(
  p_review_id uuid, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not public.loamy_is_admin() then
    raise exception 'Only an administrator can hide a review.';
  end if;
  if length(coalesce(trim(p_reason), '')) = 0 then
    raise exception 'Hiding a review requires a recorded reason.';
  end if;

  perform set_config('loamy.review_authorized', 'true', true);
  update public.reviews
     set status = 'hidden_by_admin', hidden_reason = trim(p_reason),
         hidden_by = v_uid, hidden_at = now()
   where id = p_review_id;
  perform set_config('loamy.review_authorized', 'false', true);

  perform public.loamy_audit_internal('review_hidden', 'review', p_review_id,
    jsonb_build_object('reason', trim(p_reason)));
  return jsonb_build_object('hidden', true);
end;
$$;

revoke all on function public.loamy_hide_review(uuid,text) from public, anon;
grant execute on function public.loamy_hide_review(uuid,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Reading them: anonymous in public, attributed internally.
-- ----------------------------------------------------------------------------
/**
 * The public review feed for one member. reviewer_id is NOT in the payload --
 * not nulled in a column the caller could still select, simply absent.
 */
create or replace function public.loamy_profile_reviews(
  p_username text, p_limit int default 20, p_offset int default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_subject uuid;
  v_vis     text;
  v_rows    jsonb;
begin
  select id, profile_visibility into v_subject, v_vis
  from public.profiles where username = lower(trim(coalesce(p_username, '')));

  if v_subject is null
     or v_vis = 'private'
     or (v_vis = 'members' and auth.uid() is null) then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
             'ref', r.ref,
             'rating', r.rating,
             'quality', r.rating_quality,
             'communication', r.rating_communication,
             'timeliness', r.rating_timeliness,
             'comment', r.comment,
             'response', r.response_text,
             'responded_at', r.responded_at,
             -- Who, in the only terms the public gets.
             'reviewer_label', case r.direction
                                 when 'buyer_on_seller' then 'Verified buyer'
                                 else 'Verified seller' end,
             'reviewer_state', r.reviewer_state,
             'created_at', r.created_at) as x
    from public.reviews r
    where r.subject_id = v_subject and r.status = 'visible'
    order by r.created_at desc
    limit greatest(0, least(coalesce(p_limit, 20), 100))
    offset greatest(0, coalesce(p_offset, 0))
  ) s;

  return jsonb_build_object('found', true, 'items', v_rows);
end;
$$;

grant execute on function public.loamy_profile_reviews(text,int,int) to authenticated, anon;

/**
 * The summary that sits on a profile or a listing card.
 *
 * Below a threshold it returns has_enough=false and NO average. Three
 * five-star reviews from a seller's own network is not a 5.0 rating, and
 * showing one as though it were is the most common way these systems mislead.
 */
create or replace function public.loamy_rating_summary(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_n    int;
  v_avg  numeric;
  v_dist jsonb;
  v_min  int := 3;
begin
  select count(*), round(avg(rating)::numeric, 2)
    into v_n, v_avg
  from public.reviews
  where subject_id = p_user and status = 'visible';

  select coalesce(jsonb_object_agg(rating::text, n), '{}'::jsonb) into v_dist
  from (select rating, count(*) as n from public.reviews
        where subject_id = p_user and status = 'visible'
        group by rating) d;

  return jsonb_build_object(
    'count', v_n,
    'has_enough', v_n >= v_min,
    'minimum_for_average', v_min,
    'average', case when v_n >= v_min then v_avg else null end,
    'distribution', v_dist);
end;
$$;

grant execute on function public.loamy_rating_summary(uuid) to authenticated, anon;

comment on function public.loamy_rating_summary(uuid) is
  'Withholds the average below 3 reviews. A 5.0 from two deals is not a rating, and presenting it as one misleads a buyer.';
