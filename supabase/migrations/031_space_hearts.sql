-- 031_space_hearts.sql
-- Room-level "hearts" (likes) for live rooms — MM Faces video + MM Spaces audio.
--
-- The floating-heart reaction already existed as an ephemeral broadcast (a
-- Supabase Realtime "broadcast" event that animates a heart on every client)
-- but nothing was ever counted or stored, so there was no running total and the
-- number reset the instant a viewer reconnected. This migration adds a durable
-- per-room total plus an atomic increment so the count survives reconnects and
-- is consistent across clients.
--
-- Design: a single counter column on `spaces` (not a per-heart row table) — a
-- live room can receive thousands of taps and we only ever need the aggregate,
-- so a counter + atomic increment RPC is far cheaper than storing every tap.

alter table public.spaces
  add column if not exists hearts_count bigint not null default 0;

-- Atomic increment. Returns the NEW total so the caller can broadcast it to
-- every client in one round-trip. `p_by` is clamped server-side by the API
-- route (rate-limited) but we also guard here: only positive, bounded bumps.
create or replace function public.increment_space_hearts(
  p_space_id uuid,
  p_by integer default 1
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_by    integer := greatest(1, least(coalesce(p_by, 1), 50));
begin
  update public.spaces
     set hearts_count = hearts_count + v_by
   where id = p_space_id
  returning hearts_count into v_total;

  return coalesce(v_total, 0);
end;
$$;
