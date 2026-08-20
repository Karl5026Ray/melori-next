import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "@/lib/slug";
import { DEFAULT_ALBUM_PRICE_CENTS } from "@/lib/pricing";

// `studio_albums` is a side-car over the free-text `studio_tracks.album`
// column: it gives an album a stable id, a public slug and — the point of this
// file — a price the artist controls. Track rows still carry the album NAME, so
// nothing about upload, ordering or the reorder API changes.
//
// Rows are created lazily: the first time an artist saves a track into an album
// name, we materialise the album. Migration 045 backfills everything that
// existed before this shipped.

export interface StudioAlbumRow {
  id: string;
  profile_id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_url: string | null;
  price_cents: number;
  currency: string;
}

export function normalizeAlbumTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function uniqueAlbumSlug(
  supabase: SupabaseClient,
  title: string,
  profileId: string,
): Promise<string> {
  const base = slugify(title) || "album";
  const { data: taken } = await supabase
    .from("studio_albums")
    .select("slug")
    .eq("slug", base)
    .maybeSingle();
  if (!taken) return base;

  // Same album title from a different artist — disambiguate with a stable
  // fragment of their profile id rather than a counter, so re-running this
  // for the same artist always lands on the same slug.
  const scoped = `${base}-${profileId.slice(0, 6)}`;
  const { data: scopedTaken } = await supabase
    .from("studio_albums")
    .select("slug")
    .eq("slug", scoped)
    .maybeSingle();
  if (!scopedTaken) return scoped;

  return `${scoped}-${Date.now().toString(36)}`;
}

/**
 * Return the album row for (profileId, title), creating it if needed.
 * Returns null when the title is empty (a single, not an album) or the insert
 * fails — callers treat a missing album as "no album pricing", never an error,
 * so a track upload can never fail because of this side-car.
 */
export async function ensureStudioAlbum(
  supabase: SupabaseClient,
  profileId: string | null,
  rawTitle: unknown,
  coverUrl?: string | null,
): Promise<StudioAlbumRow | null> {
  const title = normalizeAlbumTitle(rawTitle);
  if (!title || !profileId) return null;

  const columns =
    "id, profile_id, title, slug, description, cover_url, price_cents, currency";

  const { data: existing } = await supabase
    .from("studio_albums")
    .select(columns)
    .eq("profile_id", profileId)
    .eq("title", title)
    .maybeSingle();
  if (existing) {
    // Give a coverless album the first cover one of its tracks brings along.
    if (coverUrl && !(existing as StudioAlbumRow).cover_url) {
      await supabase
        .from("studio_albums")
        .update({ cover_url: coverUrl })
        .eq("id", (existing as StudioAlbumRow).id);
      return { ...(existing as StudioAlbumRow), cover_url: coverUrl };
    }
    return existing as StudioAlbumRow;
  }

  const slug = await uniqueAlbumSlug(supabase, title, profileId);
  const { data: created, error } = await supabase
    .from("studio_albums")
    .insert({
      profile_id: profileId,
      title,
      slug,
      cover_url: coverUrl ?? null,
      price_cents: DEFAULT_ALBUM_PRICE_CENTS,
    })
    .select(columns)
    .maybeSingle();

  if (error) {
    // A concurrent upload may have won the unique(profile_id, title) race.
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("studio_albums")
        .select(columns)
        .eq("profile_id", profileId)
        .eq("title", title)
        .maybeSingle();
      return (raced as StudioAlbumRow | null) ?? null;
    }
    console.error("ensureStudioAlbum failed:", error.message);
    return null;
  }

  return (created as StudioAlbumRow | null) ?? null;
}
