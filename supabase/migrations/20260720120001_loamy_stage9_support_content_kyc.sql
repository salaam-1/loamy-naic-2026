-- ============================================================================
-- Loamy Platform · Stage 9 (PHASE 2 · final) · Support/Disputes, Content, KYC
-- Additive. Support ticketing, admin-managed content, and a BVN/NIN
-- verified-STATUS flow that NEVER stores the raw number (encryption gate).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) support_tickets + support_messages (Disputes/Support).
-- ----------------------------------------------------------------------------
create table if not exists public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  opener_id       uuid not null references public.profiles (id) on delete cascade,
  category        text not null check (category in ('payment','verification','marketplace','financing','account','other')),
  subject         text not null,
  status          text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  assigned_to     uuid references public.profiles (id) on delete set null,
  resolution_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists support_tickets_opener_idx on public.support_tickets (opener_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, created_at desc);

create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

-- SECURITY-REVIEW: two-party (opener + admin) private support data. Opener
-- reads/opens own; admin reads all. All writes go through security-definer
-- functions below (open/reply/resolve) so status transitions and assignment
-- stay controlled. No third party can read a ticket or its messages.
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "loamy_tickets_select" on public.support_tickets;
create policy "loamy_tickets_select"
  on public.support_tickets for select to authenticated
  using (opener_id = auth.uid() or public.loamy_is_admin());

drop policy if exists "loamy_ticket_messages_select" on public.support_messages;
create policy "loamy_ticket_messages_select"
  on public.support_messages for select to authenticated
  using (exists (select 1 from public.support_tickets t where t.id = ticket_id
                 and (t.opener_id = auth.uid() or public.loamy_is_admin())));

drop trigger if exists loamy_tickets_updated_at on public.support_tickets;
create trigger loamy_tickets_updated_at before update on public.support_tickets
  for each row execute function public.loamy_set_updated_at();

-- Open a ticket (any signed-in user) + first message; notify admins.
create or replace function public.loamy_open_ticket(p_category text, p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_admin uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce(btrim(p_subject),'') = '' or coalesce(btrim(p_body),'') = '' then
    raise exception 'Subject and message are required';
  end if;
  insert into public.support_tickets (opener_id, category, subject)
  values (auth.uid(), p_category, p_subject) returning id into v_id;
  insert into public.support_messages (ticket_id, sender_id, body) values (v_id, auth.uid(), p_body);
  for v_admin in select id from public.profiles where role = 'admin' loop
    perform public.loamy_create_notification_internal(v_admin, 'New support ticket',
      'A ' || p_category || ' ticket was opened: ' || p_subject, 'support');
  end loop;
  perform public.loamy_audit_internal('ticket_opened', 'support_ticket', v_id,
    jsonb_build_object('category', p_category));
  return v_id;
end;
$$;

-- Reply to a ticket (opener or admin). Reopens a resolved ticket if the opener
-- writes back; notifies the other party.
create or replace function public.loamy_ticket_reply(p_ticket uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_t public.support_tickets%rowtype; v_is_admin boolean := public.loamy_is_admin();
begin
  select * into v_t from public.support_tickets where id = p_ticket;
  if v_t.id is null then raise exception 'Ticket not found'; end if;
  if v_t.opener_id <> auth.uid() and not v_is_admin then raise exception 'Not your ticket'; end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'Message is required'; end if;

  insert into public.support_messages (ticket_id, sender_id, body) values (p_ticket, auth.uid(), p_body);
  if not v_is_admin and v_t.status = 'resolved' then
    update public.support_tickets set status = 'open' where id = p_ticket;
  elsif v_is_admin and v_t.status = 'open' then
    update public.support_tickets set status = 'in_progress', assigned_to = auth.uid() where id = p_ticket;
  end if;

  if v_is_admin then
    perform public.loamy_create_notification_internal(v_t.opener_id, 'Support reply',
      'The Loamy team replied to your ticket: ' || v_t.subject, 'support');
  end if;
end;
$$;

-- Admin resolves/updates a ticket.
create or replace function public.loamy_admin_resolve_ticket(p_ticket uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_t public.support_tickets%rowtype;
begin
  if not public.loamy_is_admin() then raise exception 'Admin only'; end if;
  if p_status not in ('in_progress','resolved','closed') then raise exception 'Invalid status'; end if;
  select * into v_t from public.support_tickets where id = p_ticket;
  if v_t.id is null then raise exception 'Ticket not found'; end if;
  update public.support_tickets
  set status = p_status, resolution_note = coalesce(p_note, resolution_note), assigned_to = auth.uid()
  where id = p_ticket;
  perform public.loamy_audit_internal('ticket_' || p_status, 'support_ticket', p_ticket, '{}'::jsonb);
  perform public.loamy_create_notification_internal(v_t.opener_id,
    'Support ticket ' || p_status,
    coalesce(p_note, 'Your ticket "' || v_t.subject || '" was updated.'), 'support');
end;
$$;

grant execute on function public.loamy_open_ticket(text, text, text) to authenticated;
grant execute on function public.loamy_ticket_reply(uuid, text) to authenticated;
grant execute on function public.loamy_admin_resolve_ticket(uuid, text, text) to authenticated;
revoke all on function public.loamy_open_ticket(text, text, text) from public, anon;
revoke all on function public.loamy_ticket_reply(uuid, text) from public, anon;
revoke all on function public.loamy_admin_resolve_ticket(uuid, text, text) from public, anon;

-- ----------------------------------------------------------------------------
-- 2) content_entries (Content Management) — admin-managed help/FAQ/notices.
-- ----------------------------------------------------------------------------
create table if not exists public.content_entries (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'faq' check (kind in ('faq','notice','page')),
  title      text not null,
  body       text not null default '',
  published  boolean not null default false,
  sort_order int not null default 0,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_entries_kind_idx on public.content_entries (kind, sort_order);

alter table public.content_entries enable row level security;

-- Everyone signed in reads PUBLISHED content; admin reads all + writes.
drop policy if exists "loamy_content_select" on public.content_entries;
create policy "loamy_content_select"
  on public.content_entries for select to authenticated
  using (published or public.loamy_is_admin());

drop policy if exists "loamy_content_admin_write" on public.content_entries;
create policy "loamy_content_admin_write"
  on public.content_entries for insert to authenticated with check (public.loamy_is_admin());
drop policy if exists "loamy_content_admin_update" on public.content_entries;
create policy "loamy_content_admin_update"
  on public.content_entries for update to authenticated using (public.loamy_is_admin()) with check (public.loamy_is_admin());
drop policy if exists "loamy_content_admin_delete" on public.content_entries;
create policy "loamy_content_admin_delete"
  on public.content_entries for delete to authenticated using (public.loamy_is_admin());

drop trigger if exists loamy_content_updated_at on public.content_entries;
create trigger loamy_content_updated_at before update on public.content_entries
  for each row execute function public.loamy_set_updated_at();

-- ----------------------------------------------------------------------------
-- 3) KYC verified-STATUS. The raw bvn_encrypted/nin_encrypted columns stay
--    untouched and unused. These booleans + a provider REFERENCE record only
--    that verification passed — never the number, never the document.
-- ----------------------------------------------------------------------------
-- SECURITY-REVIEW ★ HARD GATE ★ (HANDOFF §3 item 1): no raw BVN/NIN is stored
-- anywhere. The record function is SERVICE_ROLE-only — a Phase-2 edge function,
-- AFTER the provider verifies via a provider-hosted capture, calls it. Clients
-- cannot self-verify. Wiring it requires the encryption-at-rest sign-off.
alter table public.profiles
  add column if not exists bvn_verified boolean not null default false,
  add column if not exists nin_verified boolean not null default false,
  add column if not exists kyc_reference text;

comment on column public.profiles.bvn_verified is
  'BVN verification PASSED (status only — the raw number is never stored). Set by a service-role Phase-2 edge function after provider verification. Awaits encryption/KYC review.';

create or replace function public.loamy_record_kyc_result(
  p_user uuid, p_field text, p_verified boolean, p_reference text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_field not in ('bvn','nin') then raise exception 'Invalid KYC field'; end if;
  -- Stores STATUS + provider reference only. Never the raw number.
  if p_field = 'bvn' then
    update public.profiles set bvn_verified = p_verified, kyc_reference = coalesce(p_reference, kyc_reference) where id = p_user;
  else
    update public.profiles set nin_verified = p_verified, kyc_reference = coalesce(p_reference, kyc_reference) where id = p_user;
  end if;
end;
$$;

-- SERVICE_ROLE only — clients (authenticated/anon) can never call this.
revoke all on function public.loamy_record_kyc_result(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.loamy_record_kyc_result(uuid, text, boolean, text) to service_role;
