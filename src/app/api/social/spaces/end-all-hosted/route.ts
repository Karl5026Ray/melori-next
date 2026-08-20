import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { endRoomAndTeardown } from "@/lib/endRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces/end-all-hosted
//
// Called from src/lib/authSession.ts (signOutThisDevice / signOutAllDevices)
// — the single shared choke point every sign-out button in the app actually
// goes through — BEFORE the Supabase session is invalidated, since this
// route needs a still-valid bearer token to identify the caller. A deliberate
// sign-out is an unambiguous statement of intent: if the signing-out user is
// currently hosting any live MM Spaces/Faces room, end it the same way the
// "End" button does (DB status='ended' + LiveKit teardown + client
// notification), so remaining participants get the clean "This room has
// ended" treatment instead of being stranded connected to a room whose host
// just vanished.
//
// This does NOT touch rooms the caller is merely a participant/audience
// member in — only rooms where they are host_id, and only ones still 'live'.
// Best-effort per room: one room's teardown failing must never block ending
// the others, and this route itself must never be allowed to block sign-out
// (the caller wraps it in a try/catch and always completes sign-out
// regardless of this route's outcome).
//
// Gated on requireAuth rather than requireSuperfan (unlike the single-room
// /end/[spaceId] route): this runs unconditionally on every sign-out for
// every member, including free-tier ones who could never have started a room
// (the query below just returns zero rows for them), and we still want
// teardown to fire if membership lapsed mid-session while a room was live.
// Authorization for the actual end action is enforced by construction, not by
// membership tier: we only ever query and end rows where host_id === caller,
// so nobody can end anyone else's room through this route.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const callerId = guard.membership.userId!;

  const supabase = getSupabaseAdmin();
  const { data: hostedLive } = await supabase
    .from("spaces")
    .select("id")
    .eq("host_id", callerId)
    .eq("status", "live");

  const roomIds = (hostedLive ?? []).map((r) => r.id);
  const results = await Promise.allSettled(
    roomIds.map((id) => endRoomAndTeardown(id, "host-signed-out")),
  );

  const ended = results.filter(
    (r) => r.status === "fulfilled" && r.value.ended,
  ).length;

  return NextResponse.json({ ok: true, attempted: roomIds.length, ended });
}
