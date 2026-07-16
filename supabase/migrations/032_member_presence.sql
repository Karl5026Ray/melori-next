-- 032_member_presence.sql
-- Site-wide "who is online right now" presence for the Melori Mirror
-- "Online now" ring row.
--
-- Problem: the ring row at the top of /social/mirror only ever showed live-room
-- HOSTS (spaces where status='live'), because /api/mirror/live had no other
-- signal to draw on. A member who is signed in and actively using Melori but is
-- not hosting a live room could never appear there, so the row looked empty
-- whenever nobody happened to be broadcasting.
--
-- There was no existing site-wide presence signal to reuse: PubNub presence is
-- ephemeral and per-channel, and `space_participants` only tracks people inside
-- a room. Vercel functions are stateless and cannot hold a roster in memory, so
-- the cheapest durable signal is a `last_seen_at` timestamp on the profile,
-- bumped by a lightweight client heartbeat (POST /api/presence/heartbeat) while
-- the Mirror page is open. "Online" is then simply
--   last_seen_at > now() - <window>  (the API uses a 2-minute window against a
--   ~60s client heartbeat, so one missed beat is tolerated).

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- Partial index for the "recently seen" scan the Mirror live route runs on every
-- poll. Only rows that have ever heartbeated are indexed, keeping it small.
create index if not exists profiles_last_seen_at_idx
  on public.profiles (last_seen_at desc)
  where last_seen_at is not null;

comment on column public.profiles.last_seen_at is
  'Last time this member sent a presence heartbeat (POST /api/presence/heartbeat). Used to render the Melori Mirror "Online now" row; a member is considered online when last_seen_at is within the API''s freshness window (~2 min).';
