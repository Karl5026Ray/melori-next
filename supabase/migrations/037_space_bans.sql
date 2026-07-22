-- 037_space_bans.sql
-- Room-scoped bans for live rooms / spaces (MM Faces host moderation). Distinct
-- from the GLOBAL member_blocks table (DM blocking, PRs #24-#29): a ban here
-- only prevents the banned user from rejoining ONE specific room/session. The
-- host bans a disruptive guest; the LiveKit token route (see
-- src/app/api/livekit-token/route.ts) then refuses to mint a join token for a
-- banned user for that room, and the participants PATCH route removes them from
-- the live room immediately (RoomServiceClient.removeParticipant).

create table if not exists public.space_bans (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  banned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- One ban row per (room, user). Re-banning is a no-op upsert.
  constraint space_bans_unique unique (space_id, user_id),
  -- A host can never ban themselves.
  constraint space_bans_no_self check (user_id <> banned_by)
);

create index if not exists space_bans_space_idx
  on public.space_bans (space_id);

create index if not exists space_bans_user_idx
  on public.space_bans (user_id);

alter table public.space_bans enable row level security;

-- Bans are written and read server-side through the service-role client (the
-- token route + the host-verified moderation route), which bypasses RLS. These
-- policies only cover the anon/auth client: the room host may read the bans for
-- their own room; nobody else can see or write them from the client.
drop policy if exists "space_bans_select_host" on public.space_bans;
create policy "space_bans_select_host" on public.space_bans
  for select using (
    exists (
      select 1 from public.spaces s
      where s.id = space_bans.space_id
        and s.host_id = auth.uid()
    )
  );
