# Publish-First Migration — Runbook (melorimusic.org / melori-next)

Everything in this migration was validated against the **live production database**
inside rolled-back transactions (10/10 automated tests passed) and all TypeScript
files parse cleanly. **No production changes have been applied yet** — this runbook
is the go-live sequence.

Supabase project: `melori-next` (`ouvovhwizsuhjxxmccex`)

---

## What changes (and why it's non-disruptive)

Old flow: artist uploads → `track_submissions (status='pending')` → admin approves →
creates `tracks`/`releases` with `is_published=false` → admin manually publishes.

New flow: artist uploads → `tracks`/`releases` created `is_published=true` instantly →
appears immediately → async `track-cleanup` hook can flag/remove **after** the fact by
setting a **separate** `moderation_status`, never touching `is_published`. Public
visibility = `is_published = true AND moderation_status = 'clean'`.

Key design decision (verified in code): public reads use the **service-role** client
(`getSupabaseAdmin()`), which **bypasses RLS**. So visibility is enforced in two places:
1. **App filter** — every public track query now also filters `moderation_status='clean'`.
2. **RLS** — updated for the anon client used by `useRealtime` (defense-in-depth).

---

## Files in this change set

Database:
- `supabase/migrations/015_publish_first_moderation.sql` — schema, defaults, trigger, RLS, index
- `supabase/migrations/015_rollback.sql` — full reverse
- `supabase/functions/track-cleanup/index.ts` — post-upload moderation hook

App (Next.js on Vercel):
- `src/app/api/artist/tracks/route.ts` — NEW publish-first upload endpoint (replaces POST submissions)
- `src/app/api/internal/revalidate-track/route.ts` — NEW; edge function pings this on takedown
- `src/app/api/admin/moderation/tracks/[id]/route.ts` — NEW manual moderation lever
- `src/app/api/tracks/[id]/route.ts` — PATCHED: `+ .eq('moderation_status','clean')`
- `src/app/api/tracks/[id]/stream/route.ts` — PATCHED: `+ .eq('moderation_status','clean')`
- `src/app/api/releases/[slug]/route.ts` — PATCHED: `+ .eq('moderation_status','clean')`

Frontend TODO (small): point the upload UI at `POST /api/artist/tracks` instead of
`POST /api/artist/submissions`, and remove the "awaiting approval" state. The old
submissions routes can stay for history.

---

## Go-live sequence

### 1. Environment variables
Supabase Edge Function secrets (`track-cleanup`):
- `CLEANUP_WEBHOOK_SECRET` — random string; also set as the webhook header (step 3)
- `VERCEL_REVALIDATE_URL` = `https://<your-domain>/api/internal/revalidate-track`
- `REVALIDATE_SECRET` — random string (also add to Vercel env)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — auto-injected in edge runtime

Vercel env:
- `REVALIDATE_SECRET` — same value as above

### 2. Apply the DB migration
Run `015_publish_first_moderation.sql` (via Supabase SQL editor, CLI, or apply_migration).
Then backfill any legitimately-hidden existing track if desired:
```sql
UPDATE public.tracks SET is_published = true
  WHERE is_published = false AND moderation_status = 'clean';
```

### 3. Deploy the edge function + webhook
- Deploy `track-cleanup` with `verify_jwt = false` (DB webhooks send no user JWT; it uses the shared secret).
- Create a Database Webhook: table `public.tracks`, event `INSERT`, type HTTP POST →
  the function URL, with header `x-cleanup-secret: <CLEANUP_WEBHOOK_SECRET>`.

### 4. Deploy the app
- Ship the new/patched routes to a Vercel **preview** first.
- Smoke test: upload as an artist → track appears immediately on `/browse` and the
  artist page; call the admin moderation route to set `removed` → it disappears; set
  back to `clean` → it returns. Confirm `is_published` never changed.

### 5. Promote to production
Merge to `main`, deploy, then repeat one real smoke test on prod.

### 6. Monitor (48h)
- `select * from public.audit_logs where action like 'track_moderation%' order by created_at desc;`
- Supabase edge function logs for `track-cleanup`.
- Re-run the security advisor; the new trigger is hardened (`SET search_path = ''`) so it
  won't add a `function_search_path_mutable` warning.

## Rollback
- App: redeploy previous Vercel build.
- DB: run `015_rollback.sql` (restores `is_published DEFAULT false`, original RLS, drops trigger/index).
  New moderation columns are harmless to keep; a commented block removes them if you want a clean revert.

## Test evidence (dry-run against prod, rolled back)
| Test | Result |
|---|---|
| New track defaults `is_published=true` | PASS |
| New track defaults `moderation_status='clean'` | PASS |
| `published_at` auto-stamped on insert | PASS |
| Takedown preserves `is_published` | PASS |
| Removed track excluded by public filter | PASS |
| Restore re-shows track (one-field revert) | PASS |
| Invalid `moderation_status` rejected by CHECK | PASS |
| Existing 278 clean+published still visible (no regression) | PASS |
| `auto_published` submission status accepted | PASS |
| Both RLS policies present as intended | PASS |
| Hardened trigger works with empty search_path | PASS |
