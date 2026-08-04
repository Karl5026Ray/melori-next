-- 052_social_videos_resumable_uploads.sql
--
-- Lets a signed-in member upload DIRECTLY to the `social-videos` bucket, which
-- is what makes resumable (TUS) uploads possible for MM Cinema screenings.
--
-- WHY THIS IS NEEDED AT ALL: every existing upload path in the app goes
-- through /api/social/upload-url, where the SERVICE ROLE mints a signed upload
-- URL. Service role bypasses RLS, so `social-videos` never needed a policy.
-- But a signed upload URL is single-shot: one PUT, and a dropped connection at
-- 90% means starting over. That is survivable for a 60-second reel and not
-- survivable for a feature-length film.
--
-- Supabase's resumable endpoint (/storage/v1/upload/resumable) authenticates as
-- the USER, not the service role, so the user's own JWT has to be allowed to
-- write. Hence these policies.
--
-- THE PATH CONTRACT: every social upload is keyed `social/{user_id}/{file}`.
-- These policies re-check that shape in the database rather than trusting the
-- client, so a member can only ever write inside their own folder:
--
--     foldername(name)[1] = 'social'
--     foldername(name)[2] = auth.uid()
--
-- That is the same namespacing /api/social/upload-url already enforces
-- server-side, so the two paths grant exactly the same authority and the
-- resumable route is not a privilege escalation.
--
-- UPDATE and SELECT are included deliberately: TUS is not a single write. The
-- client HEADs the object to learn the current offset when resuming and PATCHes
-- it as each chunk lands, so an INSERT-only policy would let an upload start
-- and then fail the moment it had to resume — the exact case this exists for.

-- INSERT: create the object (first chunk of a resumable upload, or a plain
-- direct upload).
drop policy if exists "social_videos_insert_own" on storage.objects;
create policy "social_videos_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'social-videos'
    and (storage.foldername(name))[1] = 'social'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- UPDATE: append subsequent chunks to an in-flight upload.
drop policy if exists "social_videos_update_own" on storage.objects;
create policy "social_videos_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'social-videos'
    and (storage.foldername(name))[1] = 'social'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'social-videos'
    and (storage.foldername(name))[1] = 'social'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- SELECT: read back the offset when resuming. Note this is about the OBJECT
-- ROW, not the file bytes — `social-videos` is a public bucket, so playback
-- has never needed a policy and still doesn't.
drop policy if exists "social_videos_select_own" on storage.objects;
create policy "social_videos_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'social-videos'
    and (storage.foldername(name))[1] = 'social'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- DELETE: clean up your own abandoned or replaced uploads. Without this a
-- member can start a 1.8 GB upload, abandon it, and have no way to reclaim it.
drop policy if exists "social_videos_delete_own" on storage.objects;
create policy "social_videos_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'social-videos'
    and (storage.foldername(name))[1] = 'social'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
