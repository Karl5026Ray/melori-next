import type { SupabaseClient } from "@supabase/supabase-js";

// Server-only removal of a Melori Mirror post, shared by the owner/admin route
// (DELETE /api/social/videos/[id]) and the admin panel
// (DELETE /api/admin/mirror/[id]) so both paths archive, scope, and clean up
// storage identically.

export interface DeletableSocialVideo {
  id: string;
  user_id: string;
  video_url: string | null;
  thumbnail_url: string | null;
  source: string | null;
}

export const DELETABLE_COLUMNS =
  "id, user_id, video_url, thumbnail_url, source" as const;

// Extract the storage-relative object path from a Supabase public URL.
// Supabase public URLs look like:
//   `<host>/storage/v1/object/public/<bucket>/<path>`
// Returns null when the URL doesn't reference the given bucket (YouTube post,
// external video, signed URL, etc.) so callers skip the storage delete rather
// than trying to remove an unrelated path.
function pathFromPublicUrl(url: string | null, bucket: string): string | null {
  if (!url) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export interface DeleteResult {
  // Set when the row could not be removed; the caller should return a 500.
  error?: string;
  // Non-fatal storage cleanup failures, surfaced to the client for logging.
  storageErrors: string[];
}

// Archive the row, delete it, then best-effort remove its storage objects.
//
// Order matters: the live row is what every feed reads, so it goes first and the
// storage sweep is allowed to fail without failing the request. The archive copy
// happens BEFORE the delete (migration 041's archive_social_video) so a manual
// removal lands in the same place the 24h rotation puts expired posts. A missing
// archive function (migration not applied yet) must not block the delete, so
// that step is best-effort too.
//
// `scopeUserId` adds a `user_id = <caller>` filter to the DELETE so an ownership
// check can't be bypassed by a race between the read and the write. Pass null
// for admins, who may delete any post.
export async function archiveAndDeleteSocialVideo(
  supabase: SupabaseClient,
  row: DeletableSocialVideo,
  scopeUserId: string | null,
): Promise<DeleteResult> {
  const { error: archiveError } = await supabase.rpc("archive_social_video", {
    p_id: row.id,
  });
  if (archiveError) {
    console.error("archive_social_video failed:", archiveError.message);
  }

  const del = supabase.from("social_videos").delete().eq("id", row.id);
  const { error: deleteError } = await (scopeUserId
    ? del.eq("user_id", scopeUserId)
    : del);
  if (deleteError) {
    return { error: deleteError.message, storageErrors: [] };
  }

  const storageErrors: string[] = [];

  // YouTube posts have no storage object — video_url points at youtube.com, so
  // pathFromPublicUrl returns null and both removals are skipped naturally.
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

  return { storageErrors };
}
