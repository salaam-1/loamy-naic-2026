-- ============================================================================
-- P0-1 — replace the custodial wallet with a non-custodial activity view.
-- ----------------------------------------------------------------------------
-- The forensic audit found a Wallet in every role's navigation, reading the
-- deprecated single-entry wallet_entries (0 rows) through loamy_wallet_balance,
-- captioned "Money released from escrow lands here. Withdraw it to your bank
-- whenever you like." and offering a Withdraw form.
--
-- That is a custody claim. It contradicts docs/financial-boundaries.md ("no
-- member balance represents cash Loamy holds"), the model freeze
-- (wallet_entries is retained-not-authoritative), and the standing
-- instruction that Loamy must not become a deposit-taking institution.
--
-- It was also, in practice, showing every member N0 and a Withdraw button --
-- which reads as "Loamy is holding nothing of yours YET", implying it will.
--
-- THIS FUNCTION IS THE REPLACEMENT. It reads the AUTHORITATIVE double-entry
-- ledger and answers a different question: not "what is your balance" but
-- "what has happened, and who owes what to whom".
--
-- The distinction is carried in the payload itself, not left to the UI:
--
--   receivable            what Loamy owes you ONCE A PROVIDER SETTLES.
--                         Not held funds. Named so it cannot be shortened to
--                         "balance" without someone noticing.
--   settled_externally    an institution paid you directly. Loamy never
--                         touched it; this is a memorandum record.
--   fees_charged          what you owe Loamy.
--
-- There is deliberately NO withdraw path here, and no field called balance,
-- available, or wallet.
--
-- wallet_entries and loamy_wallet_balance are left in place and untouched.
-- They hold no rows, the security suite still asserts they cannot be written
-- from a client, and deleting a money table -- even an empty one -- is not
-- something to do casually. What changes is that nothing in the product
-- reads them any more.
-- ============================================================================

create or replace function public.loamy_my_financial_activity(p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_receivable numeric := 0;
  v_payable    numeric := 0;
  v_settled    numeric := 0;
  v_rows  jsonb;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  -- What Loamy owes this member once a provider settles. A credit on a
  -- member_receivable account is stored negative, hence the sign flip.
  select coalesce(-sum(e.amount), 0) into v_receivable
  from public.ledger_entries e
  join public.ledger_accounts a on a.id = e.account_id
  where a.owner_id = v_uid and a.account_type = 'member_receivable'
    and e.status = 'posted';

  -- What this member owes Loamy (fees).
  select coalesce(sum(e.amount), 0) into v_payable
  from public.ledger_entries e
  join public.ledger_accounts a on a.id = e.account_id
  where a.owner_id = v_uid and a.account_type = 'member_payable'
    and e.status = 'posted';

  -- Settled OUTSIDE Loamy: an institution paid this member directly. A
  -- memorandum figure -- it is evidence that money moved, not money Loamy
  -- moved.
  select coalesce(sum(f.disbursed_amount), 0) into v_settled
  from public.financing_applications f
  where f.seller_id = v_uid and coalesce(f.disbursed_amount, 0) > 0;

  select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'ref', e.ref,
      'at', e.created_at,
      'event', e.event_type,
      -- Signed from the member's point of view: positive means in their
      -- favour. The raw double-entry sign would be meaningless here.
      'amount', case when a.account_type = 'member_receivable'
                     then -e.amount else e.amount end,
      'direction', case when a.account_type = 'member_receivable'
                        then 'owed_to_you' else 'owed_by_you' end,
      'description', e.description,
      'provider', e.provider,
      'subject_type', e.subject_type,
      'subject_id', e.subject_id,
      'status', e.status) as x
    from public.ledger_entries e
    join public.ledger_accounts a on a.id = e.account_id
    where a.owner_id = v_uid and e.status = 'posted'
    order by e.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) s;

  return jsonb_build_object(
    'available', true,
    'currency', 'NGN',

    'receivable', v_receivable,
    'payable', v_payable,
    'settled_externally', v_settled,

    'entries', v_rows,

    -- Carried in the payload so no template can drop it.
    'custody', 'none',
    'note', 'Loamy does not hold funds on your behalf. "Owed to you" is what Loamy owes once a payment provider settles; money from a financing institution is paid to you directly by that institution.',
    'generated_at', now());
end;
$$;

revoke all on function public.loamy_my_financial_activity(int) from public, anon;
grant execute on function public.loamy_my_financial_activity(int) to authenticated;

comment on function public.loamy_my_financial_activity(int) is
  'P0-1. The non-custodial replacement for the wallet. Reads the AUTHORITATIVE ledger_entries. Returns no balance, no available figure and no withdraw path -- Loamy holds no member funds.';

comment on function public.loamy_wallet_balance(uuid) is
  'DEPRECATED (P0-1, 2026-09-20). Reads the single-entry wallet_entries, which is retained-not-authoritative and empty. Nothing in the product calls this. Use loamy_my_financial_activity. Retained only so the existing security assertions about client writes keep running.';

comment on table public.wallet_entries is
  'DEPRECATED. Superseded by ledger_entries (double-entry, authoritative). Empty, and no longer read by any product surface. Retained rather than dropped because removing a money table is not a casual act.';
