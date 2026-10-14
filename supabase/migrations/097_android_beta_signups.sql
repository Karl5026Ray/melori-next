-- 097: Android beta signups.
--
-- Google Play closed testing for org.melorimusic.app now uses an EMAIL LIST
-- ("Melori Android Testers") instead of a Google Group. Testers kept failing
-- because joining a Group from a phone is a dead end for most people. The new
-- flow:
--
--   1. A tester leaves the Gmail their Play Store uses at /android
--      (POST /api/android-beta) -> a 'pending' row here.
--   2. An admin copies the pending emails into Play Console -> Testing ->
--      Closed testing -> Testers -> Melori Android Testers.
--   3. The admin clicks one button (/admin/android-testers) that marks those
--      rows 'added', emails each tester the opt-in link and the install link,
--      and marks them 'invited'.
--
-- WHO WRITES THIS TABLE: only our API routes, with the service role. So RLS is
-- on and there are deliberately NO policies for anon or authenticated — not
-- even SELECT. A client write policy on a server-only table is pure attack
-- surface (see tasks/lessons.md, "Data access"), and a client read policy would
-- hand out a list of testers' email addresses.
--
-- Emails are stored lower-cased (enforced by a CHECK) so the unique index is
-- case-insensitive without needing the citext extension.

create table if not exists public.android_beta_signups (
  id          uuid primary key default gen_random_uuid(),
  email       text not null
              check (email = lower(email) and char_length(email) between 3 and 254),
  name        text check (name is null or char_length(name) <= 100),
  country     text check (country is null or char_length(country) <= 80),
  user_id     uuid references auth.users(id) on delete set null,
  status      text not null default 'pending'
              check (status in ('pending', 'added', 'invited', 'removed')),
  created_at  timestamptz not null default now(),
  added_at    timestamptz,
  invited_at  timestamptz,
  source      text check (source is null or char_length(source) <= 64),
  constraint android_beta_signups_email_key unique (email)
);

create index if not exists android_beta_signups_status_idx
  on public.android_beta_signups (status, created_at);
create index if not exists android_beta_signups_user_idx
  on public.android_beta_signups (user_id);

alter table public.android_beta_signups enable row level security;

-- Belt and braces: Supabase grants table privileges to anon/authenticated by
-- default. With RLS on and no policies they can do nothing anyway, but revoking
-- the grants means a future policy added by mistake still cannot open it up.
revoke all on table public.android_beta_signups from anon, authenticated;
