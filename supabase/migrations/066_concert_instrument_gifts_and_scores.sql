-- 066_concert_instrument_gifts_and_scores.sql
--
-- APPEND-ONLY MIGRATION: do not edit a migration after it is applied. Add a
-- later numbered migration for every Concert stage catalog or scoring change.
--
-- Two concerns, both required by the Concert live battle stage:
--   1. The five instrument gifts the battle tray offers, as 3D GLB assets.
--   2. A read-only aggregate of gifted coins per competitor, so the stage's
--      score bar has one server-authoritative source instead of the client
--      summing an unbounded gift_sends page.

-- ---------------------------------------------------------------------------
-- 1. Instrument gift catalog
-- ---------------------------------------------------------------------------
-- Fixed UUIDs keep this insert idempotent across environments, matching the
-- pattern established by 063_record_player_glb_gift.sql. Prices are the
-- server's authority: the client renders price_coins from this catalog and
-- never hardcodes a cost at send time.

insert into public.gifts (
  id, slug, name, tier, asset_url, duration_ms, price_coins, active, sort_order
) values
  ('b1d0e5a2-1c40-4a11-9f01-0a1b2c3d4e51', 'battle_guitar',    'Battle Guitar',    'spark', '/gifts/guitar.glb',     3500, 15, true, 1),
  ('b1d0e5a2-1c40-4a11-9f01-0a1b2c3d4e52', 'battle_piano',     'Battle Piano',     'spark', '/gifts/piano.glb',      3500, 20, true, 2),
  ('b1d0e5a2-1c40-4a11-9f01-0a1b2c3d4e53', 'battle_drum',      'Battle Drum',      'glow',  '/gifts/drum.glb',       4000, 30, true, 3),
  ('b1d0e5a2-1c40-4a11-9f01-0a1b2c3d4e54', 'battle_violin',    'Battle Violin',    'glow',  '/gifts/violin.glb',     4000, 40, true, 4),
  ('b1d0e5a2-1c40-4a11-9f01-0a1b2c3d4e55', 'battle_saxophone', 'Battle Saxophone', 'epic',  '/gifts/saxophone.glb',  5000, 60, true, 5)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  tier = excluded.tier,
  asset_url = excluded.asset_url,
  duration_ms = excluded.duration_ms,
  price_coins = excluded.price_coins,
  active = excluded.active,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 2. Competitor score aggregate
-- ---------------------------------------------------------------------------
-- Only gifts aimed at one of the battle's two immutable competitor identities
-- are counted. A gift sent to anyone else in the room (which the send route
-- already refuses, but which a historical row could still contain) is excluded
-- here as well, so the score bar can never be inflated by a non-competitor.
--
-- This is a DISPLAY aggregate. concert_battle_rounds remains the authority for
-- round outcomes and the win condition; nothing here decides a battle.

create or replace function public.concert_battle_gift_totals(p_space_id uuid)
returns table (
  initiator_id uuid,
  opponent_id uuid,
  initiator_coins integer,
  opponent_coins integer,
  initiator_gifts integer,
  opponent_gifts integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.initiator_id,
    b.opponent_id,
    coalesce(sum(g.coins_spent) filter (where g.target_id = b.initiator_id), 0)::integer,
    coalesce(sum(g.coins_spent) filter (where g.target_id = b.opponent_id), 0)::integer,
    count(*) filter (where g.target_id = b.initiator_id)::integer,
    count(*) filter (where g.target_id = b.opponent_id)::integer
  from public.concert_battles b
  left join public.gift_sends g
    on g.space_id = b.space_id
   and g.target_id in (b.initiator_id, b.opponent_id)
  where b.space_id = p_space_id
  group by b.initiator_id, b.opponent_id;
$$;

-- Battle reads flow through authenticated server routes only, matching the
-- lockdown established in 060/062. No anon/authenticated execute grant.
revoke all on function public.concert_battle_gift_totals(uuid) from anon, authenticated;
grant execute on function public.concert_battle_gift_totals(uuid) to service_role;

create index if not exists gift_sends_space_target_idx
  on public.gift_sends (space_id, target_id);
