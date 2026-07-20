import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEWS_BUCKET = "gallery-previews";

// GET /api/studio/gallery/list — requireArtist. Returns the caller's own
// galleries (admins see their own galleries too — Phase 1 keeps this scoped
// to "owned by me"; a future admin-wide view is out of scope) with image
// counts and a resolved cover URL for the studio grid.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const admin = isAdmin(guard.membership.profile);

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("photo_galleries")
    .select(
      "id, name, slug, client_name, cover_image_key, password_hash, allow_downloads, is_active, view_count, created_at",
    )
    .order("created_at", { ascending: false });

  // Admins still only see galleries they personally own in this list view —
  // ownership scoping keeps the studio grid meaningful per-photographer.
  query = query.eq("photographer_id", userId);
  void admin;

  const { data: galleries, error } = await query;
  if (error) {
    console.error("studio/gallery/list query failed", error.message);
    return NextResponse.json(
      { error: "Could not load galleries" },
      { status: 500 },
    );
  }

  const rows = galleries ?? [];
  const galleryIds = rows.map((g) => g.id as string);

  const countsByGallery = new Map<string, number>();
  if (galleryIds.length > 0) {
    const { data: images } = await supabase
      .from("photo_gallery_images")
      .select("gallery_id")
      .in("gallery_id", galleryIds);
    for (const img of images ?? []) {
      const gid = img.gallery_id as string;
      countsByGallery.set(gid, (countsByGallery.get(gid) ?? 0) + 1);
    }
  }

  // Resolve a cover URL: explicit cover_image_key, else the first image's
  // thumbnail (order_index ascending) for galleries lacking an explicit cover.
  const missingCoverIds = rows
    .filter((g) => !g.cover_image_key)
    .map((g) => g.id as string);
  const fallbackCoverByGallery = new Map<string, string>();
  if (missingCoverIds.length > 0) {
    const { data: firstImages } = await supabase
      .from("photo_gallery_images")
      .select("gallery_id, thumbnail_key, order_index")
      .in("gallery_id", missingCoverIds)
      .order("order_index", { ascending: true });
    for (const img of firstImages ?? []) {
      const gid = img.gallery_id as string;
      if (!fallbackCoverByGallery.has(gid)) {
        fallbackCoverByGallery.set(gid, img.thumbnail_key as string);
      }
    }
  }

  const galleriesOut = rows.map((g) => {
    const coverKey =
      (g.cover_image_key as string | null) ??
      fallbackCoverByGallery.get(g.id as string) ??
      null;
    const coverUrl = coverKey
      ? supabase.storage.from(PREVIEWS_BUCKET).getPublicUrl(coverKey).data
          .publicUrl
      : null;

    return {
      id: g.id,
      name: g.name,
      slug: g.slug,
      clientName: g.client_name,
      coverUrl,
      hasPassword: Boolean(g.password_hash),
      allowDownloads: g.allow_downloads,
      isActive: g.is_active,
      viewCount: g.view_count,
      createdAt: g.created_at,
      imageCount: countsByGallery.get(g.id as string) ?? 0,
    };
  });

  return NextResponse.json({ galleries: galleriesOut });
}
