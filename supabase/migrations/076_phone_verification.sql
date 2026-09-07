-- Phone verification for the door.
--
-- Two columns on profiles and one attempts table. Deliberately additive: no
-- drops, no type changes, nothing that needs a backfill window.
--
-- GRANDFATHERING. Every profile that exists when this runs gets
-- phone_verified_at backfilled from created_at. Without that, turning the gate
-- on would instantly lock out all 132 existing accounts, none of which has a
-- phone number on file. Only signups after this migration are asked to verify.

alter table public.profiles
  add column if not exists phone text,
  add column if not exists phone_verified_at timestamptz;

comment on column public.profiles.phone is
  'E.164 mobile number collected at signup. Never shown on a public profile.';
comment on column public.profiles.phone_verified_at is
  'When the number passed SMS verification. Backfilled from created_at for accounts predating migration 076 so the gate never locks out an existing member.';

update public.profiles
   set phone_verified_at = created_at
 where phone_verified_at is null;

-- One verified account per number. Unverified rows are exempt so a typo does
-- not permanently burn a number for the person who actually owns it.
create unique index if not exists profiles_verified_phone_unique
  on public.profiles (phone)
  where phone is not null and phone_verified_at is not null;

-- ---------------------------------------------------------------------------
-- Attempt ledger. This is the rate limiter's storage, not analytics.
--
-- src/lib/rate-limit.ts is an in-process token bucket and says so in its own
-- comments: Vercel spins up many lambdas, so an attacker fans out across
-- containers and walks straight past it. That is acceptable for a contact
-- form. It is not acceptable for an endpoint where each call sends an SMS and
-- costs money.
-- ---------------------------------------------------------------------------

create table if not exists public.phone_verification_attempts (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete cascade,
  phone       text not null,
  ip          text,
  kind        text not null check (kind in ('start', 'check')),
  succeeded   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists phone_verification_attempts_phone_idx
  on public.phone_verification_attempts (phone, created_at desc);
create index if not exists phone_verification_attempts_ip_idx
  on public.phone_verification_attempts (ip, created_at desc);
create index if not exists phone_verification_attempts_profile_idx
  on public.phone_verification_attempts (profile_id, created_at desc);

-- Service role only. No policies are defined, so RLS denies anon and
-- authenticated outright while the service-role key used by the API routes
-- bypasses it.
alter table public.phone_verification_attempts enable row level security;

comment on table public.phone_verification_attempts is
  'Rate-limit ledger for SMS verification. Written by /api/auth/phone/*. Service role only.';
