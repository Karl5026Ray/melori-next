// Melori Radio shows — public, free to everyone (Karl, 26 Nov 2026).
//
// "We could now have the shows on the sign in page for free... advertising
// while it's serving the radio and music portion." Shows are studio uploads
// with type 'show' (filed from Studio by an admin only — see
// src/lib/studio-track-type.ts). One show = one album name; each hour is a
// part. Unlike songs, a show plays for a stranger: /api/shows/[id]/stream
// signs a URL with no account, but ONLY for a published, clean row whose type
// is 'show'. Every song keeps the members-only 401.
import { getSupabaseCatalogReader } from "@/lib/supabase/admin";

import { showSlug, type PublicShow, type ShowPart } from "@/lib/showsShared";
export { showSlug, formatShowLength, type PublicShow, type ShowPart } from "@/lib/showsShared";

export async function getPublicShows(): Promise<PublicShow[]> {
  const { data, error } = await getSupabaseCatalogReader()
    .from("studio_tracks")
    .select("id, title, artist, album, cover_url, duration, created_at")
    .eq("type", "show")
    .eq("status", "published")
    .eq("moderation_status", "clean")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getPublicShows error", error.message);
    return [];
  }
  const bySlug = new Map<string, PublicShow>();
  for (const row of (data ?? []) as Array<Record<string, any>>) {
    const name = String(row.album || row.title || "Melori Radio");
    const slug = showSlug(name);
    const d = Number(row.duration);
    const part: ShowPart = {
      id: String(row.id),
      title: String(row.title ?? name),
      durationSeconds: Number.isFinite(d) && d > 0 ? d : null,
    };
    const show = bySlug.get(slug);
    if (show) {
      show.parts.push(part);
      show.coverUrl ??= row.cover_url ?? null;
    } else {
      bySlug.set(slug, {
        slug,
        name,
        host: String(row.artist || "Karl Ray & Jade"),
        coverUrl: row.cover_url ?? null,
        parts: [part],
        totalSeconds: 0,
        createdAt: String(row.created_at),
      });
    }
  }
  const shows = Array.from(bySlug.values());
  for (const s of shows) {
    s.parts.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    s.totalSeconds = s.parts.reduce((n, p) => n + (p.durationSeconds ?? 0), 0);
  }
  // Newest show first.
  return shows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getShowBySlug(slug: string): Promise<PublicShow | null> {
  return (await getPublicShows()).find((s) => s.slug === slug) ?? null;
}

