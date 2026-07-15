-- 025_humanizer.sql
-- Melori Humanizer: multitrack stem humanization jobs + forensic-resistance
-- access grants. Mirrors the shape described in humanizer_build_spec.md.
--
-- humanize_jobs: one row per "PROCESS ALL STEMS" run. `stems` is a jsonb
-- array of { name, inPath, status, outPath, detection }, updated per-stem by
-- the Python worker (service role — bypasses RLS) as each stem finishes.
--
-- humanizer_access: per-user opt-in flag for the forensic-resistance layer,
-- granted by an admin via /api/admin/humanizer-access. Read-only to the
-- owning user; writes happen via the service-role client from the admin route.

create table if not exists public.humanize_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  preset text not null default 'natural',
  forensic boolean not null default false,
  forensic_intensity text default 'medium',
  blend boolean not null default true,
  stems jsonb not null default '[]'::jsonb,
  master_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.humanize_jobs enable row level security;

create policy "own jobs read"   on public.humanize_jobs for select using (auth.uid() = user_id);
create policy "own jobs insert" on public.humanize_jobs for insert with check (auth.uid() = user_id);
-- service role bypasses RLS for updates from the worker.

-- Keep updated_at fresh on every row change (status transitions, per-stem
-- progress, master_path, etc.) so pollers can cheaply detect "anything new?".
create or replace function public.humanize_jobs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists humanize_jobs_touch_updated_at on public.humanize_jobs;
create trigger humanize_jobs_touch_updated_at
  before update on public.humanize_jobs
  for each row execute function public.humanize_jobs_set_updated_at();

create index if not exists humanize_jobs_user_id_idx on public.humanize_jobs(user_id);
create index if not exists humanize_jobs_status_idx on public.humanize_jobs(status);

create table if not exists public.humanizer_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_forensic boolean not null default false,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.humanizer_access enable row level security;

create policy "own access read" on public.humanizer_access for select using (auth.uid() = user_id);
-- No insert/update policy: grants are written exclusively by the admin route
-- using the service-role client, which bypasses RLS.

alter publication supabase_realtime add table public.humanize_jobs;
