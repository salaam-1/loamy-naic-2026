-- ============================================================================
-- Loamy Platform · Stage 3 · Migration 4 of 5
-- `listing_interests`: the NO-PAYMENT replacement for checkout. Buyer
-- expresses interest → seller accepts/declines → ON ACCEPTANCE ONLY both
-- parties can retrieve each other's contact phone via a security-definer
-- function → the deal concludes off-platform on bank rails.
-- ============================================================================

create table if not exists public.listing_interests (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid references public.listings (id) on delete cascade,
  directory_id    uuid references public.service_directory (id) on delete cascade,
  buyer_id        uuid not null references public.profiles (id) on delete cascade,
  quantity_wanted numeric check (quantity_wanted is null or quantity_wanted > 0),
  message         text,
  status          text not null default 'open'
    check (status in ('open','accepted','declined','withdrawn','concluded_externally')),
  seller_response text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Exactly one target: a marketplace listing OR a directory entry.
  constraint listing_interests_one_target
    check ((listing_id is null) <> (directory_id is null))
);

create index if not exists listing_interests_buyer_idx on public.listing_interests (buyer_id, created_at desc);
create index if not exists listing_interests_listing_idx on public.listing_interests (listing_id);
create index if not exists listing_interests_directory_idx on public.listing_interests (directory_id);

-- Counterparty ("seller") of an interest = listing seller or directory owner.
create or replace function public.loamy_interest_counterparty(p_listing uuid, p_directory uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select seller_id from public.listings where id = p_listing),
    (select owner_id  from public.service_directory where id = p_directory)
  );
$$;

revoke all on function public.loamy_interest_counterparty(uuid, uuid) from public;
revoke all on function public.loamy_interest_counterparty(uuid, uuid) from anon;
grant execute on function public.loamy_interest_counterparty(uuid, uuid) to authenticated;

-- SECURITY-REVIEW: interests are two-party private data. Only the buyer and
-- the seller/owner of the target may ever see a row; a third account sees
-- nothing (verified in scripts/verify-stage3.mjs). Contact details are NOT
-- columns here — they are only reachable through loamy_get_interest_contacts
-- below, after acceptance.
alter table public.listing_interests enable row level security;

drop policy if exists "loamy_interests_select_parties" on public.listing_interests;
create policy "loamy_interests_select_parties"
  on public.listing_interests for select to authenticated
  using (
    buyer_id = auth.uid()
    or public.loamy_interest_counterparty(listing_id, directory_id) = auth.uid()
    or public.loamy_is_admin()
  );

-- Buyer creates; cannot express interest in their own listing/entry; listing
-- must be active.
drop policy if exists "loamy_interests_insert_buyer" on public.listing_interests;
create policy "loamy_interests_insert_buyer"
  on public.listing_interests for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and status = 'open'
    and public.loamy_interest_counterparty(listing_id, directory_id) is not null
    and public.loamy_interest_counterparty(listing_id, directory_id) <> auth.uid()
    and (listing_id is null or exists (
      select 1 from public.listings l where l.id = listing_id and l.status = 'active'
    ))
  );

-- Both parties may update; the guard trigger below enforces WHO may make
-- WHICH transition. No delete policy: withdrawal is a status, not a delete.
drop policy if exists "loamy_interests_update_parties" on public.listing_interests;
create policy "loamy_interests_update_parties"
  on public.listing_interests for update to authenticated
  using (
    buyer_id = auth.uid()
    or public.loamy_interest_counterparty(listing_id, directory_id) = auth.uid()
  )
  with check (
    buyer_id = auth.uid()
    or public.loamy_interest_counterparty(listing_id, directory_id) = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- Transition guard: buyer may withdraw an open interest and mark an accepted
-- one concluded; seller may accept/decline an open one (with a response) and
-- mark an accepted one concluded. Nothing else moves.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: security-definer (reads the target row regardless of its
-- listing's visibility). Verify the transition matrix stays exactly as
-- documented and that target/buyer columns stay frozen.
create or replace function public.loamy_interest_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller  uuid := public.loamy_interest_counterparty(old.listing_id, old.directory_id);
  is_buyer  boolean := auth.uid() = old.buyer_id;
  is_seller boolean := auth.uid() = v_seller;
begin
  if new.buyer_id is distinct from old.buyer_id
     or new.listing_id is distinct from old.listing_id
     or new.directory_id is distinct from old.directory_id then
    raise exception 'Interest parties cannot be changed';
  end if;

  if new.seller_response is distinct from old.seller_response and not is_seller then
    raise exception 'Only the seller can write a response';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'open' and new.status = 'withdrawn' and is_buyer then
      null; -- ok
    elsif old.status = 'open' and new.status in ('accepted','declined') and is_seller then
      null; -- ok
    elsif old.status = 'accepted' and new.status = 'concluded_externally' and (is_buyer or is_seller) then
      null; -- ok
    else
      raise exception 'Transition % -> % is not allowed for this party', old.status, new.status;
    end if;
  elsif not is_buyer and not is_seller then
    raise exception 'Not a party to this interest';
  end if;

  return new;
end;
$$;

drop trigger if exists loamy_interests_guard on public.listing_interests;
create trigger loamy_interests_guard
  before update on public.listing_interests
  for each row execute function public.loamy_interest_guard();

-- ----------------------------------------------------------------------------
-- Notifications: seller hears about new interest; buyer hears about the
-- seller's decision. Security definer so the inserts pass notifications RLS.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_interest_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := public.loamy_interest_counterparty(new.listing_id, new.directory_id);
  v_label  text;
begin
  select coalesce(
    (select commodity from public.listings where id = new.listing_id),
    (select business_name from public.service_directory where id = new.directory_id),
    'your listing'
  ) into v_label;

  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, title, body, type)
    values (v_seller, 'New interest received',
            'Someone is interested in "' || v_label || '". Review it in your interests inbox.',
            'marketplace');
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'accepted' then
      insert into public.notifications (user_id, title, body, type)
      values (new.buyer_id, 'Interest accepted',
              'Your interest in "' || v_label || '" was accepted. Contact details are now available — payment and delivery are arranged directly through your bank.',
              'marketplace');
    elsif new.status = 'declined' then
      insert into public.notifications (user_id, title, body, type)
      values (new.buyer_id, 'Interest declined',
              'Your interest in "' || v_label || '" was declined.' , 'marketplace');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_interests_notify on public.listing_interests;
create trigger loamy_interests_notify
  after insert or update on public.listing_interests
  for each row execute function public.loamy_interest_notify();

-- ----------------------------------------------------------------------------
-- THE contact-disclosure moment. Both parties' name + phone, ONLY to the two
-- parties, ONLY after acceptance.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW: this is the single most sensitive function of Stage 3.
-- Verify: (1) caller must be buyer or seller of the interest, (2) status must
-- be 'accepted' or 'concluded_externally', (3) it returns name+phone ONLY
-- (never email, digital_id, BVN/NIN, address), (4) grants stay
-- authenticated-only, (5) no other function or view exposes profiles.phone.
create or replace function public.loamy_get_interest_contacts(p_interest_id uuid)
returns table (party text, full_name text, phone text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_interest public.listing_interests%rowtype;
  v_seller   uuid;
begin
  select * into v_interest from public.listing_interests where id = p_interest_id;
  if v_interest.id is null then
    raise exception 'Interest not found';
  end if;

  v_seller := public.loamy_interest_counterparty(v_interest.listing_id, v_interest.directory_id);

  if auth.uid() is distinct from v_interest.buyer_id
     and auth.uid() is distinct from v_seller then
    raise exception 'Not a party to this interest';
  end if;

  if v_interest.status not in ('accepted','concluded_externally') then
    raise exception 'Contact details are only shared after the seller accepts';
  end if;

  return query
  select 'buyer'::text, p.full_name, p.phone from public.profiles p where p.id = v_interest.buyer_id
  union all
  select 'seller'::text, p.full_name, p.phone from public.profiles p where p.id = v_seller;
end;
$$;

revoke all on function public.loamy_get_interest_contacts(uuid) from public;
revoke all on function public.loamy_get_interest_contacts(uuid) from anon;
grant execute on function public.loamy_get_interest_contacts(uuid) to authenticated;
