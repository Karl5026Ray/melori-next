/**
 * Find (and optionally delete) ORPHANED Melori Mirror live recordings left in
 * the old PUBLIC bucket.
 *
 * Why: until migration 086, LiveKit egress wrote every live recording into the
 * public social-videos bucket under mirror-live/<room>/<stamp>.mp4, and "Not
 * now" never deleted anything. So every recording a host declined to post is
 * still sitting there, reachable by URL. New recordings go to the private
 * mirror-recordings bucket; this script cleans up the legacy ones.
 *
 * An object is an orphan when NO social_videos post references it (posted
 * recordings are what the feed plays — never touched) and no space is still
 * recording into it.
 *
 * DEFAULT IS A DRY RUN: prints the count + total size and the first few keys.
 * It deletes ONLY with an explicit --delete flag.
 *
 *   npx tsx scripts/mirror-orphans.ts                 # dry run (list only)
 *   npx tsx scripts/mirror-orphans.ts --verbose       # dry run, every key
 *   npx tsx scripts/mirror-orphans.ts --delete        # actually delete
 *   npx tsx scripts/mirror-orphans.ts --bucket other  # override bucket
 *
 * Required env (process.env, or a local .env.local):
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 * Bucket defaults to STORAGE_S3_BUCKET, else "social-videos".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  MIRROR_LIVE_PREFIX,
  findOrphans,
  formatBytes,
  publicVideoBucket,
  type StorageObjectLite,
} from "../src/lib/mirrorRecording";

const PAGE = 1000;

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

function parseArgs() {
  const args = process.argv.slice(2);
  const bIdx = args.indexOf("--bucket");
  return {
    doDelete: args.includes("--delete"),
    verbose: args.includes("--verbose"),
    bucket: bIdx !== -1 && args[bIdx + 1] ? args[bIdx + 1] : publicVideoBucket(),
  };
}

async function listAll(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<{ name: string; id: string | null; metadata: Record<string, unknown> | null }[]> {
  const out: { name: string; id: string | null; metadata: Record<string, unknown> | null }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    const rows = data ?? [];
    out.push(...(rows as typeof out));
    if (rows.length < PAGE) return out;
  }
}

// mirror-live/<room>/<stamp>.mp4 — two levels. Folders come back with id null.
async function listRecordings(supabase: SupabaseClient, bucket: string): Promise<StorageObjectLite[]> {
  const objects: StorageObjectLite[] = [];
  const rooms = await listAll(supabase, bucket, MIRROR_LIVE_PREFIX);
  for (const room of rooms) {
    const roomPrefix = `${MIRROR_LIVE_PREFIX}/${room.name}`;
    if (room.id) {
      // A file directly under mirror-live/ (shouldn't happen, but count it).
      objects.push({ key: roomPrefix, size: Number(room.metadata?.size ?? 0) });
      continue;
    }
    for (const f of await listAll(supabase, bucket, roomPrefix)) {
      if (!f.id) continue;
      objects.push({ key: `${roomPrefix}/${f.name}`, size: Number(f.metadata?.size ?? 0) });
    }
  }
  return objects;
}

async function referencedVideoUrls(supabase: SupabaseClient): Promise<string[]> {
  const urls: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("social_videos")
      .select("video_url")
      .like("video_url", `%/${MIRROR_LIVE_PREFIX}/%`)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`social_videos: ${error.message}`);
    const rows = (data ?? []) as { video_url: string | null }[];
    for (const r of rows) if (r.video_url) urls.push(r.video_url);
    if (rows.length < PAGE) return urls;
  }
}

async function inProgressKeys(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("spaces")
    .select("recording_storage_key")
    .eq("is_recording", true);
  if (error) throw new Error(`spaces: ${error.message}`);
  return ((data ?? []) as { recording_storage_key: string | null }[])
    .map((r) => r.recording_storage_key)
    .filter((k): k is string => !!k);
}

async function main() {
  loadDotEnvLocal();
  const { doDelete, verbose, bucket } = parseArgs();

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing env. Need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  console.log(`Scanning ${bucket}/${MIRROR_LIVE_PREFIX}/ …`);
  const [objects, refs, live] = await Promise.all([
    listRecordings(supabase, bucket),
    referencedVideoUrls(supabase),
    inProgressKeys(supabase),
  ]);
  const orphans = findOrphans(objects, refs, live);
  const total = orphans.reduce((n, o) => n + o.size, 0);

  console.log(`  recordings found:     ${objects.length}`);
  console.log(`  posted (kept):        ${objects.length - orphans.length}`);
  console.log(`  ORPHANED:             ${orphans.length}  (${formatBytes(total)})`);
  const shown = verbose ? orphans : orphans.slice(0, 10);
  for (const o of shown) console.log(`    ${o.key}  ${formatBytes(o.size)}`);
  if (shown.length < orphans.length) console.log(`    … and ${orphans.length - shown.length} more (--verbose)`);

  if (!doDelete) {
    console.log("\nDry run — nothing deleted. Re-run with --delete to remove the orphans above.");
    return;
  }
  if (orphans.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  let deleted = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const batch = orphans.slice(i, i + 100).map((o) => o.key);
    const { data, error } = await supabase.storage.from(bucket).remove(batch);
    if (error) {
      console.error(`  delete batch failed: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    deleted += data?.length ?? 0;
  }
  console.log(`\nDeleted ${deleted} of ${orphans.length} orphaned recording(s).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
