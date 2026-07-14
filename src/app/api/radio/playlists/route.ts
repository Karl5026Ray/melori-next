import { NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { listPlaylists, createPlaylist } from "@/lib/playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/radio/playlists  -> the caller's playlists (with track counts)
// POST /api/radio/playlists  { name } -> create a playlist
export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (isGuardFailure(guard)) return guard;
  const playlists = await listPlaylists(guard.membership.userId!);
  return NextResponse.json({ playlists });
}

export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (isGuardFailure(guard)) return guard;
  let name = "My Playlist";
  try {
    const body = await request.json();
    if (typeof body?.name === "string" && body.name.trim()) {
      name = body.name;
    }
  } catch {
    /* empty body is fine — use default name */
  }
  const playlist = await createPlaylist(guard.membership.userId!, name);
  if (!playlist) {
    return NextResponse.json(
      { error: "Could not create playlist" },
      { status: 500 },
    );
  }
  return NextResponse.json({ playlist }, { status: 201 });
}
