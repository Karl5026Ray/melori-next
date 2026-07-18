import { NextRequest, NextResponse } from "next/server";
import {
  requireAdmin,
  isAdminGuardFailure,
  logAdminAction,
} from "@/lib/admin-panel";
import { endSpaceAsAdmin } from "@/lib/roomHost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/spaces/[id]/end
//
// Admin override to forcefully shut down a live/dormant Space. This exists for
// rooms the empty-room reaper (mm-presence-reap cron + end_space_now) can't
// catch — e.g. a ghost participant keeps PubNub occupancy > 0, so the room
// never reads as "empty" and lingers as live. An admin explicitly deciding to
// close it bypasses the occupancy check entirely.
//
// Auth: standard admin model (Supabase access token → requireAdmin), matching
// the rest of /api/admin/*. The teardown itself (DB end + LiveKit deleteRoom +
// PubNub signal) runs with the service-role client inside endSpaceAsAdmin.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  const { id: rawId } = await props.params;
  const spaceId = String(rawId ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "Missing space id" }, { status: 400 });
  }

  let result: { found: boolean; ended: boolean };
  try {
    result = await endSpaceAsAdmin(spaceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to end space";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!result.found) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Audit every admin shutdown (best-effort; never fails the action).
  await logAdminAction(admin, {
    action: "end_room",
    targetType: "space",
    targetId: spaceId,
    details: {
      // false when the room was already ended and this call only cleaned up a
      // stale LiveKit room / re-broadcast the ended signal.
      performedEnd: result.ended,
    },
  });

  return NextResponse.json({
    ok: true,
    spaceId,
    ended: result.ended,
    alreadyEnded: !result.ended,
  });
}
