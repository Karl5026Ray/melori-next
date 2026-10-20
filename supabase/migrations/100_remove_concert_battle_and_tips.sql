-- 100: Remove Concert Battle and the leftover tips table (Karl, 20 Oct 2026).
--
-- Karl: "Concert battles should not be connected anywhere ... Gifts also, we
-- no longer have the space for gifts." The app code for both is gone in the
-- same change. Checked on production before writing this:
--   concert_battles / _rounds / _invites / concert_votes: 0 rows each
--   tips: 0 rows, and no code reads or writes it (the gift wallet and catalog
--         were already dropped by 087_drop_payments)
--   spaces with room_format = 'versus_battle': 0
-- so nothing is lost. Beyond tidiness this:
--   * removes concert_battle_space_guard, a trigger that ran on EVERY write to
--     public.spaces (every Spaces and Cinema room) for a feature nobody used;
--   * removes ON DELETE RESTRICT / NO ACTION foreign keys from these tables to
--     profiles, which would have blocked account deletion for anyone who had
--     ever battled or been tipped.

begin;

-- 1. The guard on public.spaces first, so no room write depends on Concert.
drop trigger if exists concert_battle_space_guard_before_write on public.spaces;

-- 2. Concert tables (their own triggers go with them). Children before parent.
drop table if exists public.concert_votes;
drop table if exists public.concert_battle_rounds;
drop table if exists public.concert_battle_invites;
drop table if exists public.concert_battles;

-- 3. Concert functions: RPCs the deleted API routes called, and trigger bodies.
drop function if exists public.create_concert_battle(uuid, text, text);
drop function if exists public.invite_concert_opponent(uuid, uuid, uuid, timestamptz);
drop function if exists public.cancel_concert_battle_invite(uuid, uuid);
drop function if exists public.respond_concert_battle_invite(uuid, uuid, text);
drop function if exists public.expire_concert_battle_invites_for_recipient(uuid);
drop function if exists public.expire_concert_battle_invite_for_space(uuid);
drop function if exists public.concert_battle_space_guard();
drop function if exists public.concert_battle_identity_guard();
drop function if exists public.concert_battle_round_identity_guard();
drop function if exists public.concert_battle_invite_guard();
drop function if exists public.concert_battle_touch_updated_at();
drop function if exists public.concert_vote_guard();

-- 4. 'versus_battle' is no longer a room format. Any stray row becomes an
--    ordinary discussion Space before the check tightens (none exist today).
update public.spaces set room_format = 'discussion' where room_format = 'versus_battle';
alter table public.spaces drop constraint if exists spaces_room_format_check;
alter table public.spaces add constraint spaces_room_format_check check (
  room_format = any (array[
    'release_party', 'discussion', 'dj_set',
    'live_solo', 'live_duo', 'live_group',
    'cinema',
    'table_read', 'audition', 'callback'
  ])
);

-- 5. Gifts: the last table left from the gifting/payments era.
drop table if exists public.tips;

commit;
