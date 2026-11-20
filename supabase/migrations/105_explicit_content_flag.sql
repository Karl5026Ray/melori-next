-- 105: Explicit-content flag on songs.
-- Applied to production 2026-11-20 as migration `105_explicit_content_flag`
-- (project ouvovhwizsuhjxxmccex), before the code that selects `explicit` was
-- merged. That order matters: the radio pool and track queries error without
-- the column.
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
