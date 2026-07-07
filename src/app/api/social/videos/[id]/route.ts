import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bust the public video feed cache whenever a video changes. Silent-safe:
// revalidatePath queues an invalidation for the next request; if a path
// doesn't exist yet it's a no-op instead of an error.
function revalidateVideoPaths() {
  revalidatePath("/");
  revalidatePath("/social/video");
  revalidatePath("/video");
}

// Extract the storage-relative object path from a Supabase public URL.
// Supabase public URLs look like:
//   `<host>/storage/v1/object/public/<bucket>/<path>`
// Returns null when the URL doesn't reference the given bucket (external
// video, signed URL, etc.) so callers can skip the storage delete rather
// than trying to remove an unrelated path.
function pathFromPublicUrl(
  url: string | null,
  bucket: string,
): string | null {
  if (!url) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

// DELETE /api/social/videos/[id] — owner-only deletion of a social video.
//
// Ownership: enforced via requireArtist AND an explicit user_id equality
// on the DELETE. Admins can also delete via this route because requireArtist
// accepts the admin role. Non-owner artists cannot delete another artist's
// video because the row-level filter uses `user_id = caller`.
//
// Storage cleanup: video file (in the `social-videos` public bucket) and
// optional thumbnail (in `covers`). The DB row is deleted first — even if
// storage cleanup partially fails afterward, the video disappears from every
// listing. Storage errors surface in the response so the client can log them.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const supabase = getSupabaseAdmin();

  // Fetch first so we know which storage objects to clean up. If the row
  // isn't ours (or doesn't exist), return 404 without disclosing which.
  const { data: row, error: fetchError } = await supabase
    .from("social_videos")
    .select("id, user_id, video_url, thumbnail_url")
    .eq("id", params.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  // requireArtist returns membership.profile.membership_tier as the effective
  // role — 'artist' | 'admin' | 'superfan' | 'free'. Only admins can delete a
  // video that isn't theirs; every other role is limited to their own row.
  const isAdmin =
    guard.membership.profile?.membership_tier === "admin";
  if (!isAdmin && row.user_id !== guard.membership.userId) {
    return NextResponse.json({ error: "Not your video" }, { status: 403 });
  }

  // Delete the row first — that's what the public feed reads. Even if the
  // storage step fails afterward, the video is gone from every listing.
  const del = supabase
    .from("social_videos")
    .delete()
    .eq("id", params.id);
  const scoped = isAdmin ? del : del.eq("user_id", guard.membership.userId!);
  const { error: deleteError } = await scoped;

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const storageErrors: string[] = [];

  const videoPath = pathFromPublicUrl(row.video_url, "social-videos");
  if (videoPath) {
    const { error } = await supabase.storage
      .from("social-videos")
      .remove([videoPath]);
    if (error) storageErrors.push(`social-videos:${error.message}`);
  }

  const thumbPath = pathFromPublicUrl(row.thumbnail_url, "covers");
  if (thumbPath) {
    const { error } = await supabase.storage.from("covers").remove([thumbPath]);
    if (error) storageErrors.push(`covers:${error.message}`);
  }

  revalidateVideoPaths();

  return NextResponse.json({
    success: true,
    storageErrors: storageErrors.length ? storageErrors : undefined,
  });
}
