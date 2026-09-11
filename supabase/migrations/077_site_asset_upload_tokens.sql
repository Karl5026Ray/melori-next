-- One-time upload tokens for site assets (images/site/*).
--
-- WHY: site chrome — the door's header photo, the join-page theme song, the
-- WOE picture — lives in the public `images` bucket under `site/` so it can be
-- swapped without a deploy. Uploading it meant the Supabase dashboard, which
-- only Karl can reach. POST /api/admin/site-asset-upload lets an assistant (or
-- Karl) upload one named file with a token minted here.
--
-- HOW IT STAYS SAFE:
--   * only the SHA-256 of a token is stored; the token itself never touches
--     the repo or the database
--   * each token is bound to ONE exact path, expires, and is single-use (the
--     route claims it atomically by setting used_at)
--   * service role only: RLS on with no policies, and no grants to anon /
--     authenticated
--
-- A token is minted by someone holding database access: generate a random
-- token locally, hash it locally (sha256, hex), and insert only the hash:
--   insert into public.site_asset_upload_tokens (token_hash, path)
--   values ('<sha256 hex of the token>', 'site/melori-theme.mp3');

create table if not exists public.site_asset_upload_tokens (
  token_hash  text primary key,
  path        text not null check (path ~ '^site/[a-z0-9][a-z0-9-]{0,62}\.(mp3|jpg|jpeg|png|webp)$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz
);

alter table public.site_asset_upload_tokens enable row level security;
revoke all on table public.site_asset_upload_tokens from anon, authenticated;

comment on table public.site_asset_upload_tokens is
  'Single-use, path-bound, expiring tokens for POST /api/admin/site-asset-upload. Stores token hashes only. Service role only.';
