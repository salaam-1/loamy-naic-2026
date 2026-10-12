-- ============================================================================
-- Processor Dashboard — PART 5: contracts and documents
-- ============================================================================
-- A purchase contract is auto-generated from each award, populated with the
-- agreed terms. Version history is retained; both parties e-sign (typed name +
-- timestamp + optional IP as a v1 acknowledgement). A private, company-scoped
-- document repository holds contracts, invoices, inspection reports, etc.
--
-- SECURITY-REVIEW: contracts are readable only by the buyer company's members
-- and the awarded supplier. Documents live in a PRIVATE storage bucket whose
-- objects are path-scoped to the owning company (storage RLS below) — verify no
-- cross-company access to files or contract rows.
-- ============================================================================

create sequence if not exists public.contract_number_seq;

create table if not exists public.contracts (
  id                 uuid primary key default gen_random_uuid(),
  rfq_id             uuid not null references public.rfqs(id) on delete cascade,
  award_id           uuid not null references public.rfq_awards(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete cascade,
  supplier_id        uuid not null references auth.users(id) on delete cascade,
  contract_number    text not null,
  terms              jsonb not null default '{}'::jsonb,
  pdf_url            text,
  version            int  not null default 1,
  signatures         jsonb not null default '[]'::jsonb,   -- [{party,name,signed_at,ip}]
  buyer_signed_at    timestamptz,
  supplier_signed_at timestamptz,
  status             text not null default 'pending_signatures'
                       check (status in ('pending_signatures','active','cancelled','superseded')),
  created_at         timestamptz not null default now()
);

create index if not exists contracts_award_idx on public.contracts(award_id, version desc);
create index if not exists contracts_company_idx on public.contracts(company_id);

alter table public.contracts enable row level security;

-- Buyer company members and the awarded supplier can read; writes via trigger +
-- sign RPC only (no direct insert/update policy).
drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select to authenticated
  using (
    company_id in (select public.loamy_user_company_ids())
    or supplier_id = auth.uid()
    or public.loamy_is_admin()
  );

-- Auto-generate / re-version a contract whenever an award is created or its
-- quantity/price changes. Prior versions are kept and marked 'superseded'.
create or replace function public.loamy_contract_from_award()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rfqs;
  v_company text;
  v_supplier text;
  v_version int;
begin
  if tg_op = 'UPDATE'
     and new.awarded_quantity is not distinct from old.awarded_quantity
     and new.awarded_price is not distinct from old.awarded_price then
    return new;  -- status-only change: no new contract version
  end if;

  select * into r from public.rfqs where id = new.rfq_id;
  select name into v_company from public.companies where id = r.company_id;
  select full_name into v_supplier from public.profiles where id = new.supplier_id;

  select coalesce(max(version), 0) + 1 into v_version from public.contracts where award_id = new.id;
  update public.contracts set status = 'superseded'
    where award_id = new.id and status = 'pending_signatures';

  insert into public.contracts (
    rfq_id, award_id, company_id, supplier_id, contract_number, version, terms, status
  ) values (
    new.rfq_id, new.id, r.company_id, new.supplier_id,
    'PC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.contract_number_seq')::text, 6, '0'),
    v_version,
    jsonb_build_object(
      'rfq_reference', r.reference,
      'commodity', r.commodity,
      'grade', r.grade,
      'moisture_max', r.moisture_content,
      'packaging', r.packaging_type,
      'quantity', new.awarded_quantity,
      'unit', r.unit,
      'price_per_unit', new.awarded_price,
      'total_value', round(new.awarded_quantity * new.awarded_price, 2),
      'currency', 'NGN',
      'delivery_state', r.delivery_state,
      'delivery_deadline', r.delivery_deadline,
      'inspection_mode', r.inspection_mode,
      'payment_mode', r.payment_mode,
      'buyer_company', v_company,
      'supplier_name', v_supplier
    ),
    'pending_signatures'
  );
  return new;
end;
$$;

drop trigger if exists loamy_contract_from_award on public.rfq_awards;
create trigger loamy_contract_from_award
  after insert or update of awarded_quantity, awarded_price on public.rfq_awards
  for each row execute function public.loamy_contract_from_award();

-- E-signature (v1 acknowledgement): typed name + timestamp + optional IP.
-- TODO: integrate a qualified e-signature provider for legally-binding signing.
create or replace function public.loamy_sign_contract(
  p_contract_id uuid,
  p_signer_name text,
  p_ip text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ct public.contracts;
  v_party text;
begin
  select * into ct from public.contracts where id = p_contract_id;
  if not found then raise exception 'Contract not found'; end if;
  if ct.status <> 'pending_signatures' then
    raise exception 'This contract version can no longer be signed';
  end if;
  if coalesce(trim(p_signer_name), '') = '' then
    raise exception 'Type your full name to sign';
  end if;

  if public.loamy_company_can_procure(ct.company_id) then
    v_party := 'buyer';
  elsif ct.supplier_id = auth.uid() then
    v_party := 'supplier';
  else
    raise exception 'Not authorised to sign this contract';
  end if;

  if v_party = 'buyer' then
    if ct.buyer_signed_at is not null then raise exception 'The buyer has already signed'; end if;
    update public.contracts set buyer_signed_at = now(),
      signatures = signatures || jsonb_build_object('party','buyer','name',trim(p_signer_name),'signed_at',now(),'ip',p_ip)
    where id = p_contract_id;
  else
    if ct.supplier_signed_at is not null then raise exception 'You have already signed'; end if;
    update public.contracts set supplier_signed_at = now(),
      signatures = signatures || jsonb_build_object('party','supplier','name',trim(p_signer_name),'signed_at',now(),'ip',p_ip)
    where id = p_contract_id;
  end if;

  update public.contracts set status = 'active'
  where id = p_contract_id and buyer_signed_at is not null and supplier_signed_at is not null;
end;
$$;

grant execute on function public.loamy_sign_contract(uuid, text, text) to authenticated;

-- Contracts enriched for display (names only — no phone; disclosure gate holds).
create or replace view public.loamy_contracts_v as
  select
    c.id, c.rfq_id, c.award_id, c.company_id, c.supplier_id, c.contract_number,
    c.terms, c.version, c.status, c.buyer_signed_at, c.supplier_signed_at, c.created_at,
    r.reference as rfq_reference, r.commodity,
    co.name as buyer_company, p.full_name as supplier_name
  from public.contracts c
  join public.rfqs r on r.id = c.rfq_id
  join public.companies co on co.id = c.company_id
  join public.profiles p on p.id = c.supplier_id
  where c.company_id in (select public.loamy_user_company_ids())
     or c.supplier_id = auth.uid()
     or public.loamy_is_admin();

grant select on public.loamy_contracts_v to authenticated;

-- Documents ------------------------------------------------------------------
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  rfq_id      uuid references public.rfqs(id) on delete set null,
  award_id    uuid references public.rfq_awards(id) on delete set null,
  doc_type    text not null default 'other'
                check (doc_type in ('contract','invoice','inspection_report','warehouse_receipt',
                                    'transport_document','certificate','payment_receipt','other')),
  title       text,
  file_url    text not null,           -- object path within the private bucket
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists documents_company_idx on public.documents(company_id, created_at desc);
create index if not exists documents_rfq_idx on public.documents(rfq_id);

alter table public.documents enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (company_id in (select public.loamy_user_company_ids()) or public.loamy_is_admin());

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (company_id in (select public.loamy_user_company_ids()) and uploaded_by = auth.uid());

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete to authenticated
  using (public.loamy_company_can_admin(company_id));

-- Private storage bucket, path-scoped per company: objects live under
-- {company_id}/... and only members of that company may read/write them.
insert into storage.buckets (id, name, public)
values ('rfq-documents', 'rfq-documents', false)
on conflict (id) do nothing;

drop policy if exists "rfq_docs_read" on storage.objects;
create policy "rfq_docs_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'rfq-documents'
    and (storage.foldername(name))[1]::uuid in (select public.loamy_user_company_ids())
  );

drop policy if exists "rfq_docs_write" on storage.objects;
create policy "rfq_docs_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'rfq-documents'
    and (storage.foldername(name))[1]::uuid in (select public.loamy_user_company_ids())
  );

drop policy if exists "rfq_docs_delete" on storage.objects;
create policy "rfq_docs_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'rfq-documents'
    and (storage.foldername(name))[1]::uuid in (select public.loamy_user_company_ids())
  );
