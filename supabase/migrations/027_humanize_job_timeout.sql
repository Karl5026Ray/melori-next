-- 027_humanize_job_timeout.sql
-- =============================================================================
-- Melori Humanizer: auto-fail jobs that get stuck.
--
-- If the worker dies mid-job (e.g. the Fly machine is stopped before it can
-- write a terminal status), the row stays 'pending'/'processing' forever and
-- the Studio UI spins indefinitely. This sweeps any such job older than a
-- timeout into 'failed' with a clear message, so the UI resolves on its own.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace function public.fail_stuck_humanize_jobs(stuck_minutes int default 10)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int := 0;
begin
  update public.humanize_jobs
     set status = 'failed',
         error = coalesce(
           nullif(error, ''),
           'Timed out — worker did not finish within ' || stuck_minutes ||
           ' minutes. It may have been interrupted; please re-run.'
         ),
         updated_at = now()
   where status in ('pending', 'processing')
     and updated_at < now() - make_interval(mins => stuck_minutes);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function public.fail_stuck_humanize_jobs(int) is
  'Marks humanize_jobs stuck in pending/processing longer than stuck_minutes as failed so the Studio UI stops spinning. Called every 5 min by cron job humanize-job-timeout.';

-- Run every 5 minutes so a stuck job resolves quickly (a 10-min-old job is
-- caught within ~5 min of crossing the threshold). Unschedule any prior copy
-- first to stay idempotent.
do $$
begin
  perform cron.unschedule('humanize-job-timeout')
  where exists (select 1 from cron.job where jobname = 'humanize-job-timeout');
end $$;

select cron.schedule(
  'humanize-job-timeout',
  '*/5 * * * *',
  $$select public.fail_stuck_humanize_jobs(10);$$
);
