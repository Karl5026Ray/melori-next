import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces/[spaceId]/heartbeat
// Bumps last_activity_at so the reap_idle_spaces cron doesn't kill a live room.
// Also usable as a page-visible ping every ~60s from the client.
export async function POST(
  req: NextRequest,
  { params }: { params: { spaceId: string } },
) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const callerId = guard.membership.userId!;

  const supabase = getSupabaseAdmin();

  // Only participants of *this* space can keep it alive. Without this check,
  // any Superfan could ping any live space's last_activity_at and prevent
  // reap_idle_spaces() from ever cleaning up abandoned rooms.
  const { data: space } = await supabase
    .from("spaces")
    .select("id, host_id, status")
    .eq("id", params.spaceId)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (space.status !== "live") {
    // No-op: don't resurrect ended/scheduled spaces via heartbeat.
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (space.host_id !== callerId) {
    const { count } = await supabase
      .from("space_participants")
      .select("id", { count: "exact", head: true })
      .eq("space_id", params.spaceId)
      .eq("user_id", callerId)
      .is("left_at", null);
    if ((count ?? 0) === 0) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }
  }

  const { error } = await supabase
    .from("spaces")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", params.spaceId)
    .eq("status", "live");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
