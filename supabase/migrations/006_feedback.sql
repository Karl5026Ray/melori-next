-- Feedback / "Help us improve" submissions from the About (Mission) page.
-- Open to any visitor via the /api/feedback route, which inserts using the
-- service role key. Validation and anti-spam are enforced in the API layer.

create table if not exists public.feedback (
id uuid primary key default gen_random_uuid(),
name text not null,
email text not null,
comment text not null,
source text,
user_agent text,
created_at timestamptz not null default now()
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_email_idx on public.feedback (email);

-- Lock the table down. The API uses the service role key, which bypasses RLS,
-- so no policies are granted to anon/authenticated. Nobody can read or write
-- this table directly from the client.
alter table public.feedback enable row level security;
