/* eslint-disable no-console */
//
// scripts/import-library.ts
//
// IDEMPOTENT LIBRARY IMPORTER for the public catalog (`releases` + `tracks`).
//
// Point it at a folder of albums and it inserts ONLY what is missing. Running
// it twice is a no-op: the second run reports every track as already present
// and writes nothing. That is the whole reason this exists — re-uploading the
// library through the admin UI would happily create a second copy of all 62
// releases and ~300 tracks, because nothing in the app dedupes on title.
//
// EXPECTED LAYOUT — one folder per album, one audio file per track:
//
//   MyLibrary/
//     Morning Light/
//       01 - Beholder.mp3
//       05 - Fight For You.mp3
//       06 Baby Boo.wav
//     Your Grace is Where I Stand/
//       03 - My Victory.mp3
//
// The leading number becomes `track_number`; the rest becomes the title. A file
// with no leading number is appended after the highest existing track number.
// Accepts .mp3 / .wav / .flac / .m4a / .aac / .ogg.
//
// ALBUM MATCHING — the folder name is matched against existing releases by slug
// first, then by normalized title. Unmatched folders are reported and skipped
// unless --create-albums is passed, which creates the release row (no cover
// art; set that in /admin/releases afterwards).
//
// SKIP RULES — a track is skipped when the release already has a track whose
// normalized title matches (case, punctuation, apostrophes and "feat." parts
// are ignored). If the requested track number is taken by a DIFFERENT song, the
// track is still imported but lands at the next free number and is flagged, so
// a numbering disagreement never silently overwrites a real song.
//
// SAFETY — dry run by default. Nothing is uploaded or written without --apply.
// Uploads go to the private `audio-files` bucket exactly like the admin route
// (`<epoch>_<sanitized-filename>`), and `tracks.audio_url` stores that path,
// not a URL. If the DB insert fails after a successful upload, the uploaded
// object is deleted again so storage never accumulates orphans.
//
// DURATION — read with `ffprobe` when it is on PATH; otherwise left null and
// reported, since the app tolerates a null duration (it just shows no runtime).
//
// USAGE
//   npx tsx scripts/import-library.ts ~/MyLibrary                    # dry run
//   npx tsx scripts/import-library.ts ~/MyLibrary --apply
//   npx tsx scripts/import-library.ts ~/MyLibrary --only "Morning Light"
//   npx tsx scripts/import-library.ts ~/MyLibrary --artist "Karl Ray" --create-albums --apply
//   npx tsx scripts/import-library.ts ~/MyLibrary --json report.json
//
// Also available as: npm run import:library -- ~/MyLibrary
//
// REQUIRES  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
//           SUPABASE_SERVICE_ROLE_KEY — read from the environment or .env.local.

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- env loading

// Minimal .env.local reader. tsx does not load Next's env files, and pulling in
// dotenv just for this script is not worth a dependency. Existing process env
// always wins so CI/one-off overrides work.
function loadDotEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// ------------------------------------------------------------------- CLI args

interface Args {
  dir: string;
  apply: boolean;
  createAlbums: boolean;
  artist: string | null;
  only: string | null;
  json: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    dir: "",
    apply: false,
    createAlbums: false,
    artist: null,
    only: null,
    json: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--create-albums") out.createAlbums = true;
    else if (a === "--artist") out.artist = argv[++i] ?? null;
    else if (a === "--only") out.only = argv[++i] ?? null;
    else if (a === "--json") out.json = argv[++i] ?? null;
    else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else if (!out.dir) out.dir = a;
  }
  return out;
}

// ------------------------------------------------------------------- matching

const AUDIO_EXT = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"]);

const CONTENT_TYPE: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
};

// The comparison key for "is this song already here?". Deliberately lossy:
// case, punctuation, apostrophes, accents, featured-artist tails and leading
// articles all vanish, so "Let's Try it again" and "Lets Try Again" collide —
// which is what we want, because they are the same recording.
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Apostrophes are DELETED, not turned into a separator, so "Let's" and
    // "Lets" collapse to the same key. Mapping them to a space instead would
    // yield "let s" vs "lets" and the importer would insert a duplicate.
    .replace(/['\u2018\u2019\u02bc`]/g, "")
    .replace(/\b(feat|ft|featuring|with)\b[^)\]]*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^\s*the\s+/, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Underscores are treated as word separators throughout, because exports from
// most DAWs and every "download all" zip arrive as My_Baby_Boo.mp3 rather than
// "My Baby Boo.mp3". They become spaces in the stored title.
function tidyTitle(s: string): string {
  return s.replace(/_+/g, " ").trim().replace(/\s+/g, " ");
}

// "07 - Get You On This Flight.mp3" → { number: 7,    title: "Get You On This Flight" }
// "07_Get_You_On_This_Flight.mp3"   → { number: 7,    title: "Get You On This Flight" }
// "Baby_Boo.wav"                    → { number: null, title: "Baby Boo" }
//
// The number is only consumed when a separator follows it, so "1999.mp3" keeps
// its title intact. Caveat: a title that genuinely opens with a number and a
// separator — "24_7 Love" — will read as track 24 titled "7 Love". Rename those
// few by hand, or let the dry run show you before anything is written.
export function parseFilename(file: string): {
  number: number | null;
  title: string;
} {
  const base = file.slice(0, file.length - path.extname(file).length);
  const m = base.match(/^\s*(\d{1,3})\s*(?:[-._)\]]+\s*|\s+)(.+)$/);
  if (m) {
    const n = Number(m[1]);
    const title = tidyTitle(m[2]);
    if (title && Number.isFinite(n) && n > 0) return { number: n, title };
  }
  return { number: null, title: tidyTitle(base) };
}

// Is ffprobe on PATH? Checked once so the summary can explain missing runtimes.
function hasFfprobe(): boolean {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function probeDurationSeconds(file: string): number | null {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const n = Number.parseFloat(out);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------- main

interface Outcome {
  album: string;
  file: string;
  title: string;
  trackNumber: number | null;
  action: "insert" | "skip-duplicate" | "skip-no-album" | "renumbered" | "error";
  detail: string;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const args = parseArgs(process.argv.slice(2));

  if (!args.dir) {
    console.error(
      "Usage: tsx scripts/import-library.ts <library-dir> [--apply] [--artist NAME]\n" +
        "                                    [--create-albums] [--only ALBUM] [--json FILE]",
    );
    process.exit(2);
  }
  if (!fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
    console.error(`Not a directory: ${args.dir}`);
    process.exit(2);
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env or .env.local).",
    );
    process.exit(2);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const ffprobeAvailable = hasFfprobe();
  console.log(
    `\n${args.apply ? "APPLY" : "DRY RUN"} — ${path.resolve(args.dir)}`,
  );
  if (!args.apply) console.log("Nothing will be uploaded or written. Add --apply to commit.\n");
  else console.log("");

  // --- load current catalog state once -------------------------------------

  const { data: relRows, error: relErr } = await db
    .from("releases")
    .select("id, title, slug, artist_id, release_type");
  if (relErr) throw relErr;

  const { data: trackRows, error: trErr } = await db
    .from("tracks")
    .select("id, title, release_id, track_number");
  if (trErr) throw trErr;

  const releases = relRows ?? [];
  const bySlug = new Map(releases.map((r) => [r.slug as string, r]));
  const byNormTitle = new Map<string, typeof releases>();
  for (const r of releases) {
    const k = normalizeTitle(r.title as string);
    const arr = byNormTitle.get(k) ?? [];
    arr.push(r);
    byNormTitle.set(k, arr);
  }

  // release_id → { normalized titles present, numbers taken, max number }
  const state = new Map<
    number,
    { titles: Set<string>; numbers: Set<number>; max: number }
  >();
  for (const t of trackRows ?? []) {
    const rid = t.release_id as number;
    const s =
      state.get(rid) ?? { titles: new Set<string>(), numbers: new Set<number>(), max: 0 };
    s.titles.add(normalizeTitle(t.title as string));
    const n = t.track_number as number | null;
    if (typeof n === "number") {
      s.numbers.add(n);
      if (n > s.max) s.max = n;
    }
    state.set(rid, s);
  }

  let artistId: number | null = null;
  if (args.artist) {
    const { data: a, error } = await db
      .from("artists")
      .select("id, name")
      .ilike("name", args.artist)
      .limit(2);
    if (error) throw error;
    if (!a || a.length === 0) {
      console.error(`No artist matching "${args.artist}".`);
      process.exit(2);
    }
    if (a.length > 1) {
      console.error(`"${args.artist}" is ambiguous: ${a.map((x) => x.name).join(", ")}`);
      process.exit(2);
    }
    artistId = a[0].id as number;
  }

  // --- walk the library -----------------------------------------------------

  const outcomes: Outcome[] = [];
  const folders = fs
    .readdirSync(args.dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => !args.only || normalizeTitle(n) === normalizeTitle(args.only))
    .sort();

  if (folders.length === 0) {
    console.log("No album folders found (expects one subfolder per album).");
    return;
  }

  for (const folder of folders) {
    const folderPath = path.join(args.dir, folder);
    const files = fs
      .readdirSync(folderPath, { withFileTypes: true })
      .filter((f) => f.isFile() && AUDIO_EXT.has(path.extname(f.name).toLowerCase()))
      .map((f) => f.name)
      .sort();

    if (files.length === 0) continue;

    // Resolve the album folder to a release row.
    let release =
      bySlug.get(slugify(folder)) ??
      (byNormTitle.get(normalizeTitle(folder))?.length === 1
        ? byNormTitle.get(normalizeTitle(folder))![0]
        : undefined);

    const ambiguous = (byNormTitle.get(normalizeTitle(folder))?.length ?? 0) > 1;

    console.log(`\n${folder}`);

    if (!release && ambiguous) {
      const names = byNormTitle
        .get(normalizeTitle(folder))!
        .map((r) => `${r.title} [${r.slug}]`)
        .join(", ");
      console.log(`  ! ambiguous album name — matches: ${names}. Skipped.`);
      for (const f of files) {
        outcomes.push({
          album: folder, file: f, title: parseFilename(f).title,
          trackNumber: parseFilename(f).number,
          action: "skip-no-album", detail: `ambiguous: ${names}`,
        });
      }
      continue;
    }

    if (!release) {
      if (!args.createAlbums) {
        console.log(`  ! no matching release. Skipped (pass --create-albums to create it).`);
        for (const f of files) {
          outcomes.push({
            album: folder, file: f, title: parseFilename(f).title,
            trackNumber: parseFilename(f).number,
            action: "skip-no-album", detail: "no matching release",
          });
        }
        continue;
      }
      if (artistId === null) {
        console.log(`  ! --create-albums needs --artist to know who owns the new release. Skipped.`);
        for (const f of files) {
          outcomes.push({
            album: folder, file: f, title: parseFilename(f).title,
            trackNumber: parseFilename(f).number,
            action: "skip-no-album", detail: "--create-albums requires --artist",
          });
        }
        continue;
      }
      const newRow = {
        title: folder,
        slug: slugify(folder),
        artist_id: artistId,
        release_type: files.length > 1 ? "album" : "single",
        is_published: false, // unpublished until cover art is set in /admin/releases
      };
      if (!args.apply) {
        console.log(`  + would create release "${folder}" [${newRow.slug}] (unpublished)`);
        release = { id: -1, ...newRow } as any;
      } else {
        const { data, error } = await db
          .from("releases").insert(newRow).select("id, title, slug, artist_id, release_type").single();
        if (error) {
          console.log(`  ! could not create release: ${error.message}`);
          continue;
        }
        release = data as any;
        console.log(`  + created release "${folder}" [${newRow.slug}] (unpublished — add cover art)`);
      }
    }

    const rid = release!.id as number;
    const s = state.get(rid) ?? { titles: new Set<string>(), numbers: new Set<number>(), max: 0 };
    state.set(rid, s);

    for (const file of files) {
      const { number, title } = parseFilename(file);
      const norm = normalizeTitle(title);
      const abs = path.join(folderPath, file);

      if (s.titles.has(norm)) {
        console.log(`  = ${title} — already on this album, skipped`);
        outcomes.push({
          album: folder, file, title, trackNumber: number,
          action: "skip-duplicate", detail: "title already present",
        });
        continue;
      }

      // Choose a track number: requested if free, else the next free slot.
      let finalNumber = number;
      let renumbered = false;
      if (finalNumber === null || s.numbers.has(finalNumber)) {
        const wanted = finalNumber;
        let n = Math.max(s.max + 1, 1);
        while (s.numbers.has(n)) n++;
        finalNumber = n;
        renumbered = wanted !== null;
        if (renumbered) {
          console.log(`  ~ ${title} — #${wanted} is taken by another song, placing at #${n}`);
        }
      }

      const duration = probeDurationSeconds(abs);

      if (!args.apply) {
        console.log(
          `  + ${title} → #${finalNumber}` +
            (duration !== null ? ` (${duration}s)` : " (duration unknown)"),
        );
        s.titles.add(norm);
        s.numbers.add(finalNumber);
        if (finalNumber > s.max) s.max = finalNumber;
        outcomes.push({
          album: folder, file, title, trackNumber: finalNumber,
          action: renumbered ? "renumbered" : "insert",
          detail: duration !== null ? `${duration}s` : "duration unknown",
        });
        continue;
      }

      // Upload first, then insert. Path format mirrors /api/admin/upload-url.
      const ext = path.extname(file).toLowerCase();
      const safeName = file.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const storagePath = `${Date.now()}_${safeName}`;

      const { error: upErr } = await db.storage
        .from("audio-files")
        .upload(storagePath, fs.readFileSync(abs), {
          contentType: CONTENT_TYPE[ext] ?? "application/octet-stream",
          upsert: false,
        });
      if (upErr) {
        console.log(`  ! ${title} — upload failed: ${upErr.message}`);
        outcomes.push({
          album: folder, file, title, trackNumber: finalNumber,
          action: "error", detail: `upload failed: ${upErr.message}`,
        });
        continue;
      }

      const { error: insErr } = await db.from("tracks").insert({
        title,
        release_id: rid,
        track_number: finalNumber,
        audio_url: storagePath,
        duration_seconds: duration,
        is_published: true,
        preview_start: 0,
        preview_end: 30,
        moderation_status: "clean",
        published_at: new Date().toISOString(),
      });

      if (insErr) {
        // Roll the upload back so a failed insert never leaves an orphan object.
        await db.storage.from("audio-files").remove([storagePath]);
        console.log(`  ! ${title} — insert failed, upload rolled back: ${insErr.message}`);
        outcomes.push({
          album: folder, file, title, trackNumber: finalNumber,
          action: "error", detail: `insert failed: ${insErr.message}`,
        });
        continue;
      }

      s.titles.add(norm);
      s.numbers.add(finalNumber);
      if (finalNumber > s.max) s.max = finalNumber;
      console.log(
        `  + ${title} → #${finalNumber}` +
          (duration !== null ? ` (${duration}s)` : " (duration unknown — set it in /admin/tracks)"),
      );
      outcomes.push({
        album: folder, file, title, trackNumber: finalNumber,
        action: renumbered ? "renumbered" : "insert",
        detail: storagePath,
      });
    }
  }

  // --- summary --------------------------------------------------------------

  const count = (a: Outcome["action"]) => outcomes.filter((o) => o.action === a).length;
  const inserted = count("insert") + count("renumbered");
  const noDuration = outcomes.filter(
    (o) => (o.action === "insert" || o.action === "renumbered") && o.detail === "duration unknown",
  ).length;

  console.log(`\n${"-".repeat(60)}`);
  console.log(`${args.apply ? "Imported" : "Would import"}: ${inserted}`);
  console.log(`Already present (skipped): ${count("skip-duplicate")}`);
  console.log(`Renumbered (requested slot taken): ${count("renumbered")}`);
  console.log(`No matching album (skipped): ${count("skip-no-album")}`);
  console.log(`Errors: ${count("error")}`);
  if (!ffprobeAvailable) {
    console.log(
      "\nNote: ffprobe was not found on PATH, so durations were not read. Tracks still\n" +
        "import fine; they will show no runtime until a master is re-uploaded via /admin/tracks.",
    );
  } else if (noDuration > 0) {
    console.log(`\nNote: ${noDuration} file(s) had an unreadable duration.`);
  }
  if (!args.apply && inserted > 0) {
    console.log("\nRe-run with --apply to commit these changes.");
  }

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify(outcomes, null, 2));
    console.log(`\nReport written to ${args.json}`);
  }

  process.exit(count("error") > 0 ? 1 : 0);
}

// Only run when invoked directly, so the helpers above can be imported by
// scripts/import-library.test.ts without kicking off an import.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err) => {
    console.error("\nImport failed:", err?.message ?? err);
    process.exit(1);
  });
}
