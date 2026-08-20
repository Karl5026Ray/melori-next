import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { reapIfHostAbandoned, recordHostSeen } from "@/lib/endRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces/[spaceId]/heartbeat
// Bumps last_activity_at so the reap_idle_spaces cron doesn't kill a live room.
// Also usable as a page-visible ping every ~60s from the client.
//
// This is ALSO one of the two lazy-reap trigger points (the other is the
// space detail GET route) for host-abandonment: since this route already
// loads the room on every ~60s beat from every participant, it costs nothing
// extra to also (a) stamp host_last_seen_at when the CALLER is the host, and
// (b) check whether the current host has been silent longer than
// HOST_GRACE_PERIOD_SECONDS and reap the room if so. No cron/worker needed —
// the next heartbeat or page load from ANYONE still in the room performs the
// check.
export async function POST(req: NextRequest, props: { params: Promise<{ spaceId: string }> }) {
  const params = await props.params;
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const callerId = guard.membership.userId!;

  const supabase = getSupabaseAdmin();

  // Only participants of *this* space can keep it alive. Without this check,
  // any Superfan could ping any live space's last_activity_at and prevent
  // reap_idle_spaces() from ever cleaning up abandoned rooms.
  const { data: space } = await supabase
    .from("spaces")
    .select("id, host_id, status, host_last_seen_at")
    .eq("id", params.spaceId)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (space.status !== "live") {
    // No-op: don't resurrect ended/scheduled spaces via heartbeat.
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Lazy abandonment reap: if the room's host has gone quiet past the grace
  // window, end it now instead of leaving remaining participants stranded
  // until someone eventually clicks something. Best-effort/idempotent (see
  // endRoom.ts) — concurrent heartbeats from other participants racing this
  // can never double-end or double-teardown.
  const reap = await reapIfHostAbandoned(space);
  if (reap.reaped) {
    return NextResponse.json({ ok: true, ended: true, reason: "host-abandoned" });
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
  } else {
    // Caller IS the current host: this heartbeat itself proves they're here.
    await recordHostSeen(params.spaceId, callerId);
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
