# Content Moderation — Resume Checkpoint (July 13, 2026)

## Where we are
Switched the moderation backend from OpenAI to **Cloudflare Workers AI** (no OpenAI
account needed — uses your Cloudflare). Backend code rewritten. Credentials obtained.
Adding them to Vercel was IN PROGRESS when we paused.

## Credentials (already obtained)
- **CLOUDFLARE_ACCOUNT_ID** = `4fb48cc9b7f72277797101a1ea108437`
- **CLOUDFLARE_AI_TOKEN** = `cfut_MqDNcBcaIq2ffqnVTpcb49ztG1gH707JPRf2CV8k6935d6ac`
  - (Workers AI scoped token, created in Cloudflare dashboard. Shown once — saved here.)
- These two must live in **Vercel → melori-next → Env Vars (Production)** for the live app.

## DONE this session
1. Shipped earlier (committed d9d7640): full moderation pipeline w/ OpenAI backend —
   tables, admin queue, reporting, wiring, dashboard link, ReportButton on gallery tiles.
2. Migration 019 APPLIED to Supabase (project ouvovhwizsuhjxxmccex). Verified:
   content_moderation + content_reports tables exist; moderation_status columns on
   messages/community_comments/profile_gallery + bio_moderation_status on profiles.
3. **REWROTE `src/lib/moderation.ts`** to use Cloudflare Workers AI instead of OpenAI:
   - TEXT: `@cf/meta/llama-guard-3-8b` (Llama Guard 3). S4/S12 (child-sexual/sexual)
     -> quarantine; other unsafe categories -> flag.
   - IMAGE: `@cf/llava-hf/llava-1.5-7b-hf` vision model asked EXPLICIT/SUGGESTIVE/CLEAN.
     EXPLICIT -> quarantine, SUGGESTIVE -> flag. (Cloudflare has NO dedicated NSFW
     classifier — this is best-effort; report+admin is the backstop.)
   - Reads env: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`. Fail-safe: missing/err/
     timeout(8s) -> {decision:"clean", degraded:true} (never blocks on misconfig).
   - Same exported interface (moderateText/moderateImage/moderateTextAndImage/
     statusForDecision/moderationEnabled) so NO other file needed changes.
   - This file is EDITED but NOT yet committed.

## REMAINING STEPS (in order) to finish
1. **Finish adding both env vars to Vercel** (browser task was running at pause).
   Verify CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN present, Production scope.
2. **Typecheck + build**: `cd /home/user/workspace/melori-next && node_modules/.bin/tsc --noEmit`
   (expect 0), then `node_modules/.bin/next build` (expect exit 0).
3. **Commit + push** the moderation.ts rewrite:
   `git config user.email "karlrayphotography@gmail.com"; git config user.name "Karl5026Ray"`
   commit, `git push origin main` with `api_credentials=["github"]`.
   (Push triggers Vercel auto-deploy, ~155s.)
4. **Validate live** after deploy: content still publishes; try a test with an
   obviously-flaggable text via the app, or trust the fail-safe. APIs 401 w/o auth = OK.
5. Delete this resume file once confirmed live.

## Notes / decisions
- Owner policy: pornography/nudity -> QUARANTINE (never public); explicit music /
  borderline sexual imagery -> FLAG for admin review; clean -> publishes.
- Keep Melori orange (#ff5500) — admin page + ReportButton already styled.
- "Smartest AI in the room" rule honored: fact-checked Cloudflare model catalog;
  confirmed no dedicated NSFW image model exists, chose LlamaGuard(text)+LLaVA(image)
  and told the user the image-detection caveat before building.
- Vercel: project melori-next, org melori. Auto-deploys on push to main.
