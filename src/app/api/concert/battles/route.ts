import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { concertBattleErrorResponse } from "@/lib/concertBattleApi";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/concert/battles
// Creates the space envelope, initiator participation, and battle aggregate in
// one service-only SQL transaction. Initiator identity is always token-derived.
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const initiatorId = guard.membership.userId;
  if (!isUuid(initiatorId)) {
    return NextResponse.json({ error: "Authenticated member id must be a UUID." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  const topic = String(body.topic ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "Concert title is required." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: spaceId, error } = await supabase.rpc("create_concert_battle", {
      p_initiator_id: initiatorId,
      p_title: title,
      p_topic: topic || null,
    });
    if (error || !spaceId) {
      const mapped = concertBattleErrorResponse(error?.message);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    return NextResponse.json(
      { space_id: spaceId, href: `/social/concert/${spaceId}` },
      { status: 201 },
    );
  } catch (error) {
    console.error("create concert battle failed", error);
    return NextResponse.json({ error: "Could not create the Concert." }, { status: 500 });
  }
}
