-- ============================================================================
-- Loamy Marketplace · Buy Requests (RFQ board, Stage 5).
-- Buyers post what they want to buy; sellers browse open demand and respond.
-- Browsing open requests is public (anon-safe view); posting and responding
-- require an account. No fabricated demand — every row is a real member's post.
-- ============================================================================

create table if not exists public.buy_requests (
  id           uuid primary key default gen_random_uuid(),
  buyer_id     uuid not null references public.profiles (id) on delete cascade,
  commodity    text not null,
  quantity     numeric not null check (quantity > 0),
  unit         text not null,
  target_price numeric check (target_price is null or target_price >= 0),
  currency     text not null default 'NGN',
  state        text,
  lga          text,
  note         text,
  status       text not null default 'open' check (status in ('open','closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists buy_requests_open_idx  on public.buy_requests (status, created_at desc);
create index if not exists buy_requests_buyer_idx on public.buy_requests (buyer_id, created_at desc);

-- SECURITY-REVIEW: a buy request is visible to everyone while OPEN (it is a
-- demand signal for sellers), plus the owner sees their own in any status. Only
-- the owner can create/update their rows. No contact columns here.
alter table public.buy_requests enable row level security;

drop policy if exists "loamy_buy_requests_select" on public.buy_requests;
create policy "loamy_buy_requests_select"
  on public.buy_requests for select to authenticated
  using (status = 'open' or buyer_id = auth.uid() or public.loamy_is_admin());

drop policy if exists "loamy_buy_requests_insert_own" on public.buy_requests;
create policy "loamy_buy_requests_insert_own"
  on public.buy_requests for insert to authenticated
  with check (buyer_id = auth.uid() and status = 'open');

drop policy if exists "loamy_buy_requests_update_own" on public.buy_requests;
create policy "loamy_buy_requests_update_own"
  on public.buy_requests for update to authenticated
  using (buyer_id = auth.uid())
  with check (buyer_id = auth.uid());

-- Anon-safe browse view: OPEN requests only, safe columns + buyer display name.
create or replace view public.loamy_public_buy_requests
with (security_invoker = false) as
select
  r.id, r.commodity, r.quantity, r.unit, r.target_price, r.currency,
  r.state, r.lga, r.note, r.created_at,
  p.full_name as buyer_display_name,
  p.category  as buyer_category
from public.buy_requests r
join public.profiles p on p.id = r.buyer_id
where r.status = 'open';

revoke all on public.loamy_public_buy_requests from public;
grant select on public.loamy_public_buy_requests to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Responses — a seller's offer/message on an open request. One per seller.
-- ----------------------------------------------------------------------------
create table if not exists public.buy_request_responses (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.buy_requests (id) on delete cascade,
  responder_id     uuid not null references public.profiles (id) on delete cascade,
  message          text,
  offered_price    numeric check (offered_price is null or offered_price >= 0),
  offered_quantity numeric check (offered_quantity is null or offered_quantity > 0),
  created_at       timestamptz not null default now(),
  unique (request_id, responder_id)
);

create index if not exists buy_request_responses_req_idx on public.buy_request_responses (request_id, created_at desc);

-- SECURITY-REVIEW: a response is two-party — visible only to the request's owner
-- (buyer) and the responder (plus admin). A seller may respond only to an OPEN
-- request that is not their own; one response per seller per request.
alter table public.buy_request_responses enable row level security;

drop policy if exists "loamy_br_responses_select_parties" on public.buy_request_responses;
create policy "loamy_br_responses_select_parties"
  on public.buy_request_responses for select to authenticated
  using (
    responder_id = auth.uid()
    or public.loamy_is_admin()
    or exists (select 1 from public.buy_requests r where r.id = request_id and r.buyer_id = auth.uid())
  );

drop policy if exists "loamy_br_responses_insert_own" on public.buy_request_responses;
create policy "loamy_br_responses_insert_own"
  on public.buy_request_responses for insert to authenticated
  with check (
    responder_id = auth.uid()
    and exists (
      select 1 from public.buy_requests r
      where r.id = request_id and r.status = 'open' and r.buyer_id <> auth.uid()
    )
  );

-- Notify the buyer when a seller responds.
create or replace function public.loamy_buy_request_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid;
  v_label text;
begin
  select buyer_id, commodity into v_buyer, v_label from public.buy_requests where id = new.request_id;
  if v_buyer is not null then
    insert into public.notifications (user_id, title, body, type)
    values (v_buyer, 'New response to your buy request',
            'A seller responded to your request for "' || coalesce(v_label, 'a commodity') || '". Review it in Buy Requests.',
            'marketplace');
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_buy_request_notify on public.buy_request_responses;
create trigger loamy_buy_request_notify
  after insert on public.buy_request_responses
  for each row execute function public.loamy_buy_request_notify();
