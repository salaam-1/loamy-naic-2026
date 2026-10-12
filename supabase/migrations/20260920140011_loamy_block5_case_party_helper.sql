-- ============================================================================
-- BLOCK 5 (k) — a party check that does not depend on the task's own RLS.
-- ----------------------------------------------------------------------------
-- Narrowing loamy_tasks_select in (j) had a cascade I did not anticipate, and
-- the full suite caught it. Two things read verification_tasks *through RLS*
-- to decide who is a party:
--
--   loamy_vevidence_select        "is this caller the agent or the requester"
--   loamy_verification_cases      a security_invoker view over the table
--
-- Once agents lost raw table access, both silently returned nothing to them:
-- an agent could no longer see their own evidence, nor their own assignment.
-- No error, just an empty result -- which is exactly how this kind of break
-- reaches production unnoticed.
--
-- The fix is to stop asking an RLS-protected table who the parties are.
-- loamy_case_role is SECURITY DEFINER: it answers the question without
-- exposing the row, so the policy above it means the same thing whatever the
-- table policy happens to be.
--
-- The disclosure rules are unchanged. The agent still cannot learn who
-- requested the inspection, and the parties still cannot learn who the agent
-- is -- both are enforced in the projections, not in row visibility.
-- ============================================================================

create or replace function public.loamy_case_role(p_case_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_t public.verification_tasks%rowtype;
begin
  if v_uid is null then return 'none'; end if;
  if public.loamy_is_admin() then return 'admin'; end if;

  select * into v_t from public.verification_tasks where id = p_case_id;
  if v_t.id is null then return 'none'; end if;

  if v_t.assigned_to    = v_uid then return 'agent';     end if;
  if v_t.requested_by   = v_uid then return 'requester'; end if;
  if v_t.subject_user_id = v_uid then return 'subject';  end if;
  return 'none';
end;
$$;

grant execute on function public.loamy_case_role(uuid) to authenticated;

comment on function public.loamy_case_role(uuid) is
  'BLOCK 5. Who the caller is to a verification case, answered WITHOUT reading the task row through RLS. Policies that ask "am I a party" must use this, or they break whenever the task policy changes.';

-- ----------------------------------------------------------------------------
-- 1. Evidence: the agent and the requester, as before.
-- ----------------------------------------------------------------------------
drop policy if exists "loamy_vevidence_select" on public.verification_evidence;
create policy "loamy_vevidence_select"
  on public.verification_evidence for select to authenticated
  using (public.loamy_case_role(case_id) in ('agent','requester','admin'));

-- ----------------------------------------------------------------------------
-- 2. The cases view runs as owner, and filters itself.
-- ----------------------------------------------------------------------------
-- With security_invoker on, this view inherited the (now admin-only) task
-- policy and went blank for everyone else. As owner it sees every row, so the
-- WHERE clause below IS the access control -- and the column projections
-- continue to do the masking.
drop view if exists public.loamy_verification_cases;
create view public.loamy_verification_cases as
select
  t.id               as case_id,
  t.ref              as case_ref,
  t.task_type        as verification_type,
  coalesce(t.subject_type, case when t.subject_farm_id is not null then 'farm' end) as subject_type,
  coalesce(t.subject_id, t.subject_farm_id) as subject_id,
  t.subject_user_id,
  -- Who ordered the inspection is for the parties and admins, NEVER the
  -- agent: a buyer's sourcing intention is not field information.
  case when public.loamy_case_role(t.id) in ('requester','subject','admin')
       then t.requested_by end as requested_by,
  -- The agent's identity is revealed ONLY to the agent themselves and to
  -- admins. Everyone else -- including the buyer who paid for the inspection
  -- and the seller being inspected -- sees null and the display label.
  case when t.assigned_to = auth.uid() or public.loamy_is_admin()
       then t.assigned_to else null end as assigned_to,
  case when t.assigned_to is null then null
       when t.assigned_to = auth.uid() then 'You'
       when public.loamy_is_admin() then 'Agent ' || substr(t.assigned_to::text, 1, 8)
       else 'Loamy Verification Agent' end as agent_display,
  t.status,
  t.priority,
  -- Anti-fraud flags are operational, not for the parties: a seller learning
  -- which checks fired can tune the next submission around them.
  case when public.loamy_is_admin() then t.flags else null end as flags,
  case when public.loamy_is_admin() then t.sampled_for_review else null end as sampled_for_review,
  t.expected_state,
  t.expected_lga,
  t.due_at,
  t.submitted_at,
  t.completed_at,
  t.created_at,
  t.updated_at,
  (select count(*) from public.verification_evidence e where e.case_id = t.id) as evidence_count
from public.verification_tasks t
where public.loamy_case_role(t.id) <> 'none';

alter view public.loamy_verification_cases set (security_invoker = off);
revoke all on public.loamy_verification_cases from public, anon;
grant select on public.loamy_verification_cases to authenticated;
