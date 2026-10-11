// Applies migration 094 to a stub of the live schema (same policies/constraints
// as production, read 11 Oct) and checks the RLS outcomes.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const migration = readFileSync(process.argv[2], "utf8");

await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth; create schema storage;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table public.profiles (id uuid primary key);
create table public.spaces (
  id uuid primary key default gen_random_uuid(), title text not null, topic text not null default '',
  type text not null default 'listening', status text not null default 'live',
  host_id uuid not null references public.profiles(id) on delete cascade,
  room_format text, created_at timestamptz default now());
alter table public.spaces add constraint spaces_room_format_check check (room_format = any (array[
  'release_party','versus_battle','discussion','dj_set','live_solo','live_duo','live_group','cinema']));
create table public.space_participants (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'audience', badge text, left_at timestamptz,
  unique (space_id, user_id));
alter table public.spaces enable row level security;
alter table public.space_participants enable row level security;
create policy "Hosts manage spaces" on public.spaces for all
  using ((select auth.uid()) = host_id) with check ((select auth.uid()) = host_id);
create policy "Spaces viewable by everyone" on public.spaces for select using (true);
create policy "Participants viewable by all" on public.space_participants for select using (true);
create policy "Users can join spaces" on public.space_participants for insert
  with check ((select auth.uid()) = user_id);
create policy "Users update own participation" on public.space_participants for update
  using ((select auth.uid()) = user_id);
grant usage on schema public to anon, authenticated;
grant select, insert, update on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant select on tables to anon, authenticated;
`);

await db.exec(migration);
await db.exec(`grant select on all tables in schema public to anon, authenticated;`);

const H = "00000000-0000-0000-0000-00000000000a"; // director
const A = "00000000-0000-0000-0000-00000000000b"; // admitted actor
const L = "00000000-0000-0000-0000-00000000000c"; // lobby actor
const X = "00000000-0000-0000-0000-00000000000d"; // stranger
await db.exec(`
insert into public.profiles values ('${H}'),('${A}'),('${L}'),('${X}');
insert into public.spaces (id,title,host_id,room_format) values
  ('10000000-0000-0000-0000-000000000001','open space','${H}','discussion');
insert into public.spaces (id,title,host_id,room_format,is_private) values
  ('20000000-0000-0000-0000-000000000002','private audition','${H}','audition',true);
insert into public.space_participants (space_id,user_id,role) values
  ('10000000-0000-0000-0000-000000000001','${A}','speaker'),
  ('20000000-0000-0000-0000-000000000002','${A}','speaker');
insert into public.space_access (space_id,user_id,status) values
  ('20000000-0000-0000-0000-000000000002','${A}','admitted'),
  ('20000000-0000-0000-0000-000000000002','${L}','lobby');
insert into public.space_invite_codes values ('20000000-0000-0000-0000-000000000002','ABCD2345');
insert into public.audition_files (space_id,owner_id,kind,storage_path) values
  ('20000000-0000-0000-0000-000000000002','${H}','script','p/s.pdf'),
  ('20000000-0000-0000-0000-000000000002','${A}','headshot','p/a.jpg'),
  ('20000000-0000-0000-0000-000000000002','${L}','headshot','p/l.jpg');
`);

let failures = 0;
async function as(role, uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}
function expect(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
}
const n = async (role, uid, sql) => Number((await as(role, uid, sql))[0].n);

expect("anon sees only the open room", await n("anon", null, "select count(*) n from spaces"), 1);
expect("stranger sees only the open room", await n("authenticated", X, "select count(*) n from spaces"), 1);
expect("lobby actor sees the private room row", await n("authenticated", L, "select count(*) n from spaces"), 2);
expect("director sees both", await n("authenticated", H, "select count(*) n from spaces"), 2);
expect("anon roster: open room only", await n("anon", null, "select count(*) n from space_participants"), 1);
expect("lobby actor cannot see private roster", await n("authenticated", L, "select count(*) n from space_participants"), 1);
expect("admitted actor sees private roster", await n("authenticated", A, "select count(*) n from space_participants"), 2);

let blocked = false;
try { await as("authenticated", X, `insert into space_participants (space_id,user_id) values ('20000000-0000-0000-0000-000000000002','${X}')`); }
catch { blocked = true; }
expect("stranger cannot self-insert into private room", blocked, true);
let allowed = true;
try { await as("authenticated", X, `insert into space_participants (space_id,user_id) values ('10000000-0000-0000-0000-000000000001','${X}')`); }
catch (e) { allowed = false; console.log(e.message); }
expect("stranger can still join an open Space", allowed, true);

expect("code: host only (host)", await n("authenticated", H, "select count(*) n from space_invite_codes"), 1);
expect("code: host only (admitted actor)", await n("authenticated", A, "select count(*) n from space_invite_codes"), 0);
expect("files: director sees all 3", await n("authenticated", H, "select count(*) n from audition_files"), 3);
expect("files: admitted actor sees script + own headshot", await n("authenticated", A, "select count(*) n from audition_files"), 2);
expect("files: lobby actor sees only own headshot", await n("authenticated", L, "select count(*) n from audition_files"), 1);
expect("access: lobby actor sees only own row", await n("authenticated", L, "select count(*) n from space_access"), 1);
expect("access: director sees all rows", await n("authenticated", H, "select count(*) n from space_access"), 2);
expect("recordings: stranger none", await n("authenticated", X, "select count(*) n from audition_recordings"), 0);

let bad = false;
try { await db.exec(`insert into audition_files (space_id,owner_id,kind,storage_path) values ('20000000-0000-0000-0000-000000000002','${A}','reel','x.mp4')`); }
catch { bad = true; }
expect("reel upload refused (links only)", bad, true);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
