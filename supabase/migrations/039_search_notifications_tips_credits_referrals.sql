-- 039_search_notifications_tips_credits_referrals.sql
-- One cohesive migration for five features shipped together:
--
--   1. Global search       — no schema change (reads existing releases/artists/
--                            profiles/spaces/social_videos). Adds trigram
--                            indexes so ILIKE '%q%' fan-out stays fast.
--   2. Notifications center — the `notifications` table already exists
--                            (id, user_id, type, data jsonb, read, created_at),
--                            created out-of-band and previously unused. This
--                            file makes the repo authoritative for it: ensures
--                            it exists, enables RLS (owner-read/update), and
--                            indexes the unread-badge hot path. Service-role
--                            routes bypass RLS and own inserts.
--   3. Tip button          — `tips` table records each Stripe-fulfilled tip so
--                            the webhook can be idempotent and artists can see
--                            tip history. Money routing reuses the existing
--                            Stripe Connect 90/10 destination-charge model from
--                            /api/music/checkout, so NO payout schema is needed.
--   4. Lyrics + credits    — two additive columns on `tracks` (lyrics,
--                            credits_text) plus a `track_credits` table for
--                            structured per-role credit lines.
--   5. Referral codes      — `referrals` table: one owner code per user, plus a
--                            row per invited signup, and a paid-reward ledger so
--                            the "1 free Superfan month both sides" comp is
--                            granted exactly once when the invitee's first paid
--                            plan activates.
--
-- Every statement is additive + idempotent (IF NOT EXISTS / DROP POLICY IF
-- EXISTS) and safe to re-run. No destructive changes.

-- ---------------------------------------------------------------------------
-- Extensions (trigram search). Safe if already present.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

-- ===========================================================================
-- 1. GLOBAL SEARCH — trigram indexes for substring (ILIKE) matching
-- ===========================================================================
create index if not exists releases_title_trgm
  on public.releases using gin (title gin_trgm_ops);
create index if not exists artists_name_trgm
  on public.artists using gin (name gin_trgm_ops);
create index if not exists profiles_username_trgm
  on public.profiles using gin (username gin_trgm_ops);
create index if not exists profiles_display_name_trgm
  on public.profiles using gin (display_name gin_trgm_ops);
create index if not exists spaces_title_trgm
  on public.spaces using gin (title gin_trgm_ops);
create index if not exists social_videos_title_trgm
  on public.social_videos using gin (title gin_trgm_ops);

-- ===========================================================================
-- 2. NOTIFICATIONS — ensure table, RLS, and unread-badge index
--   The existing table stores presentation fields inside `data` jsonb, e.g.
--   { "title": "...", "body": "...", "link": "/social/..." }. We keep that
--   shape rather than adding columns, so any out-of-band writers stay valid.
-- ===========================================================================
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  data jsonb default '{}'::jsonb,
  read boolean default false,
  created_at timestamptz default now()
);

-- Hot path: unread badge + newest-first list per user.
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read, created_at desc);
create index if not exists notifications_user_recent_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Owner may read + update (mark-read) their own notifications. Inserts and
-- deletes go through the service role (bypasses RLS).
drop policy if exists notifications_owner_read on public.notifications;
create policy notifications_owner_read on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notifications_owner_update on public.notifications;
create policy notifications_owner_update on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===========================================================================
-- 3. TIPS — one row per Stripe-fulfilled tip (idempotent via unique session)
-- ===========================================================================
create table if not exists public.tips (
  id uuid primary key default gen_random_uuid(),
  -- Who received the tip. artist_id (int) is set for artist-page/track/live
  -- tips; recipient_profile_id (uuid) denormalizes the owning account so the
  -- artist's Studio can query their tip history by profile.
  artist_id integer references public.artists(id) on delete set null,
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  -- Optional context: what surface the tip came from + the referenced object.
  source text not null default 'artist',            -- 'artist' | 'track' | 'live' | 'mirror'
  track_id integer references public.tracks(id) on delete set null,
  space_id uuid references public.spaces(id) on delete set null,
  -- Tipper (nullable: guest tipping allowed).
  tipper_user_id uuid references auth.users(id) on delete set null,
  tipper_email text,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  -- Whether funds were routed to the artist's Connect account (destination
  -- charge) or settled on the platform account for later reconciliation.
  connected_account_id text,
  routed_to_artist boolean not null default false,
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  status text not null default 'paid',
  created_at timestamptz not null default now()
);

create index if not exists tips_artist_idx on public.tips (artist_id, created_at desc);
create index if not exists tips_recipient_idx on public.tips (recipient_profile_id, created_at desc);
create index if not exists tips_session_idx on public.tips (stripe_session_id);

alter table public.tips enable row level security;

-- Recipient may read their own received tips. All inserts via service role.
drop policy if exists tips_recipient_read on public.tips;
create policy tips_recipient_read on public.tips
  for select using (recipient_profile_id = auth.uid());

-- ===========================================================================
-- 4. LYRICS + CREDITS
-- ===========================================================================
alter table public.tracks
  add column if not exists lyrics text;
alter table public.tracks
  add column if not exists credits_text text;

-- Structured per-line credits (e.g. role = 'Producer', name = 'Jane Doe').
create table if not exists public.track_credits (
  id uuid primary key default gen_random_uuid(),
  track_id integer not null references public.tracks(id) on delete cascade,
  role text not null,
  name text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists track_credits_track_idx
  on public.track_credits (track_id, order_index);

alter table public.track_credits enable row level security;

-- Public may read credits for published tracks; writes go through the
-- service-role studio/admin routes (owner enforced there).
drop policy if exists track_credits_public_read on public.track_credits;
create policy track_credits_public_read on public.track_credits
  for select using (
    exists (
      select 1 from public.tracks t
      where t.id = track_credits.track_id
        and t.is_published = true
    )
  );

-- ===========================================================================
-- 5. REFERRALS
--   referral_codes : one stable code per user (the inviter).
--   referrals      : one row per invited signup; tracks reward state so the
--                    "1 free Superfan month both sides" comp is granted exactly
--                    once, when the invitee's FIRST paid plan activates.
-- ===========================================================================
create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text unique not null,
  created_at timestamptz not null default now()
);

create index if not exists referral_codes_code_idx on public.referral_codes (lower(code));

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  -- The inviter (code owner) and the invited new account.
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  invitee_user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  -- Reward lifecycle: 'pending' at signup -> 'rewarded' once the invitee's
  -- first paid plan activates and both comp months are granted.
  status text not null default 'pending' check (status in ('pending', 'rewarded', 'void')),
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  -- An account can only be referred once.
  constraint referrals_unique_invitee unique (invitee_user_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id);
create index if not exists referrals_status_idx on public.referrals (status);

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;

-- Owner may read their own code; writes via service role.
drop policy if exists referral_codes_owner_read on public.referral_codes;
create policy referral_codes_owner_read on public.referral_codes
  for select using (user_id = auth.uid());

-- A user may read referrals where they are the referrer or the invitee.
drop policy if exists referrals_party_read on public.referrals;
create policy referrals_party_read on public.referrals
  for select using (
    referrer_user_id = auth.uid() or invitee_user_id = auth.uid()
  );
