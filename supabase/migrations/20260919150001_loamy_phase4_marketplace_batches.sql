-- ============================================================================
-- PHASE 4 — the marketplace sells real batches.
-- ----------------------------------------------------------------------------
-- Directive Part 15: "Do not create fake marketplace inventory independent from
-- real batch records", and "clearly distinguish SELLER DECLARED from LOAMY
-- VERIFIED / OBSERVED".
--
-- Today a listing is free-floating text: a seller types a commodity and a
-- quantity and nothing connects it to stock that exists. This phase adds the
-- link, and makes the DIFFERENCE between a backed listing and a declared one a
-- data fact rather than a UI adjective.
--
-- WHY NOT MAKE batch_id MANDATORY: input listings (fertiliser, seed) have no
-- harvest and never will, and 171 live accounts already have declared
-- listings. Forcing a batch would delete working inventory to satisfy a model.
-- Instead `claim_basis` says which kind each listing is, honestly, and buyers
-- can filter. Over-claiming is the failure mode worth preventing, not declared
-- listings existing.
--
-- SECURITY-REVIEW ** PUBLIC SURFACE CHANGE **
-- loamy_public_listings is granted to `anon`. This migration adds
-- verification_status, origin_traced and batch_ref to it. Those are safe and
-- are precisely what a remote buyer needs. It does NOT add farm_id,
-- coordinates, the origin farmer's identity, or current_location — a batch's
-- physical whereabouts must never reach an untransacted buyer. Verify that no
-- column added here can be joined back to a farm's location.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Link listings to batches.
-- ----------------------------------------------------------------------------
alter table public.listings
  add column if not exists ref          text unique,
  add column if not exists batch_id     uuid references public.commodity_batches (id) on delete set null,
  add column if not exists quality_grade text,
  -- The honest label. Derived, never typed by a seller.
  add column if not exists claim_basis  text not null default 'seller_declared'
    check (claim_basis in ('seller_declared','batch_backed'));

create index if not exists listings_batch_idx on public.listings (batch_id) where batch_id is not null;

comment on column public.listings.batch_id is
  'The commodity batch this listing sells. Null for declared listings and for inputs. Set only by loamy_list_batch.';
comment on column public.listings.claim_basis is
  'batch_backed = traceable stock behind this listing. seller_declared = the seller typed it. Never seller-editable.';

drop trigger if exists loamy_listings_assign_ref on public.listings;
create trigger loamy_listings_assign_ref
  before insert on public.listings
  for each row execute function public.loamy_assign_ref('listing', 'LIST');

do $$
declare r record;
begin
  for r in select id from public.listings where ref is null loop
    update public.listings set ref = public.loamy_register_ref('listing', r.id, 'LIST') where id = r.id;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. A seller cannot claim a batch by editing the column.
-- ----------------------------------------------------------------------------
-- The whole value of a backed listing is that the link was checked. If a
-- seller could set batch_id themselves they could point any listing at any
-- batch, or set claim_basis='batch_backed' with no batch at all.
create or replace function public.loamy_protect_listing_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('loamy.listing_batch_authorized', true), '') = 'true' then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    if new.batch_id is not null or new.claim_basis <> 'seller_declared' then
      raise exception 'A batch-backed listing is created with loamy_list_batch, not by insert.';
    end if;
  else
    if new.batch_id is distinct from old.batch_id
       or new.claim_basis is distinct from old.claim_basis then
      raise exception 'batch_id and claim_basis are set by the platform, not by the seller.';
    end if;
    -- Quantity on a backed listing is bounded by the batch, so it moves
    -- through the RPC too.
    if old.batch_id is not null and new.quantity_kg is distinct from old.quantity_kg then
      raise exception 'Change the quantity of a batch-backed listing with loamy_list_batch.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_listings_protect_batch on public.listings;
create trigger loamy_listings_protect_batch
  before insert or update on public.listings
  for each row execute function public.loamy_protect_listing_batch();

-- ----------------------------------------------------------------------------
-- 3. List a batch.
-- ----------------------------------------------------------------------------
/**
 * The only way a batch-backed listing comes into existence.
 *
 * Refuses to over-list: the total quantity across a batch's ACTIVE listings can
 * never exceed the batch's available quantity, so one 60-tonne batch cannot be
 * advertised twice as 60 tonnes.
 */
create or replace function public.loamy_list_batch(
  p_batch_id      uuid,
  p_quantity      numeric,
  p_price_per_unit numeric,
  p_state         text default null,
  p_lga           text default null,
  p_description   text default null,
  p_available_from date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_b       public.commodity_batches%rowtype;
  v_listed  numeric;
  v_id      uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;
  if p_price_per_unit is null or p_price_per_unit <= 0 then
    raise exception 'Price must be greater than zero.';
  end if;

  select * into v_b from public.commodity_batches where id = p_batch_id for update;
  if v_b.id is null then raise exception 'Batch not found.'; end if;
  if v_b.owner_id <> v_uid then
    raise exception 'You can only list a batch you hold.';
  end if;
  if v_b.status in ('sold','cancelled','disputed','delivered','released') then
    raise exception 'A batch that is % cannot be listed.', v_b.status;
  end if;

  select coalesce(sum(quantity_kg), 0) into v_listed
  from public.listings
  where batch_id = p_batch_id and status = 'active';

  if v_listed + p_quantity > v_b.available_quantity + 0.000001 then
    raise exception 'Only % % of this batch is available to list (% already listed).',
      v_b.available_quantity - v_listed, v_b.unit, v_listed;
  end if;

  perform set_config('loamy.listing_batch_authorized', 'true', true);
  insert into public.listings (
    seller_id, listing_type, commodity, quantity_kg, unit, price_per_unit,
    state, lga, description, available_from, status,
    batch_id, claim_basis, quality_grade
  ) values (
    v_uid, 'commodity', v_b.commodity, p_quantity, v_b.unit, p_price_per_unit,
    coalesce(p_state, v_b.current_state, v_b.origin_state),
    coalesce(p_lga, v_b.origin_lga), p_description, p_available_from, 'active',
    p_batch_id, 'batch_backed', v_b.quality_grade
  ) returning id into v_id;
  perform set_config('loamy.listing_batch_authorized', 'false', true);

  -- Move the batch to listed, unless it is already there.
  if v_b.status in ('created','verified','partially_sold') then
    perform public.loamy_batch_transition(
      p_batch_id, 'listed', null, 'listing', v_id, null, null, null, null,
      jsonb_build_object('quantity', p_quantity), '{}'::jsonb, null);
  end if;

  return v_id;
end;
$$;

revoke all on function public.loamy_list_batch(uuid,numeric,numeric,text,text,text,date) from public, anon;
grant execute on function public.loamy_list_batch(uuid,numeric,numeric,text,text,text,date) to authenticated;

/** Take a batch-backed listing down. */
create or replace function public.loamy_unlist_batch(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_l public.listings%rowtype;
  v_remaining int;
begin
  select * into v_l from public.listings where id = p_listing_id;
  if v_l.id is null then raise exception 'Listing not found.'; end if;
  if v_l.seller_id <> auth.uid() then raise exception 'That is not your listing.'; end if;

  perform set_config('loamy.listing_batch_authorized', 'true', true);
  update public.listings set status = 'paused', updated_at = now() where id = p_listing_id;
  perform set_config('loamy.listing_batch_authorized', 'false', true);

  if v_l.batch_id is not null then
    select count(*) into v_remaining
    from public.listings where batch_id = v_l.batch_id and status = 'active';
    if v_remaining = 0 then
      perform public.loamy_batch_transition(
        v_l.batch_id, 'unlisted', null, 'listing', p_listing_id,
        null, null, null, null, '{}'::jsonb, '{}'::jsonb, null);
    end if;
  end if;
end;
$$;

revoke all on function public.loamy_unlist_batch(uuid) from public, anon;
grant execute on function public.loamy_unlist_batch(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The buyer-facing surface: declared vs verified, said plainly.
-- ----------------------------------------------------------------------------
drop view if exists public.loamy_public_listings;

create view public.loamy_public_listings
with (security_invoker = false) as
select
  l.id,
  l.ref                      as listing_ref,
  l.commodity,
  l.listing_type,
  l.quantity_kg              as quantity,
  l.unit,
  l.price_per_unit,
  l.currency,
  l.state,
  l.lga,
  l.photos,
  l.quality_grade,
  l.created_at,
  p.full_name                as seller_display_name,
  p.category                 as seller_category,
  coalesce(p.verified_badge, false) as seller_verified,

  -- Part 15: the distinction, as data.
  l.claim_basis,
  b.ref                      as batch_ref,
  coalesce(b.verification_status, 'unverified') as verification_status,
  coalesce(b.origin_traced, false)              as origin_traced,
  -- Origin at STATE granularity only. Never the farm, never coordinates.
  b.origin_state
from public.listings l
join public.profiles p on p.id = l.seller_id
left join public.commodity_batches b on b.id = l.batch_id
where l.status = 'active';

revoke all on public.loamy_public_listings from public;
grant select on public.loamy_public_listings to anon, authenticated;

comment on view public.loamy_public_listings is
  'Public marketplace surface. Adds verification_status/origin_traced/batch_ref so a buyer can tell verified stock from a declaration. Deliberately excludes farm identity, coordinates and current_location.';

-- ----------------------------------------------------------------------------
-- 5. Buyer-requested verification (the remote-sourcing trust feature).
-- ----------------------------------------------------------------------------
/**
 * Directive Part 16 / Part 23: a buyer in Lagos looking at maize in Benue can
 * ask Loamy to send someone to look at it.
 *
 * Creates a commodity_verification case against the batch. The buyer becomes
 * the requester, so they can see the evidence and the outcome — but NOT the
 * batch's location, which stays with the case.
 */
create or replace function public.loamy_request_listing_verification(
  p_listing_id uuid,
  p_note       text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_l    public.listings%rowtype;
  v_b    public.commodity_batches%rowtype;
  v_case uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_l from public.listings where id = p_listing_id;
  if v_l.id is null then raise exception 'Listing not found.'; end if;
  if v_l.status <> 'active' then raise exception 'That listing is not active.'; end if;
  if v_l.seller_id = v_uid then
    raise exception 'You cannot request verification of your own listing.';
  end if;
  if v_l.batch_id is null then
    raise exception 'This listing is seller-declared and has no batch to inspect. Ask the seller to list traceable stock.';
  end if;

  select * into v_b from public.commodity_batches where id = v_l.batch_id;

  -- One open request per buyer per batch.
  select id into v_case from public.verification_tasks
  where subject_type = 'commodity_batch' and subject_id = v_l.batch_id
    and requested_by = v_uid
    and status not in ('approved','rejected');
  if v_case is not null then return v_case; end if;

  perform set_config('loamy.status_change_authorized', 'true', true);
  insert into public.verification_tasks (
    task_type, subject_type, subject_id, subject_user_id, requested_by,
    status, priority, expected_state, expected_lga
  ) values (
    'commodity_verification', 'commodity_batch', v_l.batch_id, v_b.owner_id, v_uid,
    'pending', 'high', coalesce(v_b.current_state, v_b.origin_state), v_b.origin_lga
  ) returning id into v_case;
  perform set_config('loamy.status_change_authorized', 'false', true);

  insert into public.notifications (user_id, title, body, type)
  values (v_b.owner_id, 'A buyer requested verification',
          'A buyer has asked Loamy to inspect stock behind one of your listings. A field agent will be in touch.',
          'verification');

  return v_case;
end;
$$;

revoke all on function public.loamy_request_listing_verification(uuid,text) from public, anon;
grant execute on function public.loamy_request_listing_verification(uuid,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Seller view of their own batch-backed inventory.
-- ----------------------------------------------------------------------------
create or replace view public.loamy_my_batch_listings as
select
  l.id            as listing_id,
  l.ref           as listing_ref,
  l.seller_id,
  l.commodity,
  l.quantity_kg,
  l.unit,
  l.price_per_unit,
  l.status        as listing_status,
  l.claim_basis,
  b.id            as batch_id,
  b.ref           as batch_ref,
  b.available_quantity,
  b.status        as batch_status,
  b.verification_status,
  b.origin_traced,
  (select coalesce(sum(l2.quantity_kg), 0) from public.listings l2
    where l2.batch_id = b.id and l2.status = 'active') as total_listed_from_batch
from public.listings l
join public.commodity_batches b on b.id = l.batch_id;

alter view public.loamy_my_batch_listings set (security_invoker = on);
grant select on public.loamy_my_batch_listings to authenticated;
