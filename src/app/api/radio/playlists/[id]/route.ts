import { NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { renamePlaylist, deletePlaylist } from "@/lib/playlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH  /api/radio/playlists/[id]  { name } -> rename
// DELETE /api/radio/playlists/[id]           -> delete
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAuth(request);
  if (isGuardFailure(guard)) return guard;
  let name = "";
  try {
    const body = await request.json();
    name = typeof body?.name === "string" ? body.name : "";
  } catch {
    /* no body */
  }
  if (!name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  const ok = await renamePlaylist(guard.membership.userId!, params.id, name);
  if (!ok) {
    return NextResponse.json(
      { error: "Could not rename playlist" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAuth(request);
  if (isGuardFailure(guard)) return guard;
  const ok = await deletePlaylist(guard.membership.userId!, params.id);
  if (!ok) {
    return NextResponse.json(
      { error: "Could not delete playlist" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
