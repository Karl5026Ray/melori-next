-- 036_live_invites.sql
-- In-app invites to join a live room (MM Faces). Mirrors the "waves" pattern:
-- a host sends a pending invite to someone they follow; the recipient sees an
-- incoming invite with a Join CTA. Expires after 2h.

create table if not exists public.live_invites (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  responded_at timestamptz,
  constraint live_invites_no_self check (sender_id <> recipient_id)
);

create index if not exists live_invites_recipient_status_idx
  on public.live_invites (recipient_id, status, created_at desc);

create index if not exists live_invites_sender_status_idx
  on public.live_invites (sender_id, status, created_at desc);

create index if not exists live_invites_space_idx
  on public.live_invites (space_id);

-- Idempotency: at most one pending invite from A to B for a given room.
create unique index if not exists live_invites_unique_pending
  on public.live_invites (sender_id, recipient_id, space_id)
  where status = 'pending';

alter table public.live_invites enable row level security;

drop policy if exists "live_invites_select_involved" on public.live_invites;
create policy "live_invites_select_involved" on public.live_invites
  for select using (
    auth.uid() = sender_id or auth.uid() = recipient_id
  );

drop policy if exists "live_invites_insert_own" on public.live_invites;
create policy "live_invites_insert_own" on public.live_invites
  for insert with check (auth.uid() = sender_id);

-- Recipient updates (accept/decline) and sender updates (cancel).
drop policy if exists "live_invites_update_involved" on public.live_invites;
create policy "live_invites_update_involved" on public.live_invites
  for update using (
    auth.uid() = recipient_id or auth.uid() = sender_id
  );

-- Expire stale invites (>2h old, still pending). Mirrors expire_stale_waves().
create or replace function public.expire_stale_live_invites()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.live_invites
     set status = 'expired'
   where status = 'pending'
     and expires_at < now();
  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;
