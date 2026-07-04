import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces/[spaceId]/leave
// Called from `pagehide`/`beforeunload` via sendBeacon so the server sees the
// leave even if the tab crashes. Marks the caller left_at, and if the leaving
// user was the last remaining host and the space has no other speakers, ends
// the space (Clubhouse-style ephemerality).
//
// This intentionally does NOT require Superfan — audience users can leave.
// We just require a valid session so we can identify the leaver.
export async function POST(
  req: NextRequest,
  { params }: { params: { spaceId: string } },
) {
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

  // If no active speakers remain, end the space.
  const { count } = await supabase
    .from("space_participants")
    .select("id", { count: "exact", head: true })
    .eq("space_id", spaceId)
    .in("role", ["host", "speaker"])
    .is("left_at", null);

  if ((count ?? 0) === 0) {
    await supabase
      .from("spaces")
      .update({ status: "ended", ended_at: now })
      .eq("id", spaceId);
  }

  return NextResponse.json({ ok: true });
}
