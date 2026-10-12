-- ============================================================================
-- Loamy Platform · Dataviz pass · Migration 1 of 1
-- Aggregate-only chart feeds for the Growth Partner dashboard. RLS boundaries
-- are NOT widened: both functions return COUNTS about the caller's OWN
-- onboarded farmers — never rows, names, or per-farm data the partner cannot
-- already see elsewhere.
-- ============================================================================

-- SECURITY-REVIEW: aggregate-only exposure. loamy_partner_funnel returns four
-- integers about the caller's own onboardees; loamy_partner_territory returns
-- (lga, farmer_count) pairs restricted to the caller's ACTIVE territory and
-- own onboardees, with no identifying fields. Verify both stay aggregate-only
-- and caller-scoped (auth.uid()) if ever modified.
create or replace function public.loamy_partner_funnel()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'registered', count(*),
    'profile_completed', count(*) filter (where p.onboarding_complete),
    'verified', count(*) filter (where p.verified_badge),
    'active', count(*) filter (where exists (
      select 1 from public.notifications n
      where n.user_id = p.id and n.created_at > now() - interval '30 days'
    ) or exists (
      select 1 from public.farms f
      where f.owner_id = p.id and f.updated_at > now() - interval '30 days'
    )))
  from public.onboarded_farmers o
  join public.profiles p on p.id = o.farmer_id
  where o.partner_id = auth.uid();
$$;

revoke all on function public.loamy_partner_funnel() from public;
revoke all on function public.loamy_partner_funnel() from anon;
grant execute on function public.loamy_partner_funnel() to authenticated;

create or replace function public.loamy_partner_territory()
returns table (lga text, farmers bigint)
language sql
stable
security definer
set search_path = public
as $$
  select f.lga, count(distinct f.owner_id) as farmers
  from public.onboarded_farmers o
  join public.farms f on f.owner_id = o.farmer_id
  where o.partner_id = auth.uid()
    and exists (
      select 1 from public.partner_assignments pa
      where pa.partner_id = auth.uid() and pa.active and pa.state = f.state
        and (coalesce(array_length(pa.lgas, 1), 0) = 0 or f.lga = any (pa.lgas))
    )
  group by f.lga
  order by farmers desc, f.lga
  limit 12;
$$;

revoke all on function public.loamy_partner_territory() from public;
revoke all on function public.loamy_partner_territory() from anon;
grant execute on function public.loamy_partner_territory() to authenticated;
