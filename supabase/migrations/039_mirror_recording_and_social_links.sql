-- 039_mirror_recording_and_social_links.sql
-- Two related feature additions:
--   1. Melori Mirror live recording: track the LiveKit egress that records a
--      live session so it can be stopped on end and turned into a Mirror post.
--   2. Profile custom social links: up to 5 user-editable {label,url} links shown
--      on each profile for other social media / websites.

-- --- 1. Recording state on live rooms (spaces) ------------------------------
alter table public.spaces
  add column if not exists recording_egress_id text,
  add column if not exists recording_storage_key text,
  add column if not exists recording_url text,
  -- true while the host has recording running for this live session
  add column if not exists is_recording boolean not null default false;

comment on column public.spaces.recording_egress_id is
  'LiveKit egress id for the in-progress/last recording of this live room.';
comment on column public.spaces.recording_url is
  'Public URL of the finished MP4 recording (social-videos bucket), if any.';

-- --- 2. Custom social links on profiles -------------------------------------
-- Array of objects: [{ "label": "Instagram", "url": "https://..." }, ...]
-- Capped at 5 entries in application code; a defensive check keeps it sane.
alter table public.profiles
  add column if not exists social_links jsonb not null default '[]'::jsonb;

comment on column public.profiles.social_links is
  'Up to 5 user-editable {label,url} links to other social media / websites.';

-- Guard: must be a JSON array of at most 5 elements.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_social_links_max5'
  ) then
    alter table public.profiles
      add constraint profiles_social_links_max5
      check (
        jsonb_typeof(social_links) = 'array'
        and jsonb_array_length(social_links) <= 5
      );
  end if;
end $$;
