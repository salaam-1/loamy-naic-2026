-- ============================================================================
-- Loamy Platform · Stage 2 · Migration 4 of 4
-- Avatar storage: public-read bucket (avatars are displayed across the UI),
-- writes strictly scoped to the owner's own folder ({user_id}/...).
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- SECURITY-REVIEW: storage policies. Bucket is public-READ by design (profile
-- pictures only — nothing sensitive may ever be uploaded here; farm evidence
-- in Stage 4 uses a PRIVATE bucket instead). Writes are path-scoped: a user
-- can only create/replace/delete objects under their own auth.uid() folder.
-- Verify the folder check stays on every write policy.
drop policy if exists "loamy_avatars_insert_own" on storage.objects;
create policy "loamy_avatars_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "loamy_avatars_update_own" on storage.objects;
create policy "loamy_avatars_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "loamy_avatars_delete_own" on storage.objects;
create policy "loamy_avatars_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
