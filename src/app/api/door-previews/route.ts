import { NextResponse } from "next/server";
import { getSupabaseCatalogReader } from "@/lib/supabase/admin";
import { DOOR_PREVIEW_TRACK_IDS } from "@/lib/doorPreviews";

export const runtime = "nodejs";
export const revalidate = 300;

export type DoorPreview = {
  id: number;
  title: string;
  artist: string;
  cover: string | null;
  albumHref: string | null;
};

// GET /api/door-previews — the song list for the door's "Listen now" strip.
//
// Public catalog facts only (title, artist, cover, album page link) for the
// hand-picked ids in src/lib/doorPreviews.ts. No storage paths ever leave this
// route: audio comes from /api/tracks/[id]/preview, one tap at a time.
export async function GET() {
  try {
    const supabase = getSupabaseCatalogReader();
    const { data, error } = await supabase
      .from("tracks")
      .select(
        "id, title, preview_url, release:releases!inner(slug, cover_art_url, is_published, artist:artists!inner(name))",
      )
      .in("id", DOOR_PREVIEW_TRACK_IDS as number[])
      .eq("is_published", true)
      .eq("moderation_status", "clean");
    if (error) throw error;

    const byId = new Map<number, DoorPreview>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (!row.preview_url) continue;
      const relRaw = row.release as unknown;
      const rel = (Array.isArray(relRaw) ? relRaw[0] : relRaw) as
        | { slug?: string; cover_art_url?: string | null; is_published?: boolean; artist?: unknown }
        | undefined;
      if (!rel || rel.is_published === false) continue;
      const artRaw = rel.artist;
      const art = (Array.isArray(artRaw) ? artRaw[0] : artRaw) as { name?: string } | undefined;
      byId.set(Number(row.id), {
        id: Number(row.id),
        title: String(row.title ?? ""),
        artist: art?.name ?? "",
        cover: rel.cover_art_url ?? null,
        albumHref: rel.slug ? `/albums/${rel.slug}` : null,
      });
    }

    const previews = DOOR_PREVIEW_TRACK_IDS.map((id) => byId.get(id)).filter(
      (p): p is DoorPreview => Boolean(p),
    );
    return NextResponse.json({ previews });
  } catch (err) {
    console.error("GET /api/door-previews failed:", err);
    // The door must never break over this strip: an empty list hides it.
    return NextResponse.json({ previews: [] });
  }
}
