-- 005_mm_social_clubhouse.sql
-- Ephemeral spaces + wave invites + conversation bootstrapping + read receipts
-- + scheduled spaces + host moderation.

-- ---------------------------------------------------------------------------
-- Spaces: scheduling + host-force-mute
-- ---------------------------------------------------------------------------

alter table public.spaces
  add column if not exists scheduled_at timestamptz,
  add column if not exists last_activity_at timestamptz default now();

-- host_muted lets the host force-mute a speaker independently of the
-- speaker's own is_muted toggle.
alter table public.space_participants
  add column if not exists host_muted boolean not null default false;

-- ---------------------------------------------------------------------------
-- Waves — lightweight "hey, wanna chat privately?" invites.
-- Expires after 24h. Accepting materializes a conversation.
-- ---------------------------------------------------------------------------

create table if not exists public.waves (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired')),
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  responded_at timestamptz,
  constraint waves_no_self check (sender_id <> recipient_id)
);

create index if not exists waves_recipient_status_idx
  on public.waves (recipient_id, status, created_at desc);

create index if not exists waves_sender_status_idx
  on public.waves (sender_id, status, created_at desc);

-- Idempotency: at most one pending wave from A to B at a time.
create unique index if not exists waves_unique_pending
  on public.waves (sender_id, recipient_id)
  where status = 'pending';

alter table public.waves enable row level security;

drop policy if exists "waves_select_involved" on public.waves;
create policy "waves_select_involved" on public.waves
  for select using (
    auth.uid() = sender_id or auth.uid() = recipient_id
  );

drop policy if exists "waves_insert_own" on public.waves;
create policy "waves_insert_own" on public.waves
  for insert with check (auth.uid() = sender_id);

drop policy if exists "waves_update_recipient" on public.waves;
create policy "waves_update_recipient" on public.waves
  for update using (
    auth.uid() = recipient_id or auth.uid() = sender_id
  );

-- ---------------------------------------------------------------------------
-- Conversation membership: read receipts
-- ---------------------------------------------------------------------------

alter table public.conversation_members
  add column if not exists last_read_at timestamptz;

-- ---------------------------------------------------------------------------
-- Auto-prune ended spaces (called by cron)
-- ---------------------------------------------------------------------------

create or replace function public.prune_ended_spaces(older_than_hours int default 2)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.spaces
   where status = 'ended'
     and coalesce(ended_at, created_at) < now() - make_interval(hours => older_than_hours);
  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;

-- Also expire stale waves (>24h old, still pending)
create or replace function public.expire_stale_waves()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.waves
     set status = 'expired'
   where status = 'pending'
     and expires_at < now();
  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;

-- End orphaned live spaces (no last_activity for 30 min)
create or replace function public.reap_idle_spaces(idle_minutes int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.spaces
     set status = 'ended',
         ended_at = coalesce(ended_at, now())
   where status = 'live'
     and coalesce(last_activity_at, created_at) < now() - make_interval(mins => idle_minutes);
  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;
