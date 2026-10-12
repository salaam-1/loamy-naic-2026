-- ============================================================================
-- PHASE 6 — financing abstraction, transaction-linked.
-- ----------------------------------------------------------------------------
-- Master directive Parts 14-17. Built now under Part 1: where an integration
-- cannot safely be activated, build the interface, model, workflow and
-- permissions, and isolate the boundary behind a sandbox adapter. Nothing here
-- pretends a bank is connected.
--
-- THE CENTRAL IDEA (Part 14): a buyer is not asking "give me N10m". They are
-- asking "finance THIS transaction" -- this batch, this seller, this price,
-- this delivery. So a financing application INHERITS its transaction context
-- rather than being a free-standing loan request, and a bank can see exactly
-- what it is funding.
--
-- WHAT LOAMY DOES NOT DO, enforced rather than documented:
--   * no BVN, ever. Not a column, not a payload, not a log. (Part 16)
--   * no credit decision. approved_amount can ONLY be written by the bank or
--     the platform acting for it -- never by the applicant. (Part 15)
--   * no hard-coded limits. The eligibility signal is configurable and is
--     explicitly labelled a RECOMMENDATION, not an approval. (Part 17)
--
-- SECURITY-REVIEW ** LIVELIHOOD DATA + A BANK BOUNDARY **
-- An application exposes what someone earns and owes. Read is the applicant,
-- officers of the assigned bank, and admin. A bank officer must never see an
-- application assigned to a different bank -- that is the one boundary in this
-- migration that would be a regulatory incident, not just a bug.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Bank integration boundary.
-- ----------------------------------------------------------------------------
-- One row per bank describing WHAT THAT BANK SUPPORTS. The directive is
-- explicit that no two banks behave alike and that supplier-direct settlement
-- must never be assumed -- so it is a per-bank capability flag, not a global.
alter table public.banks
  add column if not exists ref text unique,
  add column if not exists adapter_key text not null default 'sandbox',
  -- Capabilities, defaulting to the most conservative answer: no.
  add column if not exists supports_account_opening boolean not null default false,
  add column if not exists supports_supplier_direct boolean not null default false,
  add column if not exists supports_status_callback boolean not null default false,
  -- 'sandbox' until a real integration is signed off. A live adapter must be
  -- turned on deliberately, by an admin, per bank.
  add column if not exists integration_mode text not null default 'sandbox'
    check (integration_mode in ('sandbox','live','disabled')),
  add column if not exists account_opening_url text,
  add column if not exists contact_note text;

drop trigger if exists loamy_banks_assign_ref on public.banks;
create trigger loamy_banks_assign_ref
  before insert on public.banks
  for each row execute function public.loamy_assign_ref('bank', 'BNK');

do $$
declare r record;
begin
  for r in select id from public.banks where ref is null loop
    update public.banks set ref = public.loamy_register_ref('bank', r.id, 'BNK') where id = r.id;
  end loop;
end;
$$;

comment on column public.banks.supports_supplier_direct is
  'Whether THIS bank can pay a verified seller directly. Never assumed -- the directive is explicit that not every bank supports it.';
comment on column public.banks.integration_mode is
  'sandbox until a real integration is signed off. A live adapter is switched on deliberately, per bank, by an admin.';

-- ----------------------------------------------------------------------------
-- 2. Bank account links — WITHOUT BVN.
-- ----------------------------------------------------------------------------
-- Part 16: if a bank needs a BVN, the BANK collects it. Loamy stores the
-- minimum needed to continue the workflow: which bank, a masked account tail,
-- and whether the bank confirmed the link. There is deliberately no column
-- that could hold a BVN, and no free-text blob that could be abused as one.
create table if not exists public.bank_account_links (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  bank_id       uuid not null references public.banks (id) on delete cascade,

  -- Last four digits only. Never the full number, never the BVN.
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  -- Opaque handle issued BY THE BANK for this relationship. Meaningless to us.
  bank_reference text,
  account_name_masked text,

  status        text not null default 'pending' check (status in
                  ('pending','link_requested','account_opening','linked','failed','revoked')),
  linked_at     timestamptz,
  failure_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, bank_id)
);

create index if not exists bank_links_user_idx on public.bank_account_links (user_id);

-- SECURITY-REVIEW: own-row only. A bank officer sees a link ONLY for their own
-- bank, via the policy below. No policy grants cross-bank visibility.
alter table public.bank_account_links enable row level security;

drop policy if exists "loamy_bank_links_select" on public.bank_account_links;
create policy "loamy_bank_links_select"
  on public.bank_account_links for select to authenticated
  using (
    user_id = auth.uid()
    or public.loamy_is_admin()
    or bank_id = public.loamy_officer_bank()
  );

drop trigger if exists loamy_bank_links_assign_ref on public.bank_account_links;
create trigger loamy_bank_links_assign_ref
  before insert on public.bank_account_links
  for each row execute function public.loamy_assign_ref('bank_account_link', 'BAL');

drop trigger if exists loamy_bank_links_updated_at on public.bank_account_links;
create trigger loamy_bank_links_updated_at
  before update on public.bank_account_links
  for each row execute function public.loamy_set_updated_at();

/**
 * Start linking a bank account.
 *
 * Deliberately takes the LAST FOUR DIGITS only. A full account number is not
 * needed for Loamy's side of the workflow, and a column that cannot hold one
 * cannot leak one. The bank verifies the customer through its own approved
 * flow and hands back an opaque reference.
 */
create or replace function public.loamy_link_bank_account(
  p_bank_id       uuid,
  p_account_last4 text default null,
  p_has_account   boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_b   public.banks%rowtype;
  v_id  uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if p_account_last4 is not null and p_account_last4 !~ '^[0-9]{4}$' then
    raise exception 'Provide the last four digits only.';
  end if;

  select * into v_b from public.banks where id = p_bank_id and active;
  if v_b.id is null then raise exception 'Bank not found or inactive.'; end if;
  if v_b.integration_mode = 'disabled' then
    raise exception 'That bank is not accepting applications through Loamy right now.';
  end if;

  -- "Do you have a <BANK> account?" -> yes links, no routes to the bank's own
  -- account-opening flow. Loamy never opens an account itself.
  if p_has_account then
    v_status := 'link_requested';
  else
    if not v_b.supports_account_opening then
      raise exception 'This bank does not offer account opening through Loamy. Open an account with them directly, then link it here.';
    end if;
    v_status := 'account_opening';
  end if;

  insert into public.bank_account_links (user_id, bank_id, account_last4, status)
  values (v_uid, p_bank_id, p_account_last4, v_status)
  on conflict (user_id, bank_id) do update
    set account_last4 = coalesce(excluded.account_last4, public.bank_account_links.account_last4),
        status = v_status, updated_at = now()
  returning id into v_id;

  return jsonb_build_object(
    'link_id', v_id,
    'status', v_status,
    -- The client sends the user here. Loamy collects nothing further.
    'next', case when v_status = 'account_opening'
                 then jsonb_build_object('action', 'open_account_with_bank',
                                         'url', v_b.account_opening_url)
                 else jsonb_build_object('action', 'await_bank_confirmation') end,
    'integration_mode', v_b.integration_mode);
end;
$$;

revoke all on function public.loamy_link_bank_account(uuid,text,boolean) from public, anon;
grant execute on function public.loamy_link_bank_account(uuid,text,boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Financing applications, carrying their transaction context.
-- ----------------------------------------------------------------------------
alter table public.financing_applications
  add column if not exists ref             text unique,
  add column if not exists transaction_id  uuid references public.transactions (id) on delete set null,
  add column if not exists batch_id        uuid references public.commodity_batches (id) on delete set null,
  add column if not exists listing_id      uuid references public.listings (id) on delete set null,
  add column if not exists seller_id       uuid references public.profiles (id) on delete set null,
  add column if not exists bank_link_id    uuid references public.bank_account_links (id) on delete set null,
  -- The bank's answer. Separate from what was asked for, and from what moved.
  add column if not exists approved_amount numeric check (approved_amount is null or approved_amount >= 0),
  add column if not exists disbursed_amount numeric not null default 0 check (disbursed_amount >= 0),
  add column if not exists conditions      text,
  add column if not exists decided_at      timestamptz,
  add column if not exists expires_at      timestamptz;

-- Widen product types beyond the original input-financing pilot (Part 14).
alter table public.financing_applications drop constraint if exists financing_applications_product_type_check;
alter table public.financing_applications add constraint financing_applications_product_type_check
  check (product_type in (
    'input_financing','working_capital','commodity_purchase','trade_finance','export_finance'
  ));

-- Full lifecycle from the directive.
alter table public.financing_applications drop constraint if exists financing_applications_status_check;
alter table public.financing_applications add constraint financing_applications_status_check
  check (status in (
    'draft','submitted','under_review','info_requested','additional_information_required',
    'approved','partially_approved','rejected','expired','cancelled','disbursed','completed',
    'decided_external'
  ));

comment on column public.financing_applications.amount_requested is
  'What the applicant ASKED for.';
comment on column public.financing_applications.approved_amount is
  'What the BANK approved. Writable only through loamy_financing_decision -- never by the applicant.';
comment on column public.financing_applications.disbursed_amount is
  'What actually moved. Three distinct numbers, per directive Part 18 of the earlier brief.';

drop trigger if exists loamy_financing_assign_ref on public.financing_applications;
create trigger loamy_financing_assign_ref
  before insert on public.financing_applications
  for each row execute function public.loamy_assign_ref('financing_application', 'FIN');

do $$
declare r record;
begin
  for r in select id from public.financing_applications where ref is null loop
    update public.financing_applications
       set ref = public.loamy_register_ref('financing_application', r.id, 'FIN') where id = r.id;
  end loop;
end;
$$;

-- An applicant must never be able to write their own decision.
create or replace function public.loamy_protect_financing_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('loamy.financing_decision_authorized', true), '') = 'true' then
    return new;
  end if;
  if new.approved_amount is distinct from old.approved_amount
     or new.disbursed_amount is distinct from old.disbursed_amount
     or new.bank_id is distinct from old.bank_id
     or (new.status is distinct from old.status
         and new.status in ('approved','partially_approved','rejected','disbursed','completed')) then
    raise exception 'A financing decision is recorded by the bank, not by the applicant.';
  end if;
  return new;
end;
$$;

drop trigger if exists loamy_financing_protect_decision on public.financing_applications;
create trigger loamy_financing_protect_decision
  before update on public.financing_applications
  for each row execute function public.loamy_protect_financing_decision();

-- ----------------------------------------------------------------------------
-- 4. Append-only financing events.
-- ----------------------------------------------------------------------------
create table if not exists public.financing_events (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique,
  application_id uuid not null references public.financing_applications (id) on delete cascade,
  event_type     text not null,
  actor_id       uuid references public.profiles (id) on delete set null,
  actor_kind     text not null default 'applicant' check (actor_kind in ('applicant','bank','platform','system')),
  previous_status text,
  new_status     text,
  amount         numeric,
  detail         jsonb not null default '{}'::jsonb,
  note           text,
  occurred_at    timestamptz not null default now()
);

create index if not exists financing_events_app_idx on public.financing_events (application_id, occurred_at);

alter table public.financing_events enable row level security;

drop policy if exists "loamy_financing_events_select" on public.financing_events;
create policy "loamy_financing_events_select"
  on public.financing_events for select to authenticated
  using (exists (
    select 1 from public.financing_applications a
    where a.id = application_id
      and (a.applicant_id = auth.uid()
           or public.loamy_is_admin()
           or a.bank_id = public.loamy_officer_bank())
  ));

drop trigger if exists loamy_financing_events_assign_ref on public.financing_events;
create trigger loamy_financing_events_assign_ref
  before insert on public.financing_events
  for each row execute function public.loamy_assign_ref('financing_event', 'FEV');

-- ----------------------------------------------------------------------------
-- 5. Apply to finance a SPECIFIC transaction.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_apply_financing_for_transaction(
  p_transaction_id uuid,
  p_bank_id        uuid,
  p_amount         numeric default null,
  p_purpose        text default null,
  p_product_type   text default 'commodity_purchase'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.transactions%rowtype;
  v_b   public.banks%rowtype;
  v_link uuid;
  v_amount numeric;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select * into v_t from public.transactions where id = p_transaction_id;
  if v_t.id is null then raise exception 'Transaction not found.'; end if;
  if v_t.buyer_id <> v_uid then
    raise exception 'Only the buyer can seek financing for this purchase.';
  end if;
  if v_t.status in ('cancelled','rejected','expired') then
    raise exception 'That transaction is %.', v_t.status;
  end if;

  select * into v_b from public.banks where id = p_bank_id and active;
  if v_b.id is null then raise exception 'Bank not found or inactive.'; end if;
  if v_b.integration_mode = 'disabled' then
    raise exception 'That bank is not accepting applications through Loamy right now.';
  end if;

  select id into v_link from public.bank_account_links
  where user_id = v_uid and bank_id = p_bank_id;

  -- Default to the transaction's own total: the point of transaction-linked
  -- financing is that the amount is derived, not typed.
  v_amount := coalesce(p_amount, v_t.subtotal);
  if v_amount <= 0 then raise exception 'Amount must be greater than zero.'; end if;

  if exists (select 1 from public.financing_applications
             where transaction_id = p_transaction_id and applicant_id = v_uid
               and status not in ('rejected','cancelled','expired','completed')) then
    raise exception 'You already have a live financing application for this purchase.';
  end if;

  insert into public.financing_applications (
    applicant_id, bank_id, bank_link_id, transaction_id, batch_id, listing_id, seller_id,
    product_type, structure, amount_requested, purpose, status, disbursement_preference
  ) values (
    v_uid, p_bank_id, v_link, p_transaction_id, v_t.batch_id, v_t.listing_id, v_t.seller_id,
    p_product_type, 'murabaha', v_amount,
    coalesce(p_purpose, 'Purchase of ' || v_t.quantity || ' ' || v_t.unit || ' ' || v_t.commodity),
    'submitted',
    -- Supplier-direct only where THIS bank supports it. Never assumed.
    case when v_b.supports_supplier_direct then 'supplier_payment' else 'cash' end
  ) returning id into v_id;

  insert into public.financing_events (application_id, event_type, actor_id, actor_kind, new_status, amount, detail)
  values (v_id, 'submitted', v_uid, 'applicant', 'submitted', v_amount,
          jsonb_build_object('transaction', v_t.id, 'commodity', v_t.commodity,
                             'quantity', v_t.quantity, 'seller', v_t.seller_id,
                             'supplier_direct', v_b.supports_supplier_direct));

  perform set_config('loamy.txn_system_authorized', 'true', true);
  update public.transactions set financing_application_id = v_id where id = p_transaction_id;
  perform set_config('loamy.txn_system_authorized', 'false', true);

  return v_id;
end;
$$;

revoke all on function public.loamy_apply_financing_for_transaction(uuid,uuid,numeric,text,text) from public, anon;
grant execute on function public.loamy_apply_financing_for_transaction(uuid,uuid,numeric,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. The bank's decision. Loamy never makes it.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_financing_decision(
  p_application_id uuid,
  p_decision       text,
  p_approved_amount numeric default null,
  p_conditions     text default null,
  p_note           text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_a    public.financing_applications%rowtype;
  v_bank uuid := public.loamy_officer_bank();
  v_new  text;
begin
  select * into v_a from public.financing_applications where id = p_application_id for update;
  if v_a.id is null then raise exception 'Application not found.'; end if;

  -- Only an officer of the ASSIGNED bank, or an admin acting for them.
  if not (public.loamy_is_admin() or (v_bank is not null and v_a.bank_id = v_bank)) then
    raise exception 'Only the assigned bank can decide this application.';
  end if;
  if p_decision not in ('approved','partially_approved','rejected',
                        'additional_information_required','under_review') then
    raise exception 'Unknown decision: %', p_decision;
  end if;
  if v_a.status in ('disbursed','completed','cancelled','expired') then
    raise exception 'This application is % and cannot be re-decided.', v_a.status;
  end if;

  if p_decision in ('approved','partially_approved') then
    if p_approved_amount is null or p_approved_amount <= 0 then
      raise exception 'An approval needs an approved amount.';
    end if;
    if p_approved_amount > v_a.amount_requested then
      raise exception 'Approved amount cannot exceed the amount requested.';
    end if;
  end if;

  v_new := p_decision;

  perform set_config('loamy.financing_decision_authorized', 'true', true);
  update public.financing_applications
     set status = v_new,
         approved_amount = case when p_decision in ('approved','partially_approved')
                                then p_approved_amount else approved_amount end,
         conditions = coalesce(p_conditions, conditions),
         decision_note = coalesce(p_note, decision_note),
         reviewed_by = v_uid,
         decided_at = case when p_decision in ('approved','partially_approved','rejected')
                           then now() else decided_at end,
         updated_at = now()
   where id = p_application_id;
  perform set_config('loamy.financing_decision_authorized', 'false', true);

  insert into public.financing_events (
    application_id, event_type, actor_id, actor_kind, previous_status, new_status, amount, note)
  values (p_application_id, p_decision, v_uid, 'bank', v_a.status, v_new, p_approved_amount, p_note);

  insert into public.notifications (user_id, title, body, type)
  values (v_a.applicant_id, 'Financing update',
          'Your financing application has been updated by the bank.', 'finance');

  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, subject_id, detail)
  values (v_uid, 'bank', 'financing_decision', 'financing_application', p_application_id,
          jsonb_build_object('decision', p_decision, 'approved_amount', p_approved_amount));
end;
$$;

revoke all on function public.loamy_financing_decision(uuid,text,numeric,text,text) from public, anon;
grant execute on function public.loamy_financing_decision(uuid,text,numeric,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Eligibility SIGNAL — a recommendation, never an approval.
-- ----------------------------------------------------------------------------
update public.platform_config
set settings = jsonb_build_object('eligibility_weights', jsonb_build_object(
      'completed_transactions', 1.0,
      'verified_farm',          1.0,
      'verified_identity',      0.5,
      'account_age_months',     0.2,
      'disputes',              -2.0
    )) || coalesce(settings, '{}'::jsonb)
where id = 1;

/**
 * A transparent, versioned, CONFIGURABLE signal.
 *
 * It returns factors and a band -- never a naira figure presented as an
 * entitlement, and never a hard-coded N100k-N500k ladder. The bank sets the
 * money. Loamy supplies evidence.
 */
create or replace function public.loamy_eligibility_signal(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target uuid := coalesce(p_user, auth.uid());
  v_w      jsonb;
  v_txns   int; v_farms int; v_disputes int; v_age_months numeric;
  v_ident  boolean;
  v_score  numeric := 0;
  v_factors jsonb := '[]'::jsonb;
begin
  if v_target is null then raise exception 'Not signed in.'; end if;
  if v_target <> auth.uid()
     and not public.loamy_is_admin()
     and public.loamy_officer_bank() is null then
    raise exception 'Not authorized.';
  end if;

  select coalesce(settings->'eligibility_weights', '{}'::jsonb) into v_w
  from public.platform_config where id = 1;

  select count(*) into v_txns from public.transactions
   where (buyer_id = v_target or seller_id = v_target) and status = 'completed';
  select count(*) into v_farms from public.farms
   where owner_id = v_target and verification_status = 'verified';
  select count(*) into v_disputes from public.disputes
   where against_id = v_target and status not in ('withdrawn','resolved');
  select coalesce(verified_badge, false),
         extract(epoch from (now() - created_at)) / 2629800.0
    into v_ident, v_age_months
  from public.profiles where id = v_target;

  v_score := v_score + v_txns * coalesce((v_w->>'completed_transactions')::numeric, 1);
  v_factors := v_factors || jsonb_build_object('key','completed_transactions','value',v_txns);

  v_score := v_score + v_farms * coalesce((v_w->>'verified_farm')::numeric, 1);
  v_factors := v_factors || jsonb_build_object('key','verified_farms','value',v_farms);

  if v_ident then
    v_score := v_score + coalesce((v_w->>'verified_identity')::numeric, 0.5);
  end if;
  v_factors := v_factors || jsonb_build_object('key','verified_identity','value',v_ident);

  v_score := v_score + least(coalesce(v_age_months,0), 24) * coalesce((v_w->>'account_age_months')::numeric, 0.2);
  v_factors := v_factors || jsonb_build_object('key','account_age_months','value',round(coalesce(v_age_months,0),1));

  v_score := v_score + v_disputes * coalesce((v_w->>'disputes')::numeric, -2);
  v_factors := v_factors || jsonb_build_object('key','open_disputes','value',v_disputes);

  return jsonb_build_object(
    'kind', 'recommendation',
    -- Said in the payload itself, so no UI can accidentally present it as more.
    'disclaimer', 'A Loamy eligibility signal based on platform activity. It is not a credit decision, not an offer, and not a guarantee. The bank decides.',
    'score', round(v_score, 2),
    'band', case when v_score >= 10 then 'strong'
                 when v_score >= 4  then 'developing'
                 when v_score >= 0  then 'limited'
                 else 'adverse' end,
    'factors', v_factors,
    'weights_version', v_w,
    'computed_at', now());
end;
$$;

revoke all on function public.loamy_eligibility_signal(uuid) from public, anon;
grant execute on function public.loamy_eligibility_signal(uuid) to authenticated;

comment on function public.loamy_eligibility_signal(uuid) is
  'A CONFIGURABLE, explainable recommendation signal. Returns factors and a band, never an entitlement figure. Banks retain underwriting authority (directive Part 17).';
