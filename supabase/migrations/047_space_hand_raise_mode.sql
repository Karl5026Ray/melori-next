-- 047_space_hand_raise_mode.sql
-- Host-controlled hand-raise mode for MM Spaces (Clubhouse parity).
--
-- Adds spaces.hand_raise_mode: who may raise a hand to request the stage.
--   'off'      — raise-hand is disabled; only the host can invite someone up.
--   'followed' — limited to accounts the HOST follows (uses the existing
--                public.follows graph from migration 021). NOTE: the client/
--                server "followed" enforcement is left as a documented TODO in
--                this PR (see src/app/api/social/spaces/[spaceId]/raise-hand/
--                route.ts) — the column + "off"/"everyone" modes are fully
--                wired end-to-end today.
--   'everyone' — any signed-in participant may raise a hand (default; this is
--                the existing behavior, preserved as the default so no space
--                changes behavior without the host opting in).
--
-- Additive only: new nullable-with-default column, no edits to any existing
-- migration, no data loss. Safe to re-run (IF NOT EXISTS / guarded constraint).

alter table public.spaces
  add column if not exists hand_raise_mode text not null default 'everyone';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'spaces_hand_raise_mode_check'
  ) then
    alter table public.spaces
      add constraint spaces_hand_raise_mode_check
      check (hand_raise_mode in ('off', 'followed', 'everyone'));
  end if;
end $$;

-- Backfill any existing rows (default already covers new inserts).
update public.spaces
   set hand_raise_mode = 'everyone'
 where hand_raise_mode is null;
