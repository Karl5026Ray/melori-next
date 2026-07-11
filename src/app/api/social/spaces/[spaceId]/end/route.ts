import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces/[spaceId]/end - Host ends an active space.
// Only the host may end the room. Marks status='ended' and stamps ended_at.
export async function POST(
  req: NextRequest,
  { params }: { params: { spaceId: string } }
) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  const spaceId = String(params?.spaceId ?? "").trim();
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

  const endedAt = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("spaces")
    .update({ status: "ended", ended_at: endedAt })
    .eq("id", spaceId)
    .select("id, status, ended_at")
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, space: updated });
}
