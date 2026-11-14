-- 103: Open letter signatures (/open-letter).
--
-- Karl's open letter to Congress, "The Citizen Accountability Clause": let a
-- U.S. citizen with a pending fiance(e) or spousal petition sign a binding
-- guarantee so their partner can visit while the case is processed. Visitors
-- read the letter for free, sign with first name + city/state + email, and are
-- then invited into an MM Spaces room to talk about it.
--
-- PRIVACY: many signers have a partner in an open immigration case. We collect
-- the minimum (no partner names, no case numbers), never show names publicly,
-- and only ever publish the COUNT. Karl delivers signatures to lawmakers.
--
-- WHO WRITES THIS TABLE: only POST /api/open-letter, with the service role. RLS
-- is on with NO policies for anon or authenticated, same as migration 097
-- (android_beta_signups) — a client read policy would hand out a list of
-- emails of people in immigration cases.
--
-- Emails are stored lower-cased (CHECK) so the unique index is
-- case-insensitive: one signature per email, a repeat submit updates the row.

create table if not exists public.open_letter_signatures (
  id           uuid primary key default gen_random_uuid(),
  letter       text not null default 'citizen-accountability-clause'
               check (char_length(letter) between 1 and 64),
  email        text not null
               check (email = lower(email) and char_length(email) between 3 and 254),
  first_name   text not null check (char_length(first_name) between 1 and 60),
  city_state   text not null check (char_length(city_state) between 2 and 100),
  has_partner_in_process boolean not null default false,
  story        text check (story is null or char_length(story) <= 1000),
  user_id      uuid references auth.users(id) on delete set null,
  source       text check (source is null or char_length(source) <= 64),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint open_letter_signatures_letter_email_key unique (letter, email)
);

create index if not exists open_letter_signatures_letter_idx
  on public.open_letter_signatures (letter, created_at);
create index if not exists open_letter_signatures_user_idx
  on public.open_letter_signatures (user_id);

alter table public.open_letter_signatures enable row level security;

-- Belt and braces, as in 097: revoke the default grants so a policy added by
-- mistake later still cannot open the table to clients.
revoke all on table public.open_letter_signatures from anon, authenticated;
