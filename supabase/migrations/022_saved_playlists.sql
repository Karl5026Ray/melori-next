-- =====================================================================
-- Saved playlists for Melori Radio — Phase 2 (2026-07-14)
-- =====================================================================
-- Lets a member curate their own named playlists and play them on the
-- radio. Mirrors the dual-track-id pattern already established by
-- track_listens (014): the platform has BOTH a legacy `tracks` surface
-- (int PK) and a newer `studio_tracks` surface (uuid PK), so a playlist
-- item points at exactly one of them, enforced by a CHECK.
--
-- Design:
--   * saved_playlists: one row per playlist, owned by a profile.
--   * saved_playlist_tracks: membership rows. `position` gives a stable
--     manual order; a partial-unique index prevents the same track being
--     added to the same playlist twice (per source surface).
--   * RLS: a member may only see / mutate THEIR OWN playlists and the
--     track rows belonging to their playlists. The service-role client
--     (used by API routes after auth) bypasses RLS; policies are
--     defense-in-depth for any anon-key access.
-- ---------------------------------------------------------------------

create table if not exists public.saved_playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'My Playlist',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_playlists_name_len check (char_length(name) between 1 and 80)
);

create index if not exists saved_playlists_owner_idx
  on public.saved_playlists (owner_id, updated_at desc);

create table if not exists public.saved_playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.saved_playlists(id) on delete cascade,
  studio_track_id uuid references public.studio_tracks(id) on delete cascade,
  legacy_track_id integer references public.tracks(id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  constraint saved_playlist_tracks_one_track check (
    (studio_track_id is null) <> (legacy_track_id is null)
  )
);

create index if not exists saved_playlist_tracks_playlist_idx
  on public.saved_playlist_tracks (playlist_id, position asc, added_at asc);

-- Prevent duplicate adds of the same track to the same playlist. Two partial
-- unique indexes (one per surface) because only one of the two id columns is
-- non-null on any row.
create unique index if not exists saved_playlist_tracks_uniq_studio
  on public.saved_playlist_tracks (playlist_id, studio_track_id)
  where studio_track_id is not null;

create unique index if not exists saved_playlist_tracks_uniq_legacy
  on public.saved_playlist_tracks (playlist_id, legacy_track_id)
  where legacy_track_id is not null;

-- Bump the parent playlist's updated_at whenever its track set changes so the
-- "recently updated" ordering on saved_playlists stays meaningful.
create or replace function public.saved_playlist_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.saved_playlists
    set updated_at = now()
    where id = coalesce(new.playlist_id, old.playlist_id);
  return null;
end;
$$;

drop trigger if exists saved_playlist_tracks_touch_trg on public.saved_playlist_tracks;
create trigger saved_playlist_tracks_touch_trg
  after insert or delete on public.saved_playlist_tracks
  for each row execute function public.saved_playlist_touch();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.saved_playlists enable row level security;
alter table public.saved_playlist_tracks enable row level security;

-- Playlists: fully private to the owner (select/insert/update/delete).
drop policy if exists saved_playlists_select_own on public.saved_playlists;
create policy saved_playlists_select_own on public.saved_playlists
  for select using (auth.uid() = owner_id);

drop policy if exists saved_playlists_insert_own on public.saved_playlists;
create policy saved_playlists_insert_own on public.saved_playlists
  for insert with check (auth.uid() = owner_id);

drop policy if exists saved_playlists_update_own on public.saved_playlists;
create policy saved_playlists_update_own on public.saved_playlists
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists saved_playlists_delete_own on public.saved_playlists;
create policy saved_playlists_delete_own on public.saved_playlists
  for delete using (auth.uid() = owner_id);

-- Track rows: allowed only when the parent playlist belongs to the caller.
drop policy if exists saved_playlist_tracks_select_own on public.saved_playlist_tracks;
create policy saved_playlist_tracks_select_own on public.saved_playlist_tracks
  for select using (
    exists (
      select 1 from public.saved_playlists p
      where p.id = saved_playlist_tracks.playlist_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists saved_playlist_tracks_insert_own on public.saved_playlist_tracks;
create policy saved_playlist_tracks_insert_own on public.saved_playlist_tracks
  for insert with check (
    exists (
      select 1 from public.saved_playlists p
      where p.id = saved_playlist_tracks.playlist_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists saved_playlist_tracks_delete_own on public.saved_playlist_tracks;
create policy saved_playlist_tracks_delete_own on public.saved_playlist_tracks
  for delete using (
    exists (
      select 1 from public.saved_playlists p
      where p.id = saved_playlist_tracks.playlist_id
        and p.owner_id = auth.uid()
    )
  );

comment on table public.saved_playlists is
  'Member-curated playlists for Melori Radio (Phase 2). Private to owner_id.';
comment on table public.saved_playlist_tracks is
  'Tracks in a saved playlist. Exactly one of studio_track_id / legacy_track_id is set per row.';
