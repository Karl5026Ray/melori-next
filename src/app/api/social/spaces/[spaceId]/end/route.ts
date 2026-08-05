import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { endRoomAndTeardown } from "@/lib/endRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces/[spaceId]/end - Host ends an active space.
// Only the host may end the room. Marks status='ended', stamps ended_at, AND
// tears down the matching LiveKit room so everyone still connected is
// actually disconnected (previously this route only updated the DB row,
// leaving connected clients stranded in a dead LiveKit room with no way out).
//
// This same route also serves MM Faces video rooms — Faces rooms are just
// `spaces` rows with a live_* room_format, and LiveRoom.tsx's finishLeave()
// posts here exactly like MM Spaces' handleEndSpace does. There is no
// separate Faces-specific end route; endRoomAndTeardown()'s room-name
// derivation already prefers space.livekit_room, which is how Faces rooms are
// tracked, so this single fix covers both.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  const { spaceId: rawSpaceId } = await params;
  const spaceId = String(rawSpaceId ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: space, error: fetchErr } = await supabase
    .from("spaces")
    .select("id, host_id, status")
    .eq("id", spaceId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (space.host_id !== membership.userId) {
    return NextResponse.json(
      { error: "Only the host can end this room" },
      { status: 403 }
    );
  }
  if (space.status === "ended") {
    return NextResponse.json({ ok: true, alreadyEnded: true });
  }

  const result = await endRoomAndTeardown(spaceId, "host-ended");
  if (!result.found) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // result.ended can be false here only if another request (e.g. a duplicate
  // double-click, or the abandonment reaper) won the race and ended it first
  // in the moment between our read above and the call below — that's still a
  // success from the caller's point of view (the room IS ended), so we don't
  // surface it as an error, matching the pre-existing "alreadyEnded" shape.
  return NextResponse.json({ ok: true, alreadyEnded: !result.ended });
}
