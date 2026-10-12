-- ============================================================================
-- P0 — close the custodial wallet for good.
-- ----------------------------------------------------------------------------
-- Wave 1 QA found a `wallet_entries` row written on 2026-09-21 by the LIVE
-- product: `kind: 'order_settlement'`, "Marketplace order … released by the
-- buyer". The custodial wallet MODULE was deleted in the completion sprint;
-- the paths that write the TABLE were not, because they live in deployed edge
-- functions rather than in src/.
--
-- Four production writers, all edge functions running as service_role:
--
--   paystack-payout    kind 'order_settlement'      <- wrote the row we found
--   escrow-release     kind 'escrow_release'
--   wallet-withdraw    kind 'withdrawal_reversal'
--   paystack-webhook   kind 'withdrawal_reversal'
--
-- Repointing the functions is necessary but NOT sufficient: they are deployed
-- artefacts, they can be rolled back, and a fifth writer can appear the next
-- time somebody needs to credit a seller. A grep is not an invariant.
--
-- So the guarantee is made where it cannot be bypassed: the table refuses new
-- rows. service_role does not bypass a BEFORE trigger, which is exactly why
-- this is a trigger and not an RLS policy.
--
-- HISTORY IS NOT TOUCHED.
--   Existing rows stay, readable, forever. They are financial records and
--   deleting them to make a test green would be the worst possible response
--   to finding them. UPDATE and DELETE are blocked too — an audit record that
--   can be edited is not one.
--
-- WHERE THE MONEY GOES INSTEAD
--   The double-entry ledger, through memorandum accounts. A member balance is
--   never created: `partner_funding` and `external_settlement` are Loamy's own
--   memorandum accounts, and a posting against them records that an
--   institution moved money — it does not say Loamy holds any.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The table is now history-only.
-- ----------------------------------------------------------------------------
create or replace function public.loamy_wallet_entries_are_closed()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'wallet_entries is closed. Loamy is not a custodian and holds no member balances; record the movement in ledger_entries instead (see loamy_record_supplier_settlement / loamy_record_escrow_release). Existing rows are retained for audit.'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists loamy_wallet_entries_closed on public.wallet_entries;
create trigger loamy_wallet_entries_closed
  before insert or update or delete on public.wallet_entries
  for each row execute function public.loamy_wallet_entries_are_closed();

comment on table public.wallet_entries is
  'CLOSED 2026-09-22. History only: existing rows are retained for audit and are readable, but INSERT, UPDATE and DELETE all raise. Loamy holds no member funds. Money movement is recorded in ledger_entries through memorandum accounts.';

-- Withdrawals imply custody, so the same applies to the request table.
create or replace function public.loamy_withdrawals_are_closed()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Withdrawals are closed. Loamy holds no member funds, so there is no balance to withdraw. Existing rows are retained for audit.'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists loamy_withdrawals_closed on public.wallet_withdrawals;
create trigger loamy_withdrawals_closed
  before insert or update or delete on public.wallet_withdrawals
  for each row execute function public.loamy_withdrawals_are_closed();

comment on table public.wallet_withdrawals is
  'CLOSED 2026-09-22. History only. A withdrawal presumes a custodial balance, which Loamy does not hold.';

-- ----------------------------------------------------------------------------
-- 2. The non-custodial replacement for an escrow release.
-- ----------------------------------------------------------------------------
/**
 * Record that escrow money reached the supplier.
 *
 * Replaces the wallet credit in `escrow-release`. Posts a MEMORANDUM pair:
 * neither leg is a member balance, and nothing here says Loamy holds or owes
 * the money. It records that a release happened, against the provider's own
 * reference.
 *
 * Service-role only, like `loamy_post_ledger` itself: an edge function that
 * has already verified the release conditions calls it. A member cannot, and
 * must not be able to, declare their own escrow released.
 */
create or replace function public.loamy_record_escrow_release(
  p_escrow_id uuid,
  p_amount    numeric,
  p_external_reference text,
  p_provider  text default 'paystack'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fund  uuid;
  v_ext   uuid;
  v_group uuid;
  v_esc   public.escrow_transactions%rowtype;
begin
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'A release amount must be greater than zero.';
  end if;
  if coalesce(btrim(p_external_reference), '') = '' then
    raise exception 'A release must carry the provider''s own reference.';
  end if;

  select * into v_esc from public.escrow_transactions where id = p_escrow_id;
  if v_esc.id is null then raise exception 'Escrow not found.'; end if;

  -- Replay reported honestly rather than as an error a caller would retry --
  -- retrying a settlement blindly is how a supplier gets paid twice.
  if exists (select 1 from public.ledger_entries
             where external_reference = p_external_reference) then
    return jsonb_build_object('posted', false, 'reason', 'already_posted',
      'external_reference', p_external_reference);
  end if;

  select id into v_fund from public.ledger_accounts
   where owner_id is null and account_type = 'partner_funding' and currency = 'NGN';
  select id into v_ext from public.ledger_accounts
   where owner_id is null and account_type = 'external_settlement' and currency = 'NGN';
  if v_fund is null or v_ext is null then
    raise exception 'The memorandum accounts are not configured.';
  end if;

  v_group := public.loamy_post_ledger(
    'escrow_release',
    jsonb_build_array(
      jsonb_build_object('account_id', v_fund, 'amount', -p_amount),
      jsonb_build_object('account_id', v_ext,  'amount',  p_amount)),
    p_external_reference, p_provider,
    'escrow_transaction', p_escrow_id,
    'Escrow released to the supplier by the payment provider. Memorandum only: Loamy holds no funds.');

  return jsonb_build_object('posted', true, 'entry_group', v_group,
    'external_reference', p_external_reference);
end;
$$;

-- Service-role only. Deliberately not granted to authenticated: a member must
-- never be able to declare their own escrow released.
revoke all on function public.loamy_record_escrow_release(uuid,numeric,text,text)
  from public, anon, authenticated;

comment on function public.loamy_record_escrow_release(uuid,numeric,text,text) is
  'Records an escrow release as a memorandum ledger pair, replacing the wallet credit that made Loamy look like a custodian. Service-role only.';
