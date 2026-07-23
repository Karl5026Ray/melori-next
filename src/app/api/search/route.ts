import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/search?q=...
// Global search across releases, artists, profiles, live spaces and videos.
// Each source is queried in parallel with a substring (ILIKE) match, backed by
// the trigram indexes added in migration 039 so the fan-out stays fast.

interface ReleaseResult {
  id: number;
  title: string;
  slug: string;
  cover_art_url: string | null;
  artistName: string | null;
}

// Escape ILIKE wildcards so a user typing "%" or "_" can't inject a pattern.
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const EMPTY = {
  releases: [] as ReleaseResult[],
  artists: [] as unknown[],
  profiles: [] as unknown[],
  spaces: [] as unknown[],
  videos: [] as unknown[],
};

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (raw.length < 2) {
    return NextResponse.json({ results: EMPTY });
  }

  const q = escapeLike(raw);
  const like = `%${q}%`;
  const supabase = getSupabaseAdmin();

  try {
    const [releasesRes, artistsRes, profilesRes, spacesRes, videosRes] =
      await Promise.all([
        supabase
          .from("releases")
          .select("id,title,slug,cover_art_url,artist_id")
          .eq("is_published", true)
          .ilike("title", like)
          .limit(8),
        supabase
          .from("artists")
          .select("id,name,slug,avatar_url")
          .eq("is_published", true)
          .ilike("name", like)
          .limit(8),
        supabase
          .from("profiles")
          .select("id,username,display_name,avatar_url")
          .or(`username.ilike.${like},display_name.ilike.${like}`)
          .limit(8),
        supabase
          .from("spaces")
          .select("id,title,topic")
          .eq("status", "live")
          .ilike("title", like)
          .limit(8),
        supabase
          .from("social_videos")
          .select("id,title")
          .ilike("title", like)
          .limit(8),
      ]);

    // Resolve artist name for each release via one batched lookup.
    const releaseRows = (releasesRes.data ?? []) as Array<{
      id: number;
      title: string;
      slug: string;
      cover_art_url: string | null;
      artist_id: number | null;
    }>;
    const artistIds = Array.from(
      new Set(releaseRows.map((r) => r.artist_id).filter((v): v is number => v != null)),
    );
    const artistNameById = new Map<number, string>();
    if (artistIds.length) {
      const { data: relArtists } = await supabase
        .from("artists")
        .select("id,name")
        .in("id", artistIds);
      for (const a of (relArtists ?? []) as Array<{ id: number; name: string }>) {
        artistNameById.set(a.id, a.name);
      }
    }

    const releases: ReleaseResult[] = releaseRows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      cover_art_url: r.cover_art_url,
      artistName: r.artist_id != null ? artistNameById.get(r.artist_id) ?? null : null,
    }));

    return NextResponse.json({
      results: {
        releases,
        artists: artistsRes.data ?? [],
        profiles: profilesRes.data ?? [],
        spaces: spacesRes.data ?? [],
        videos: videosRes.data ?? [],
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "search failed";
    console.error("api/search error:", msg);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
