import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadOwnedFolder(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  folderId: string,
  userId: string,
  callerIsAdmin: boolean,
) {
  const { data: folder, error } = await supabase
    .from("photo_gallery_folders")
    .select("id, gallery_id, photo_galleries!inner(photographer_id)")
    .eq("id", folderId)
    .maybeSingle();
  if (error || !folder) return { folder: null, forbidden: false };

  const gallery = Array.isArray(folder.photo_galleries)
    ? folder.photo_galleries[0]
    : folder.photo_galleries;
  if (gallery?.photographer_id !== userId && !callerIsAdmin) {
    return { folder: null, forbidden: true };
  }
  return { folder, forbidden: false };
}

// PATCH /api/studio/gallery/folder/[folderId] — owner/admin only. Sets or
// clears the folder's cover photo (null falls back to its first photo).
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ folderId: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { folderId } = await props.params;
  const supabase = getSupabaseAdmin();

  const { folder, forbidden } = await loadOwnedFolder(
    supabase,
    folderId,
    userId,
    callerIsAdmin,
  );
  if (forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  let body: { coverPhotoId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (body.coverPhotoId === undefined) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  let coverPhotoId: string | null = null;
  if (body.coverPhotoId !== null) {
    const { data: image } = await supabase
      .from("photo_gallery_images")
      .select("id, folder_id")
      .eq("id", body.coverPhotoId)
      .maybeSingle();
    if (!image || image.folder_id !== folderId) {
      return NextResponse.json(
        { error: "Cover photo not found in this folder" },
        { status: 400 },
      );
    }
    coverPhotoId = image.id as string;
  }

  const { data: updated, error } = await supabase
    .from("photo_gallery_folders")
    .update({ cover_photo_id: coverPhotoId })
    .eq("id", folderId)
    .select("id, name, cover_photo_id")
    .single();

  if (error || !updated) {
    console.error("studio/gallery/folder PATCH failed", error?.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ folder: updated });
}
