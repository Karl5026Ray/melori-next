-- 086_concert_votes.sql
--
-- Concert battles score on AUDIENCE VOTES instead of gift coins. Melori no
-- longer sells anything, so the gift-coin economy that used to decide rounds
-- is being removed (see 087_drop_payments.sql). This migration adds what the
-- vote model needs; it does not remove anything.
--
-- Rules (enforced here and in POST /api/concert/battles/:spaceId/vote):
--   * one vote per signed-in member per round:
--       unique (space_id, round_number, voter_id)
--     The API upserts on that key, so a member may CHANGE their vote while the
--     round is open but never holds two;
--   * nobody votes for themselves (check constraint), and the two competitors
--     do not vote at all (API rule);
--   * a vote must name one of the battle's two competitors and may only land
--     while its round is active and inside [starts_at, ends_at) (trigger).
--
-- Access: RLS on, no policies, all privileges revoked from anon/authenticated
-- (including through PUBLIC). Only the service role, used by the API routes,
-- reads or writes votes — the same lockdown as concert_battles in 060/062.

create table if not exists public.concert_votes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.concert_battles(space_id) on delete cascade,
  round_number smallint not null check (round_number between 1 and 4),
  voter_id uuid not null references public.profiles(id) on delete cascade,
  performer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concert_votes_one_per_round unique (space_id, round_number, voter_id),
  constraint concert_votes_no_self_vote check (voter_id <> performer_id),
  constraint concert_votes_round_fk
    foreign key (space_id, round_number)
    references public.concert_battle_rounds (space_id, round_number)
    on delete cascade
);

-- The finalize step and the live tally both count one round's votes.
create index if not exists concert_votes_round_idx
  on public.concert_votes (space_id, round_number, performer_id);

alter table public.concert_votes enable row level security;
revoke all on table public.concert_votes from public, anon, authenticated;
grant all on table public.concert_votes to service_role;

-- Defence in depth for the API rules that need other tables to check.
create or replace function public.concert_vote_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initiator_id uuid;
  v_opponent_id uuid;
  v_state text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  select initiator_id, opponent_id
    into v_initiator_id, v_opponent_id
    from public.concert_battles
   where space_id = new.space_id;
  if not found then
    raise exception 'concert vote requires a battle';
  end if;

  if new.performer_id <> v_initiator_id
     and new.performer_id is distinct from v_opponent_id then
    raise exception 'concert vote must be for a competitor';
  end if;
  if new.voter_id = v_initiator_id or new.voter_id is not distinct from v_opponent_id then
    raise exception 'concert competitors cannot vote';
  end if;

  select state, starts_at, ends_at
    into v_state, v_starts_at, v_ends_at
    from public.concert_battle_rounds
   where space_id = new.space_id
     and round_number = new.round_number;
  if not found
     or v_state <> 'active'
     or v_starts_at is null
     or v_ends_at is null
     or now() < v_starts_at
     or now() >= v_ends_at then
    raise exception 'concert voting is closed for this round';
  end if;

  if tg_op = 'UPDATE' then
    -- A vote may change its performer; its identity may not move.
    if new.space_id <> old.space_id
       or new.round_number <> old.round_number
       or new.voter_id <> old.voter_id then
      raise exception 'concert vote identity is immutable';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.concert_vote_guard() from public;

drop trigger if exists concert_vote_guard_before_write on public.concert_votes;
create trigger concert_vote_guard_before_write
before insert or update on public.concert_votes
for each row execute function public.concert_vote_guard();

-- Per-round vote totals replace the coin/gift totals on the round ledger. The
-- old coin columns are dropped by 087 once no deployed code reads them.
alter table public.concert_battle_rounds
  add column if not exists initiator_votes integer not null default 0,
  add column if not exists opponent_votes integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'concert_battle_rounds_votes_nonnegative'
  ) then
    alter table public.concert_battle_rounds
      add constraint concert_battle_rounds_votes_nonnegative
      check (initiator_votes >= 0 and opponent_votes >= 0);
  end if;
end;
$$;

comment on table public.concert_votes is
  'Concert battle audience votes. One row per member per round (changeable while the round is open). Service-role only; scores are counted server-side.';
