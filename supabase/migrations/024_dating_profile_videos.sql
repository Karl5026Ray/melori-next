-- Melori Connect: allow dating profiles to carry short intro video clips.
-- The swipe card plays the first video (if present) instead of the lead photo.
alter table public.dating_profiles
  add column if not exists videos text[] not null default array[]::text[];
