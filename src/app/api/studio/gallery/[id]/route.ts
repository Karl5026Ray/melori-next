import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGINALS_BUCKET = "gallery-originals";
const PREVIEWS_BUCKET = "gallery-previews";

async function loadOwnedGallery(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  galleryId: string,
  userId: string,
  callerIsAdmin: boolean,
) {
  const { data: gallery, error } = await supabase
    .from("photo_galleries")
    .select("id, photographer_id")
    .eq("id", galleryId)
    .maybeSingle();
  if (error || !gallery) return { gallery: null, forbidden: false };
  if (gallery.photographer_id !== userId && !callerIsAdmin) {
    return { gallery: null, forbidden: true };
  }
  return { gallery, forbidden: false };
}

// PATCH /api/studio/gallery/[id] — owner/admin only. Supports renaming,
// toggling is_active, and setting the cover image (by imageId, resolved to
// that image's thumbnail_key) or clearing it.
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { id: galleryId } = await props.params;
  const supabase = getSupabaseAdmin();

  const { gallery, forbidden } = await loadOwnedGallery(
    supabase,
    galleryId,
    userId,
    callerIsAdmin,
  );
  if (forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!gallery) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }

  let body: {
    name?: string;
    clientName?: string | null;
    allowDownloads?: boolean;
    isActive?: boolean;
    coverImageId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    update.name = body.name.trim();
  }
  if (body.clientName !== undefined) {
    update.client_name =
      typeof body.clientName === "string" && body.clientName.trim()
        ? body.clientName.trim()
        : null;
  }
  if (typeof body.allowDownloads === "boolean") {
    update.allow_downloads = body.allowDownloads;
  }
  if (typeof body.isActive === "boolean") {
    update.is_active = body.isActive;
  }

  if (body.coverImageId !== undefined) {
    if (body.coverImageId === null) {
      update.cover_image_key = null;
    } else {
      const { data: image } = await supabase
        .from("photo_gallery_images")
        .select("id, thumbnail_key, gallery_id")
        .eq("id", body.coverImageId)
        .maybeSingle();
      if (!image || image.gallery_id !== galleryId) {
        return NextResponse.json(
          { error: "Cover image not found in this gallery" },
          { status: 400 },
        );
      }
      update.cover_image_key = image.thumbnail_key;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("photo_galleries")
    .update(update)
    .eq("id", galleryId)
    .select(
      "id, name, slug, client_name, cover_image_key, allow_downloads, is_active",
    )
    .single();

  if (error || !updated) {
    console.error("studio/gallery/[id] PATCH failed", error?.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ gallery: updated });
}

// DELETE /api/studio/gallery/[id] — owner/admin only. Deletes the gallery row
// (images cascade via FK), plus best-effort removal of all storage objects
// under this gallery's prefix in both buckets.
export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { id: galleryId } = await props.params;
  const supabase = getSupabaseAdmin();

  const { gallery, forbidden } = await loadOwnedGallery(
    supabase,
    galleryId,
    userId,
    callerIsAdmin,
  );
  if (forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!gallery) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }

  const { data: images } = await supabase
    .from("photo_gallery_images")
    .select("storage_key, preview_key, thumbnail_key")
    .eq("gallery_id", galleryId);

  const originalKeys = (images ?? []).map((i) => i.storage_key as string);
  const previewKeys = (images ?? []).flatMap((i) => [
    i.preview_key as string,
    i.thumbnail_key as string,
  ]);

  if (originalKeys.length > 0) {
    await supabase.storage.from(ORIGINALS_BUCKET).remove(originalKeys).catch(() => {});
  }
  if (previewKeys.length > 0) {
    await supabase.storage.from(PREVIEWS_BUCKET).remove(previewKeys).catch(() => {});
  }

  const { error } = await supabase
    .from("photo_galleries")
    .delete()
    .eq("id", galleryId);

  if (error) {
    console.error("studio/gallery/[id] DELETE failed", error.message);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
