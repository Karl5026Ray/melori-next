-- 088_mirror_recordings_private_bucket.sql
--
-- Melori Mirror live recordings become PRIVATE until the host posts them.
--
-- Before this, LiveKit egress wrote every live recording straight into the
-- PUBLIC social-videos bucket (mirror-live/<room>/<stamp>.mp4) and stamped a
-- public URL on the spaces row the moment recording STARTED. Anyone holding
-- that URL could watch a recording the host never chose to post, and "Not now"
-- left the file there forever. Illinois is an all-party-consent state; a
-- recording of other people must not be reachable unless the host posts it.
--
-- Now:
--   * egress writes into this private bucket (env MIRROR_RECORDINGS_BUCKET,
--     default 'mirror-recordings');
--   * /api/mirror/recording/publish copies the MP4 into social-videos only
--     when the host taps "Post it" (the feed keeps playing plain public URLs);
--   * /api/mirror/recording/discard ("Not now") deletes it.
--
-- public = false: no anonymous object URL works. Only the service role (the
-- server routes) and the S3 access keys LiveKit egress uses can read/write it;
-- no storage.objects policies are added, so anon/authenticated get nothing.
--
-- Idempotent; safe to re-run.

insert into storage.buckets (id, name, public)
values ('mirror-recordings', 'mirror-recordings', false)
on conflict (id) do nothing;

-- If someone pre-created the bucket by hand as public, close it.
update storage.buckets set public = false where id = 'mirror-recordings' and public;

comment on column public.spaces.recording_url is
  'Public URL of a POSTED live recording (social-videos bucket). Null until the host posts it; unposted recordings live only in the private mirror-recordings bucket.';
comment on column public.spaces.recording_storage_key is
  'Object key of the unposted recording in the private mirror-recordings bucket. Cleared when the host posts (copied to social-videos) or discards (deleted).';
