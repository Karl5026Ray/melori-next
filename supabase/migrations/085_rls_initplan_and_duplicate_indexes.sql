-- 085_rls_initplan_and_duplicate_indexes
--
-- Performance only. Nobody gains or loses access to anything in this
-- migration. Two changes:
--
-- 1. RLS InitPlan wrap (71 policies on 2026-09-24)
--    ------------------------------------------------
--    A policy written as `auth.uid() = user_id` makes Postgres call auth.uid()
--    once PER ROW it checks. Written as `(select auth.uid()) = user_id`, the
--    planner evaluates it once per QUERY (an InitPlan) and reuses the value.
--    auth.uid() and auth.role() are STABLE, meaning they return the same
--    value for the whole statement, so both forms give the same answer on
--    every row. Only the cost changes. This is the Supabase advisor
--    "auth_rls_initplan" (lint 0003) and the same convention
--    wrap_auth_calls_in_rls_initplan and 082 already use.
--
--    Done as a loop over pg_policies rather than 71 hand-copied ALTERs: the
--    expressions come straight from the catalog, so there is no chance of a
--    transcription typo silently changing a rule. ALTER POLICY only replaces
--    USING / WITH CHECK. Name, command, roles and PERMISSIVE/RESTRICTIVE are
--    untouched. The loop is idempotent: on a database where everything is
--    already wrapped, it finds nothing to do.
--
--    Verified before and after on production: same policy count (170), same
--    md5 over (table, name, cmd, permissive, roles), and same md5 over the
--    expressions once the wrapper is normalised away.
--
-- 2. Three duplicate indexes (advisor "duplicate_index")
--    ---------------------------------------------------
--    Each pair has byte-identical definitions and neither backs a constraint.
--    The copy dropped is the one with fewer recorded scans, so the index the
--    planner already prefers stays put:
--      follows                  keep follows_following_id_idx            drop idx_follows_following_id
--      notifications            keep notifications_user_recent_idx       drop idx_notifications_user
--      space_comment_reactions  keep idx_space_comment_reactions_comment drop idx_scr_comment

-- Temporary helper, dropped at the end of this migration.
create or replace function public._085_wrap(expr text) returns text
language sql immutable as $f$
  select replace(replace(replace(replace(replace(replace(expr,
           '( SELECT auth.uid() AS uid)',   '@@UID@@'),
           '( SELECT auth.role() AS role)', '@@ROLE@@'),
           'auth.uid()',  '( SELECT auth.uid() AS uid)'),
           'auth.role()', '( SELECT auth.role() AS role)'),
           '@@UID@@',  '( SELECT auth.uid() AS uid)'),
           '@@ROLE@@', '( SELECT auth.role() AS role)')
$f$;

do $$
declare
  p record;
  wrapped_uid  constant text := '( SELECT auth.uid() AS uid)';
  wrapped_role constant text := '( SELECT auth.role() AS role)';
  new_qual  text;
  new_check text;
  stmt      text;
  n         int := 0;
begin
  for p in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and replace(replace(coalesce(qual, '') || coalesce(with_check, ''),
                           wrapped_uid, ''), wrapped_role, '')
           ~ 'auth\.(uid|role)\(\)'
  loop
    -- Protect already-wrapped calls, wrap the bare ones, restore.
    new_qual := public._085_wrap(p.qual);
    new_check := public._085_wrap(p.with_check);

    stmt := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if new_qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;
    execute stmt;
    n := n + 1;
  end loop;
  raise notice '085: wrapped auth calls in % policies', n;
end
$$;

drop function public._085_wrap(text);

drop index if exists public.idx_follows_following_id;
drop index if exists public.idx_notifications_user;
drop index if exists public.idx_scr_comment;
