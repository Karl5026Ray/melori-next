-- 105: Explicit-content flag on songs.
-- NOT YET APPLIED to production when this file was written (2026-11-20).
-- Apply as migration `105_explicit_content_flag` on project ouvovhwizsuhjxxmccex
-- BEFORE the code that selects `explicit` is deployed, otherwise the radio pool
-- and track queries will error on the missing column.
--
-- Artists mark explicit tracks in Studio; admins can flip it too. The site shows
-- an "E" badge on those tracks, and the homepage radio (which autoplays muted on
-- the front page) leaves them out.

alter table public.studio_tracks
  add column if not exists explicit boolean not null default false;

alter table public.tracks
  add column if not exists explicit boolean not null default false;

comment on column public.studio_tracks.explicit is
  'Track contains explicit content. Shows an E badge; kept off the homepage radio.';
comment on column public.tracks.explicit is
  'Track contains explicit content. Shows an E badge; kept off the homepage radio.';
