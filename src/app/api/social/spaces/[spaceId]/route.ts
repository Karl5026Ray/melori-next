import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { isHandRaiseMode } from "@/lib/spacesStage";
import { endRoomAndTeardown } from "@/lib/endRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/social/spaces/[spaceId]
// Host-only (verified below against space.host_id, never trusted from the
// client). Currently supports:
//   { action: "go_live" }               -> scheduled -> live
//   { action: "end" }                   -> live -> ended
//   { action: "set_hand_raise_mode",
//     hand_raise_mode: "off"|"followed"|"everyone" } -> host hand-raise policy
export async function PATCH(req: NextRequest, props: { params: Promise<{ spaceId: string }> }) {
  const params = await props.params;
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { userId } = guard.membership;

  const body = await req.json().catch(() => ({}));
  const action = body.action as "go_live" | "end" | "set_hand_raise_mode" | undefined;
  if (action !== "go_live" && action !== "end" && action !== "set_hand_raise_mode") {
    return NextResponse.json(
      { error: "action must be 'go_live', 'end', or 'set_hand_raise_mode'" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: space } = await supabase
    .from("spaces")
    .select("id, host_id, status")
    .eq("id", params.spaceId)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (space.host_id !== userId) {
    return NextResponse.json({ error: "Host only" }, { status: 403 });
  }

  const now = new Date().toISOString();

  // "end" goes through the shared helper instead of a bare column update so
  // this path (reachable but not currently used by any UI — the host's End
  // button posts to /api/social/spaces/[spaceId]/end instead) doesn't
  // silently strand connected LiveKit participants the same way that route
  // used to. Keeping this action working correctly rather than removing it,
  // since it is part of the route's public contract.
  if (action === "end") {
    if (space.status !== "live") {
      return NextResponse.json({ error: "Space is not live" }, { status: 409 });
    }
    const result = await endRoomAndTeardown(params.spaceId, "host-ended");
    if (!result.found) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }
    const { data: refreshed } = await supabase
      .from("spaces")
      .select()
      .eq("id", params.spaceId)
      .single();
    return NextResponse.json({ space: refreshed });
  }

  let update: Record<string, unknown> = {};
  if (action === "go_live") {
    if (space.status !== "scheduled") {
      return NextResponse.json(
        { error: "Space is not scheduled" },
        { status: 409 },
      );
    }
    update = { status: "live", last_activity_at: now, host_last_seen_at: now };
  } else {
    // set_hand_raise_mode
    if (!isHandRaiseMode(body.hand_raise_mode)) {
      return NextResponse.json(
        { error: "hand_raise_mode must be 'off', 'followed', or 'everyone'" },
        { status: 400 },
      );
    }
    update = { hand_raise_mode: body.hand_raise_mode };
  }

  const { data, error } = await supabase
    .from("spaces")
    .update(update)
    .eq("id", params.spaceId)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ space: data });
}
