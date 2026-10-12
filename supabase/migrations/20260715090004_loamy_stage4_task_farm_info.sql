-- ============================================================================
-- Loamy Platform · Stage 4 · Migration 4 of 4
-- Limited farm surface for the verification workflow. farms RLS is strictly
-- owner+admin; field partners need JUST ENOUGH to work a task:
--   * pool (pending, in-territory, can_verify): name/location/size/crops —
--     NO coordinates, NO owner identity.
--   * assigned partner / admin: + coordinates (for the GPS check) and the
--     owner's display name (for in-person identity confirmation).
-- ============================================================================

-- SECURITY-REVIEW: the only path that shows a farm to a non-owner. Verify the
-- tiered exposure above never widens (coordinates and owner name are gated to
-- the assigned partner / admin) and grants stay authenticated-only.
create or replace function public.loamy_task_farm_info(p_task uuid)
returns table (
  farm_name text, state text, lga text, size_hectares numeric,
  primary_crops text[], latitude numeric, longitude numeric, owner_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_task public.verification_tasks%rowtype;
  v_full boolean := false;
begin
  select * into v_task from public.verification_tasks where id = p_task;
  if v_task.id is null or v_task.subject_farm_id is null then
    raise exception 'Task not found';
  end if;

  if public.loamy_is_admin() or v_task.assigned_to = auth.uid() then
    v_full := true;
  elsif not (
    v_task.status = 'pending' and v_task.assigned_to is null
    and public.loamy_can_verify(auth.uid())
    and public.loamy_covers_farm(v_task.subject_farm_id)
  ) then
    raise exception 'Not authorized for this task';
  end if;

  return query
  select f.farm_name, f.state, f.lga, f.size_hectares, f.primary_crops,
         case when v_full then f.latitude  else null end,
         case when v_full then f.longitude else null end,
         case when v_full then p.full_name else null end
  from public.farms f
  join public.profiles p on p.id = f.owner_id
  where f.id = v_task.subject_farm_id;
end;
$$;

revoke all on function public.loamy_task_farm_info(uuid) from public;
revoke all on function public.loamy_task_farm_info(uuid) from anon;
grant execute on function public.loamy_task_farm_info(uuid) to authenticated;
