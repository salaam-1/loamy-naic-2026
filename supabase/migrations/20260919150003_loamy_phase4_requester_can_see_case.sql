-- ============================================================================
-- PHASE 4 (c) — a buyer must be able to see the verification they asked for.
-- ----------------------------------------------------------------------------
-- The Stage 4 select policy on verification_tasks predates buyer-requested
-- verification: it covered the assigned agent, admins, and eligible agents
-- browsing the open queue. `requested_by` did not exist.
--
-- So a buyer could pay attention to a remote-sourcing request and then see
-- nothing at all -- the case, its progress and its outcome were invisible to
-- the person who asked for it. That defeats the feature (directive Part 16:
-- "buyer receives verification report").
--
-- Found by tests/security/phase4-marketplace-batches.test.ts.
--
-- SECURITY-REVIEW: this widens who can read a CASE row, not who can read
-- EVIDENCE. verification_evidence already scopes to assigned agent / requester
-- / admin, and the case row itself carries no coordinates that the requester
-- should not have (expected_lat/lng are on the table but excluded from the
-- loamy_verification_cases view the client reads). Verify no future column on
-- verification_tasks leaks the subject's precise location to a requester.
-- ============================================================================

drop policy if exists "loamy_tasks_select" on public.verification_tasks;
create policy "loamy_tasks_select"
  on public.verification_tasks for select to authenticated
  using (
    assigned_to = auth.uid()
    -- The buyer (or other party) who requested this verification.
    or requested_by = auth.uid()
    or public.loamy_is_admin()
    or (
      status = 'pending' and assigned_to is null
      and public.loamy_can_verify(auth.uid())
      and subject_farm_id is not null
      and public.loamy_covers_farm(subject_farm_id)
    )
  );
