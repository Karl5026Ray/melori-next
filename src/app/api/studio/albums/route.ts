import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { OWNER_COLUMN } from "@/lib/studio-ownership";
import { PRICE_RANGE_MESSAGE, parsePriceCents } from "@/lib/pricing";
import { ensureStudioAlbum, normalizeAlbumTitle } from "@/lib/studio-albums";

export const dynamic = "force-dynamic";

// Album pricing for the Artist Studio. Albums themselves are derived from the
// free-text `studio_tracks.album` column; this route materialises the pricing
// side-car for every album the caller actually has tracks in, so the dashboard
// never shows a stale album or misses a brand new one.

interface AlbumSummary {
  id: string;
  title: string;
  slug: string;
  priceCents: number;
  description: string | null;
  coverUrl: string | null;
  trackCount: number;
  publishedCount: number;
}

// GET /api/studio/albums — every album the caller has tracks in, with price.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const supabase = createServiceClient();
  const userId = guard.membership.userId;

  const { data: tracks, error } = await supabase
    .from("studio_tracks")
    .select("album, status, cover_url")
    .eq(OWNER_COLUMN, userId)
    .not("album", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts = new Map<
    string,
    { total: number; published: number; cover: string | null }
  >();
  for (const row of (tracks ?? []) as Array<{
    album: string | null;
    status: string | null;
    cover_url: string | null;
  }>) {
    const title = normalizeAlbumTitle(row.album);
    if (!title) continue;
    const entry = counts.get(title) ?? { total: 0, published: 0, cover: null };
    entry.total += 1;
    if (row.status === "published") entry.published += 1;
    if (!entry.cover && row.cover_url) entry.cover = row.cover_url;
    counts.set(title, entry);
  }

  const albums: AlbumSummary[] = [];
  for (const [title, entry] of counts) {
    const row = await ensureStudioAlbum(supabase, userId, title, entry.cover);
    if (!row) continue;
    albums.push({
      id: row.id,
      title: row.title,
      slug: row.slug,
      priceCents: row.price_cents,
      description: row.description,
      coverUrl: row.cover_url,
      trackCount: entry.total,
      publishedCount: entry.published,
    });
  }
  albums.sort((a, b) => a.title.localeCompare(b.title));

  return NextResponse.json({ albums });
}

// PATCH /api/studio/albums — update one album's price/description.
// Scoped by profile_id so an artist can only reprice their own album, matching
// the RLS policy in migration 045.
export async function PATCH(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const body = await req.json().catch(() => ({}));
  const albumId = typeof body.id === "string" ? body.id : null;
  if (!albumId) {
    return NextResponse.json({ error: "Album id is required." }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.price_cents !== undefined) {
    const priceCents = parsePriceCents(body.price_cents);
    if (priceCents === null) {
      return NextResponse.json({ error: PRICE_RANGE_MESSAGE }, { status: 400 });
    }
    update.price_cents = priceCents;
  }
  if (typeof body.description === "string") {
    update.description = body.description.trim() || null;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("studio_albums")
    .update(update)
    .eq("id", albumId)
    .eq("profile_id", guard.membership.userId)
    .select("id, slug, price_cents, description")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }

  revalidatePath("/music");
  revalidatePath(`/music/album/${(data as { slug: string }).slug}`);

  return NextResponse.json({ success: true, album: data });
}
