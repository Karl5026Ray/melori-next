import { NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import {
  getPlaylistTracks,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  type PlaylistTrackRef,
} from "@/lib/playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRef(body: any): PlaylistTrackRef | null {
  const sourceType = body?.sourceType;
  const id = body?.id;
  if (sourceType !== "studio" && sourceType !== "legacy") return null;
  if (id === undefined || id === null || id === "") return null;
  return { sourceType, id };
}

// GET    /api/radio/playlists/[id]/tracks  -> { name, tracks } resolved to RadioTrack[]
// POST   /api/radio/playlists/[id]/tracks  { sourceType, id } -> add a track
// DELETE /api/radio/playlists/[id]/tracks  { sourceType, id } -> remove a track
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAuth(request);
  if (isGuardFailure(guard)) return guard;
  const result = await getPlaylistTracks(guard.membership.userId!, params.id);
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAuth(request);
  if (isGuardFailure(guard)) return guard;
  let ref: PlaylistTrackRef | null = null;
  try {
    ref = parseRef(await request.json());
  } catch {
    ref = null;
  }
  if (!ref) {
    return NextResponse.json({ error: "Invalid track" }, { status: 400 });
  }
  const ok = await addTrackToPlaylist(guard.membership.userId!, params.id, ref);
  if (!ok) {
    return NextResponse.json({ error: "Could not add track" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAuth(request);
  if (isGuardFailure(guard)) return guard;
  let ref: PlaylistTrackRef | null = null;
  try {
    ref = parseRef(await request.json());
  } catch {
    ref = null;
  }
  if (!ref) {
    return NextResponse.json({ error: "Invalid track" }, { status: 400 });
  }
  const ok = await removeTrackFromPlaylist(
    guard.membership.userId!,
    params.id,
    ref,
  );
  if (!ok) {
    return NextResponse.json(
      { error: "Could not remove track" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
