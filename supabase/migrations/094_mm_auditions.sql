-- 094: MM Auditions — private table reads, auditions and callbacks.
--
-- Auditions is a set of room FORMATS on the existing `spaces` engine (like
-- Cinema), so host/stage roles, bans, the LiveKit room and teardown are shared.
-- What is new here:
--
--   1. Three formats: table_read, audition, callback.
--   2. `spaces.is_private` — the director's choice at create time. Until now
--      every room was readable by everyone (policy "Spaces viewable by
--      everyone") and anyone could insert themselves into space_participants.
--      Private rooms now hide their row and roster from non-members. Every
--      existing room has is_private = false, so nothing else changes.
--   3. `space_access` — who may be in an audition room and in what state
--      (invited → lobby → admitted / denied). It is the ONLY thing the LiveKit
--      token route trusts for audition rooms; space_participants is not.
--   4. `space_invite_codes` — kept off `spaces` on purpose: `spaces` rows are
--      readable by members, the code must be readable only by the host.
--   5. `audition_files` + private bucket `audition-docs` — scripts/sides
--      (director → readers) and headshots/resumes/reel links (actor →
--      director). All reads and writes go through server routes with the
--      service role and signed URLs; there are deliberately no storage.objects
--      policies on this bucket.
--   6. `audition_room_state` — which script is open and on which page.
--
-- Writes to the new tables are service-role only (no insert/update/delete
-- policies): the API routes enforce who may admit, deny, upload or turn pages.

-- 1. Formats ------------------------------------------------------------------
-- Re-list ALL existing values (see 050: the live_* values are not in the TS
-- union, and dropping them would break MM Faces).
alter table public.spaces drop constraint if exists spaces_room_format_check;
alter table public.spaces add constraint spaces_room_format_check
  check (room_format = any (array[
    'release_party', 'versus_battle', 'discussion', 'dj_set',
    'live_solo', 'live_duo', 'live_group', 'cinema',
    'table_read', 'audition', 'callback'
  ]));

-- 2. Privacy flag -------------------------------------------------------------
alter table public.spaces
  add column if not exists is_private boolean not null default false;

-- 3. Access ledger ------------------------------------------------------------
create table if not exists public.space_access (
  space_id       uuid not null references public.spaces(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  status         text not null
                 check (status in ('invited', 'lobby', 'admitted', 'denied')),
  character_name text check (character_name is null or char_length(character_name) <= 80),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  decided_by     uuid references public.profiles(id) on delete set null,
  primary key (space_id, user_id)
);
create index if not exists space_access_user_idx on public.space_access (user_id);
create index if not exists space_access_space_status_idx
  on public.space_access (space_id, status);

-- 4. Invite codes (host-only) -------------------------------------------------
create table if not exists public.space_invite_codes (
  space_id   uuid primary key references public.spaces(id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z0-9]{6,12}$'),
  created_at timestamptz not null default now()
);

-- 5. Files --------------------------------------------------------------------
create table if not exists public.audition_files (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces(id) on delete cascade,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('script', 'headshot', 'resume', 'reel')),
  storage_path  text,
  external_url  text check (external_url is null or external_url ~ '^https://'),
  file_name     text check (file_name is null or char_length(file_name) <= 200),
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or size_bytes between 1 and 15728640),
  created_at    timestamptz not null default now(),
  -- A file is exactly one of: an upload in audition-docs, or a link (reels).
  constraint audition_files_one_source check (
    (storage_path is not null) <> (external_url is not null)
  ),
  -- Reels are links at launch (storage cost); everything else is an upload.
  constraint audition_files_reel_is_link check (
    (kind = 'reel') = (external_url is not null)
  )
);
create index if not exists audition_files_space_idx on public.audition_files (space_id, kind);
create index if not exists audition_files_owner_idx on public.audition_files (owner_id);

-- 6. Room state (open script + page) -----------------------------------------
create table if not exists public.audition_room_state (
  space_id       uuid primary key references public.spaces(id) on delete cascade,
  script_file_id uuid references public.audition_files(id) on delete set null,
  page           integer not null default 1 check (page >= 1),
  updated_at     timestamptz not null default now()
);

-- 7. Recordings ---------------------------------------------------------------
-- One row per take. The MP4 lands in the PRIVATE mirror-recordings bucket via
-- LiveKit egress (same pipeline as Mirror, migration 088) and is NEVER copied
-- to a public bucket: /api/mirror/recording/publish refuses audition rooms.
-- Only the director can list or play them (server routes, signed URLs).
create table if not exists public.audition_recordings (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  egress_id   text not null,
  storage_key text not null,
  started_by  uuid references public.profiles(id) on delete set null,
  started_at  timestamptz not null default now(),
  stopped_at  timestamptz
);
create index if not exists audition_recordings_space_idx
  on public.audition_recordings (space_id, started_at desc);

-- Access helpers --------------------------------------------------------------
-- SECURITY DEFINER so policies on spaces / space_participants / space_access
-- can consult each other without RLS recursion.

-- May the caller see this room at all? Open rooms: everyone. Private rooms:
-- the host, and anyone with an access row that is not denied (so an actor in
-- the lobby can still see which room they are waiting for).
create or replace function public.can_see_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (not s.is_private)
        or s.host_id = (select auth.uid())
        or exists (
             select 1 from public.space_access a
              where a.space_id = s.id
                and a.user_id = (select auth.uid())
                and a.status in ('invited', 'lobby', 'admitted')
           )
      from public.spaces s
     where s.id = p_space_id
  ), false);
$$;

-- Is the caller inside the room (host or admitted)? Open rooms: everyone, so
-- ordinary Spaces/Faces/Cinema behaviour is unchanged.
create or replace function public.is_in_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (not s.is_private)
        or s.host_id = (select auth.uid())
        or exists (
             select 1 from public.space_access a
              where a.space_id = s.id
                and a.user_id = (select auth.uid())
                and a.status = 'admitted'
           )
      from public.spaces s
     where s.id = p_space_id
  ), false);
$$;

-- Director-side: host, or a host-appointed mod/cohost currently in the room.
create or replace function public.is_space_director(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.spaces s
     where s.id = p_space_id and s.host_id = (select auth.uid())
  ) or exists (
    select 1 from public.space_participants p
     where p.space_id = p_space_id
       and p.user_id = (select auth.uid())
       and p.badge in ('mod', 'cohost')
       and p.left_at is null
  );
$$;

-- anon keeps EXECUTE on the two policy helpers: the spaces and participants
-- SELECT policies apply to signed-out readers too, and Postgres does not
-- promise to short-circuit `not is_private or ...`. Without the grant a
-- signed-out teaser read would error instead of seeing open rooms. Both only
-- ever answer "false" for anon on a private room.
revoke all on function public.can_see_space(uuid) from public;
revoke all on function public.is_in_space(uuid) from public;
revoke all on function public.is_space_director(uuid) from public, anon;
grant execute on function public.can_see_space(uuid) to anon, authenticated;
grant execute on function public.is_in_space(uuid) to anon, authenticated;
grant execute on function public.is_space_director(uuid) to authenticated;

-- RLS: spaces -----------------------------------------------------------------
-- Was: select using (true). Open rooms stay visible to everyone (anon
-- included, for the signed-out teasers); private rooms only to members.
drop policy if exists "Spaces viewable by everyone" on public.spaces;
create policy "Spaces viewable by everyone" on public.spaces
  for select
  using (not is_private or public.can_see_space(id));

-- RLS: space_participants -----------------------------------------------------
-- Was: select using (true) and insert with check (self). A private room's
-- roster is visible only inside it, and nobody can self-insert into a private
-- room without being admitted.
drop policy if exists "Participants viewable by all" on public.space_participants;
create policy "Participants viewable by all" on public.space_participants
  for select
  using (public.is_in_space(space_id));

drop policy if exists "Users can join spaces" on public.space_participants;
create policy "Users can join spaces" on public.space_participants
  for insert
  with check ((select auth.uid()) = user_id and public.is_in_space(space_id));

-- RLS: new tables -------------------------------------------------------------
alter table public.space_access enable row level security;
alter table public.space_invite_codes enable row level security;
alter table public.audition_files enable row level security;
alter table public.audition_room_state enable row level security;
alter table public.audition_recordings enable row level security;

create policy audition_recordings_read_director on public.audition_recordings
  for select to authenticated
  using (public.is_space_director(space_id));

-- Your own access row, or every row if you run the room.
create policy space_access_read on public.space_access
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_space_director(space_id));

-- Codes: host only (the API also serves it to the host).
create policy space_invite_codes_read_host on public.space_invite_codes
  for select to authenticated
  using (exists (
    select 1 from public.spaces s
     where s.id = space_id and s.host_id = (select auth.uid())
  ));

-- Scripts: everyone in the room. Actor materials: the actor and the director.
create policy audition_files_read on public.audition_files
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_space_director(space_id)
    or (kind = 'script' and public.is_in_space(space_id))
  );

create policy audition_room_state_read on public.audition_room_state
  for select to authenticated
  using (public.is_in_space(space_id));

-- Storage ---------------------------------------------------------------------
-- 15 MB; PDFs (scripts, resumes) and images (headshots). Reels are links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audition-docs', 'audition-docs', false, 15728640,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
