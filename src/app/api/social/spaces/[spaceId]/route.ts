import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/social/spaces/[spaceId]
// Host-only. Currently supports:
//   { action: "go_live" }  → scheduled → live
//   { action: "end" }      → live → ended
export async function PATCH(
  req: NextRequest,
  { params }: { params: { spaceId: string } },
) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { userId } = guard.membership;

  const body = await req.json().catch(() => ({}));
  const action = body.action as "go_live" | "end" | undefined;
  if (action !== "go_live" && action !== "end") {
    return NextResponse.json(
      { error: "action must be 'go_live' or 'end'" },
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
  let update: Record<string, unknown> = {};
  if (action === "go_live") {
    if (space.status !== "scheduled") {
      return NextResponse.json(
        { error: "Space is not scheduled" },
        { status: 409 },
      );
    }
    update = { status: "live", last_activity_at: now };
  } else {
    if (space.status !== "live") {
      return NextResponse.json({ error: "Space is not live" }, { status: 409 });
    }
    update = { status: "ended", ended_at: now };
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
