import { NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { playlistsContainingTrack, type PlaylistTrackRef } from "@/lib/playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/radio/playlists/containing?sourceType=studio|legacy&id=<id>
// Returns the ids of the caller's playlists that already contain the track,
// so the "add to playlist" sheet can show checkmarks.
export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (isGuardFailure(guard)) return guard;

  const url = new URL(request.url);
  const sourceType = url.searchParams.get("sourceType");
  const id = url.searchParams.get("id");
  if ((sourceType !== "studio" && sourceType !== "legacy") || !id) {
    return NextResponse.json({ error: "Invalid track" }, { status: 400 });
  }
  const ref: PlaylistTrackRef = { sourceType, id };
  const playlistIds = await playlistsContainingTrack(
    guard.membership.userId!,
    ref,
  );
  return NextResponse.json({ playlistIds });
}
