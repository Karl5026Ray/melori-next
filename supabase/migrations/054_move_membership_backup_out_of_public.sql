-- 054_move_membership_backup_out_of_public.sql
--
-- Moves the 2026-08-02 membership snapshot out of the PostgREST-exposed
-- `public` schema.
--
-- WHY: the Supabase security linter flagged this table as
-- rls_disabled_in_public (lint 0013). On inspection the exposure was worse
-- than read-only — `anon` and `authenticated` both held
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE, and RLS was off. Any unauthenticated
-- caller could read all 157 membership rows through /rest/v1/, and could also
-- have deleted or truncated them.
--
-- WHY MOVE RATHER THAN JUST ENABLE RLS: an RLS-enabled table with no policy is
-- still listed in the API surface and still relies on the grant model being
-- right forever. A backup snapshot has no business being reachable from the
-- REST API at all, so the fix is to take it off that surface entirely. `public`
-- is for things the app serves; snapshots are not that.
--
-- DATA IS PRESERVED. This relocates the table; it does not drop it. The rows
-- remain fully available to the service role and the SQL editor.
--
-- Reverse with:
--   alter table backups.profiles_membership_backup_20260802 set schema public;

create schema if not exists backups;

comment on schema backups is
  'Point-in-time data snapshots. NOT exposed to PostgREST. Never add this schema to the API exposed-schemas list.';

-- Revoke BEFORE the move, so the grants cannot travel with the table and leave
-- a window where it is relocated but still world-writable.
revoke all on public.profiles_membership_backup_20260802 from anon, authenticated, public;

-- Second layer: deny the schema itself to the API roles. Even if `backups` were
-- one day added to the exposed-schemas list by mistake, anon cannot enter it.
revoke all on schema backups from anon, authenticated, public;
grant usage on schema backups to postgres, service_role;

alter table public.profiles_membership_backup_20260802 set schema backups;

-- Belt and braces: keep RLS on even though the table is off the API surface,
-- so any future exposure fails closed instead of open.
alter table backups.profiles_membership_backup_20260802 enable row level security;

-- Default-deny anything added to this schema later, so the next snapshot does
-- not repeat the original mistake.
alter default privileges in schema backups revoke all on tables from anon, authenticated, public;

comment on table backups.profiles_membership_backup_20260802 is
  'Snapshot of public.profiles membership columns taken 2026-08-02. Moved out of public on 2026-08-04: it had RLS disabled and anon held full DML, exposing all rows via PostgREST.';
