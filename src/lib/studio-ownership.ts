import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Per-artist ownership for studio_tracks. Every studio route runs through the
// service-role client (bypasses RLS), so ownership MUST be enforced here in
// application code. `profile_id` (a profiles.id / auth.uid()) is the owner —
// matching the artists/track_submissions convention. `membership.userId` from
// requireArtist is that same id.

// The owner column name, in one place so routes never hardcode the string.
export const OWNER_COLUMN = "profile_id" as const;

// Confirms `artistId` owns the track. On mismatch/absence returns a NextResponse
// (404 so we don't leak which ids exist) that the caller returns as-is; on
// success returns the resolved profile_id. Pass extra `columns` to also fetch
// fields the caller needs, avoiding a second round-trip.
export async function assertTrackOwnership(
  supabase: SupabaseClient,
  trackId: string,
  artistId: string | null,
  columns = "",
): Promise<{ owner: string; row: Record<string, any> } | NextResponse> {
  // requireArtist guarantees a non-null userId before we get here; guard anyway
  // so a null owner can never match a null profile_id row.
  if (!artistId) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const select = ["id", OWNER_COLUMN, ...(columns ? columns.split(",").map((c) => c.trim()) : [])]
    .filter(Boolean)
    .join(", ");

  const { data: row, error } = await supabase
    .from("studio_tracks")
    .select(select)
    .eq("id", trackId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  if ((row as Record<string, any>)[OWNER_COLUMN] !== artistId) {
    // 404 rather than 403: don't reveal that a track with this id exists.
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  return { owner: artistId, row: row as Record<string, any> };
}

export function isOwnershipFailure(
  result: { owner: string; row: Record<string, any> } | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

// Every studio upload goes through /api/studio/upload-url, which forces the
// storage path to `studio/<callerUserId>/...`. When a route accepts `file_path`
// (or `file_url` derived from getPublicUrl) back from the client to persist on
// a studio_tracks row, we MUST verify the caller isn't claiming another
// artist's path — otherwise a subsequent GET would sign that path and hand out
// the other artist's private master. Returns true when the path is safely
// scoped under the caller's own studio subfolder.
export function isOwnedStudioPath(
  filePath: unknown,
  userId: string | null,
): filePath is string {
  if (typeof filePath !== "string" || !userId) return false;
  const trimmed = filePath.trim();
  if (!trimmed) return false;
  // Block traversal and absolute paths; require the exact caller-scoped prefix.
  if (trimmed.includes("..")) return false;
  if (trimmed.startsWith("/")) return false;
  return trimmed.startsWith(`studio/${userId}/`);
}

// Companion check for file_url. The upload-url route publishes both a signed
// upload URL and a getPublicUrl string that embeds the same path. When the
// client sends `file_url` back, ensure the embedded path is under the caller's
// studio subfolder — a bare URL string is not sufficient proof of ownership.
export function isOwnedStudioFileUrl(
  fileUrl: unknown,
  userId: string | null,
): fileUrl is string {
  if (typeof fileUrl !== "string" || !userId) return false;
  const trimmed = fileUrl.trim();
  if (!trimmed) return false;
  // Match the exact per-artist prefix anywhere in the URL. getPublicUrl output
  // looks like `.../storage/v1/object/public/audio-files/studio/<uid>/<file>`
  // — the substring check is enough to reject cross-tenant paths without
  // hard-coding the Supabase URL shape.
  if (trimmed.includes("..")) return false;
  return trimmed.includes(`/studio/${userId}/`);
}
