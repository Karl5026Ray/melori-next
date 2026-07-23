/**
 * One-time backfill: generate poster thumbnails for existing reels that have
 * no `thumbnail_url`.
 *
 * Why: `social_videos` rows created before client-side poster capture landed
 * (PR #194) have `thumbnail_url = null`. The profile/feed grids can render a
 * `<video>` first-frame fallback, but a stored JPEG poster is lighter (grids
 * no longer need to open the video at all) and lets the modal use a real
 * `poster`. This script closes that gap for pre-existing rows.
 *
 * What it does, per video row missing a thumbnail:
 *   1. Downloads a small byte-range from the public video URL (enough for the
 *      moov/first frames) — full download is avoided where possible.
 *   2. Extracts one poster frame at ~0.1s with ffmpeg (scaled to max 720px
 *      wide, JPEG q=3).
 *   3. Uploads it to the `covers` bucket under social/{user_id}/… (the same
 *      bucket + namespace the live upload path uses).
 *   4. Updates social_videos.thumbnail_url with the public URL.
 *
 * Only `media_type = 'video'` rows are touched; audio posts don't need a frame.
 * Idempotent: rows that already have a thumbnail_url are skipped, so it's safe
 * to re-run.
 *
 * Run from the repo root with real env (service role key):
 *   npx tsx scripts/backfill-reel-thumbnails.ts            # process all
 *   npx tsx scripts/backfill-reel-thumbnails.ts --dry-run  # list only
 *   npx tsx scripts/backfill-reel-thumbnails.ts --limit 5  # cap count
 *
 * Reads env from process.env and, if present, from a local .env.local file so
 * it works the same way `next dev` does. NEVER commit .env.local.
 *
 * Required env:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Requires ffmpeg on PATH.
 */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const COVERS_BUCKET = "covers";
const MAX_WIDTH = 720;

function loadDotEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* no .env.local — rely on process.env */
  }
}

type VideoRow = {
  id: string;
  user_id: string;
  title: string | null;
  video_url: string;
  thumbnail_url: string | null;
  media_type: string | null;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limIdx = args.indexOf("--limit");
  const limit =
    limIdx !== -1 && args[limIdx + 1] ? Number(args[limIdx + 1]) : undefined;
  return { dryRun, limit };
}

function ffmpegHasSupport(): boolean {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return r.status === 0;
}

/**
 * Extract a single poster frame. ffmpeg reads the input URL directly (it does
 * HTTP range requests internally, so it does not pull the whole file just to
 * grab an early frame). Returns the JPEG bytes, or null on any failure.
 */
function extractPoster(videoUrl: string, workDir: string): Buffer | null {
  const outPath = join(workDir, "poster.jpg");
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss", "0.1", // seek before decode → fast, avoids a black lead frame
      "-i", videoUrl,
      "-frames:v", "1",
      "-vf", `scale='min(${MAX_WIDTH},iw)':-2`,
      "-q:v", "3",
      outPath,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (r.status !== 0) {
    console.error(`    ffmpeg failed: ${(r.stderr || "").split("\n").slice(-3).join(" ")}`);
    return null;
  }
  try {
    return readFileSync(outPath);
  } catch {
    return null;
  }
}

async function main() {
  loadDotEnvLocal();

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing env. Need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }
  if (!ffmpegHasSupport()) {
    console.error("ffmpeg not found on PATH.");
    process.exit(1);
  }

  const { dryRun, limit } = parseArgs();
  const supabase: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let q = supabase
    .from("social_videos")
    .select("id, user_id, title, video_url, thumbnail_url, media_type")
    .is("thumbnail_url", null)
    .eq("media_type", "video")
    .order("created_at", { ascending: true });
  if (limit) q = q.limit(limit);

  const { data, error } = await q;
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as VideoRow[];

  console.log(
    `Found ${rows.length} video reel(s) with no thumbnail${limit ? ` (limited to ${limit})` : ""}.`,
  );
  if (rows.length === 0) {
    console.log("Nothing to backfill. ✅");
    return;
  }
  if (dryRun) {
    for (const r of rows) {
      console.log(`  [dry-run] ${r.id}  "${r.title ?? "(untitled)"}"  ${r.video_url}`);
    }
    console.log("Dry run only — no changes made.");
    return;
  }

  const workDir = mkdtempSync(join(tmpdir(), "reel-thumbs-"));
  let ok = 0;
  let failed = 0;

  try {
    for (const r of rows) {
      const label = `${r.id} "${r.title ?? "(untitled)"}"`;
      if (!r.video_url) {
        console.log(`  ✗ ${label} — no video_url, skipping`);
        failed++;
        continue;
      }
      console.log(`  → ${label}`);

      const jpeg = extractPoster(r.video_url, workDir);
      if (!jpeg || jpeg.length === 0) {
        console.log("    ✗ could not extract a frame");
        failed++;
        continue;
      }

      const path = `social/${r.user_id}/${Date.now()}_${r.id}_poster.jpg`;
      const { error: upErr } = await supabase.storage
        .from(COVERS_BUCKET)
        .upload(path, jpeg, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (upErr) {
        console.log(`    ✗ upload failed: ${upErr.message}`);
        failed++;
        continue;
      }

      const { data: pub } = supabase.storage
        .from(COVERS_BUCKET)
        .getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { error: updErr } = await supabase
        .from("social_videos")
        .update({ thumbnail_url: publicUrl })
        .eq("id", r.id)
        .is("thumbnail_url", null); // guard against races / re-runs
      if (updErr) {
        console.log(`    ✗ row update failed: ${updErr.message}`);
        failed++;
        continue;
      }

      console.log(`    ✓ thumbnail set (${(jpeg.length / 1024).toFixed(0)} KB)`);
      ok++;
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(`\nDone. ${ok} updated, ${failed} failed, ${rows.length} total.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
