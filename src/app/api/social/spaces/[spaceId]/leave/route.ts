import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { promoteHostOnLeave } from "@/lib/roomHost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces/[spaceId]/leave
// Called from `pagehide`/`beforeunload` via sendBeacon so the server sees the
// leave even if the tab crashes. Marks the caller left_at, and if the leaving
// user was the host, hands the room off to the oldest-tenured moderator (else
// oldest speaker) via promoteHostOnLeave(); only when nobody is eligible does
// the room end (Clubhouse-style ephemerality). All of this is decided
// server-side — the client never reassigns host.
//
// This intentionally does NOT require Superfan — audience users can leave.
// We just require a valid session so we can identify the leaver.
export async function POST(req: NextRequest, props: { params: Promise<{ spaceId: string }> }) {
  const params = await props.params;
  const { userId } = await getRequestMembership(req);
  if (!userId) {
    // sendBeacon can't retry; return 200 quietly so browsers stop caring.
    return NextResponse.json({ ok: false, reason: "no-session" });
  }

  const supabase = getSupabaseAdmin();
  const spaceId = params.spaceId;
  const now = new Date().toISOString();

  // Mark our participant row as left.
  await supabase
    .from("space_participants")
    .update({ left_at: now })
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .is("left_at", null);

  // Was the leaver the host? If so, check if any other hosts remain.
  const { data: space } = await supabase
    .from("spaces")
    .select("id, host_id, status")
    .eq("id", spaceId)
    .maybeSingle();

  if (!space || space.status !== "live") {
    return NextResponse.json({ ok: true });
  }

  const isHostLeaving = space.host_id === userId;
  if (!isHostLeaving) return NextResponse.json({ ok: true });

  // Host left: atomically promote the oldest moderator (else oldest speaker),
  // or end the room gracefully if nobody is eligible. Race-safe across the
  // duplicate signals a single leave produces (beacon + presence timeout).
  const { outcome, newHostId } = await promoteHostOnLeave(spaceId, userId);
  return NextResponse.json({ ok: true, outcome, newHostId });
}
