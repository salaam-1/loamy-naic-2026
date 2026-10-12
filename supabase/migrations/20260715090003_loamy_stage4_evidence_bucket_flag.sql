-- ============================================================================
-- Loamy Platform · Stage 4 · Migration 3 of 3
-- PRIVATE evidence bucket (signed-URL access only) + flip the
-- verification_workflow feature flag ON.
-- ============================================================================

-- Private bucket: public = false → objects are reachable ONLY via signed URLs
-- created by users whom the SELECT policy below authorizes.
insert into storage.buckets (id, name, public)
values ('verification-evidence', 'verification-evidence', false)
on conflict (id) do nothing;

-- SECURITY-REVIEW: THE key Stage 4 storage boundary. Evidence photos show
-- private property + people. Path convention: {task_id}/{filename}.
--   * WRITE: only the partner currently assigned to that task, while it is
--     still editable.
--   * READ (and therefore signed-URL creation): admins and the assigned
--     partner. The subject farmer has NO read path — verified in
--     scripts/verify-stage4.mjs.
-- Engineer to review: retention policy, and that no future bucket/policy
-- change opens farmer or public access.
drop policy if exists "loamy_evidence_insert_assigned" on storage.objects;
create policy "loamy_evidence_insert_assigned"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-evidence'
    and exists (
      select 1 from public.verification_tasks t
      where t.id::text = (storage.foldername(name))[1]
        and t.assigned_to = auth.uid()
        and t.status in ('assigned','in_progress','resubmit_requested')
    )
  );

drop policy if exists "loamy_evidence_select" on storage.objects;
create policy "loamy_evidence_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'verification-evidence'
    and (
      public.loamy_is_admin()
      or exists (
        select 1 from public.verification_tasks t
        where t.id::text = (storage.foldername(name))[1]
          and t.assigned_to = auth.uid()
      )
    )
  );

drop policy if exists "loamy_evidence_delete_assigned" on storage.objects;
create policy "loamy_evidence_delete_assigned"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'verification-evidence'
    and exists (
      select 1 from public.verification_tasks t
      where t.id::text = (storage.foldername(name))[1]
        and t.assigned_to = auth.uid()
        and t.status in ('assigned','in_progress','resubmit_requested')
    )
  );

-- Stage 4 ships the field workflow: flip the flag.
update public.platform_config
set flags = flags || '{"verification_workflow": true}'::jsonb
where id = 1;
