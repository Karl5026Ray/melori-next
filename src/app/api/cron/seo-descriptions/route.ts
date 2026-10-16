import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { generateSeoDescription, type SeoFacts } from "@/lib/seoDescriptions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET/POST /api/cron/seo-descriptions
//
// Fills `seo_description` (migration 098) for published artists, releases and
// studio albums that have none, or whose row changed since it was written
// (updated_at > seo_generated_at). Runs hourly; a run with nothing to do makes
// no Claude call and costs nothing. Each run handles at most BATCH rows so it
// finishes well inside maxDuration; the first backfill (~107 rows) spreads
// over a few runs.
//
// A failed generation is skipped, never written: the page keeps its existing
// fallback and the row is retried next run. The response reports what
// happened, including token usage, so the spend is visible.
//
// Auth: same shared secret as the other crons —
// `x-cron-secret: $CRON_SECRET` or `Authorization: Bearer $CRON_SECRET`.

const BATCH = 30;
const CONCURRENCY = 5;

type Job = { table: "artists" | "releases" | "studio_albums"; id: number | string; facts: SeoFacts };

function stale(row: { updated_at?: string | null; seo_generated_at?: string | null }): boolean {
  if (!row.seo_generated_at) return true;
  if (!row.updated_at) return false;
  return new Date(row.updated_at).getTime() > new Date(row.seo_generated_at).getTime();
}

function year(date?: string | null): string | null {
  return date && /^\d{4}/.test(date) ? date.slice(0, 4) : null;
}

async function collectJobs(): Promise<Job[]> {
  const db = getSupabaseAdmin();
  const [artistsRes, releasesRes, albumsRes, genresRes] = await Promise.all([
    db.from("artists")
      .select("id, name, bio, genre_id, updated_at, seo_generated_at")
      .eq("is_published", true),
    db.from("releases")
      .select("id, title, release_type, description, release_date, artist_id, updated_at, seo_generated_at, artists(name)")
      .eq("is_published", true),
    db.from("studio_albums")
      .select("id, title, description, profile_id, updated_at, seo_generated_at"),
    db.from("genres").select("id, name"),
  ]);
  for (const r of [artistsRes, releasesRes, albumsRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  const genreName = new Map((genresRes.data ?? []).map((g) => [g.id as number, g.name as string]));
  const jobs: Job[] = [];

  const artists = (artistsRes.data ?? []).filter(stale);
  const releases = (releasesRes.data ?? []).filter(stale);
  const albums = (albumsRes.data ?? []).filter(stale);

  // Titles shown on each page, fetched only for the rows that need work.
  const artistIds = artists.map((a) => a.id as number);
  const releaseIds = releases.map((r) => r.id as number);
  const [artistReleases, releaseTracks] = await Promise.all([
    artistIds.length
      ? db.from("releases").select("artist_id, title").eq("is_published", true).in("artist_id", artistIds)
      : Promise.resolve({ data: [] as { artist_id: number; title: string }[] }),
    releaseIds.length
      ? db.from("tracks").select("release_id, title, track_number").eq("is_published", true)
          .in("release_id", releaseIds).order("track_number", { ascending: true })
      : Promise.resolve({ data: [] as { release_id: number; title: string }[] }),
  ]);

  for (const a of artists) {
    jobs.push({
      table: "artists",
      id: a.id,
      facts: {
        kind: "artist",
        name: a.name,
        genre: a.genre_id ? genreName.get(a.genre_id) ?? null : null,
        ownWords: a.bio,
        titles: (artistReleases.data ?? []).filter((r) => r.artist_id === a.id).map((r) => r.title),
      },
    });
  }
  for (const r of releases) {
    const artist = Array.isArray(r.artists) ? r.artists[0] : r.artists;
    jobs.push({
      table: "releases",
      id: r.id,
      facts: {
        kind: "album",
        name: r.title,
        artist: (artist as { name?: string } | null)?.name ?? null,
        releaseType: r.release_type,
        year: year(r.release_date),
        ownWords: r.description,
        titles: (releaseTracks.data ?? []).filter((t) => t.release_id === r.id).map((t) => t.title),
      },
    });
  }
  for (const al of albums) {
    const [{ data: owner }, { data: tracks }] = await Promise.all([
      db.from("artists").select("name").eq("profile_id", al.profile_id).maybeSingle(),
      db.from("studio_tracks").select("title").eq("profile_id", al.profile_id)
        .eq("album", al.title).eq("status", "published")
        // Taken-down titles must not end up in a public description.
        .eq("moderation_status", "clean").limit(12),
    ]);
    jobs.push({
      table: "studio_albums",
      id: al.id,
      facts: {
        kind: "album",
        name: al.title,
        artist: owner?.name ?? null,
        releaseType: "album",
        ownWords: al.description,
        titles: (tracks ?? []).map((t) => t.title),
      },
    });
  }
  return jobs;
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let jobs: Job[];
  try {
    jobs = await collectJobs();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  const pending = jobs.length;
  const batch = jobs.slice(0, BATCH);
  const db = getSupabaseAdmin();
  let written = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const errors: string[] = [];

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(
      batch.slice(i, i + CONCURRENCY).map(async (job) => {
        const result = await generateSeoDescription(job.facts);
        if (!result.ok) {
          errors.push(`${job.table}#${job.id}: ${result.error}`);
          return;
        }
        inputTokens += result.inputTokens;
        outputTokens += result.outputTokens;
        // updated_at is deliberately left alone: bumping it would mark the row
        // stale again and regenerate it every run.
        const { error } = await db
          .from(job.table)
          .update({ seo_description: result.text, seo_generated_at: new Date().toISOString() })
          .eq("id", job.id);
        if (error) errors.push(`${job.table}#${job.id}: ${error.message}`);
        else written += 1;
      }),
    );
    // A missing/placeholder key fails every call the same way; stop early.
    if (errors.length && errors.every((e) => e.includes("ANTHROPIC_API_KEY"))) break;
  }

  return NextResponse.json({
    pending,
    attempted: batch.length,
    written,
    remaining: Math.max(0, pending - written),
    usage: { inputTokens, outputTokens },
    errors: errors.slice(0, 10),
  });
}

export const GET = handle;
export const POST = handle;
