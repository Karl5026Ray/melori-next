import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/spaces/[spaceId]/participants
//
// The live roster of everyone currently in a room — the reliable presence
// signal is the space_participants table (a row is written on join, left_at is
// stamped on leave), joined to profiles for a name + avatar. The in-room UI
// renders this so viewers can see who else is here; it is refreshed on the
// LiveKit ParticipantConnected/Disconnected events (and a slow poll) so it
// tracks joins/leaves live. Runs on the admin client so it is not gated by the
// per-row RLS the anonymous client is subject to.
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ spaceId: string }> },
) {
  const params = await props.params;
  const spaceId = String(params.spaceId ?? "").trim();
  if (!spaceId || !isUuid(spaceId)) {
    return NextResponse.json({ participants: [] });
  }

  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("space_participants")
      .select(
        "user_id, role, badge, has_raised_hand, stage_requested_at, joined_at, user:profiles(display_name, username, avatar_url)",
      )
      .eq("space_id", spaceId)
      .is("left_at", null)
      .order("joined_at", { ascending: true })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Roster order stays join-order (the audience grid reads it that way), but
    // each row now carries stage_requested_at — the moment the CURRENT hand went
    // up, stamped by the trg_sync_stage_requested_at trigger (028). Consumers
    // sort the raise-hand queue by it so hosts work the queue oldest-request
    // first; sorting by joined_at instead made the queue order arbitrary for
    // people who joined together.
    const participants = (data ?? []).map((r: any) => ({
      user_id: r.user_id,
      role: r.role ?? "audience",
      badge: r.badge ?? null,
      has_raised_hand: !!r.has_raised_hand,
      stage_requested_at: r.stage_requested_at ?? null,
      name: r.user?.display_name || r.user?.username || "Guest",
      avatar: r.user?.avatar_url ?? null,
    }));

    return NextResponse.json(
      { participants },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load participants" },
      { status: 500 },
    );
  }
}
