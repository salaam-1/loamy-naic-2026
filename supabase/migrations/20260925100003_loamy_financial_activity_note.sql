-- ==========================================================================
-- Financial activity: one sentence instead of four clauses.
--
-- The note is the honest framing shown above the figures. It had grown to
-- four clauses, two of which the cards beneath it already carry:
--
--   'Owed to you'            already sub-labelled "Once a provider settles"
--   'Paid to you directly'   already sub-labelled "By a financing institution"
--
-- So the reader met those two facts twice before reaching a number. They are
-- now stated once, in the note, in a single sentence.
--
-- WHAT IS DELIBERATELY KEPT, AND WHY IT IS NOT TRIMMED
--   The custody statement stays in the note, spelled out: "Loamy does not
--   hold your funds." The surrounding UI does lead with the same assurance,
--   which is an argument for cutting it, and that argument is rejected here.
--   A custody disclosure is a compliance statement, not decoration, and it
--   must not depend on an adjacent element that a later layout change could
--   reorder, restyle or drop. It travels with the payload that carries the
--   figures.
--
-- WHAT IS UNCHANGED
--   'custody' is still 'none'. No figure, column, join or calculation is
--   touched, and nothing here implies Loamy lends, holds funds or receives
--   financing proceeds. This migration changes one string.
-- ==========================================================================

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
    'note', 'Loamy does not hold your funds. Owed to you is what a payment partner will settle, and financing is paid to you directly by the institution.',
    'generated_at', now());
end;
$$;

revoke all on function public.loamy_my_financial_activity(int) from public, anon;
grant execute on function public.loamy_my_financial_activity(int) to authenticated;
