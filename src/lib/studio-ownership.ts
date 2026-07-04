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
